import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import './App.css'

type Invoice = {
  id: string
  invoiceId: string
  invoiceNumber: string | null
  invoiceDate: string | null
  dueDate: string | null
  vendor: string | null
  currency: string | null
  total: string | null
  invoiceUrl: string | null
  description: string | null
  category: string | null
  amountPaid: string
  balanceDue: string | null
  overpayment: string | null
  paymentDate: string | null
  paymentStatus: 'unpaid' | 'partially_paid' | 'paid' | 'overpaid'
  syncPending: boolean
}

type Payment = {
  id: string
  date: string
  amount: string
  currency: string
  paidBy: string | null
  reference: string | null
  receipts: { url: string }[]
}

type ReceiptReview = {
  id: string
  filename: string
  targetInvoiceId: string | null
  proof: {
    vendorName: string | null
    invoiceReference: string | null
    transactionReference: string | null
    amount: string
    currency: string
    paymentDate: string
    successful: boolean
  }
}

type Dashboard = {
  invoices: Invoice[]
  reviews: ReceiptReview[]
  googleConnected: boolean
  canConnectGoogle: boolean
}

type Expense = {
  id: string
  expenseId: string
  description: string
  vendor: string | null
  paymentDate: string
  amount: string
  currency: string
  status: string
  hasReceipt: boolean
  receiptUrl: string | null
  linkedInvoice: string | null
  syncPending: boolean
}

type ExpenseDraft = {
  description: string
  vendor: string
  paymentDate: string
  currency: string
  amount: string
  method?: string
  transactionReference?: string
  receiptNumber?: string
}

type UploadResult = {
  kind: 'invoice' | 'receipt' | 'duplicate' | 'review'
  invoiceId: string | null
  reviewId?: string
}

const months = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const labels = {
  unpaid: 'Unpaid',
  partially_paid: 'Partially paid',
  paid: 'Paid',
  overpaid: 'Paid · Overpaid',
}
const fileTypes = 'application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png'
const pageSize = 5

function formatMoney(amount: string | null, currency: string | null) {
  if (amount === null || !currency) return '—'
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(Number(amount))
}

function formatDate(value: string | null) {
  if (!value) return '—'
  const date = new Date(value + 'T00:00:00Z')
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  }).format(date)
}

function totalByCurrency(invoices: Invoice[]) {
  const amounts = new Map<string, bigint>()
  for (const { currency, total } of invoices) {
    if (!currency || total === null) continue
    const [units, cents = ''] = total.replace(/^-/, '').split('.')
    const unsigned = BigInt(units) * 100n + BigInt(cents.padEnd(2, '0'))
    const amount = total.startsWith('-') ? -unsigned : unsigned
    amounts.set(currency, (amounts.get(currency) ?? 0n) + amount)
  }
  return [...amounts].sort(([left], [right]) => left.localeCompare(right)).map(([currency, cents]) => {
    const absolute = cents < 0n ? -cents : cents
    const decimal = String(absolute / 100n) + '.' + String(absolute % 100n).padStart(2, '0')
    return { currency, amount: cents < 0n ? '-' + decimal : decimal }
  })
}

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: 'include', ...options })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(result.error || (response.status === 401 ? 'Sign in again to continue.' : 'Try again. The request could not be completed.'))
  }
  return result as T
}

function Chevron({ expanded }: { expanded: boolean }) {
  return <span className={'chevron' + (expanded ? ' chevron-up' : '')} aria-hidden="true" />
}

function Modal({ title, busy, onClose, children }: {
  title: string; busy: boolean; onClose: () => void; children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])
  return (
    <dialog ref={ref} className="invoice-dialog" aria-label={title} onCancel={(event) => {
      event.preventDefault()
      if (!busy) onClose()
    }}>
      <div className="dialog-heading">
        <h2>{title}</h2>
        <button className="icon-button" type="button" aria-label="Close" disabled={busy} onClick={onClose}>×</button>
      </div>
      {children}
    </dialog>
  )
}

function InvoiceDetails({ invoice, onReceipt }: { invoice: Invoice; onReceipt: () => void }) {
  const [activity, setActivity] = useState<{ payments: Payment[]; error: string }>()
  const { id, amountPaid, syncPending } = invoice
  useEffect(() => {
    const controller = new AbortController()
    void api<{ payments: Payment[] }>('/api/invoices/' + id, { signal: controller.signal })
      .then(({ payments }) => setActivity({ payments, error: '' }))
      .catch((error: Error) => { if (!controller.signal.aborted) setActivity({ payments: [], error: error.message }) })
    return () => controller.abort()
  }, [id, amountPaid, syncPending])

  return (
    <div className="invoice-details" id={'details-' + id}>
      {invoice.description && <p className="detail-description">{invoice.description}</p>}
      <dl className="invoice-facts">
        <div><dt>Invoice date</dt><dd>{formatDate(invoice.invoiceDate)}</dd></div>
        <div><dt>Due date</dt><dd>{formatDate(invoice.dueDate)}</dd></div>
        <div><dt>Amount paid</dt><dd>{formatMoney(invoice.amountPaid, invoice.currency)}</dd></div>
        <div><dt>Balance due</dt><dd>{formatMoney(invoice.balanceDue, invoice.currency)}</dd></div>
        {Number(invoice.overpayment) > 0 && <div><dt>Overpayment</dt><dd>{formatMoney(invoice.overpayment, invoice.currency)}</dd></div>}
      </dl>
      {activity?.error && <p className="inline-error" role="alert">{activity.error}</p>}
      {!!activity?.payments.length && (
        <ul className="payment-entries" aria-label="Verified payments">
          {activity.payments.map((payment) => (
            <li key={payment.id}>
              <span><strong>{formatMoney(payment.amount, payment.currency)}</strong> · {formatDate(payment.date)}
                {payment.paidBy && ' · ' + payment.paidBy}</span>
              <div className="proof-links">
                {payment.receipts.map((receipt, index) => <a key={receipt.url} href={receipt.url} target="_blank" rel="noreferrer">
                  {payment.receipts.length === 1 ? 'Payment proof' : 'Proof ' + (index + 1)}
                </a>)}
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="detail-actions">
        {invoice.invoiceUrl && <a className="button button-outline" href={invoice.invoiceUrl} target="_blank" rel="noreferrer">Open invoice ↗</a>}
        <button className="button button-primary" type="button" onClick={onReceipt}>Upload receipt</button>
      </div>
    </div>
  )
}

function ExpenseForm({ expense, initialFile, onClose, onSave }: {
  expense?: Expense
  initialFile?: File
  onClose: () => void
  onSave: (expense: Expense) => void
}) {
  const [mode, setMode] = useState<'receipt' | 'manual'>(expense || initialFile ? 'receipt' : 'manual')
  const [file, setFile] = useState(initialFile)
  const [receiptRead, setReceiptRead] = useState(false)
  const [requestId] = useState(() => crypto.randomUUID())
  const [draft, setDraft] = useState<ExpenseDraft>(() => ({
    description: expense?.description ?? '',
    vendor: expense?.vendor ?? '',
    amount: expense?.amount ?? '',
    currency: expense?.currency ?? 'INR',
    paymentDate: expense?.paymentDate ?? new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date()),
  }))
  const [busy, setBusy] = useState<'read' | 'save'>()
  const [error, setError] = useState('')
  const reading = mode === 'receipt' && !receiptRead

  async function readReceipt() {
    if (!file) return
    setBusy('read')
    setError('')
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('Choose a file up to 10 MB.')
      const form = new FormData()
      form.set('files', file)
      const proof = await api<ExpenseDraft>('/api/expenses/read-receipt', { method: 'POST', body: form })
      setDraft({
        ...proof,
        description: expense?.description ?? proof.description,
        vendor: proof.vendor || expense?.vendor || '',
      })
      setReceiptRead(true)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not read this receipt.')
    } finally {
      setBusy(undefined)
    }
  }

  async function save() {
    setBusy('save')
    setError('')
    try {
      const form = new FormData()
      if (mode === 'receipt' && file) form.set('files', file)
      form.set('details', JSON.stringify(expense ? draft : { requestId, details: draft }))
      const path = expense ? '/api/expenses/' + expense.id + '/receipt' : '/api/expenses'
      onSave(await api<Expense>(path, { method: 'POST', body: form }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save this expense.')
    } finally {
      setBusy(undefined)
    }
  }

  return (
    <Modal title={expense ? 'Add expense receipt' : 'Record expense'} busy={Boolean(busy)} onClose={onClose}>
      {expense
        ? <p className="dialog-intro">{expense.expenseId} · {expense.description} · {formatMoney(expense.amount, expense.currency)}</p>
        : <div className="segments expense-modes" aria-label="Expense entry method">
          <button type="button" aria-pressed={mode === 'receipt'} disabled={Boolean(busy)} onClick={() => {
            setError('')
            setMode('receipt')
          }}>Upload receipt</button>
          <button type="button" aria-pressed={mode === 'manual'} disabled={Boolean(busy)} onClick={() => {
            setError('')
            setMode('manual')
            if (receiptRead) {
              setReceiptRead(false)
              setDraft(({ description, vendor, paymentDate, currency, amount }) => ({ description, vendor, paymentDate, currency, amount }))
            }
          }}>Enter manually</button>
        </div>}
      <form className="dialog-form" key={mode} onSubmit={(event) => {
        event.preventDefault()
        if (reading) void readReceipt()
        else void save()
      }}>
        {mode === 'receipt' && <label>Receipt or payment screenshot
          <input type="file" accept={fileTypes} disabled={Boolean(busy)} onChange={(event) => {
            setFile(event.currentTarget.files?.[0])
            setReceiptRead(false)
            setError('')
          }} />
        </label>}
        {mode === 'receipt' && file && <small className="filename">{file.name}</small>}
        {!reading && <>
          {!expense && <label>What did you pay for?
            <input value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              placeholder="e.g. Whiteboard" maxLength={160} required disabled={Boolean(busy)} />
          </label>}
          <div className="expense-fields">
            <label>Amount paid
              <input value={draft.amount} onChange={(event) => setDraft({ ...draft, amount: event.target.value })}
                inputMode="decimal" pattern={'(?:0|[1-9][0-9]{0,12})(?:[.][0-9]{1,2})?'} required disabled={Boolean(busy) || Boolean(expense)} />
            </label>
            <label>Currency
              <input value={draft.currency} onChange={(event) => setDraft({ ...draft, currency: event.target.value.toUpperCase() })}
                maxLength={3} pattern="[A-Z]{3}" required disabled={Boolean(busy) || Boolean(expense)} />
            </label>
          </div>
          <label>Payment date
            <input type="date" value={draft.paymentDate} onChange={(event) => setDraft({ ...draft, paymentDate: event.target.value })}
              required disabled={Boolean(busy) || Boolean(expense)} />
          </label>
          <label>Vendor <span className="optional">(optional)</span>
            <input value={draft.vendor} onChange={(event) => setDraft({ ...draft, vendor: event.target.value })}
              maxLength={160} disabled={Boolean(busy)} />
          </label>
          {mode === 'receipt' && draft.receiptNumber && <small>Receipt {draft.receiptNumber}</small>}
        </>}
        {error && <p className="inline-error" role="alert">{error}</p>}
        <button className="button button-primary" type="submit" disabled={Boolean(busy) || (mode === 'receipt' && !file)}>
          {busy === 'read' ? 'Reading receipt…' : busy === 'save' ? 'Saving…'
            : reading ? 'Read receipt' : expense ? 'Save receipt' : 'Save paid expense'}
        </button>
      </form>
    </Modal>
  )
}

function LinkExpense({ expense, invoices, onClose, onSave }: {
  expense: Expense
  invoices: Invoice[]
  onClose: () => void
  onSave: (expense: Expense) => void
}) {
  const [invoiceId, setInvoiceId] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function link() {
    setBusy(true)
    setError('')
    try {
      onSave(await api<Expense>('/api/expenses/' + expense.id + '/link-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId }),
      }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not link this expense.')
    } finally {
      setBusy(false)
    }
  }

  return <Modal title="Link expense to invoice" busy={busy} onClose={onClose}>
    <p className="dialog-intro">{formatMoney(expense.amount, expense.currency)} paid on {formatDate(expense.paymentDate)} for {expense.description}.</p>
    <form className="dialog-form" onSubmit={(event) => { event.preventDefault(); void link() }}>
      <label>Invoice
        <select value={invoiceId} disabled={busy} onChange={(event) => setInvoiceId(event.target.value)} required>
          <option value="">Select invoice</option>
          {invoices.filter((invoice) => invoice.currency === expense.currency && invoice.total).map((invoice) =>
            <option key={invoice.id} value={invoice.id}>{[invoice.invoiceId, invoice.vendor, invoice.invoiceNumber,
              formatMoney(invoice.total, invoice.currency)].filter(Boolean).join(' · ')}</option>,
          )}
        </select>
      </label>
      {error && <p className="inline-error" role="alert">{error}</p>}
      <button className="button button-primary" type="submit" disabled={busy || !invoiceId}>{busy ? 'Linking…' : 'Confirm payment link'}</button>
    </form>
  </Modal>
}

function ExpenseList({ expenses, onReceipt, onLink }: {
  expenses: Expense[]
  onReceipt: (expense: Expense) => void
  onLink: (expense: Expense) => void
}) {
  const [showAll, setShowAll] = useState(false)
  return <section className="register" aria-labelledby="expenses-title">
    <div className="register-heading expense-heading"><h2 id="expenses-title">Expenses without invoices</h2></div>
    {!expenses.length && <p className="empty-state">No expenses in this period.</p>}
    <ul className="invoice-list">
      {(showAll ? expenses : expenses.slice(0, pageSize)).map((expense) => (
        <li className="invoice-item" key={expense.id}>
          <details className="expense-detail">
            <summary className="invoice-row">
              <span className="invoice-identity">
                <strong>{expense.description}</strong>
                <small>{[expense.expenseId, expense.vendor, formatDate(expense.paymentDate)].filter(Boolean).join(' · ')}</small>
              </span>
              <span className="invoice-amount">{formatMoney(expense.amount, expense.currency)}</span>
              <span className="invoice-state">
                <span className={'status ' + (expense.hasReceipt || expense.linkedInvoice ? 'status-paid' : 'status-unpaid')}>
                  {expense.linkedInvoice ?? (expense.hasReceipt ? 'Paid' : 'Paid · No receipt')}
                </span>
                {expense.syncPending && <small>Sync pending</small>}
              </span>
              <Chevron expanded={false} />
            </summary>
            <div className="invoice-details detail-actions">
              {expense.receiptUrl && <a className="button button-outline" href={expense.receiptUrl} target="_blank" rel="noreferrer">Open receipt ↗</a>}
              {!expense.hasReceipt && <button className="button button-outline" type="button" onClick={() => onReceipt(expense)}>Add receipt</button>}
              {!expense.linkedInvoice && <button className="button button-outline" type="button" onClick={() => onLink(expense)}>Link to invoice</button>}
              {expense.hasReceipt && !expense.receiptUrl && <small>Receipt sync pending</small>}
              {expense.linkedInvoice && <small>Linked to {expense.linkedInvoice}</small>}
            </div>
          </details>
        </li>
      ))}
    </ul>
    {expenses.length > pageSize && <button type="button" aria-expanded={showAll} className="show-button" onClick={() => setShowAll(!showAll)}>
      {showAll ? 'Show less' : 'Show all expenses'} <Chevron expanded={showAll} />
    </button>}
  </section>
}

export default function App({ user, onLogout }: { user: { name: string }; onLogout: () => void }) {
  const [dashboard, setDashboard] = useState<Dashboard>()
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [expenseLoadError, setExpenseLoadError] = useState('')
  const [expenseForm, setExpenseForm] = useState<{ expense?: Expense; file?: File }>()
  const [expenseLink, setExpenseLink] = useState<Expense>()
  const [loadError, setLoadError] = useState('')
  const [notice, setNotice] = useState('')
  const [uploadError, setUploadError] = useState('')
  const [search, setSearch] = useState('')
  const [vendor, setVendor] = useState('')
  const [month, setMonth] = useState('')
  const [year, setYear] = useState('')
  const [awaiting, setAwaiting] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [expandedId, setExpandedId] = useState<string>()
  const [busy, setBusy] = useState<'invoice' | 'receipt' | 'review'>()
  const [receipt, setReceipt] = useState<{ invoice: Invoice; file?: File }>()
  const [payer, setPayer] = useState('')
  const [review, setReview] = useState<{ id: string; invoiceId: string }>()
  const [modalError, setModalError] = useState('')
  const [dragged, setDragged] = useState<'invoice' | 'receipt'>()
  const invoicePicker = useRef<HTMLInputElement>(null)
  const requestId = useRef(0)

  const load = useCallback(async (signal?: AbortSignal) => {
    const id = ++requestId.current
    const [invoiceResult, expenseResult] = await Promise.allSettled([
      api<Dashboard>('/api/invoices', { signal }),
      api<{ expenses: Expense[] }>('/api/expenses', { signal }),
    ])
    if (id !== requestId.current || signal?.aborted) return
    if (invoiceResult.status === 'fulfilled') {
      setDashboard(invoiceResult.value)
      setLoadError('')
    } else {
      setLoadError(invoiceResult.reason instanceof Error ? invoiceResult.reason.message : 'Could not load invoices.')
    }
    if (expenseResult.status === 'fulfilled') {
      setExpenses(expenseResult.value.expenses)
      setExpenseLoadError('')
    } else {
      setExpenseLoadError('Could not load expenses.')
    }
  }, [])
  const syncing = dashboard?.invoices.some((invoice) => invoice.syncPending) || expenses.some((expense) => expense.syncPending)
  useEffect(() => {
    const controller = new AbortController()
    queueMicrotask(() => { if (!controller.signal.aborted) void load(controller.signal) })
    const refreshWhenFocused = () => { void load(controller.signal) }
    window.addEventListener('focus', refreshWhenFocused)
    return () => {
      controller.abort()
      window.removeEventListener('focus', refreshWhenFocused)
    }
  }, [load])
  useEffect(() => {
    if (!syncing) return
    const timer = window.setInterval(() => { if (!document.hidden) void load() }, 4000)
    return () => window.clearInterval(timer)
  }, [load, syncing])

  const invoices = dashboard?.invoices ?? []
  const vendorOptions = [...new Set(invoices.flatMap((invoice) => invoice.vendor ? [invoice.vendor] : []))].sort((a, b) => a.localeCompare(b))
  const yearOptions = [...new Set([
    ...invoices.flatMap((invoice) => invoice.invoiceDate ? [invoice.invoiceDate.slice(0, 4)] : []),
    ...expenses.map((expense) => expense.paymentDate.slice(0, 4)),
  ])].sort().reverse()
  const visibleExpenses = expenses.filter((expense) =>
    (!month || expense.paymentDate.slice(5, 7) === month) && (!year || expense.paymentDate.slice(0, 4) === year),
  )
  const query = search.trim().toLowerCase()
  const matches = invoices.filter((invoice) =>
    (!query || [invoice.vendor, invoice.invoiceId, invoice.invoiceNumber].some((value) => value?.toLowerCase().includes(query))) &&
    (!vendor || invoice.vendor === vendor) && (!month || invoice.invoiceDate?.slice(5, 7) === month) &&
    (!year || invoice.invoiceDate?.slice(0, 4) === year) &&
    (!awaiting || invoice.paymentStatus === 'unpaid' || invoice.paymentStatus === 'partially_paid'),
  )
  const visible = showAll ? matches : matches.slice(0, pageSize)
  const totals = totalByCurrency(matches)
  const narrowed = Boolean(query || vendor || month || year || awaiting)
  const pendingReview = dashboard?.reviews.find((row) => row.id === review?.id)

  function openReceipt(invoice: Invoice) {
    setModalError('')
    setPayer('')
    setReceipt({ invoice })
  }

  function handleExpenseSave(saved: Expense) {
    if (expenseForm && !expenseForm.expense) {
      setMonth('')
      setYear('')
    }
    setExpenseForm(undefined)
    setExpenseLink(undefined)
    setNotice(saved.expenseId + (saved.linkedInvoice ? ' linked to ' + saved.linkedInvoice + '.' : ' saved.'))
    setUploadError('')
    void load()
  }

  function resetListView() {
    setShowAll(false)
    setExpandedId(undefined)
  }

  function handleResult(result: UploadResult) {
    setNotice({
      invoice: 'Invoice added as unpaid.',
      receipt: 'Receipt matched. The invoice will update when its proof is saved.',
      duplicate: 'Already recorded. The existing invoice was kept.',
      review: 'Check which invoice this receipt belongs to.',
    }[result.kind])
    if (result.reviewId) setReview({ id: result.reviewId, invoiceId: result.invoiceId ?? '' })
    if (result.kind === 'invoice') {
      setSearch('')
      setVendor('')
      setMonth('')
      setYear('')
      setAwaiting(false)
      resetListView()
    }
  }

  async function uploadFile(kind: 'invoice' | 'receipt', file: File, invoiceId?: string) {
    setBusy(kind)
    setNotice('')
    setUploadError('')
    setModalError('')
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('Choose a file smaller than 10 MB.')
      const form = new FormData()
      form.set('kind', kind)
      if (invoiceId) form.set('invoiceId', invoiceId)
      if (kind === 'receipt' && payer.trim()) form.set('paidBy', payer.trim())
      form.set('files', file)
      const result = await api<UploadResult>('/api/upload', { method: 'POST', body: form })
      if (kind === 'receipt') setReceipt(undefined)
      await load()
      handleResult(result)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The upload did not finish.'
      if (kind === 'invoice') setUploadError(message)
      else setModalError(message)
    } finally {
      setBusy(undefined)
    }
  }

  async function applyReview() {
    if (!review?.invoiceId) return
    setBusy('review')
    setModalError('')
    try {
      const result = await api<UploadResult>('/api/receipt-reviews/' + review.id + '/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId: review.invoiceId }),
      })
      setReview(undefined)
      handleResult(result)
      await load()
    } catch (error) {
      setModalError(error instanceof Error ? error.message : 'Could not confirm the receipt.')
    } finally {
      setBusy(undefined)
    }
  }

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <span className="brand"><span className="brand-mark" aria-hidden="true">C</span>ChatDeal</span>
          <div className="account"><span>{user.name}</span><button type="button" className="quiet-link" onClick={onLogout}>Sign out</button></div>
        </div>
      </header>
      <main className="workspace">
        <div className="page-title">
          <h1>Invoice Manager</h1>
          <p>Track invoices, payment proof, and expenses.</p>
        </div>

        <input ref={invoicePicker} type="file" accept={fileTypes} hidden onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void uploadFile('invoice', file)
        }} />
        <div className="upload-grid">
          {(['invoice', 'receipt'] as const).map((kind) => (
            <button
              type="button" key={kind} disabled={Boolean(busy)}
              className={'upload-action upload-' + kind + (dragged === kind ? ' dragging' : '')}
              onClick={() => kind === 'invoice' ? invoicePicker.current?.click() : setExpenseForm({})}
              onDragOver={(event) => { event.preventDefault(); if (!busy) setDragged(kind) }}
              onDragLeave={() => setDragged(undefined)}
              onDrop={(event) => {
                event.preventDefault()
                setDragged(undefined)
                const file = event.dataTransfer.files[0]
                if (file && !busy) {
                  if (kind === 'invoice') void uploadFile('invoice', file)
                  else setExpenseForm({ file })
                }
              }}
            >
              <span className="upload-icon" aria-hidden="true">{kind === 'invoice' ? '↑' : '+'}</span>
              <span><strong>{kind === 'invoice' ? busy === 'invoice' ? 'Reading invoice…' : 'Upload invoice' : 'Record expense'}</strong>
                <small>{kind === 'invoice' ? 'Add a new vendor bill' : 'With or without a receipt'}</small></span>
              <span className="upload-arrow" aria-hidden="true">↗</span>
            </button>
          ))}
        </div>
        <p className="file-note">PDF, JPG, or PNG · Up to 10 MB per file</p>
        {notice && <p className="feedback" role="status">{notice}</p>}
        {uploadError && <p className="feedback feedback-error" role="alert">{uploadError}</p>}
        {dashboard && !dashboard.googleConnected && <p className="feedback">
          Drive and Sheets will sync once Google is connected.
          {dashboard.canConnectGoogle && <> <a href="/api/auth/google/login" target="_blank" rel="noreferrer">Connect Google</a></>}
        </p>}

        {!!dashboard?.reviews.length && (
          <section className="review-list" aria-label="Receipts to review">
            {dashboard.reviews.map((row) => (
              <button type="button" className="review-notice" key={row.id} disabled={Boolean(busy)} onClick={() => {
                setModalError('')
                setReview({ id: row.id, invoiceId: row.targetInvoiceId ?? '' })
              }}>
                <span><strong>Receipt needs review</strong><small>{row.proof.vendorName ?? row.filename} · {formatMoney(row.proof.amount, row.proof.currency)}</small></span>
                <span>Review ↗</span>
              </button>
            ))}
          </section>
        )}

        <section className="register" aria-labelledby="register-title">
          <div className="register-heading">
            <h2 id="register-title">Invoices</h2>
            <div className="segments" aria-label="Invoice list">
              <button type="button" aria-pressed={!awaiting} onClick={() => { setAwaiting(false); resetListView() }}>All invoices</button>
              <button type="button" aria-pressed={awaiting} onClick={() => { setAwaiting(true); resetListView() }}>Awaiting receipt</button>
            </div>
          </div>

          <div className="filters">
            <input type="search" value={search} onChange={(event) => { setSearch(event.target.value); resetListView() }}
              aria-label="Search invoices" placeholder="Search vendor or invoice ID / number" />
            <select aria-label="Vendor" value={vendor} onChange={(event) => { setVendor(event.target.value); resetListView() }}>
              <option value="">All vendors</option>
              {vendorOptions.map((item) => <option key={item}>{item}</option>)}
            </select>
            <select aria-label="Month" value={month} onChange={(event) => { setMonth(event.target.value); resetListView() }}>
              <option value="">All months</option>
              {months.map((label, index) => <option key={label} value={String(index + 1).padStart(2, '0')}>{label}</option>)}
            </select>
            <select aria-label="Year" value={year} onChange={(event) => { setYear(event.target.value); resetListView() }}>
              <option value="">All years</option>
              {yearOptions.map((item) => <option key={item}>{item}</option>)}
            </select>
          </div>

          {dashboard && <div className="invoice-totals">
            <div><span>{narrowed ? 'Matching invoices' : 'Total invoices'}</span><strong>{matches.length}</strong></div>
            <div><span>Invoice amount</span><strong>
              {totals.length ? totals.map(({ currency, amount }) => formatMoney(amount, currency)).join(' · ') : '—'}
            </strong></div>
          </div>}
          {loadError && <p className="feedback feedback-error" role="alert">{loadError} <button className="quiet-link" type="button" onClick={() => void load()}>Retry</button></p>}
          {!dashboard && !loadError && <p className="empty-state" role="status">Loading invoices…</p>}
          {dashboard && !visible.length && <p className="empty-state">
            {narrowed ? 'No invoices match this view.' : 'Upload an invoice to start tracking it.'}
          </p>}

          <ul className="invoice-list">
            {visible.map((invoice) => {
              const expanded = expandedId === invoice.id
              return <li key={invoice.id} className="invoice-item">
                <button className="invoice-row" type="button" aria-expanded={expanded}
                  aria-controls={expanded ? 'details-' + invoice.id : undefined}
                  onClick={() => setExpandedId(expanded ? undefined : invoice.id)}>
                  <span className="invoice-identity">
                    <strong>{invoice.vendor ?? 'Vendor not recorded'}</strong>
                    <small>{[invoice.invoiceId, invoice.invoiceNumber, invoice.invoiceDate && formatDate(invoice.invoiceDate)].filter(Boolean).join(' · ')}</small>
                  </span>
                  <span className="invoice-amount">{formatMoney(invoice.total, invoice.currency)}</span>
                  <span className="invoice-state">
                    <span className={'status status-' + invoice.paymentStatus}>{labels[invoice.paymentStatus]}</span>
                    {invoice.syncPending && <small>Sync pending</small>}
                  </span>
                  <Chevron expanded={expanded} />
                </button>
                {expanded && <InvoiceDetails invoice={invoice} onReceipt={() => openReceipt(invoice)} />}
              </li>
            })}
          </ul>
          {matches.length > pageSize && <button className="show-button" type="button"
            aria-expanded={showAll} onClick={() => {
              if (showAll && !matches.slice(0, pageSize).some((invoice) => invoice.id === expandedId)) setExpandedId(undefined)
              setShowAll(!showAll)
            }}>{showAll ? 'Show less' : 'Show all invoices'} <Chevron expanded={showAll} /></button>}
        </section>
        {expenseLoadError && <p className="feedback feedback-error" role="alert">{expenseLoadError} <button className="quiet-link" type="button" onClick={() => void load()}>Retry</button></p>}
        {!!expenses.length && <ExpenseList expenses={visibleExpenses}
          onReceipt={(expense) => setExpenseForm({ expense })} onLink={setExpenseLink} />}
      </main>

      {expenseForm && <ExpenseForm expense={expenseForm.expense} initialFile={expenseForm.file}
        onClose={() => setExpenseForm(undefined)} onSave={handleExpenseSave} />}
      {expenseLink && <LinkExpense expense={expenseLink} invoices={invoices}
        onClose={() => setExpenseLink(undefined)} onSave={handleExpenseSave} />}
      {receipt && <Modal title="Upload receipt" busy={Boolean(busy)} onClose={() => setReceipt(undefined)}>
        <p className="dialog-intro">{[receipt.invoice.invoiceId, receipt.invoice.vendor, receipt.invoice.invoiceNumber].filter(Boolean).join(' · ')}</p>
        <form className="dialog-form" onSubmit={(event) => {
          event.preventDefault()
          if (receipt.file) void uploadFile('receipt', receipt.file, receipt.invoice.id)
        }}>
          <label>Payment proof
            <input type="file" accept={fileTypes} disabled={Boolean(busy)} onChange={(event) => {
              setReceipt({ ...receipt, file: event.target.files?.[0] })
            }} />
          </label>
          {receipt.file && <small className="filename">{receipt.file.name}</small>}
          <label>Paid by <span className="optional">(optional)</span>
            <input type="text" placeholder="Name of the person who paid" value={payer} maxLength={120}
              disabled={Boolean(busy)} onChange={(event) => setPayer(event.target.value)} />
          </label>
          {modalError && <p className="inline-error" role="alert">{modalError}</p>}
          <button className="button button-primary" type="submit" disabled={Boolean(busy) || !receipt.file}>
            {busy ? 'Checking payment proof…' : 'Upload receipt'}
          </button>
        </form>
      </Modal>}
      {review && pendingReview && <Modal title="Match receipt" busy={Boolean(busy)} onClose={() => setReview(undefined)}>
        <p className="dialog-intro">Compare the payment proof with the invoice before confirming.</p>
        <div className="proof-preview">
          <strong>{pendingReview.proof.vendorName ?? pendingReview.filename}</strong>
          <span>{formatMoney(pendingReview.proof.amount, pendingReview.proof.currency)} · {formatDate(pendingReview.proof.paymentDate)}</span>
          {pendingReview.proof.transactionReference && <span>Payment reference {pendingReview.proof.transactionReference}</span>}
          <a href={'/api/receipt-reviews/' + pendingReview.id + '/file'} target="_blank" rel="noreferrer">Open payment proof ↗</a>
        </div>
        <form className="dialog-form" onSubmit={(event) => { event.preventDefault(); void applyReview() }}>
          <label>Invoice
            <select value={review.invoiceId} disabled={Boolean(busy)} onChange={(event) => setReview({ ...review, invoiceId: event.target.value })}>
              <option value="">Select invoice</option>
              {invoices.filter((invoice) => invoice.currency === pendingReview.proof.currency).map((invoice) =>
                <option key={invoice.id} value={invoice.id}>{[invoice.invoiceId, invoice.vendor, invoice.invoiceNumber,
                  formatMoney(invoice.total, invoice.currency)].filter(Boolean).join(' · ')}</option>,
              )}
            </select>
          </label>
          {invoices.find((invoice) => invoice.id === review.invoiceId)?.invoiceUrl && <a
            href={invoices.find((invoice) => invoice.id === review.invoiceId)?.invoiceUrl ?? undefined}
            target="_blank" rel="noreferrer">Open selected invoice ↗</a>}
          {modalError && <p className="inline-error" role="alert">{modalError}</p>}
          <button className="button button-primary" type="submit" disabled={Boolean(busy) || !review.invoiceId}>
            {busy ? 'Confirming…' : 'Confirm match'}
          </button>
        </form>
      </Modal>}
    </>
  )
}
