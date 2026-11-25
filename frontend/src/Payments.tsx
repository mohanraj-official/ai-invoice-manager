import { useEffect, useState, type FormEvent } from 'react'

export type PaymentDocument = {
  id: number
  documentType: 'invoice' | 'receipt' | 'unknown' | null
  invoiceNumber: string | null
  vendorName: string | null
  filename: string
  currency: string | null
  total: number | null
  confirmedPaid: string
}

type Payment = {
  id: string
  paymentDate: string
  currency: string
  amount: string
  method: string
  reference: string | null
  recordedBy: string
  verifiedBy: string | null
  verifiedAt: string | null
  allocations: { invoiceId: number; amount: number }[]
  receipts: { receiptId: number; url: string | null }[]
}

type Props = {
  documents: PaymentDocument[]
  invoice: PaymentDocument | null
  onCloseInvoice: () => void
  onSaved: () => Promise<unknown>
}

export function formatPaymentAmount(amount: number, currency: string) {
  return `${currency} ${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function documentLabel(document: PaymentDocument) {
  return `#${document.id} · ${document.vendorName ?? 'Unknown vendor'} · ${document.invoiceNumber ?? document.filename}`
}

async function requestPayments(path = '', payload?: unknown) {
  const response = await fetch(`/api/payments${path}`, payload === undefined ? undefined : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error ?? 'Payment request failed.')
  return data
}

export default function Payments({ documents, invoice, onCloseInvoice, onSaved }: Props) {
  const [payments, setPayments] = useState<Payment[]>([])
  const [loadError, setLoadError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState(false)
  const [editAllocation, setEditAllocation] = useState<string | null>(null)
  const [editEvidence, setEditEvidence] = useState<string | null>(null)
  const [currency, setCurrency] = useState('INR')
  const [allocations, setAllocations] = useState<Record<string, string>>({})
  const [confirmed, setConfirmed] = useState(false)
  const [reviewOnly, setReviewOnly] = useState(false)
  const currencyChoices = [...new Set(['INR', 'USD', currency, ...documents.flatMap((document) =>
    document.currency && /^[A-Z]{3}$/.test(document.currency) ? [document.currency] : [],
  )])].sort()

  useEffect(() => {
    let active = true
    void requestPayments().then((data) => {
      if (active) setPayments(data.payments)
    }).catch((error: Error) => {
      if (active) setLoadError(error.message)
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!invoice?.currency) return
    const remaining = Math.max(0, (invoice.total ?? 0) - Number(invoice.confirmedPaid ?? 0))
    setCurrency(invoice.currency)
    setAllocations({ [invoice.id]: remaining.toFixed(2) })
    setConfirmed(false)
    setMessage('')
    setDraft(true)
    document.getElementById('payments')?.scrollIntoView({ block: 'start' })
  }, [invoice])

  function resetDraft() {
    setDraft(false)
    setAllocations({})
    setConfirmed(false)
    onCloseInvoice()
  }

  async function save(path: string, payload: unknown, close: () => void) {
    setBusy(true)
    setMessage('')
    try {
      await requestPayments(path, payload)
      close()
      setMessage('Payment saved.')
      try {
        const [data] = await Promise.all([requestPayments(), onSaved()])
        setPayments(data.payments)
        setLoadError('')
      } catch {
        setMessage('Payment saved. Refresh the page to update the dashboard.')
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Payment could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  function receiptOptions(forCurrency: string) {
    const usedReceipts = new Set(payments.flatMap((entry) => entry.receipts.map((receipt) => receipt.receiptId)))
    return documents.filter((document) =>
      document.documentType === 'receipt' && document.currency === forCurrency && !usedReceipts.has(document.id),
    ).map((document) => <option key={document.id} value={document.id}>
      {documentLabel(document)}{document.total !== null ? ` · ${formatPaymentAmount(document.total, forCurrency)}` : ''}
    </option>)
  }

  function submitPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    const reference = String(fields.get('reference') ?? '').trim()
    const receiptId = Number(fields.get('receiptId'))
    void save('', {
      paymentDate: fields.get('paymentDate'),
      method: fields.get('method'),
      amount: fields.get('amount'),
      currency,
      reference: reference || undefined,
      receiptId: receiptId || undefined,
      confirmed,
      allocations: Object.entries(allocations).filter(([, amount]) => amount.trim() !== '')
        .map(([invoiceId, amount]) => ({ invoiceId: Number(invoiceId), amount })),
    }, resetDraft)
  }

  const openInvoices = (forCurrency: string) => documents.filter((document) =>
    document.documentType === 'invoice' && document.currency === forCurrency && document.total !== null &&
    Math.round(document.total * 100) > Math.round(Number(document.confirmedPaid ?? 0) * 100),
  )
  const availableInvoices = openInvoices(currency)
  const visiblePayments = payments.filter((entry) => {
    const allocated = entry.allocations.reduce((sum, allocation) => sum + Number(allocation.amount), 0)
    return !reviewOnly || !entry.verifiedAt || Math.round(allocated * 100) < Math.round(Number(entry.amount) * 100)
  })

  return (
    <section className="upload-card payment-section" id="payments">
      <h2>Payments</h2>
      <div className="payment-toolbar">
        <button type="button" className="upload-action" disabled={busy || draft} onClick={() => {
          setMessage('')
          setDraft(true)
        }}>Record payment</button>
        <label><input type="checkbox" checked={reviewOnly} onChange={(event) => setReviewOnly(event.target.checked)} /> Needs review only</label>
      </div>
      {loadError && <p role="alert">{loadError}</p>}
      {message && <p role="status">{message}</p>}

      {draft && (
        <form className="payment-form" onSubmit={submitPayment} key={invoice?.id ?? 'new'}>
          <h3>{invoice ? `Record payment for invoice #${invoice.id}` : 'Record payment'}</h3>
          <div className="document-filters">
            <label>Payment date<input type="date" name="paymentDate" required /></label>
            <label>Currency<select value={currency} onChange={(event) => {
              setCurrency(event.target.value)
              setAllocations({})
            }}>
              {currencyChoices.map((choice) => <option key={choice}>{choice}</option>)}
            </select></label>
            <label>Payment amount<input name="amount" type="number" min="0.01" step="0.01" required /></label>
            <label>Method<select name="method">
              <option value="bank">Bank transfer</option><option value="card">Card</option>
              <option value="upi">UPI</option><option value="cash">Cash</option><option value="other">Other</option>
            </select></label>
            <label>Transaction reference<input name="reference" maxLength={200} /></label>
            <label>Uploaded receipt<select name="receiptId" key={currency}>
              <option value="">No receipt attached</option>{receiptOptions(currency)}
            </select></label>
          </div>
          <fieldset>
            <legend>Apply to invoices</legend>
            {availableInvoices.length === 0 && <p>No recent open invoices in {currency}.</p>}
            {availableInvoices.map((entry) => (
              <label className="payment-allocation" key={entry.id}>
                <span>{documentLabel(entry)} · Open {formatPaymentAmount((entry.total ?? 0) - Number(entry.confirmedPaid ?? 0), currency)}</span>
                <input type="number" min="0.01" step="0.01" placeholder="Amount"
                  value={allocations[entry.id] ?? ''}
                  onChange={(event) => setAllocations((current) => ({ ...current, [entry.id]: event.target.value }))} />
              </label>
            ))}
          </fieldset>
          <label><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> I verified this payment against the transaction or receipt</label>
          <p>Leave unverified payments unchecked. They stay in review until you confirm the evidence.</p>
          <div className="payment-toolbar">
            <button type="submit" disabled={busy}>Save payment</button>
            <button type="button" disabled={busy} onClick={resetDraft}>Cancel</button>
          </div>
        </form>
      )}

      {!visiblePayments.length && !loadError && <p>No matching payments.</p>}
      {visiblePayments.map((entry) => {
        const allocated = entry.allocations.reduce((sum, allocation) => sum + Number(allocation.amount), 0)
        const unallocated = Math.max(0, Math.round((Number(entry.amount) - allocated) * 100) / 100)
        return (
          <article className="payment-record" key={entry.id}>
            <strong>{formatPaymentAmount(Number(entry.amount), entry.currency)}</strong> · {entry.paymentDate} · {entry.method.toUpperCase()}
            <p>{entry.verifiedAt ? `Confirmed by ${entry.verifiedBy} on ${new Date(entry.verifiedAt).toLocaleDateString()}` : `Reported by ${entry.recordedBy} · Needs verification`}
              {entry.reference ? ` · Ref ${entry.reference}` : ''}
              {entry.receipts.length === 0 ? ' · No receipt attached' : ''}</p>
            {entry.allocations.length > 0 && <p>Applied to {entry.allocations.map((allocation) =>
              `#${allocation.invoiceId} (${formatPaymentAmount(Number(allocation.amount), entry.currency)})`,
            ).join(', ')}</p>}
            {unallocated > 0 && <p>Unallocated {formatPaymentAmount(unallocated, entry.currency)}</p>}
            {editAllocation === entry.id ? (
              <form className="payment-form" onSubmit={(event) => {
                event.preventDefault()
                const fields = new FormData(event.currentTarget)
                void save(`/${entry.id}/allocations`, {
                  invoiceId: Number(fields.get('invoiceId')), amount: fields.get('amount'),
                }, () => setEditAllocation(null))
              }}>
                <div className="document-filters">
                  <label>Invoice<select name="invoiceId" required defaultValue="">
                    <option value="">Choose an open invoice</option>
                    {openInvoices(entry.currency).map((invoice) => <option key={invoice.id} value={invoice.id}>
                      {documentLabel(invoice)}
                    </option>)}
                  </select></label>
                  <label>Amount to apply<input name="amount" type="number" min="0.01" step="0.01" max={unallocated} required /></label>
                </div>
                <div className="payment-toolbar">
                  <button type="submit" disabled={busy}>Apply payment</button>
                  <button type="button" disabled={busy} onClick={() => setEditAllocation(null)}>Cancel</button>
                </div>
              </form>
            ) : unallocated > 0 && <div><button type="button" disabled={busy} onClick={() => setEditAllocation(entry.id)}>Apply to invoice</button></div>}
            {entry.receipts.map((receipt) => receipt.url
              ? <a key={receipt.receiptId} href={receipt.url} target="_blank" rel="noreferrer">Receipt #{receipt.receiptId} </a>
              : <span key={receipt.receiptId}>Receipt #{receipt.receiptId} </span>)}
            {editEvidence === entry.id ? (
              <form className="payment-form" onSubmit={(event) => {
                event.preventDefault()
                const fields = new FormData(event.currentTarget)
                const reference = String(fields.get('reference') ?? '').trim()
                const receiptId = Number(fields.get('receiptId'))
                void save(`/${entry.id}/evidence`, {
                  reference: reference || undefined, receiptId: receiptId || undefined,
                }, () => setEditEvidence(null))
              }}>
                <div className="document-filters">
                  <label>Transaction reference<input name="reference" maxLength={200} defaultValue={entry.reference ?? ''} readOnly={Boolean(entry.reference)} /></label>
                  <label>Uploaded receipt<select name="receiptId">
                    <option value="">Choose a receipt</option>{receiptOptions(entry.currency)}
                  </select></label>
                </div>
                <div className="payment-toolbar">
                  <button type="submit" disabled={busy}>Save and confirm evidence</button>
                  <button type="button" disabled={busy} onClick={() => setEditEvidence(null)}>Cancel</button>
                </div>
              </form>
            ) : (
              <div><button type="button" disabled={busy} onClick={() => {
                setMessage('')
                setEditEvidence(entry.id)
              }}>{entry.verifiedAt ? 'Attach evidence' : 'Verify payment'}</button></div>
            )}
          </article>
        )
      })}
    </section>
  )
}
