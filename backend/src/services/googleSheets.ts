import { google, type sheets_v4 } from 'googleapis'
import { googleOAuthClient } from './googleAuth.js'
import { invoiceCode } from './invoiceWorkflow.js'
import type { InvoiceRow, PaymentRow } from './invoiceRecords.js'

const legacyHeaders = [
  'Invoice ID', 'Invoice Number', 'Invoice Date', 'Due Date', 'Vendor', 'Vendor Tax ID',
  'Customer', 'Currency', 'Subtotal', 'Tax', 'Total', 'Payment Status', 'Category',
  'Financial Status', 'Drive File ID', 'Drive Link', 'Billing Start', 'Billing End', 'Document Type',
]

export const invoiceHeaders = [
  'Invoice ID', 'Vendor Invoice Number', 'Invoice Date', 'Due Date', 'Vendor', 'Vendor Tax ID',
  'Customer', 'Currency', 'Subtotal', 'Tax', 'Invoice Amount', 'Payment Status', 'Category',
  'Financial Status', 'Drive File ID', 'Invoice PDF / Photo', 'Billing Start', 'Billing End',
  'Document Type', 'Description', 'Receipt / Payment Proof', 'Payment Date', 'Amount Paid', 'Balance Due',
  'Overpayment',
]

const cellFields = 'userEnteredValue,textFormatRuns,userEnteredFormat.numberFormat'
const requestOptions = { timeout: 20_000 }
const paymentLabels = {
  unpaid: 'Unpaid',
  partially_paid: 'Partially Paid',
  paid: 'Paid',
  overpaid: 'Paid · Overpaid',
}

function textCell(value: string | null): sheets_v4.Schema$CellData {
  return value === null || value === '' ? {} : { userEnteredValue: { stringValue: value } }
}

function amountCell(value: string | null): sheets_v4.Schema$CellData {
  return value === null ? {} : {
    userEnteredValue: { numberValue: Number(value) },
    userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern: '#,##0.00' } },
  }
}

function dateCell(value: string | null): sheets_v4.Schema$CellData {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return textCell(value)
  return {
    userEnteredValue: { numberValue: Date.parse(value + 'T00:00:00Z') / 86_400_000 + 25569 },
    userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'yyyy-mm-dd' } },
  }
}

function linkedCell(links: { label: string; url: string }[]): sheets_v4.Schema$CellData {
  if (!links.length) return {}
  let text = ''
  const runs: sheets_v4.Schema$TextFormatRun[] = []
  for (const { label, url } of links) {
    if (text) {
      runs.push({ startIndex: text.length, format: {} })
      text += ' · '
    }
    runs.push({ startIndex: text.length, format: { link: { uri: url } } })
    text += label
  }
  return { userEnteredValue: { stringValue: text }, textFormatRuns: runs }
}

function invoiceCells(invoice: InvoiceRow, payments: PaymentRow[]): sheets_v4.Schema$CellData[] {
  const receipts = [...new Set(payments.flatMap((payment) => payment.receipts.map((receipt) => receipt.url)))]
  return [
    textCell(invoiceCode(invoice.id)),
    textCell(invoice.invoice_number),
    dateCell(invoice.invoice_date),
    dateCell(invoice.due_date),
    textCell(invoice.vendor_name),
    textCell(invoice.vendor_tax_id),
    textCell(invoice.customer_name),
    textCell(invoice.currency),
    amountCell(invoice.subtotal),
    amountCell(invoice.tax_total),
    amountCell(invoice.total),
    textCell(paymentLabels[invoice.payment_status]),
    textCell(invoice.category),
    textCell(invoice.financial_check_status),
    textCell(invoice.drive_file_id),
    linkedCell(invoice.drive_file_url ? [{ label: 'Open invoice', url: invoice.drive_file_url }] : []),
    dateCell(invoice.billing_period_start),
    dateCell(invoice.billing_period_end),
    textCell('invoice'),
    textCell(invoice.description),
    linkedCell(receipts.map((url, index) => ({ label: 'Receipt ' + (index + 1), url }))),
    dateCell(invoice.payment_date),
    amountCell(invoice.amount_paid),
    amountCell(invoice.balance_due),
    amountCell(invoice.overpayment),
  ]
}

export function isInvoiceSheetHeader(values: unknown[]): boolean {
  const headings = JSON.stringify(values)
  return headings === JSON.stringify(invoiceHeaders) ||
    headings === JSON.stringify(legacyHeaders) ||
    headings === JSON.stringify(legacyHeaders.slice(0, -1))
}

export async function saveInvoiceToSheet(invoice: InvoiceRow, payments: PaymentRow[]): Promise<void> {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID
  if (!spreadsheetId) throw new Error('GOOGLE_SHEET_ID is missing')
  const tab = process.env.GOOGLE_SHEET_TAB || 'INVOICES'
  const range = "'" + tab.replace(/'/g, "''") + "'!"
  const sheets = google.sheets({ version: 'v4', auth: googleOAuthClient })
  const [metadata, values] = await Promise.all([
    sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets(properties(sheetId,title,gridProperties(columnCount)))' }, requestOptions),
    sheets.spreadsheets.values.batchGet({
      spreadsheetId, ranges: [range + '1:1', range + 'A2:A'], valueRenderOption: 'UNFORMATTED_VALUE',
    }, requestOptions),
  ])
  const target = metadata.data.sheets?.find((item) => item.properties?.title === tab)?.properties
  const sheetId = target?.sheetId
  if (sheetId === null || sheetId === undefined) throw new Error('Invoice sheet tab was not found')
  const headings = values.data.valueRanges?.[0]?.values?.[0] ?? []
  const current = JSON.stringify(headings.slice(0, invoiceHeaders.length))
  const matchesNew = current === JSON.stringify(invoiceHeaders)
  if (headings.length && !matchesNew && !isInvoiceSheetHeader(headings)) {
    throw new Error('The target sheet header is different from the invoice register')
  }

  const ids = values.data.valueRanges?.[1]?.values ?? []
  const matches = ids.flatMap(([id], index) =>
    String(id) === invoice.id || String(id) === invoiceCode(invoice.id) ? [index + 1] : [],
  )
  if (matches.length > 1) throw new Error('The Google Sheet has more than one row for this invoice')
  if (!headings.length && ids.some((row) => row.length)) throw new Error('Invoice data exists without its header')

  const requests: sheets_v4.Schema$Request[] = []
  const columnCount = target?.gridProperties?.columnCount ?? 0
  if (columnCount < invoiceHeaders.length) {
    requests.push({ appendDimension: { sheetId, dimension: 'COLUMNS', length: invoiceHeaders.length - columnCount } })
  }
  if (!matchesNew) {
    requests.push({ updateCells: {
      start: { sheetId, columnIndex: 0, rowIndex: 0 },
      rows: [{ values: invoiceHeaders.map(textCell) }],
      fields: 'userEnteredValue',
    } })
  }
  const rows = [{ values: invoiceCells(invoice, payments) }]
  const rowIndex = matches[0]
  requests.push(rowIndex === undefined
    ? { appendCells: { sheetId, rows, fields: cellFields } }
    : { updateCells: { start: { sheetId, rowIndex, columnIndex: 0 }, rows, fields: cellFields } })
  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } }, requestOptions)
}
