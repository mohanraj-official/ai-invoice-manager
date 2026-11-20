
import { useEffect, useState } from 'react'
import './App.css'

type ApiStatus = 'checking' | 'connected' | 'disconnected'

type UploadedFile = {
  filename: string
  size: number
  mimeType: string
  sha256: string
}

function App() {
  const [apiStatus, setApiStatus] = useState<ApiStatus>('checking')
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
            <strong>0</strong>
          </div>
          <div className="stat-card">
            <h3>Total Expenses</h3>
            <strong>₹0</strong>
          </div>
          <div className="stat-card">
            <h3>Duplicates Detected</h3>
            <strong>0</strong>
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
                  {file.filename} ({(file.size / 1024).toFixed(1)} KB)
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
