
import { useEffect, useRef, useState } from 'react'
import './App.css'

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
  invoiceNumber: string | null
  invoiceDate: string | null
  vendorName: string | null
  currency: string | null
  total: number | null
  paymentStatus: string | null
  financialStatus: string | null
  extractedAt: string | null
  driveFileUrl: string | null
  driveStatus: string | null
}


type DashboardStats = {
  success: boolean
  totalInvoices: number
  totalExpenses: number
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

  const [totalExpenses, setTotalExpenses] =
    useState<number | null>(null)

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
    setTotalExpenses(stats.totalExpenses)
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
    const selectedFiles = Array.from(event.target.files ?? [])

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
            <h3>Total Invoices</h3>
            <strong>{totalInvoices ?? '—'}</strong>
          </div>

          <div className="stat-card">
            <h3>Total Invoiced (INR)</h3>
            <strong>
              {totalExpenses === null
                ? '—'
                : currencyFormatter.format(totalExpenses)}
            </strong>
          </div>

          <div className="stat-card">
            <h3>Duplicates Detected</h3>
            <strong>{duplicatesDetected ?? '—'}</strong>
          </div>
        </section>

        <section className="upload-card">
          <h2>Upload Invoices</h2>

          <p>
            Select up to 10 PDF, JPG, or PNG files
            (maximum 10 MB each).
          </p>

          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png"
            multiple
            disabled={uploading}
            onChange={handleFileSelection}
          />

          <button
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
          <h2>Invoice History</h2>

          {historyError && (
            <p role="alert" style={{ color: '#dc2626' }}>
              {historyError}
            </p>
          )}

          {invoiceHistory.length === 0 ? (
            <p>No invoices found.</p>
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
                      'Invoice Number',
                      'Vendor',
                      'Invoice Date',
                      'Amount',
                      'Payment Status',
                      'Extraction',
                      'Document',
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
                  {invoiceHistory.map((invoice) => (
                    <tr key={invoice.id}>
                      <td style={{ padding: '12px' }}>
                        {invoice.id}
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
                        {invoice.paymentStatus ?? 'Unknown'}
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
                            Open PDF
                          </a>
                        ) : (
                          <span style={{ color: '#94a3b8' }}>
                            Not available
                          </span>
                        )}
                      </td>

                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>


      </main>
    </div>
  )
}

export default App
