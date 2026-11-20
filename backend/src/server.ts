import 'dotenv/config'
import { requireAdmin } from './middleware/requireAdmin.js'
import express from 'express'
import cors from 'cors'
import session from 'express-session'
import connectSqlite3 from 'connect-sqlite3'
import { join } from 'node:path'

import db from './db/database.js'

import uploadRouter from './routes/upload.js'
import googleAuthRouter from './routes/googleAuth.js'
import userAuthRouter from './routes/userAuth.js'

import { requireAuth } from './middleware/requireAuth.js'

// -----------------------------------------
// 1. Application configuration
// -----------------------------------------

const app = express()

const PORT = Number(process.env.PORT) || 3001
const isProduction = process.env.NODE_ENV === 'production'

const frontendOrigin =
  process.env.FRONTEND_ORIGIN || 'http://localhost:5173'

const sessionSecret = process.env.SESSION_SECRET

if (!sessionSecret || sessionSecret.length < 32) {
  throw new Error(
    'SESSION_SECRET must contain at least 32 characters'
  )
}

// Required when running behind a trusted cloud proxy
if (isProduction) {
  app.set('trust proxy', 1)
}

// -----------------------------------------
// 2. CORS configuration
// -----------------------------------------

app.use(
  cors({
    origin: frontendOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
  })
)

app.use(
  express.json({
    limit: '1mb',
  })
)

// -----------------------------------------
// 3. Session configuration
// -----------------------------------------

const SQLiteStore = connectSqlite3(session)

app.use(
  session({
    store: new SQLiteStore({
      db: 'sessions.sqlite',
      dir: join(process.cwd(), 'data'),
    }) as unknown as session.Store,

    name: 'invoice.sid',

    secret: sessionSecret,

    resave: false,
    saveUninitialized: false,

    cookie: {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      maxAge: 8 * 60 * 60 * 1000,
    },
  })
)

// -----------------------------------------
// 4. Health check
// -----------------------------------------

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'AI Invoice Manager API',
  })
})

// -----------------------------------------
// 5. User authentication
// -----------------------------------------

app.use('/api/auth/user', userAuthRouter)

// Existing Google Drive / Sheets authorization
app.use('/api/auth/google', requireAuth, requireAdmin, googleAuthRouter)

// -----------------------------------------
// 6. Protected invoice upload
// -----------------------------------------

app.use(
  '/api/upload',
  requireAuth,
  uploadRouter
)

// -----------------------------------------
// 7. Protected dashboard statistics
// -----------------------------------------

app.get('/api/stats', requireAuth, (_req, res) => {
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
// 8. Protected invoice history
// -----------------------------------------

app.get('/api/invoices', requireAuth, (_req, res) => {
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
// 9. Protected individual invoice details
// -----------------------------------------

app.get('/api/invoices/:id', requireAuth, (req, res) => {
  try {
    const invoiceId = Number(req.params.id)

    if (
      !Number.isSafeInteger(invoiceId) ||
      invoiceId <= 0
    ) {
      res.status(400).json({
        success: false,
        error: 'Invalid invoice ID',
      })
      return
    }

    const invoice = db
      .prepare(`
        SELECT
          i.id,
          i.filename,
          i.drive_file_url AS driveFileUrl,

          e.invoice_number AS invoiceNumber,
          e.invoice_date AS invoiceDate,
          e.due_date AS dueDate,
          e.vendor_name AS vendorName,
          e.currency,
          e.subtotal,
          e.tax_total AS taxTotal,
          e.total,
          e.payment_status AS paymentStatus,
          e.category,
          e.financial_check_status AS financialStatus

        FROM invoices i

        LEFT JOIN invoice_extractions e
          ON i.id = e.invoice_id

        WHERE i.id = ?
      `)
      .get(invoiceId)

    if (!invoice) {
      res.status(404).json({
        success: false,
        error: 'Invoice not found',
      })
      return
    }

    res.json({
      success: true,
      invoice,
    })
  } catch (error) {
    console.error('Invoice details error:', error)

    res.status(500).json({
      success: false,
      error: 'Failed to retrieve invoice',
    })
  }
})

// -----------------------------------------
// 10. Start backend
// -----------------------------------------

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Backend running on port ${PORT}`)
})