
import { useEffect, useState } from 'react'
import './App.css'

type ApiStatus = 'checking' | 'connected' | 'disconnected'

function App() {
  const [apiStatus, setApiStatus] = useState<ApiStatus>('checking')

  useEffect(() => {
    const controller = new AbortController()

    async function checkBackend() {
      try {
        const response = await fetch('/api/health', {
          signal: controller.signal,
        })

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }

        const data: unknown = await response.json()

        if (
          typeof data !== 'object' ||
          data === null ||
          !('status' in data) ||
          data.status !== 'ok'
        ) {
          throw new Error('Invalid API response')
        }

        setApiStatus('connected')
      } catch {
        if (!controller.signal.aborted) {
          setApiStatus('disconnected')
        }
      }
    }

    void checkBackend()

    return () => controller.abort()
  }, [])

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
          <p>Upload PDF, JPG, or PNG invoices for AI processing.</p>
          <input
            type="file"
            accept=".pdf,.jpg,.jpeg,.png"
            multiple
            disabled
          />
          <p className="note">
            File processing will be enabled after backend integration.
          </p>
        </section>

        <section className="upload-card">
          <h2>Recent Invoices</h2>
          <p>No invoices uploaded yet.</p>
        </section>
      </main>
    </div>
  )
}

export default App
