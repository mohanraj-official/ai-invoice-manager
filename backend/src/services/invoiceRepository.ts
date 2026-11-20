
import db from '../db/database.js'
import type { ExtractedInvoice } from '../types/invoice.js'

export type FinancialCheckStatus =
  | 'verified'
  | 'mismatch'
  | 'not_checked'

export function saveInvoiceExtraction(
  invoiceId: number,
  invoice: ExtractedInvoice,
  financialStatus: FinancialCheckStatus,
): void {
  const statement = db.prepare(`
    INSERT INTO invoice_extractions (
      invoice_id,
      invoice_number,
      invoice_date,
      due_date,
      vendor_name,
      vendor_tax_id,
      vendor_address,
      customer_name,
      customer_tax_id,
      customer_address,
      currency,
      subtotal,
      discount_total,
      tax_total,
      cgst,
      sgst,
      igst,
      total,
      payment_status,
      category,
      billing_period_start,
      billing_period_end,
      line_items_json,
      financial_check_status
    )
    VALUES (
      @invoice_id,
      @invoice_number,
      @invoice_date,
      @due_date,
      @vendor_name,
      @vendor_tax_id,
      @vendor_address,
      @customer_name,
      @customer_tax_id,
      @customer_address,
      @currency,
      @subtotal,
      @discount_total,
      @tax_total,
      @cgst,
      @sgst,
      @igst,
      @total,
      @payment_status,
      @category,
      @billing_period_start,
      @billing_period_end,
      @line_items_json,
      @financial_check_status
    )
    ON CONFLICT(invoice_id) DO UPDATE SET
      invoice_number = excluded.invoice_number,
      invoice_date = excluded.invoice_date,
      due_date = excluded.due_date,
      vendor_name = excluded.vendor_name,
      vendor_tax_id = excluded.vendor_tax_id,
      vendor_address = excluded.vendor_address,
      customer_name = excluded.customer_name,
      customer_tax_id = excluded.customer_tax_id,
      customer_address = excluded.customer_address,
      currency = excluded.currency,
      subtotal = excluded.subtotal,
      discount_total = excluded.discount_total,
      tax_total = excluded.tax_total,
      cgst = excluded.cgst,
      sgst = excluded.sgst,
      igst = excluded.igst,
      total = excluded.total,
      payment_status = excluded.payment_status,
      category = excluded.category,
      billing_period_start = excluded.billing_period_start,
      billing_period_end = excluded.billing_period_end,
      line_items_json = excluded.line_items_json,
      financial_check_status = excluded.financial_check_status,
      extracted_at = CURRENT_TIMESTAMP
  `)

  statement.run({
    invoice_id: invoiceId,
    invoice_number: invoice.invoice_number,
    invoice_date: invoice.invoice_date,
    due_date: invoice.due_date,

    vendor_name: invoice.vendor.name,
    vendor_tax_id: invoice.vendor.tax_id,
    vendor_address: invoice.vendor.address,

    customer_name: invoice.customer.name,
    customer_tax_id: invoice.customer.tax_id,
    customer_address: invoice.customer.address,

    currency: invoice.currency,

    subtotal: invoice.subtotal,
    discount_total: invoice.discount_total,
    tax_total: invoice.tax_total,

    cgst: invoice.cgst,
    sgst: invoice.sgst,
    igst: invoice.igst,

    total: invoice.total,

    payment_status: invoice.payment_status,
    category: invoice.category,

    billing_period_start: invoice.billing_period_start,
    billing_period_end: invoice.billing_period_end,

    line_items_json: JSON.stringify(invoice.line_items),
    financial_check_status: financialStatus,
  })
}
