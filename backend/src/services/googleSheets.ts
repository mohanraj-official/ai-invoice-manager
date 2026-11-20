
import 'dotenv/config'
import { google } from 'googleapis'
import { googleOAuthClient } from './googleAuth.js'
import type { ExtractedInvoice } from '../types/invoice.js'

const spreadsheetId = process.env.GOOGLE_SHEET_ID
const SHEET_NAME = process.env.GOOGLE_SHEET_TAB || 'INVOICES'

const HEADERS = [
  'Invoice ID',
  'Invoice Number',
  'Invoice Date',
  'Due Date',
  'Vendor',
  'Vendor Tax ID',
  'Customer',
  'Currency',
  'Subtotal',
  'Tax',
  'Total',
  'Payment Status',
  'Category',
  'Financial Status',
  'Drive File ID',
  'Drive Link',
  'Billing Start',
  'Billing End',
]

export async function saveInvoiceToSheet(
  invoiceId: number,
  invoice: ExtractedInvoice,
  financialStatus: string,
  driveFileId: string,
  driveLink: string
): Promise<void> {
  if (!spreadsheetId) {
    throw new Error('GOOGLE_SHEET_ID is missing')
  }

  const sheets = google.sheets({
    version: 'v4',
    auth: googleOAuthClient,
  })

  // Check the header row.
  const headerResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAME}!A1:R1`,
  })

  const existingHeaders = headerResponse.data.values?.[0]

  if (!existingHeaders?.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${SHEET_NAME}!A1:R1`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [HEADERS],
      },
    })
  } else if (
    JSON.stringify(existingHeaders) !== JSON.stringify(HEADERS)
  ) {
    throw new Error('Google Sheet headers do not match the expected schema')
  }

  const row = [
    invoiceId,
    invoice.invoice_number,
    invoice.invoice_date,
    invoice.due_date,
    invoice.vendor.name,
    invoice.vendor.tax_id,
    invoice.customer.name,
    invoice.currency,
    invoice.subtotal,
    invoice.tax_total,
    invoice.total,
    invoice.payment_status,
    invoice.category,
    financialStatus,
    driveFileId,
    driveLink,
    invoice.billing_period_start,
    invoice.billing_period_end,
  ]

  // Look up existing invoice IDs to avoid duplicate rows.
  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAME}!A2:A`,
  })

  const ids = existing.data.values ?? []

  const existingIndex = ids.findIndex(
    (values) => String(values[0]) === String(invoiceId)
  )

  if (existingIndex >= 0) {
    const rowNumber = existingIndex + 2

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${SHEET_NAME}!A${rowNumber}:R${rowNumber}`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [row],
      },
    })
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${SHEET_NAME}!A:R`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [row],
      },
    })
  }
}
