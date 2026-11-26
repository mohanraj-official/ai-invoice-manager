import type { PoolClient } from 'pg'
import pool from '../db/postgres.js'
import type { ExtractedInvoice } from '../types/invoice.js'
import { checkInvoiceTotals } from '../validators/invoiceValidator.js'
import { saveInvoiceExtractionPg } from './postgresInvoiceRepository.js'
import {
  asMinorUnits, autoMatchReceipt, invoiceCode, invoiceInput, invoiceVendor, InvoiceWorkflowError,
  normalizeInvoiceNumber, normalizePaymentReference, receiptInput,
} from './invoiceWorkflow.js'
import type { MatchInvoice, ReceiptProof } from './invoiceWorkflow.js'

export type InvoiceRow = {
  id: string
  filename: string
  uploaded_at: Date
  drive_file_id: string | null
  drive_file_url: string | null
  drive_status: string
  invoice_number: string | null
  invoice_date: string | null
  due_date: string | null
  vendor_name: string | null
  vendor_key: string | null
  vendor_tax_id: string | null
  customer_name: string | null
  currency: string | null
  subtotal: string | null
  tax_total: string | null
  total: string | null
  category: string | null
  financial_check_status: string
  billing_period_start: string | null
  billing_period_end: string | null
  description: string | null
  amount_paid: string
  balance_due: string | null
  overpayment: string | null
  payment_date: string | null
  payment_status: 'unpaid' | 'partially_paid' | 'paid' | 'overpaid'
  sync_pending: boolean
}

export type PaymentRow = {
  id: string
  amount: string
  currency: string
  date: string
  paidBy: string | null
  reference: string | null
  receipts: { url: string }[]
}

type Client = Pick<PoolClient, 'query'>
type DocumentType = 'invoice' | 'receipt'
type WorkFile = {
  filename: string
  mimeType: string
  hash: string
  buffer: Buffer
}

export type UploadResult = {
  kind: 'invoice' | 'receipt' | 'duplicate' | 'review'
  invoiceId: string | null
  reviewId?: string
}

export type ReviewRow = {
  id: string
  filename: string
  targetInvoiceId: string | null
  proof: ReceiptProof
}

export async function transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await work(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

export function presentInvoice(row: InvoiceRow) {
  return {
    id: row.id,
    invoiceId: invoiceCode(row.id),
    invoiceNumber: row.invoice_number,
    invoiceDate: row.invoice_date,
    dueDate: row.due_date,
    vendor: row.vendor_name,
    currency: row.currency,
    total: row.total,
    invoiceUrl: row.drive_file_url,
    description: row.description,
    category: row.category,
    amountPaid: row.amount_paid,
    balanceDue: row.balance_due,
    overpayment: row.overpayment,
    paymentDate: row.payment_date,
    paymentStatus: row.payment_status,
    syncPending: row.sync_pending,
  }
}

export async function getInvoice(id: string, client: Client = pool): Promise<InvoiceRow | undefined> {
  return (await client.query<InvoiceRow>('SELECT * FROM invoice_register WHERE id = $1', [id])).rows[0]
}

export async function getPayments(invoiceId: string, client: Client = pool): Promise<PaymentRow[]> {
  return (await client.query<PaymentRow>(`
    SELECT p.id::text, a.amount::text, p.currency, p.payment_date::text AS date,
      p.payer_name AS "paidBy", p.reference,
      (
        SELECT COALESCE(json_agg(json_build_object('url', d.drive_file_url) ORDER BY d.id), '[]'::json)
        FROM invoice_payment_receipts r JOIN invoices d ON d.id = r.receipt_id
        WHERE r.payment_id = p.id AND d.drive_status = 'uploaded' AND d.drive_file_url IS NOT NULL
      ) AS receipts
    FROM invoice_payment_allocations a
    JOIN invoice_payments p ON p.id = a.payment_id
    WHERE a.invoice_id = $1 AND p.verified_at IS NOT NULL
    ORDER BY p.id
  `, [invoiceId])).rows
}

export async function queueSheet(invoiceId: string, client: Client): Promise<void> {
  await client.query(`
    INSERT INTO invoice_sheet_queue (invoice_id)
    VALUES ($1)
    ON CONFLICT (invoice_id) DO UPDATE SET available_at = NOW()
  `, [invoiceId])
}

export async function listReviews(): Promise<ReviewRow[]> {
  return (await pool.query<ReviewRow>(`
    SELECT i.id::text, i.filename, w.target_invoice_id::text AS "targetInvoiceId", w.proof
    FROM invoice_work_files w JOIN invoices i ON i.id = w.document_id
    WHERE w.state = 'review' ORDER BY i.id DESC
  `)).rows
}

export async function findDuplicateDocument(
  hash: string, kind: DocumentType, targetId?: string, client: Client = pool,
): Promise<UploadResult | null> {
  const { rows: [row] } = await client.query<{
    id: string
    kind: DocumentType | null
    state: 'review' | 'ready' | null
    invoice_id: string | null
  }>(`
    SELECT d.id, e.document_type AS kind, w.state, COALESCE(w.target_invoice_id,
      (SELECT MIN(a.invoice_id) FROM invoice_payment_allocations a WHERE a.payment_id = r.payment_id)
    ) AS invoice_id
    FROM invoices d
    LEFT JOIN invoice_extractions e ON e.invoice_id = d.id
    LEFT JOIN invoice_work_files w ON w.document_id = d.id
    LEFT JOIN invoice_payment_receipts r ON r.receipt_id = d.id
    WHERE d.sha256 = $1
  `, [hash])

  if (!row) return null
  if (row.kind !== kind) {
    throw new InvoiceWorkflowError('This file is already stored as another document. Choose a separate original.', 409)
  }
  if (kind === 'invoice') return { kind: 'duplicate', invoiceId: row.id }
  if (row.state === 'review') return { kind: 'review', invoiceId: targetId ?? row.invoice_id, reviewId: row.id }
  if (targetId && row.invoice_id && row.invoice_id !== targetId) {
    throw new InvoiceWorkflowError('This receipt is already attached to another invoice.', 409)
  }
  if (row.invoice_id) return { kind: 'duplicate', invoiceId: row.invoice_id }

  throw new InvoiceWorkflowError('This receipt exists in the previous app without an invoice link. Review its original record first.', 409)
}

async function saveDocument(file: WorkFile, client: Client): Promise<string> {
  const { rows: [row] } = await client.query<{ id: string }>(`
    INSERT INTO invoices (filename, mime_type, file_size, sha256)
    VALUES ($1, $2, $3, $4) RETURNING id
  `, [file.filename.slice(0, 240), file.mimeType, file.buffer.length, file.hash])
  if (!row) throw new Error('Invoice document insert returned no ID')
  return row.id
}

export async function storeInvoice(file: WorkFile, extraction: ExtractedInvoice): Promise<UploadResult> {
  const fields = invoiceInput(extraction)
  const totals = checkInvoiceTotals(extraction)
  const financialStatus = totals.valid ? 'verified' : totals.message.startsWith('Total mismatch') ? 'mismatch' : 'not_checked'

  return transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['invoice-document:' + file.hash])
    const duplicate = await findDuplicateDocument(file.hash, 'invoice', undefined, client)
    if (duplicate) return duplicate

    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['invoice-vendor:' + fields.vendor.key])
    const { rows: priorInvoices } = await client.query<InvoiceRow>(`
      SELECT * FROM invoice_register
      WHERE invoice_number_key = $1
         OR (invoice_number_key IS NULL AND lower(btrim(invoice_number)) = $1)
    `, [fields.invoiceNumberKey])
    const sameVendor = priorInvoices.filter((row) =>
      (row.vendor_key ?? invoiceVendor(row.vendor_name ?? '', row.description ?? '').key) === fields.vendor.key,
    )
    if (sameVendor.length > 1) {
      throw new InvoiceWorkflowError('More than one existing invoice has this vendor invoice number. Check the existing records first.', 409)
    }
    const existing = sameVendor[0]
    if (existing) {
      if (existing.currency !== fields.currency || existing.total === null ||
          asMinorUnits(existing.total) !== asMinorUnits(fields.total) || existing.invoice_date !== extraction.invoice_date) {
        throw new InvoiceWorkflowError('This vendor invoice number already exists with different details. Compare the two bills before continuing.', 409)
      }
      return { kind: 'duplicate', invoiceId: existing.id }
    }

    const priorVendor = (await client.query<{ vendor_name: string }>(`
      SELECT vendor_name FROM invoice_extractions
      WHERE vendor_key = $1 AND document_type = 'invoice' ORDER BY invoice_id LIMIT 1
    `, [fields.vendor.key])).rows[0]
    const id = await saveDocument(file, client)
    await saveInvoiceExtractionPg(id, {
      ...extraction,
      invoice_number: fields.invoiceNumber,
      vendor: { ...extraction.vendor, name: priorVendor?.vendor_name ?? fields.vendor.name },
      currency: fields.currency,
      payment_status: 'unpaid',
    }, financialStatus, client)
    await client.query(`
      UPDATE invoice_extractions SET vendor_key = $2, invoice_number_key = $3, description = $4
      WHERE invoice_id = $1
    `, [id, fields.vendor.key, fields.invoiceNumberKey, fields.description])
    await client.query(`
      INSERT INTO invoice_work_files (document_id, content, state) VALUES ($1, $2, 'ready')
    `, [id, file.buffer])

    return { kind: 'invoice', invoiceId: id }
  })
}

async function paymentByReference(proof: ReceiptProof, client: Client) {
  const key = proof.transactionReference && normalizePaymentReference(proof.transactionReference)
  if (!key) return undefined
  const { rows } = await client.query<{ id: string; amount: string; invoice_id: string | null }>(`
    SELECT p.id, p.amount, (SELECT MIN(a.invoice_id)
      FROM invoice_payment_allocations a WHERE a.payment_id = p.id
    ) AS invoice_id
    FROM invoice_payments p
    WHERE p.currency = $1 AND (p.reference_key = $2 OR (
      p.reference_key IS NULL AND regexp_replace(lower(p.reference), '[^a-z0-9]', '', 'g') = $2
    ))
    LIMIT 2
  `, [proof.currency, key])
  if (rows.length > 1) throw new InvoiceWorkflowError('This payment reference already appears more than once. Review the existing payments.', 409)
  return rows[0]
}

async function duplicatePayment(proof: ReceiptProof, client: Client, targetId?: string): Promise<UploadResult | null> {
  const existing = await paymentByReference(proof, client)
  if (!existing) return null
  if (!existing.invoice_id || (targetId && existing.invoice_id !== targetId) ||
      asMinorUnits(existing.amount) !== asMinorUnits(proof.amount)) {
    throw new InvoiceWorkflowError('This transaction reference is already recorded with different payment details.', 409)
  }
  return { kind: 'duplicate', invoiceId: existing.invoice_id }
}

function matchRow(row: InvoiceRow): MatchInvoice {
  return {
    id: row.id,
    invoiceDate: row.invoice_date,
    invoiceNumber: row.invoice_number,
    vendorKey: row.vendor_key ?? invoiceVendor(row.vendor_name ?? '', row.description ?? '').key,
    currency: row.currency,
    total: row.total,
    balanceDue: row.balance_due,
  }
}

async function attachReceipt(client: Client, documentId: string, invoiceId: string, proof: ReceiptProof, actor: string) {
  await client.query('SELECT id FROM invoices WHERE id = $1 FOR UPDATE', [invoiceId])
  const invoice = await getInvoice(invoiceId, client)
  if (!invoice?.total || !invoice.invoice_date || !invoice.vendor_name) {
    throw new InvoiceWorkflowError('Choose an invoice that has a vendor, date, and amount.', 409)
  }
  if (invoice.currency !== proof.currency) throw new InvoiceWorkflowError('The receipt currency does not match this invoice.', 409)
  if (proof.invoiceReference && invoice.invoice_number &&
      normalizeInvoiceNumber(proof.invoiceReference) !== normalizeInvoiceNumber(invoice.invoice_number)) {
    throw new InvoiceWorkflowError('The printed invoice number on the proof belongs to a different invoice.', 409)
  }

  const duplicate = await duplicatePayment(proof, client, invoiceId)
  if (duplicate) return duplicate
  const key = proof.transactionReference && normalizePaymentReference(proof.transactionReference)
  const sameAmountAndDate = await client.query(`
    SELECT 1 FROM invoice_payment_allocations a
    JOIN invoice_payments p ON p.id = a.payment_id
    WHERE a.invoice_id = $1 AND p.payment_date = $2::date AND a.amount = $3
      AND (p.reference IS NULL OR $4::text IS NULL)
    LIMIT 1
  `, [invoiceId, proof.paymentDate, proof.amount, key])
  if (sameAmountAndDate.rowCount) {
    throw new InvoiceWorkflowError('A payment with the same date and amount already exists. Use proof showing a distinct transaction reference.', 409)
  }

  const { rows: [payment] } = await client.query<{ id: string }>(`
    INSERT INTO invoice_payments (payment_date, currency, amount, method, reference, reference_key, recorded_by, payer_name)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id
  `, [proof.paymentDate, proof.currency, proof.amount, proof.method, proof.transactionReference, key, actor, proof.paidBy])
  if (!payment) throw new Error('Payment insert returned no ID')
  await client.query(`
    INSERT INTO invoice_payment_allocations (payment_id, invoice_id, amount, allocated_by)
    VALUES ($1, $2, $3, $4)
  `, [payment.id, invoiceId, proof.amount, actor])
  await client.query(`
    INSERT INTO invoice_payment_receipts (receipt_id, payment_id, attached_by) VALUES ($1, $2, $3)
  `, [documentId, payment.id, actor])
  await client.query(`
    UPDATE invoice_work_files SET state = 'ready', target_invoice_id = $2, payment_id = $3,
      receipt_number = (
        SELECT COUNT(*) FROM invoice_payment_receipts r
        JOIN invoice_payment_allocations a ON a.payment_id = r.payment_id
        WHERE a.invoice_id = $2
      ),
      available_at = NOW()
    WHERE document_id = $1
  `, [documentId, invoiceId, payment.id])
  return { kind: 'receipt', invoiceId } as const
}

async function lockPaymentReference(proof: ReceiptProof, client: Client) {
  if (!proof.transactionReference) return
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
    'invoice-payment:' + proof.currency + ':' + normalizePaymentReference(proof.transactionReference),
  ])
}

export async function storeReceipt(
  file: WorkFile, extraction: ExtractedInvoice, actor: string, targetId?: string, paidBy?: string,
): Promise<UploadResult> {
  const proof = receiptInput(extraction, paidBy)

  return transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['invoice-document:' + file.hash])
    const duplicate = await findDuplicateDocument(file.hash, 'receipt', targetId, client)
    if (duplicate) return duplicate
    if (targetId && !await getInvoice(targetId, client)) {
      throw new InvoiceWorkflowError('That invoice no longer exists. Choose another invoice.', 404)
    }
    await lockPaymentReference(proof, client)
    const paymentDuplicate = await duplicatePayment(proof, client, targetId)
    if (paymentDuplicate) return paymentDuplicate

    const id = await saveDocument(file, client)
    await saveInvoiceExtractionPg(id, { ...extraction, document_type: 'receipt', currency: proof.currency }, 'not_checked', client)
    await client.query(`
      INSERT INTO invoice_work_files (document_id, content, state, target_invoice_id, proof)
      VALUES ($1, $2, 'review', $3, $4)
    `, [id, file.buffer, targetId ?? null, JSON.stringify(proof)])

    const { rows } = await client.query<InvoiceRow>(`
      SELECT * FROM invoice_register WHERE currency = $1 AND invoice_date <= $2
        AND (vendor_key = $3 OR vendor_key IS NULL OR id = $4)
    `, [proof.currency, proof.paymentDate, proof.vendorKey, targetId ?? null])
    const invoiceId = autoMatchReceipt(proof, rows.map(matchRow), targetId)

    return invoiceId
      ? attachReceipt(client, id, invoiceId, proof, actor)
      : { kind: 'review', invoiceId: targetId ?? null, reviewId: id }
  })
}

export async function confirmReceipt(documentId: string, invoiceId: string, actor: string): Promise<UploadResult> {
  return transaction(async (client) => {
    const { rows: [work] } = await client.query<{ proof: ReceiptProof }>(`
      SELECT proof FROM invoice_work_files WHERE document_id = $1 AND state = 'review' FOR UPDATE
    `, [documentId])
    if (!work) {
      throw new InvoiceWorkflowError('That receipt has already been handled. Refresh the invoice list.', 409)
    }

    await lockPaymentReference(work.proof, client)
    const result = await attachReceipt(client, documentId, invoiceId, work.proof, actor)
    if (result.kind === 'duplicate') {
      await client.query('DELETE FROM invoices WHERE id = $1', [documentId])
    }
    return result
  })
}
