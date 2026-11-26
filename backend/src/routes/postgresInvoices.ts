import { Router } from 'express'
import { z } from 'zod'
import pool from '../db/postgres.js'
import { googleOAuthClient } from '../services/googleAuth.js'
import { confirmReceipt, getInvoice, getPayments, listReviews, presentInvoice } from '../services/invoiceRecords.js'
import type { InvoiceRow } from '../services/invoiceRecords.js'
import { runInvoiceSync } from '../services/sheetSyncWorker.js'
import { sendWorkflowError } from './postgresUpload.js'

const router = Router()
const id = z.string().regex(/^[1-9]\d{0,17}$/)

router.get('/invoices', async (req, res) => {
  try {
    const [result, reviews] = await Promise.all([
      pool.query<InvoiceRow>(`
        SELECT * FROM invoice_register ORDER BY uploaded_at DESC, id DESC
      `),
      listReviews(),
    ])
    res.set('Cache-Control', 'no-store').json({
      invoices: result.rows.map(presentInvoice),
      reviews,
      googleConnected: Boolean(googleOAuthClient.credentials.refresh_token || googleOAuthClient.credentials.access_token),
      canConnectGoogle: Boolean(process.env.ADMIN_USER_EMAIL &&
        process.env.ADMIN_USER_EMAIL.trim().toLowerCase() === req.session.user?.email.toLowerCase()),
    })
  } catch (error) {
    sendWorkflowError(res, error)
  }
})

router.get('/invoices/:id', async (req, res) => {
  const invoiceId = id.safeParse(req.params.id)
  if (!invoiceId.success) {
    res.status(400).json({ error: 'Invalid invoice ID.' })
    return
  }
  try {
    const invoice = await getInvoice(invoiceId.data)
    if (!invoice) {
      res.status(404).json({ error: 'Invoice not found.' })
      return
    }
    res.set('Cache-Control', 'no-store').json({
      invoice: presentInvoice(invoice),
      payments: await getPayments(invoice.id),
    })
  } catch (error) {
    sendWorkflowError(res, error)
  }
})

router.get('/receipt-reviews/:id/file', async (req, res) => {
  const receiptId = id.safeParse(req.params.id)
  if (!receiptId.success) {
    res.status(404).end()
    return
  }
  try {
    const { rows: [row] } = await pool.query<{ content: Buffer; mime_type: string }>(`
      SELECT w.content, i.mime_type
      FROM invoice_work_files w JOIN invoices i ON i.id = w.document_id
      WHERE w.document_id = $1 AND w.state = 'review'
    `, [receiptId.data])
    if (!row) {
      res.status(404).end()
      return
    }
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
      .type(row.mime_type).send(row.content)
  } catch (error) {
    sendWorkflowError(res, error)
  }
})

router.post('/receipt-reviews/:id/confirm', async (req, res) => {
  const receiptId = id.safeParse(req.params.id)
  const invoiceId = id.safeParse(req.body?.invoiceId)
  const actor = req.session.user?.email
  if (!receiptId.success || !invoiceId.success || !actor) {
    res.status(400).json({ error: 'Choose the invoice this receipt belongs to.' })
    return
  }
  try {
    const result = await confirmReceipt(receiptId.data, invoiceId.data, actor)
    void runInvoiceSync()
    res.json(result)
  } catch (error) {
    sendWorkflowError(res, error)
  }
})

export default router
