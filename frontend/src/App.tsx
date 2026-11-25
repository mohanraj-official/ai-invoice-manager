
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


type DocumentTotal = { documentType: 'invoice' | 'receipt'; currency: string; total: number }

type DashboardStats = {
  success: boolean
  totalInvoices: number
  documentTotals: DocumentTotal[]
  balances: { currency: string; billed: string; paid: string }[]
  duplicatesDetected: number
}

type UploadResponse = {
  success: boolean
  count: number
  files: UploadedFile[]
  error?: string
}

const MAX_FILES = 10
const MAX_FILE_SIZE = 10 * 1024 * 1024

const currencyFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

function App() {

  const [invoiceHistory, setInvoiceHistory] = useState<InvoiceHistoryItem[]>([])

  const [historyError, setHistoryError] = useState('')

  const [apiStatus, setApiStatus] = useState<ApiStatus>('checking')

  const [totalInvoices, setTotalInvoices] =
    useState<number | null>(null)

  const [documentTotals, setDocumentTotals] = useState<DocumentTotal[]>([])
  const [balances, setBalances] = useState<DashboardStats['balances']>([])
  const [paymentInvoice, setPaymentInvoice] = useState<InvoiceHistoryItem | null>(null)
  const [vendorSearch, setVendorSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [overdueOnly, setOverdueOnly] = useState(false)
  const [documentFilter, setDocumentFilter] = useState('all')
  const [currencyFilter, setCurrencyFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [dragging, setDragging] = useState(false)

  const [duplicatesDetected, setDuplicatesDetected] =
    useState<number | null>(null)

  const [files, setFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [message, setMessage] = useState('')
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([])

  const fileInputRef = useRef<HTMLInputElement>(null)

  function updateStats(stats: DashboardStats) {
    if (!stats.success) {
      throw new Error('Statistics API returned an error')
    }

    setTotalInvoices(stats.totalInvoices)
    setDocumentTotals(stats.documentTotals ?? [])
    setBalances(stats.balances ?? [])
    setDuplicatesDetected(stats.duplicatesDetected)
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

  const query = search.trim().toLowerCase()
  const currencies = [...new Set([...documentTotals.map((entry) => entry.currency), ...invoiceHistory.flatMap((entry) => entry.currency ? [entry.currency] : [])])].sort()
  const today = new Date().toLocaleDateString('sv-SE')
  const visibleDocuments = invoiceHistory.filter((entry) => {
    const needsReview = !entry.documentType || entry.documentType === 'unknown' || !entry.currency || entry.financialStatus === 'mismatch' || Number(entry.reportedPaid) > 0
    return (documentFilter === 'all' || (documentFilter === 'review' ? needsReview : entry.documentType === documentFilter)) &&
      (currencyFilter === 'all' || (entry.currency ?? 'unknown') === currencyFilter) &&
      (!vendorSearch || (entry.vendorName ?? '').toLowerCase().includes(vendorSearch.trim().toLowerCase())) &&
      (!dateFrom || Boolean(entry.invoiceDate && entry.invoiceDate >= dateFrom)) &&
      (!dateTo || Boolean(entry.invoiceDate && entry.invoiceDate <= dateTo)) &&
      (!overdueOnly || Boolean(entry.documentType === 'invoice' && entry.dueDate &&
        entry.dueDate < today && entry.total !== null && Math.round(entry.total * 100) > Math.round(Number(entry.confirmedPaid) * 100))) &&
      [entry.filename, entry.invoiceNumber, entry.vendorName].some((value) => value?.toLowerCase().includes(query))
  })

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>AI Invoice Manager</h1>
          <p>Smart invoice extraction and expense management</p>
        </div>

        <span className="status">
          Backend: {apiStatus}
        </span>
      </header>

      <main>
        <section className="stats">
          <div className="stat-card">
            <h3>Uploaded Documents</h3>
            <strong>{totalInvoices ?? '—'}</strong>
          </div>

          {(['Billed', 'Confirmed paid', 'Outstanding'] as const).map((label) => (
            <div className="stat-card" key={label}>
              <h3>{label}</h3>
              {balances.length ? balances.map(({ currency, billed, paid }) => (
                <div className="currency-total" key={currency}>
                  <strong>{formatPaymentAmount(label === 'Billed' ? Number(billed) : label === 'Confirmed paid' ? Number(paid) : Number(billed) - Number(paid), currency)}</strong>
                </div>
              )) : <strong>—</strong>}
            </div>
          ))}
          {(['receipt'] as const).map((type) => (
            <div className="stat-card" key={type}>
              <h3>Receipt document totals</h3>
              {documentTotals.some((entry) => entry.documentType === type)
                ? documentTotals.filter((entry) => entry.documentType === type).map((entry) => (
                    <div className="currency-total" key={entry.currency}>
                      <span>{entry.currency}</span>
                      <strong>{entry.total.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
                    </div>
                  ))
                : <strong>—</strong>}
            </div>
          ))}

          <div className="stat-card">
            <h3>Duplicates Detected</h3>
            <strong>{duplicatesDetected ?? '—'}</strong>
          </div>
        </section>

        <section className="upload-card">
          <h2>Upload Invoices and Receipts</h2>

          <p>
            Select up to 10 PDF, JPG, or PNG files
            (maximum 10 MB each).
          </p>

          <div
            className={dragging ? 'drop-zone drop-zone-active' : 'drop-zone'}
            onDragOver={(event) => {
              event.preventDefault()
              if (!uploading) setDragging(true)
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false)
            }}
            onDrop={(event) => {
              event.preventDefault()
              setDragging(false)
              selectFiles(Array.from(event.dataTransfer.files))
            }}
          >
            <p>Drag and drop files here</p>
            <button type="button" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
              Browse files
            </button>
          </div>

          <input
            hidden
            ref={fileInputRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png"
            multiple
            disabled={uploading}
            onChange={handleFileSelection}
          />

          {files.length > 0 && (
            <ul className="selected-files">
              {files.map((file, index) => (
                <li key={`${file.name}-${index}`}>
                  <span>{file.name}</span>
                  <button type="button" disabled={uploading} aria-label={`Remove ${file.name}`}
                    onClick={() => setFiles((current) => current.filter((_, position) => position !== index))}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}

          <button
            className="upload-action"
            type="button"
            disabled={files.length === 0 || uploading}
            onClick={() => void handleUpload()}
          >
            {uploading ? 'Processing...' : 'Upload Files'}
          </button>

          {uploading && (
            <p>
              Uploading and extracting invoice data.
              This may take some time.
            </p>
          )}

          {message && <p role="status">{message}</p>}
        </section>

        <section className="upload-card">
          <h2>Recent Upload Results</h2>

          {uploadedFiles.length === 0 ? (
            <p>No files processed yet.</p>
          ) : (
            <ul>
              {uploadedFiles.map((file, index) => (
                <li key={`${file.sha256}-${index}`}>
                  <strong>{file.filename}</strong>
                  {' '}
                  ({(file.size / 1024).toFixed(1)} KB)
                  {' — '}

                  {file.duplicate ? (
                    <span style={{ color: '#d97706' }}>
                      Duplicate detected
                      (Invoice #{file.invoiceId})
                    </span>
                  ) : (
                    <span style={{ color: '#16a34a' }}>
                      New invoice (ID: {file.invoiceId})
                    </span>
                  )}

                  {' — '}
                  {renderExtractionStatus(file.extractionStatus)}
                </li>
              ))}
            </ul>
          )}
        </section>


        <section className="upload-card">
          <h2>Document History</h2>
          <div className="document-filters">
            <label>Document type
              <select value={documentFilter} onChange={(event) => setDocumentFilter(event.target.value)}>
                <option value="all">All documents</option>
                <option value="invoice">Invoices</option>
                <option value="receipt">Receipts</option>
                <option value="review">Needs review</option>
              </select>
            </label>
            <label>Currency
              <select value={currencyFilter} onChange={(event) => setCurrencyFilter(event.target.value)}>
                <option value="all">All currencies</option>
                {currencies.map((currency) => <option key={currency}>{currency}</option>)}
                <option value="unknown">Unknown currency</option>
              </select>
            </label>
            <label>Search recent documents
              <input type="search" placeholder="Vendor, reference, or filename" value={search}
                onChange={(event) => setSearch(event.target.value)} />
            </label>
          </div>

          <div className="document-filters">
            <label>Vendor<input type="search" value={vendorSearch} onChange={(event) => setVendorSearch(event.target.value)} /></label>
            <label>From date<input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label>
            <label>To date<input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label>
            <label><span>Overdue only</span><input type="checkbox" checked={overdueOnly} onChange={(event) => setOverdueOnly(event.target.checked)} /></label>
          </div>

          {historyError && (
            <p role="alert" style={{ color: '#dc2626' }}>
              {historyError}
            </p>
          )}

          {visibleDocuments.length === 0 ? (
            <p>No matching documents.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  textAlign: 'left',
                }}
              >
                <thead>
                  <tr>
                    {[
                      'ID',
                      'Type',
                      'Reference',
                      'Vendor',
                      'Document Date',
                      'Amount',
                      'Due Date',
                      'Confirmed Paid',
                      'Outstanding',
                      'Payment Status',
                      'Extraction',
                      'Document',
                      'Payment',
                    ].map((heading) => (
                      <th
                        key={heading}
                        style={{
                          padding: '12px',
                          borderBottom: '1px solid #ddd',
                        }}
                      >
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>

                <tbody>
                  {visibleDocuments.map((invoice) => {
                    const payable = invoice.documentType === 'invoice' && Boolean(invoice.currency) && invoice.total !== null
                    const paid = Number(invoice.confirmedPaid ?? 0)
                    const outstanding = payable ? Math.round(((invoice.total ?? 0) - paid) * 100) / 100 : null
                    const reported = Number(invoice.reportedPaid ?? 0)
                    const status = outstanding === null ? '—' : outstanding <= 0 ? 'Paid' :
                      paid > 0 ? 'Partially paid' : reported > 0 || invoice.paymentStatus === 'paid' ? 'Payment unverified' : 'Open'
                    return <tr key={invoice.id}>
                      <td style={{ padding: '12px' }}>
                        {invoice.id}
                      </td>

                      <td style={{ padding: '12px' }}>
                        {invoice.documentType === 'invoice' ? 'Invoice' : invoice.documentType === 'receipt' ? 'Receipt' : 'Needs review'}
                      </td>

                      <td style={{ padding: '12px' }}>
                        {invoice.invoiceNumber ?? invoice.filename}
                      </td>

                      <td style={{ padding: '12px' }}>
                        {invoice.vendorName ?? 'Not extracted'}
                      </td>

                      <td style={{ padding: '12px' }}>
                        {invoice.invoiceDate ?? '—'}
                      </td>

                      <td style={{ padding: '12px' }}>
                        {invoice.total === null
                          ? '—'
                          : invoice.currency === 'INR'
                            ? currencyFormatter.format(invoice.total)
                            : `${invoice.currency ?? ''} ${invoice.total.toFixed(2)}`}
                      </td>

                      <td style={{ padding: '12px' }}>
                        {invoice.dueDate ?? '—'}
                      </td>
                      <td style={{ padding: '12px' }}>{payable ? formatPaymentAmount(paid, invoice.currency ?? '') : '—'}</td>
                      <td style={{ padding: '12px' }}>{outstanding === null ? '—' : formatPaymentAmount(outstanding, invoice.currency ?? '')}</td>
                      <td style={{ padding: '12px' }}>
                        {status}
                        {reported > 0 && <><br />Reported {formatPaymentAmount(reported, invoice.currency ?? '')}</>}
                        {paid > 0 && <><br />{invoice.hasReceipt ? 'Receipt attached' : 'Receipt missing'}</>}
                      </td>

                      <td style={{ padding: '12px' }}>
                        {invoice.extractedAt
                          ? invoice.financialStatus === 'verified'
                            ? 'Extracted - Total verified'
                            : 'Extracted - Review needed'
                          : 'Not extracted'}
                      </td>

                      <td style={{ padding: '12px' }}>
                        {invoice.driveStatus === 'uploaded' &&
                          invoice.driveFileUrl ? (
                          <a
                            href={invoice.driveFileUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Open file
                          </a>
                        ) : (
                          <span style={{ color: '#94a3b8' }}>
                            Not available
                          </span>
                        )}
                      </td>

                      <td style={{ padding: '12px' }}>
                        {outstanding !== null && outstanding > 0 && <button type="button" onClick={() => setPaymentInvoice({ ...invoice })}>Record payment</button>}
                      </td>
                    </tr>
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>


        <Payments documents={invoiceHistory} invoice={paymentInvoice}
          onCloseInvoice={() => setPaymentInvoice(null)}
          onSaved={() => Promise.all([loadStats(), loadInvoiceHistory()])} />
      </main>
    </div>
  )
}

export default App
