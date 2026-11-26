import type { PoolClient } from 'pg'
import pool from '../db/postgres.js'
import type { PaymentMethod } from '../types/invoice.js'
import {
  getInvoice, lockPaymentReference, paymentByReference, recordInvoicePayment, transaction,
} from './invoiceRecords.js'
import type { WorkFile } from './invoiceRecords.js'
import { asMinorUnits, expenseCode, invoiceCode, invoiceVendor, InvoiceWorkflowError, normalizePaymentReference } from './invoiceWorkflow.js'

export type ExpenseDetails = {
  description: string
  vendor: string
  paymentDate: string
  currency: string
  amount: string
  method: PaymentMethod
  transactionReference: string
  receiptNumber: string
}

export type ExpenseRow = {
  id: string
  description: string
  vendor: string | null
  payment_date: string
  currency: string
  amount: string
  payment_method: PaymentMethod
  payment_reference: string | null
  receipt_number: string | null
  receipt_sha256: string | null
  receipt_url: string | null
  linked_invoice_id: string | null
  linked_payment_id: string | null
  sync_at: Date | null
}

export const expenseColumns = `id, description, vendor, payment_date::text, currency, amount,
  payment_method, payment_reference, receipt_number, receipt_sha256, receipt_url,
  linked_invoice_id, linked_payment_id, sync_at`

export function expenseStatus(row: ExpenseRow) {
  if (row.linked_invoice_id) return 'Linked to invoice'
  return row.receipt_sha256 ? 'Paid · Receipt attached' : 'Paid · No receipt'
}

function presentExpense(row: ExpenseRow) {
  return {
    id: row.id,
    expenseId: expenseCode(row.id),
    description: row.description,
    vendor: row.vendor,
    paymentDate: row.payment_date,
    amount: row.amount,
    currency: row.currency,
    status: expenseStatus(row),
    hasReceipt: Boolean(row.receipt_sha256),
    receiptUrl: row.receipt_url,
    linkedInvoice: row.linked_invoice_id && invoiceCode(row.linked_invoice_id),
    syncPending: row.sync_at !== null,
  }
}

export async function listExpenses() {
  const { rows } = await pool.query<ExpenseRow>(`
    SELECT ${expenseColumns} FROM standalone_expenses ORDER BY payment_date DESC, id DESC
  `)
  return rows.map(presentExpense)
}

function proofKeys(details: ExpenseDetails) {
  const vendor = invoiceVendor(details.vendor, details.description)
  const transactionReference = details.transactionReference || null
  return {
    vendor: vendor.name || null,
    vendorKey: vendor.key || null,
    currency: details.currency,
    transactionReference,
    referenceKey: transactionReference ? normalizePaymentReference(transactionReference) || null : null,
    receiptNumber: details.receiptNumber || null,
    receiptNumberKey: normalizePaymentReference(details.receiptNumber) || null,
  }
}

async function checkExpenseProof(
  client: PoolClient, keys: ReturnType<typeof proofKeys>, file?: WorkFile, expense?: ExpenseRow,
) {
  if (file) {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['invoice-document:' + file.hash])
  }
  await lockPaymentReference(keys, client)
  if (keys.vendorKey && keys.receiptNumberKey) {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      'expense-receipt:' + keys.vendorKey + ':' + keys.receiptNumberKey,
    ])
  }
  const { rows: [duplicate] } = await client.query<{ id: string }>(`
    SELECT id FROM standalone_expenses
    WHERE id IS DISTINCT FROM $6::bigint AND (
      receipt_sha256 = $1 OR (currency = $2 AND reference_key = $3)
      OR (vendor_key = $4 AND receipt_number_key = $5)
    )
    LIMIT 1
  `, [file?.hash ?? null, keys.currency, keys.referenceKey, keys.vendorKey, keys.receiptNumberKey, expense?.id ?? null])
  if (duplicate) {
    throw new InvoiceWorkflowError('This payment is already recorded as ' + expenseCode(duplicate.id) + '.', 409)
  }
  const invoicePayment = await paymentByReference(keys, client)
  if (invoicePayment && invoicePayment.id !== expense?.linked_payment_id) {
    throw new InvoiceWorkflowError(invoicePayment.invoice_id
      ? 'This payment is already recorded on ' + invoiceCode(invoicePayment.invoice_id) + '.'
      : 'This payment is already in the invoice tracker.', 409)
  }
  if (!file) return
  const { rowCount } = await client.query(`
    SELECT 1 FROM invoices d
    WHERE (d.sha256 = $1 OR EXISTS (
      SELECT 1 FROM invoice_extractions e WHERE e.invoice_id = d.id AND e.document_type = 'receipt'
        AND ($2 = e.vendor_key OR (e.vendor_key IS NULL AND
          $2 = btrim(regexp_replace(lower(e.vendor_name), '[^[:alnum:]]+', ' ', 'g'))))
        AND $3 = regexp_replace(lower(e.invoice_number), '[^a-z0-9]', '', 'g')
    )) AND NOT (d.sha256 = $1 AND EXISTS (
      SELECT 1 FROM invoice_work_files w WHERE w.document_id = d.id AND w.state = 'review' AND w.target_invoice_id IS NULL
    ))
    LIMIT 1
  `, [file.hash, keys.vendorKey, keys.receiptNumberKey])
  if (rowCount) {
    throw new InvoiceWorkflowError('This file or receipt number is already in the invoice tracker. Check the invoice or receipt review first.', 409)
  }
}

export async function storeExpense(details: ExpenseDetails, requestId: string, actor: string, file?: WorkFile) {
  const keys = proofKeys(details)
  return transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', ['expense-request:' + requestId])
    const { rows: [prior] } = await client.query<ExpenseRow>(`
      SELECT ${expenseColumns} FROM standalone_expenses WHERE request_id = $1 AND recorded_by = $2
    `, [requestId, actor])
    if (prior) return presentExpense(prior)

    await checkExpenseProof(client, keys, file)
    const { rows: [row] } = await client.query<ExpenseRow>(`
      INSERT INTO standalone_expenses (request_id, description, vendor, vendor_key, payment_date, currency, amount,
        payment_method, payment_reference, reference_key, receipt_number, receipt_number_key,
        receipt_sha256, receipt_mime_type, receipt_content, recorded_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING ${expenseColumns}
    `, [
      requestId, details.description, keys.vendor, keys.vendorKey, details.paymentDate, details.currency, details.amount,
      details.method, keys.transactionReference, keys.referenceKey, keys.receiptNumber, keys.receiptNumberKey,
      file?.hash ?? null, file?.mimeType ?? null, file?.buffer ?? null, actor,
    ])
    if (!row) throw new Error('Expense insert returned no ID')
    return presentExpense(row)
  })
}

async function lockExpense(client: PoolClient, id: string) {
  const { rows: [row] } = await client.query<ExpenseRow>(`
    SELECT ${expenseColumns} FROM standalone_expenses WHERE id = $1 FOR UPDATE
  `, [id])
  if (!row) throw new InvoiceWorkflowError('Expense not found.', 404)
  return row
}

export async function addExpenseReceipt(id: string, details: ExpenseDetails, file: WorkFile) {
  return transaction(async (client) => {
    const expense = await lockExpense(client, id)
    if (expense.receipt_sha256 === file.hash) return presentExpense(expense)
    if (expense.receipt_sha256) throw new InvoiceWorkflowError('This expense already has a receipt.', 409)
    if (expense.currency !== details.currency || expense.payment_date !== details.paymentDate ||
        asMinorUnits(expense.amount) !== asMinorUnits(details.amount)) {
      throw new InvoiceWorkflowError('Use a receipt with the same payment date, amount and currency as this expense.', 409)
    }
    const keys = proofKeys({ ...details, vendor: details.vendor || expense.vendor || '' })
    if (expense.payment_reference && keys.referenceKey &&
        normalizePaymentReference(expense.payment_reference) !== keys.referenceKey) {
      throw new InvoiceWorkflowError('The receipt has a different payment reference from this expense.', 409)
    }
    await checkExpenseProof(client, keys, file, expense)
    const { rows: [updated] } = await client.query<ExpenseRow>(`
      UPDATE standalone_expenses SET receipt_sha256 = $2, receipt_mime_type = $3, receipt_content = $4,
        vendor = COALESCE($5, vendor), vendor_key = COALESCE($6, vendor_key),
        payment_reference = COALESCE(payment_reference, $7), reference_key = COALESCE(reference_key, $8),
        receipt_number = $9, receipt_number_key = $10, sync_at = NOW()
      WHERE id = $1 RETURNING ${expenseColumns}
    `, [
      id, file.hash, file.mimeType, file.buffer, keys.vendor, keys.vendorKey,
      keys.transactionReference, keys.referenceKey, keys.receiptNumber, keys.receiptNumberKey,
    ])
    if (!updated) throw new Error('Expense receipt update returned no ID')
    return presentExpense(updated)
  })
}

export async function linkExpenseToInvoice(id: string, invoiceId: string, actor: string) {
  return transaction(async (client) => {
    const expense = await lockExpense(client, id)
    if (expense.linked_invoice_id === invoiceId) return presentExpense(expense)
    if (expense.linked_invoice_id) throw new InvoiceWorkflowError('This expense is already linked to an invoice.', 409)
    const payment = {
      transactionReference: expense.payment_reference,
      paymentDate: expense.payment_date,
      currency: expense.currency,
      amount: expense.amount,
      method: expense.payment_method,
      paidBy: null,
    }
    await lockPaymentReference(payment, client)
    await client.query('SELECT id FROM invoices WHERE id = $1 FOR UPDATE', [invoiceId])
    const invoice = await getInvoice(invoiceId, client)
    if (!invoice) throw new InvoiceWorkflowError('Invoice not found.', 404)
    if (!invoice.total || invoice.currency !== expense.currency) {
      throw new InvoiceWorkflowError('Choose an invoice with a total and the same currency.', 409)
    }
    const duplicate = await paymentByReference(payment, client)
    if (duplicate) {
      throw new InvoiceWorkflowError('This payment reference is already recorded on an invoice. Review that payment before linking.', 409)
    }
    const { rowCount } = await client.query(`
      SELECT 1 FROM invoice_payment_allocations a JOIN invoice_payments p ON p.id = a.payment_id
      WHERE a.invoice_id = $1 AND p.payment_date = $2::date AND a.amount = $3
        AND (p.reference IS NULL OR $4::text IS NULL)
      LIMIT 1
    `, [invoiceId, expense.payment_date, expense.amount, expense.payment_reference])
    if (rowCount) {
      throw new InvoiceWorkflowError('That invoice already has a payment with this date and amount. Review it before linking.', 409)
    }
    const paymentId = await recordInvoicePayment(client, invoiceId, payment, actor)
    const { rows: [linked] } = await client.query<ExpenseRow>(`
      UPDATE standalone_expenses SET linked_invoice_id = $2, linked_payment_id = $3, sync_at = NOW()
      WHERE id = $1 RETURNING ${expenseColumns}
    `, [id, invoiceId, paymentId])
    if (!linked) throw new Error('Expense link returned no ID')
    return presentExpense(linked)
  })
}
