import { google, type sheets_v4 } from 'googleapis'
import { googleOAuthClient } from './googleAuth.js'
import { expenseCode, invoiceCode } from './invoiceWorkflow.js'
import type { InvoiceRow, PaymentRow } from './invoiceRecords.js'
import { expenseStatus } from './expenseRecords.js'
import type { ExpenseRow } from './expenseRecords.js'

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

export const expenseTab = 'EXPENSES_LIVE'
const expenseHeaders = [
  'Expense ID', 'Payment Date', 'Description', 'Vendor', 'Currency', 'Amount Paid',
  'Status', 'Receipt / Payment Proof', 'Receipt Number', 'Payment Reference', 'Linked Invoice', 'Standalone Spend',
]
const expenseRange = "'" + expenseTab + "'!"

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

export async function ensureExpenseSheet(spreadsheetId: string): Promise<number> {
  if (process.env.GOOGLE_SHEET_TAB === expenseTab) throw new Error('The invoice and expense tabs must have different names')
  const sheets = google.sheets({ version: 'v4', auth: googleOAuthClient })
  const metadata = await sheets.spreadsheets.get({
    spreadsheetId, fields: 'sheets(properties(sheetId,title,gridProperties(columnCount)))',
  }, requestOptions)
  const existing = metadata.data.sheets?.find((item) => item.properties?.title === expenseTab)?.properties
  let sheetId = existing?.sheetId
  if (sheetId === undefined || sheetId === null) {
    const created = await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: {
        title: expenseTab,
        gridProperties: { columnCount: expenseHeaders.length, frozenRowCount: 1 },
      } } }] },
    }, requestOptions)
    sheetId = created.data.replies?.[0]?.addSheet?.properties?.sheetId
  }
  if (sheetId === undefined || sheetId === null) throw new Error('Expense sheet tab was not found')
  const wholeTab = await sheets.spreadsheets.values.get({
    spreadsheetId, range: expenseRange + '1:1', valueRenderOption: 'UNFORMATTED_VALUE',
  }, requestOptions)
  const headers = wholeTab.data.values?.[0] ?? []
  if (JSON.stringify(headers.slice(0, expenseHeaders.length)) === JSON.stringify(expenseHeaders)) return sheetId
  if (headers.length) throw new Error('The existing expense tab has a different header')
  const empty = await sheets.spreadsheets.values.get({
    spreadsheetId, range: "'" + expenseTab + "'", valueRenderOption: 'FORMULA',
  }, requestOptions)
  if (empty.data.values?.some((row) => row.some((cell) => cell !== '' && cell !== null))) {
    throw new Error('The expense tab has existing data without a header')
  }
  const requests: sheets_v4.Schema$Request[] = []
  const columns = existing?.gridProperties?.columnCount ?? expenseHeaders.length
  if (columns < expenseHeaders.length) {
    requests.push({ appendDimension: { sheetId, dimension: 'COLUMNS', length: expenseHeaders.length - columns } })
  }
  requests.push({ updateCells: {
    start: { sheetId, columnIndex: 0, rowIndex: 0 },
    rows: [{ values: expenseHeaders.map(textCell) }],
    fields: 'userEnteredValue',
  } })
  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } }, requestOptions)
  return sheetId
}

export async function saveExpenseToSheet(spreadsheetId: string, sheetId: number, expense: ExpenseRow): Promise<void> {
  const sheets = google.sheets({ version: 'v4', auth: googleOAuthClient })
  const register = await sheets.spreadsheets.values.batchGet({
    spreadsheetId, ranges: [expenseRange + '1:1', expenseRange + 'A2:A'], valueRenderOption: 'UNFORMATTED_VALUE',
  }, requestOptions)
  const headers = register.data.valueRanges?.[0]?.values?.[0] ?? []
  if (JSON.stringify(headers.slice(0, expenseHeaders.length)) !== JSON.stringify(expenseHeaders)) {
    throw new Error('The expense sheet header has changed')
  }
  const code = expenseCode(expense.id)
  const matches = (register.data.valueRanges?.[1]?.values ?? []).flatMap(([id], index) => id === code ? [index + 1] : [])
  if (matches.length > 1) throw new Error('The expense sheet has more than one row for this expense')
  const rows = [{ values: [
    textCell(code),
    dateCell(expense.payment_date),
    textCell(expense.description),
    textCell(expense.vendor),
    textCell(expense.currency),
    amountCell(expense.amount),
    textCell(expenseStatus(expense)),
    linkedCell(expense.receipt_url ? [{ label: 'Open receipt', url: expense.receipt_url }] : []),
    textCell(expense.receipt_number),
    textCell(expense.payment_reference),
    textCell(expense.linked_invoice_id ? invoiceCode(expense.linked_invoice_id) : null),
    amountCell(expense.linked_invoice_id ? '0' : expense.amount),
  ] }]
  const rowIndex = matches[0]
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [rowIndex === undefined
      ? { appendCells: { sheetId, rows, fields: cellFields } }
      : { updateCells: { start: { sheetId, rowIndex, columnIndex: 0 }, rows, fields: cellFields } }] },
  }, requestOptions)
}
