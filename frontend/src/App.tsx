
import './App.css'

function App() {
  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>AI Invoice Manager</h1>
          <p>Smart invoice extraction and expense management</p>
        </div>
        <span className="status">Development Mode</span>
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
