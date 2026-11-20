
import { useEffect, useState } from 'react'
import './App.css'

type ApiStatus = 'checking' | 'connected' | 'disconnected'


type UploadedFile = {
  filename: string
  size: number
  mimeType: string
  sha256: string
  duplicate: boolean
  invoiceId: number
}


function App() {
  const [apiStatus, setApiStatus] = useState<ApiStatus>('checking')
  const [totalInvoices, setTotalInvoices] = useState<number | null>(null)
  const [duplicatesDetected, setDuplicatesDetected] = useState<number | null>(null)
  const [files, setFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [message, setMessage] = useState('')
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([])

  useEffect(() => {
    const controller = new AbortController()

    async function checkBackend() {
      try {
        const response = await fetch('/api/health', {
          signal: controller.signal,
        })
        if (!response.ok) throw new Error('Backend unavailable')

        const data = await response.json()
        setApiStatus(data.status === 'ok' ? 'connected' : 'disconnected')
      } catch {
        if (!controller.signal.aborted) setApiStatus('disconnected')
      }
    }

    void checkBackend()
    return () => controller.abort()
  }, [])


  useEffect(() => {
    const controller = new AbortController()

    async function loadStats() {
      try {
        const response = await fetch('/api/stats', {
          signal: controller.signal,
        })

        if (!response.ok) {
          throw new Error('Failed to load statistics')
        }

        const data: {
          totalInvoices: number
          duplicatesDetected: number
        } = await response.json()

        if (!controller.signal.aborted) {
          setTotalInvoices(data.totalInvoices)
          setDuplicatesDetected(data.duplicatesDetected)
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error('Statistics request failed:', error)
        }
      }
    }

    void loadStats()

    return () => controller.abort()
  }, [])


  async function handleUpload() {
    if (files.length === 0 || uploading) return

    setUploading(true)
    setMessage('')

    try {
      const formData = new FormData()
      files.forEach((file) => formData.append('files', file))

      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Upload failed')
      }

      setUploadedFiles(data.files)

      const statsResponse = await fetch('/api/stats')

      if (statsResponse.ok) {
        const stats: {
          totalInvoices: number
          duplicatesDetected: number
        } = await statsResponse.json()
        setTotalInvoices(stats.totalInvoices)
        setDuplicatesDetected(stats.duplicatesDetected)
      }

      setMessage(`${data.count} file(s) processed successfully`)
      setFiles([])
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>AI Invoice Manager</h1>
          <p>Smart invoice extraction and expense management</p>
        </div>
        <span className="status">Backend: {apiStatus}</span>
      </header>

      <main>
        <section className="stats">
          <div className="stat-card">
            <h3>Total Invoices</h3>
            <strong>{totalInvoices ?? '—'}</strong>
          </div>
          <div className="stat-card">
            <h3>Total Expenses</h3>
            <strong>₹0</strong>
          </div>
          <div className="stat-card">
            <h3>Duplicates Detected</h3>
            <strong>{duplicatesDetected ?? '—'}</strong>
          </div>
        </section>

        <section className="upload-card">
          <h2>Upload Invoices</h2>
          <p>Select up to 10 PDF, JPG, or PNG files (maximum 10 MB each).</p>

          <input
            type="file"
            accept=".pdf,.jpg,.jpeg,.png"
            multiple
            onChange={(event) => {
              setFiles(Array.from(event.target.files ?? []))
              setMessage('')
            }}
          />

          <button
            type="button"
            disabled={files.length === 0 || uploading}
            onClick={() => void handleUpload()}
          >
            {uploading ? 'Processing...' : 'Upload Files'}
          </button>

          {message && <p>{message}</p>}
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
                      Duplicate detected (Invoice #{file.invoiceId})
                    </span>
                  ) : (
                    <span style={{ color: '#16a34a' }}>
                      New invoice (ID: {file.invoiceId})
                    </span>
                  )}
                </li>
              ))}
            </ul>

          )}
        </section>
      </main>
    </div>
  )
}

export default App
