import pool from '../db/postgres.js'
import type { ExtractedInvoice } from '../types/invoice.js'
import type { FinancialCheckStatus } from './invoiceRepository.js'

export async function saveInvoiceExtractionPg(
  invoiceId: number,
  invoice: ExtractedInvoice,
  financialStatus: FinancialCheckStatus,
): Promise<void> {
  const columns = [
    'invoice_id',
    'document_type',
    'invoice_number',
    'invoice_date',
    'due_date',
    'vendor_name',
    'vendor_tax_id',
    'vendor_address',
    'customer_name',
    'customer_tax_id',
    'customer_address',
    'currency',
    'subtotal',
    'discount_total',
    'tax_total',
    'cgst',
    'sgst',
    'igst',
    'total',
    'payment_status',
    'category',
    'billing_period_start',
    'billing_period_end',
    'line_items_json',
    'financial_check_status',
  ]

  const values = [
    invoiceId,
    invoice.document_type ?? 'unknown',
    invoice.invoice_number,
    invoice.invoice_date,
    invoice.due_date,
    invoice.vendor.name,
    invoice.vendor.tax_id,
    invoice.vendor.address,
    invoice.customer.name,
    invoice.customer.tax_id,
    invoice.customer.address,
    invoice.currency,
    invoice.subtotal,
    invoice.discount_total,
    invoice.tax_total,
    invoice.cgst,
    invoice.sgst,
    invoice.igst,
    invoice.total,
    invoice.payment_status,
    invoice.category,
    invoice.billing_period_start,
    invoice.billing_period_end,
    JSON.stringify(invoice.line_items),
    financialStatus,
  ]

  const placeholders = columns
    .map((_, index) => `$${index + 1}`)
    .join(', ')

  const updates = columns
    .filter((column) => column !== 'invoice_id')
    .map((column) => `${column} = EXCLUDED.${column}`)
    .join(', ')

  await pool.query(
    `
      INSERT INTO invoice_extractions (
        ${columns.join(', ')}
      )
      VALUES (${placeholders})
      ON CONFLICT (invoice_id)
      DO UPDATE SET
        ${updates},
        extracted_at = NOW()
    `,
    values
  )
}