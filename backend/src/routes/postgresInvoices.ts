import { Router } from 'express'
import pool from '../db/postgres.js'

const router = Router()

// Dashboard statistics
router.get('/stats', async (_req, res) => {
  try {
    const [invoices, duplicates, expenses, documentTotals, balances] = await Promise.all([
      pool.query('SELECT COUNT(*) AS total FROM invoices'),

      pool.query(`
        SELECT COUNT(*) AS total
        FROM upload_events
        WHERE is_duplicate = TRUE
      `),

      pool.query(`
        SELECT COALESCE(SUM(total), 0) AS total
        FROM invoice_extractions
        WHERE currency = 'INR'
          AND total IS NOT NULL
      `),
      pool.query(`
        SELECT document_type, currency, SUM(total) AS total
        FROM invoice_extractions
        WHERE document_type IN ('invoice', 'receipt')
          AND currency ~ '^[A-Z]{3}$' AND total IS NOT NULL
        GROUP BY document_type, currency
        ORDER BY currency
      `),
      pool.query(`
        WITH paid AS (
          SELECT a.invoice_id, SUM(a.amount) AS amount
          FROM invoice_payment_allocations a
          JOIN invoice_payments p ON p.id = a.payment_id
          WHERE p.verified_at IS NOT NULL
          GROUP BY a.invoice_id
        )
        SELECT e.currency, SUM(e.total) AS billed, SUM(COALESCE(paid.amount, 0)) AS paid
        FROM invoice_extractions e LEFT JOIN paid ON paid.invoice_id = e.invoice_id
        WHERE e.document_type = 'invoice' AND e.currency ~ '^[A-Z]{3}$' AND e.total IS NOT NULL
        GROUP BY e.currency ORDER BY e.currency
      `),
    ])

    res.json({
      success: true,
      totalInvoices: Number(invoices.rows[0].total),
      duplicatesDetected: Number(duplicates.rows[0].total),
      totalExpenses: Number(expenses.rows[0].total),
      balances: balances.rows,
      documentTotals: documentTotals.rows.map((row) => ({
        documentType: row.document_type,
        currency: row.currency,
        total: Number(row.total),
      })),
    })
  } catch (error) {
    console.error('PostgreSQL statistics error:', error)

    res.status(500).json({
      success: false,
      error: 'Failed to retrieve statistics',
    })
  }
})

// Invoice history
router.get('/invoices', async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        i.id,
        i.filename,
        i.mime_type AS "mimeType",
        i.file_size AS "fileSize",
        i.uploaded_at AS "uploadedAt",
        i.drive_file_url AS "driveFileUrl",
        i.drive_status AS "driveStatus",

        e.document_type AS "documentType",
        e.invoice_number AS "invoiceNumber",
        e.invoice_date AS "invoiceDate",
        e.due_date AS "dueDate",
        e.vendor_name AS "vendorName",
        e.currency,
        e.total,
        COALESCE(applied.paid, 0) AS "confirmedPaid",
        COALESCE(applied.reported, 0) AS "reportedPaid",
        COALESCE(applied.has_receipt, false) AS "hasReceipt",
        e.payment_status AS "paymentStatus",
        e.financial_check_status AS "financialStatus",
        e.extracted_at AS "extractedAt"

      FROM invoices i
      LEFT JOIN invoice_extractions e
        ON i.id = e.invoice_id

      LEFT JOIN LATERAL (
        SELECT SUM(a.amount) FILTER (WHERE p.verified_at IS NOT NULL) AS paid,
          SUM(a.amount) FILTER (WHERE p.verified_at IS NULL) AS reported,
          BOOL_AND(EXISTS (
            SELECT 1 FROM invoice_payment_receipts r WHERE r.payment_id = p.id
          )) FILTER (WHERE p.verified_at IS NOT NULL) AS has_receipt
        FROM invoice_payment_allocations a
        JOIN invoice_payments p ON p.id = a.payment_id
        WHERE a.invoice_id = i.id
      ) applied ON true

      ORDER BY i.id DESC
      LIMIT 100
    `)

    const invoices = result.rows.map((invoice) => ({
      ...invoice,
      id: Number(invoice.id),
      fileSize: Number(invoice.fileSize),
      total:
        invoice.total === null
          ? null
          : Number(invoice.total),
    }))

    res.json({
      success: true,
      count: invoices.length,
      invoices,
    })
  } catch (error) {
    console.error('PostgreSQL invoice history error:', error)

    res.status(500).json({
      success: false,
      error: 'Failed to retrieve invoices',
    })
  }
})

// Individual invoice details
router.get('/invoices/:id', async (req, res) => {
  try {
    const invoiceId = Number(req.params.id)

    if (!Number.isSafeInteger(invoiceId) || invoiceId <= 0) {
      res.status(400).json({
        success: false,
        error: 'Invalid invoice ID',
      })
      return
    }

    const result = await pool.query(
      `
        SELECT
          i.id,
          i.filename,
          i.drive_file_url AS "driveFileUrl",

          e.document_type AS "documentType",
          e.invoice_number AS "invoiceNumber",
          e.invoice_date AS "invoiceDate",
          e.due_date AS "dueDate",
          e.vendor_name AS "vendorName",
          e.currency,
          e.subtotal,
          e.tax_total AS "taxTotal",
          e.total,
          e.payment_status AS "paymentStatus",
          e.category,
          e.financial_check_status AS "financialStatus"

        FROM invoices i
        LEFT JOIN invoice_extractions e
          ON i.id = e.invoice_id
        WHERE i.id = $1
      `,
      [invoiceId]
    )

    const invoice = result.rows[0]

    if (!invoice) {
      res.status(404).json({
        success: false,
        error: 'Invoice not found',
      })
      return
    }

    res.json({
      success: true,
      invoice: {
        ...invoice,
        id: Number(invoice.id),
        subtotal:
          invoice.subtotal === null
            ? null
            : Number(invoice.subtotal),
        taxTotal:
          invoice.taxTotal === null
            ? null
            : Number(invoice.taxTotal),
        total:
          invoice.total === null
            ? null
            : Number(invoice.total),
      },
    })
  } catch (error) {
    console.error('PostgreSQL invoice details error:', error)

    res.status(500).json({
      success: false,
      error: 'Failed to retrieve invoice',
    })
  }
})

export default router