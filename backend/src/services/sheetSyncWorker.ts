import pool from '../db/postgres.js'
import { saveInvoiceToSheet } from './googleSheets.js'
import type { ExtractedInvoice } from '../types/invoice.js'

const RETRY_INTERVAL_MS = 5 * 60 * 1000
const BATCH_SIZE = 10

let isRunning = false

type PendingInvoice = {
  id: string
  drive_file_id: string
  drive_file_url: string
  financial_check_status: string
  document_type: ExtractedInvoice['document_type']
  invoice_number: string | null
  invoice_date: string | null
  due_date: string | null
  vendor_name: string | null
  vendor_tax_id: string | null
  vendor_address: string | null
  customer_name: string | null
  customer_tax_id: string | null
  customer_address: string | null
  currency: string | null
  subtotal: number | string | null
  discount_total: number | string | null
  tax_total: number | string | null
  cgst: number | string | null
  sgst: number | string | null
  igst: number | string | null
  total: number | string | null
  payment_status: ExtractedInvoice['payment_status']
  category: string | null
  billing_period_start: string | null
  billing_period_end: string | null
}

function amount(value: number | string | null): number | null {
  return value === null ? null : Number(value)
}

function rebuildInvoice(row: PendingInvoice): ExtractedInvoice {
  return {
    document_type: row.document_type ?? 'unknown',
    invoice_number: row.invoice_number,
    invoice_date: row.invoice_date,
    due_date: row.due_date,

    vendor: {
      name: row.vendor_name,
      tax_id: row.vendor_tax_id,
      address: row.vendor_address,
    },

    customer: {
      name: row.customer_name,
      tax_id: row.customer_tax_id,
      address: row.customer_address,
    },

    currency: row.currency,
    subtotal: amount(row.subtotal),
    discount_total: amount(row.discount_total),
    tax_total: amount(row.tax_total),

    cgst: amount(row.cgst),
    sgst: amount(row.sgst),
    igst: amount(row.igst),
    total: amount(row.total),

    payment_status: row.payment_status,
    category: row.category,
    billing_period_start: row.billing_period_start,
    billing_period_end: row.billing_period_end,

    line_items: [],
  }
}

async function retrySheetSync(): Promise<void> {
  if (isRunning) return

  isRunning = true

  try {
    const result = await pool.query<PendingInvoice>(`
      SELECT
        i.id,
        i.drive_file_id,
        i.drive_file_url,
        e.financial_check_status,
        e.document_type,
        e.invoice_number,
        e.invoice_date,
        e.due_date,
        e.vendor_name,
        e.vendor_tax_id,
        e.vendor_address,
        e.customer_name,
        e.customer_tax_id,
        e.customer_address,
        e.currency,
        e.subtotal,
        e.discount_total,
        e.tax_total,
        e.cgst,
        e.sgst,
        e.igst,
        e.total,
        e.payment_status,
        e.category,
        e.billing_period_start,
        e.billing_period_end
      FROM invoices i
      JOIN invoice_extractions e
        ON e.invoice_id = i.id
      WHERE i.sheet_sync_status <> 'synced'
        AND i.drive_status = 'uploaded'
        AND i.drive_file_id IS NOT NULL
        AND i.drive_file_url IS NOT NULL
      ORDER BY i.id
      LIMIT $1
    `, [BATCH_SIZE])

    for (const row of result.rows) {
      const invoiceId = Number(row.id)

      try {
        await saveInvoiceToSheet(
          invoiceId,
          rebuildInvoice(row),
          row.financial_check_status,
          row.drive_file_id,
          row.drive_file_url
        )

        await pool.query(`
          UPDATE invoices
          SET
            sheet_sync_status = 'synced',
            sheet_synced_at = NOW()
          WHERE id = $1
        `, [invoiceId])

        console.log(`Invoice ${invoiceId} synced to Sheets`)
      } catch (error) {
        await pool.query(`
          UPDATE invoices
          SET sheet_sync_status = 'failed'
          WHERE id = $1
        `, [invoiceId]).catch(console.error)

        console.error(
          `Sheets retry failed for invoice ${invoiceId}:`,
          error
        )
      }
    }
  } catch (error) {
    console.error('Google Sheets retry worker failed:', error)
  } finally {
    isRunning = false
  }
}

export function startSheetSyncWorker(): void {
  // Give Google authorization time to restore.
  setTimeout(() => {
    void retrySheetSync()

    setInterval(() => {
      void retrySheetSync()
    }, RETRY_INTERVAL_MS)
  }, 30_000)
}