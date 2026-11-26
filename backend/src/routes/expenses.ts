import { Router } from 'express'
import { z } from 'zod'
import { extractInvoice } from '../services/invoiceExtractor.js'
import { addExpenseReceipt, linkExpenseToInvoice, listExpenses, storeExpense } from '../services/expenseRecords.js'
import { asMinorUnits, InvoiceWorkflowError, receiptInput } from '../services/invoiceWorkflow.js'
import { runExpenseSync } from '../services/expenseSyncWorker.js'
import { acceptDocument, readUploadedDocument, sendWorkflowError } from './postgresUpload.js'

const router = Router()
const id = z.string().regex(/^[1-9]\d{0,17}$/)
const detailsSchema = z.object({
  description: z.string().trim().min(1).max(160),
  vendor: z.string().trim().max(160).default(''),
  paymentDate: z.iso.date(),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
  amount: z.string().trim().refine((value) =>
    /^(?:0|[1-9]\d{0,12})(?:\.\d{1,2})?$/.test(value) && asMinorUnits(value) > 0n),
  transactionReference: z.string().trim().max(200).default(''),
  receiptNumber: z.string().trim().max(200).default(''),
  method: z.enum(['bank', 'card', 'upi', 'cash', 'other']).default('other'),
})

function readDetails(body: { details?: unknown } | undefined) {
  if (typeof body?.details !== 'string') return undefined
  try {
    return JSON.parse(body.details) as unknown
  } catch {
    return undefined
  }
}

router.get('/', async (_req, res) => {
  try {
    res.set('Cache-Control', 'no-store').json({ expenses: await listExpenses() })
  } catch (error) {
    sendWorkflowError(res, error)
  }
})

router.post('/read-receipt', acceptDocument, async (req, res) => {
  try {
    if (!req.file) throw new InvoiceWorkflowError('Choose a receipt or payment screenshot.', 400)
    const file = await readUploadedDocument(req.file)
    const extracted = await extractInvoice(file.buffer, file.mimeType).catch(() => {
      throw new InvoiceWorkflowError('The receipt could not be read. Try a clearer copy or enter the expense manually.', 502)
    })
    const proof = receiptInput(extracted)
    const description = extracted.line_items.find((item) => item.description?.trim())?.description?.trim()
    res.set('Cache-Control', 'no-store').json({
      description: (description ?? proof.vendorName ?? '').slice(0, 160),
      vendor: proof.vendorName?.slice(0, 160) ?? '',
      paymentDate: proof.paymentDate,
      currency: proof.currency,
      amount: proof.amount,
      method: proof.method,
      transactionReference: proof.transactionReference ?? '',
      receiptNumber: extracted.document_type === 'receipt' ? extracted.invoice_number?.trim().slice(0, 200) ?? '' : '',
    })
  } catch (error) {
    sendWorkflowError(res, error)
  }
})

router.post('/', acceptDocument, async (req, res) => {
  const request = z.object({ requestId: z.uuid(), details: detailsSchema }).safeParse(readDetails(req.body))
  const actor = req.session.user?.email
  if (!request.success || !actor) {
    res.status(400).json({ error: 'Enter a description, payment date, currency and positive amount with up to two decimals.' })
    return
  }
  try {
    const file = req.file ? await readUploadedDocument(req.file) : undefined
    const expense = await storeExpense(request.data.details, request.data.requestId, actor, file)
    void runExpenseSync()
    res.status(201).json(expense)
  } catch (error) {
    sendWorkflowError(res, error)
  }
})

router.post('/:id/receipt', acceptDocument, async (req, res) => {
  const expenseId = id.safeParse(req.params.id)
  const details = detailsSchema.safeParse(readDetails(req.body))
  if (!expenseId.success || !details.success || !req.file) {
    res.status(400).json({ error: 'Choose a receipt and verify its payment details.' })
    return
  }
  try {
    const expense = await addExpenseReceipt(expenseId.data, details.data, await readUploadedDocument(req.file))
    void runExpenseSync()
    res.json(expense)
  } catch (error) {
    sendWorkflowError(res, error)
  }
})

router.post('/:id/link-invoice', async (req, res) => {
  const expenseId = id.safeParse(req.params.id)
  const invoiceId = id.safeParse(req.body?.invoiceId)
  const actor = req.session.user?.email
  if (!expenseId.success || !invoiceId.success || !actor) {
    res.status(400).json({ error: 'Choose the invoice for this expense.' })
    return
  }
  try {
    const expense = await linkExpenseToInvoice(expenseId.data, invoiceId.data, actor)
    void runExpenseSync()
    res.json(expense)
  } catch (error) {
    sendWorkflowError(res, error)
  }
})

export default router
