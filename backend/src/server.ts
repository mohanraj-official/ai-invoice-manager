
import 'dotenv/config'

import express from 'express'
import cors from 'cors'

import db from './db/database.js'
import uploadRouter from './routes/upload.js'
import googleAuthRouter from './routes/googleAuth.js'

// -----------------------------------------
// 1. Express application configuration
// -----------------------------------------

const app = express()
const PORT = Number(process.env.PORT) || 3001

app.use(
  cors({
    origin: 'http://localhost:5173',
  })
)

app.use(express.json({ limit: '1mb' }))

// -----------------------------------------
// 2. Health check API
// -----------------------------------------

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'AI Invoice Manager API',
  })
})

// -----------------------------------------
// 3. Invoice upload API
// -----------------------------------------

app.use('/api/upload', uploadRouter)

// -----------------------------------------
// 4. Dashboard statistics API
// -----------------------------------------

app.get('/api/stats', (_req, res) => {
  try {
    const invoices = db
      .prepare(`
        SELECT COUNT(*) AS total
        FROM invoices
      `)
      .get() as { total: number }

    const duplicates = db
      .prepare(`
        SELECT COUNT(*) AS total
        FROM upload_events
        WHERE is_duplicate = 1
      `)
      .get() as { total: number }

    const expenses = db
      .prepare(`
        SELECT
          COALESCE(SUM(total), 0) AS totalExpenses
        FROM invoice_extractions
        WHERE currency = 'INR'
          AND total IS NOT NULL
      `)
      .get() as { totalExpenses: number }

    res.json({
      success: true,
      totalInvoices: invoices.total,
      totalExpenses: expenses.totalExpenses,
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

// -----------------------------------------
// 5. Invoice history API
// -----------------------------------------

app.get('/api/invoices', (_req, res) => {
  try {
    const invoices = db
      .prepare(`
        SELECT
          i.id,
          i.filename,
          i.mime_type AS mimeType,
          i.file_size AS fileSize,
          i.uploaded_at AS uploadedAt,
          i.drive_file_url AS driveFileUrl,
          i.drive_status AS driveStatus,      

          e.invoice_number AS invoiceNumber,
          e.invoice_date AS invoiceDate,
          e.vendor_name AS vendorName,
          e.currency,
          e.total,
          e.payment_status AS paymentStatus,
          e.financial_check_status AS financialStatus,
          e.extracted_at AS extractedAt

        FROM invoices i

        LEFT JOIN invoice_extractions e
          ON i.id = e.invoice_id

        ORDER BY i.id DESC
        LIMIT 100
      `)
      .all()

    res.json({
      success: true,
      count: invoices.length,
      invoices,
    })
  } catch (error) {
    console.error('Invoice history error:', error)

    res.status(500).json({
      success: false,
      error: 'Failed to retrieve invoices',
    })
  }
})

// -----------------------------------------
// 6. Google OAuth authentication
// -----------------------------------------

app.use('/api/auth/google', googleAuthRouter)

// -----------------------------------------
// 7. Start backend server
// -----------------------------------------

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Backend running on port ${PORT}`)
})
