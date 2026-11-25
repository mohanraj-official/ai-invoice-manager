
import { useEffect, useRef, useState } from 'react'
import './App.css'
import Payments, { formatPaymentAmount } from './Payments'

type ApiStatus = 'checking' | 'connected' | 'disconnected'

type ExtractionStatus =
  | 'completed'
  | 'failed'
  | 'not_processed'

type UploadedFile = {
  filename: string
  size: number
  mimeType: string
  sha256: string
  duplicate: boolean
  invoiceId: number
  extractionStatus: ExtractionStatus
}


type InvoiceHistoryItem = {
  id: number
  filename: string
  mimeType: string
  fileSize: number
  uploadedAt: string
  documentType: 'invoice' | 'receipt' | 'unknown' | null
  invoiceNumber: string | null
  invoiceDate: string | null
  dueDate: string | null
  vendorName: string | null
  currency: string | null
  total: number | null
  confirmedPaid: string
  reportedPaid: string
  hasReceipt: boolean
  paymentStatus: string | null
  financialStatus: string | null
  extractedAt: string | null
  driveFileUrl: string | null
  driveStatus: string | null
}


type DashboardStats = {
  success: boolean
  balances: { currency: string; billed: string; paid: string }[]
}

type UploadResponse = {
  success: boolean
  count: number
  files: UploadedFile[]
  error?: string
}

const MAX_FILES = 10
const MAX_FILE_SIZE = 10 * 1024 * 1024

function App() {

  const [invoiceHistory, setInvoiceHistory] = useState<InvoiceHistoryItem[]>([])

  const [historyError, setHistoryError] = useState('')

  const [apiStatus, setApiStatus] = useState<ApiStatus>('checking')

  const [balances, setBalances] = useState<DashboardStats['balances']>([])
  const [paymentInvoice, setPaymentInvoice] = useState<InvoiceHistoryItem | null>(null)
  const [overdueOnly, setOverdueOnly] = useState(false)
  const [view, setView] = useState<'invoice' | 'receipt' | 'payments' | 'review'>('invoice')
  const [showUpload, setShowUpload] = useState(false)
  const [summaryChoice, setSummaryChoice] = useState('')
  const [currencyFilter, setCurrencyFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [dragging, setDragging] = useState(false)


  const [files, setFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [message, setMessage] = useState('')
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([])

  const fileInputRef = useRef<HTMLInputElement>(null)

  function updateStats(stats: DashboardStats) {
    if (!stats.success) {
      throw new Error('Statistics API returned an error')
    }

    setBalances(stats.balances ?? [])
  }

  async function loadStats(signal?: AbortSignal) {
    const response = await fetch('/api/stats', { signal })

    if (!response.ok) {
      throw new Error('Failed to load statistics')
    }

    const stats: DashboardStats = await response.json()

    if (!signal?.aborted) {
      updateStats(stats)
    }
  }

  useEffect(() => {
    const controller = new AbortController()

    async function checkBackend() {
      try {
        const response = await fetch('/api/health', {
          signal: controller.signal,
        })

        if (!response.ok) {
          throw new Error('Backend unavailable')
        }

        const data: { status: string } = await response.json()

        if (!controller.signal.aborted) {
          setApiStatus(
            data.status === 'ok' ? 'connected' : 'disconnected'
          )
        }
      } catch {
        if (!controller.signal.aborted) {
          setApiStatus('disconnected')
        }
      }
    }

    void checkBackend()

    return () => controller.abort()
  }, [])


  useEffect(() => {
    const controller = new AbortController()

    void loadInvoiceHistory(controller.signal).catch((error) => {
      if (!controller.signal.aborted) {
        setHistoryError(
          error instanceof Error
            ? error.message
            : 'Unable to load invoices'
        )
      }
    })

    return () => controller.abort()
  }, [])


  useEffect(() => {
    const controller = new AbortController()

    void loadStats(controller.signal).catch((error) => {
      if (!controller.signal.aborted) {
        console.error('Statistics request failed:', error)
      }
    })

    return () => controller.abort()
  }, [])

  function handleFileSelection(
    event: React.ChangeEvent<HTMLInputElement>
  ) {
    selectFiles(Array.from(event.target.files ?? []))
    event.target.value = ''
  }

  function selectFiles(selectedFiles: File[]) {
    if (uploading || selectedFiles.length === 0) return

    setMessage('')

    if (selectedFiles.length > MAX_FILES) {
      setFiles([])
      setMessage('You can upload a maximum of 10 files.')
      return
    }

    const oversizedFile = selectedFiles.find(
      (file) => file.size > MAX_FILE_SIZE
    )

    if (oversizedFile) {
      setFiles([])
      setMessage(
        `${oversizedFile.name} exceeds the 10 MB file limit.`
      )
      return
    }

    const invalidFile = selectedFiles.find((file) => !/\.(pdf|jpe?g|png)$/i.test(file.name))
    if (invalidFile) {
      setMessage(`${invalidFile.name} must be a PDF, JPG, or PNG.`)
      return
    }

    setFiles(selectedFiles)
  }

  async function loadInvoiceHistory(signal?: AbortSignal) {
    const response = await fetch('/api/invoices', { signal })

    if (!response.ok) {
      throw new Error('Failed to load invoice history')
    }

    const data: {
      success: boolean
      invoices: InvoiceHistoryItem[]
    } = await response.json()

    if (!data.success) {
      throw new Error('Invoice history API returned an error')
    }

    if (!signal?.aborted) {
      setInvoiceHistory(data.invoices)
      setHistoryError('')
    }
  }


  async function handleUpload() {
    if (files.length === 0 || uploading) return

    setUploading(true)
    setMessage('')
    setUploadedFiles([])

    try {
      const formData = new FormData()

      files.forEach((file) => {
        formData.append('files', file)
      })

      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      })

      const data: UploadResponse = await response.json()

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Upload failed')
      }

      setUploadedFiles(data.files)

      const completed = data.files.filter(
        (file) => file.extractionStatus === 'completed'
      ).length

      const failed = data.files.filter(
        (file) => file.extractionStatus === 'failed'
      ).length

      const duplicates = data.files.filter(
        (file) => file.duplicate
      ).length

      setMessage(
        `${data.count} file(s) processed. ` +
        `${completed} AI extraction(s) completed, ` +
        `${failed} failed, ` +
        `${duplicates} duplicate(s).`
      )

      setFiles([])

      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }

      try {
        await loadStats()
      } catch (statsError) {
        console.error('Statistics refresh failed:', statsError)
        setMessage((previous) =>
          `${previous} Dashboard statistics could not be refreshed.`
        )
      }

      try {
        await loadInvoiceHistory()
      } catch (error) {
        console.error('Invoice history refresh failed:', error)
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Upload failed'
      )
    } finally {
      setUploading(false)
    }
  }

  function renderExtractionStatus(status: ExtractionStatus) {
    switch (status) {
      case 'completed':
        return (
          <span style={{ color: '#16a34a' }}>
            AI extraction completed
          </span>
        )

      case 'failed':
        return (
          <span style={{ color: '#dc2626' }}>
            AI extraction failed
          </span>
        )

      case 'not_processed':
        return (
          <span style={{ color: '#d97706' }}>
            AI extraction not processed
          </span>
        )
    }
  }

  const today = new Date().toLocaleDateString('sv-SE')
  const query = search.trim().toLowerCase()
  const currencies = [...new Set([
    ...balances.map((entry) => entry.currency),
    ...invoiceHistory.flatMap((entry) => entry.currency ? [entry.currency] : []),
  ])].sort()
  const summaryCurrency = balances.some((entry) => entry.currency === summaryChoice) ? summaryChoice : balances[0]?.currency
  const summary = balances.find((entry) => entry.currency === summaryCurrency)
  const needsReview = (entry: InvoiceHistoryItem) =>
    !entry.documentType || entry.documentType === 'unknown' || !entry.currency ||
    entry.financialStatus === 'mismatch' || Number(entry.reportedPaid) > 0 ||
    (entry.documentType === 'invoice' && entry.paymentStatus === 'paid' && Number(entry.confirmedPaid) === 0)
  const reviewCount = invoiceHistory.filter(needsReview).length
  const visibleDocuments = invoiceHistory.filter((entry) => {
    const matchesView = view === 'review' ? needsReview(entry) : entry.documentType === view
    return matchesView &&
      (currencyFilter === 'all' || entry.currency === currencyFilter) &&
      (!overdueOnly || Boolean(entry.documentType === 'invoice' && entry.dueDate &&
        entry.dueDate < today && entry.total !== null && Math.round(entry.total * 100) > Math.round(Number(entry.confirmedPaid) * 100))) &&
      (!query || [entry.filename, entry.invoiceNumber, entry.vendorName].some((value) => value?.toLowerCase().includes(query)))
  })

  function openPayment(invoice: InvoiceHistoryItem) {
    setPaymentInvoice({ ...invoice })
    setView('payments')
  }

  return (
    <main className="app">
      <header className="header">
        <h1>AI Invoice Manager</h1>
        <button className="primary-button" type="button" aria-expanded={showUpload} aria-controls="upload-panel"
          onClick={() => setShowUpload((open) => !open)}>
          {showUpload ? 'Close upload' : 'Upload documents'}
        </button>
      </header>

      {apiStatus === 'disconnected' && <p role="alert">The backend is unavailable. Try refreshing in a moment.</p>}

      <section className="dashboard-summary" aria-label="Invoice balances">
        <div className="summary-heading">
          <h2>Invoice balances</h2>
          {balances.length > 1 && <label>Currency
            <select value={summaryCurrency} onChange={(event) => setSummaryChoice(event.target.value)}>
              {balances.map((entry) => entry.currency).map((currency) => <option key={currency}>{currency}</option>)}
            </select>
          </label>}
        </div>
        <div className="stats">
          {([
            ['Billed', Number(summary?.billed)],
            ['Confirmed paid', Number(summary?.paid)],
            ['Outstanding', Number(summary?.billed) - Number(summary?.paid)],
          ] as const).map(([label, amount]) => (
            <div className="stat-card" key={label}>
              <h3>{label}</h3>
              <strong>{summary && summaryCurrency ? formatPaymentAmount(amount, summaryCurrency) : '—'}</strong>
            </div>
          ))}
        </div>
      </section>

      <section id="upload-panel" className="upload-card" hidden={!showUpload}>
        <h2>Upload invoices or receipts</h2>
        <div className={dragging ? 'drop-zone drop-zone-active' : 'drop-zone'}
          onDragOver={(event) => { event.preventDefault(); if (!uploading) setDragging(true) }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false)
          }}
          onDrop={(event) => {
            event.preventDefault()
            setDragging(false)
            selectFiles(Array.from(event.dataTransfer.files))
          }}>
          <p>Drop up to 10 PDF, JPG, or PNG files here. Maximum 10 MB each.</p>
          <button type="button" disabled={uploading} onClick={() => fileInputRef.current?.click()}>Browse files</button>
        </div>
        <input hidden ref={fileInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png" multiple
          disabled={uploading} onChange={handleFileSelection} />
        {files.length > 0 && <ul className="selected-files">
          {files.map((file, index) => <li key={`${file.name}-${index}`}>
            <span>{file.name}</span>
            <button type="button" disabled={uploading} aria-label={`Remove ${file.name}`}
              onClick={() => setFiles((current) => current.filter((_, position) => position !== index))}>Remove</button>
          </li>)}
        </ul>}
        <button className="upload-action" type="button" disabled={!files.length || uploading} onClick={() => void handleUpload()}>
          {uploading ? 'Processing…' : 'Upload files'}
        </button>
        {message && <p role="status">{message}</p>}
        {uploadedFiles.length > 0 && <details className="upload-results">
          <summary>File results</summary>
          <ul>{uploadedFiles.map((file, index) => <li key={`${file.sha256}-${index}`}>
            {file.filename} · {file.duplicate ? 'Existing file' : 'New file'} · {renderExtractionStatus(file.extractionStatus)}
          </li>)}</ul>
        </details>}
      </section>

      <nav className="dashboard-nav" aria-label="Dashboard views">
        {([
          ['invoice', 'Invoices'], ['receipt', 'Receipts'], ['payments', 'Payments'], ['review', 'Needs review'],
        ] as const).map(([key, label]) => (
          <button type="button" key={key} aria-current={view === key ? 'page' : undefined} onClick={() => setView(key)}>
            {label}{key === 'review' && reviewCount > 0 ? ` (${reviewCount})` : ''}
          </button>
        ))}
      </nav>

      <div hidden={view !== 'payments'}>
        <Payments documents={invoiceHistory} invoice={paymentInvoice}
          onCloseInvoice={() => setPaymentInvoice(null)}
          onSaved={() => Promise.all([loadStats(), loadInvoiceHistory()])} />
      </div>

      {view !== 'payments' && <section className="upload-card document-panel">
        <div className="document-filters">
          <label className="document-search">Search<input type="search" placeholder="Vendor, reference, or filename"
            value={search} onChange={(event) => setSearch(event.target.value)} /></label>
          <label>Currency<select value={currencyFilter} onChange={(event) => setCurrencyFilter(event.target.value)}>
            <option value="all">All currencies</option>
            {currencies.map((currency) => <option key={currency}>{currency}</option>)}
          </select></label>
          {view === 'invoice' && <label className="overdue-filter"><input type="checkbox" checked={overdueOnly}
            onChange={(event) => setOverdueOnly(event.target.checked)} /> Overdue only</label>}
        </div>
        {historyError && <p role="alert">{historyError}</p>}
        {!visibleDocuments.length && !historyError && <p>No matching documents.</p>}
        <div className="document-list">
          {visibleDocuments.map((entry) => {
            const paid = Number(entry.confirmedPaid ?? 0)
            const billed = entry.total
            const payable = entry.documentType === 'invoice' && Boolean(entry.currency) && billed !== null
            const outstanding = payable ? Math.round((billed - paid) * 100) / 100 : null
            const reported = Number(entry.reportedPaid ?? 0)
            const status = outstanding === null ? (entry.documentType === 'receipt' ? 'Receipt' : 'Needs review') :
              outstanding <= 0 ? 'Paid' : reported > 0 || (entry.paymentStatus === 'paid' && paid === 0) ? 'Payment unverified' :
              paid > 0 ? 'Partially paid' : 'Open'
            const display = (value: number | null) => value === null ? '—' :
              entry.currency ? formatPaymentAmount(value, entry.currency) : `${value.toFixed(2)} · Currency unknown`

            return <article className="document-entry" key={entry.id}>
              <div className="document-row">
                <div className="document-identity">
                  <strong>{entry.vendorName ?? entry.filename}</strong>
                  <span>{entry.invoiceNumber ?? (entry.vendorName ? entry.filename : 'Reference unavailable')}</span>
                </div>
                <div className="document-amount"><strong>{display(outstanding ?? billed)}</strong>
                  <span>{outstanding !== null ? 'Outstanding' : 'Document amount'}</span></div>
                <span className={status === 'Paid' ? 'document-status paid-status' : 'document-status'}>{status}</span>
                {outstanding !== null && outstanding > 0 && <button type="button" className="secondary-button"
                  onClick={() => openPayment(entry)}>Upload receipt</button>}
              </div>
              <details className="document-details">
                <summary>Details</summary>
                <dl>
                  <div><dt>Document date</dt><dd>{entry.invoiceDate ?? '—'}</dd></div>
                  {payable && <>
                    <div><dt>Due date</dt><dd>{entry.dueDate ?? '—'}</dd></div>
                    <div><dt>Billed</dt><dd>{display(billed)}</dd></div>
                    <div><dt>Confirmed paid</dt><dd>{display(paid)}</dd></div>
                    {reported > 0 && <div><dt>Reported paid</dt><dd>{display(reported)}</dd></div>}
                    {paid > 0 && <div><dt>Receipt</dt><dd>{entry.hasReceipt ? 'Attached' : 'Missing'}</dd></div>}
                  </>}
                  <div><dt>Extraction</dt><dd>{entry.extractedAt ? entry.financialStatus === 'mismatch' ? 'Totals need review' : 'Extracted' : 'Pending or failed'}</dd></div>
                </dl>
                {entry.driveStatus === 'uploaded' && entry.driveFileUrl && <a href={entry.driveFileUrl}
                  target="_blank" rel="noopener noreferrer">Open original</a>}
              </details>
            </article>
          })}
        </div>
      </section>}
    </main>
  )
}

export default App
