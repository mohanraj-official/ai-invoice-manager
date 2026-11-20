import db from './db/database.js'
import uploadRouter from './routes/upload.js'
import express from 'express'
import cors from 'cors'
import 'dotenv/config'

const app = express()
const PORT = Number(process.env.PORT) || 3001

app.use(cors({
  origin: 'http://localhost:5173'
}))

app.use(express.json({ limit: '1mb' }))

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'AI Invoice Manager API'
  })
})

app.use('/api/upload', uploadRouter)


app.get('/api/stats', (_req, res) => {
  try {
    const invoices = db
      .prepare('SELECT COUNT(*) AS total FROM invoices')
      .get() as { total: number }

    const duplicates = db
      .prepare(`
        SELECT COUNT(*) AS total
        FROM upload_events
        WHERE is_duplicate = 1
      `)
      .get() as { total: number }

    res.json({
      success: true,
      totalInvoices: invoices.total,
      duplicatesDetected: duplicates.total,
    })
  } catch (error) {
    console.error('Statistics error:', error)

    res.status(500).json({
      success: false,
      error: 'Failed to retrieve statistics',
    })
  }
})


app.listen(PORT, '0.0.0.0', () => {
  console.log(`Backend running on port ${PORT}`)
})
