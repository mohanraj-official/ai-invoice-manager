import { z } from 'zod'
import type { ExtractedInvoice, PaymentMethod } from '../types/invoice.js'

export class InvoiceWorkflowError extends Error {
  readonly status: number

  constructor(message: string, status = 422) {
    super(message)
    this.status = status
  }
}

export function invoiceCode(id: string | number): string {
  return 'INV' + String(id).padStart(3, '0')
}

export function expenseCode(id: string): string {
  return 'EXP-' + id.padStart(3, '0')
}

export function normalizeInvoiceNumber(number: string): string {
  return number.normalize('NFKC').toLowerCase().trim().replace(/\s+/g, ' ')
}

export function normalizePaymentReference(reference: string): string {
  return reference.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function invoiceVendor(name: string, description = ''): { key: string; name: string } {
  const cleanName = name.normalize('NFKC').trim().replace(/\s+/g, ' ')
  const key = cleanName.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

  if (/^(aws|amazon web services)( |$)/.test(key)) return { key: 'aws', name: 'AWS' }
  if (/^(anthropic|claude)( |$)/.test(key)) return { key: 'claude', name: 'Claude Subscription' }
  if (/^openrouter( |$)/.test(key)) return { key: 'openrouter', name: 'OpenRouter API' }
  if (/^emudhra( |$)/.test(key)) return { key: 'emudhra', name: 'E-Mudhra DSC Tokens' }
  if (key === 'e mudhra dsc tokens') return { key: 'emudhra', name: 'E-Mudhra DSC Tokens' }
  if (key === 'google workspace' || (/^google( |$)/.test(key) && /\bworkspace\b/i.test(description))) {
    return { key: 'google workspace', name: 'Google Workspace' }
  }

  return { key, name: cleanName }
}

export function asMinorUnits(value: string): bigint {
  const [whole = '0', fraction = ''] = value.replace(/^-/, '').split('.')
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
  return value.startsWith('-') ? -cents : cents
}

function validatedAmount(value: number | null): string | null {
  if (value === null || value <= 0) return null
  const cents = Math.round(value * 100)
  if (!Number.isSafeInteger(cents) || Math.abs(value * 100 - cents) > 0.000001) return null
  return (BigInt(cents) / 100n).toString() + '.' + String(BigInt(cents) % 100n).padStart(2, '0')
}

const isoDate = z.iso.date()
const currencyCode = /^[A-Z]{3}$/

export function invoiceInput(extracted: ExtractedInvoice) {
  if (extracted.document_type !== 'invoice') {
    throw new InvoiceWorkflowError('This file does not read as an invoice. Use Upload Receipt for payment proof.')
  }

  const invoiceNumber = extracted.invoice_number?.trim() ?? ''
  const date = extracted.invoice_date
  const currency = extracted.currency?.trim().toUpperCase() ?? ''
  const total = validatedAmount(extracted.total)
  const description = [...new Set(extracted.line_items.flatMap((item) =>
    item.description?.trim() ? [item.description.trim()] : [],
  ))].slice(0, 3).join(' · ').slice(0, 320) || extracted.category
  const vendor = invoiceVendor(extracted.vendor.name ?? '', description ?? '')

  if (!vendor.key || !invoiceNumber || !isoDate.safeParse(date).success || !currencyCode.test(currency) || !total) {
    throw new InvoiceWorkflowError('Upload a clear invoice showing the vendor, invoice number, date, currency, and total.')
  }

  return {
    invoiceNumber,
    invoiceNumberKey: normalizeInvoiceNumber(invoiceNumber),
    vendor,
    currency,
    total,
    description,
  }
}

export type ReceiptProof = {
  invoiceReference: string | null
  transactionReference: string | null
  paymentDate: string
  currency: string
  amount: string
  vendorName: string | null
  vendorKey: string
  paidBy: string | null
  method: PaymentMethod
  successful: boolean
}

export function receiptInput(extracted: ExtractedInvoice, paidBy?: string): ReceiptProof {
  const details = extracted.receipt_details
  const isReceipt = extracted.document_type === 'receipt'
  if (!isReceipt && !(extracted.document_type === 'invoice' && extracted.payment_status === 'paid' && details)) {
    throw new InvoiceWorkflowError('Upload a receipt, payment screenshot, or a paid bill showing the actual payment.')
  }
  if (details?.status === 'failed' || details?.status === 'pending') {
    throw new InvoiceWorkflowError('This proof shows an unsuccessful or pending payment. Upload proof of a completed payment.')
  }

  const date = details?.payment_date ?? (isReceipt ? extracted.invoice_date : null)
  const amount = validatedAmount(details?.amount_paid ?? (isReceipt ? extracted.total : null))
  const currency = extracted.currency?.trim().toUpperCase() ?? ''
  if (!date || !isoDate.safeParse(date).success || !amount || !currencyCode.test(currency)) {
    throw new InvoiceWorkflowError('This proof needs a readable payment date, currency, and amount paid.')
  }

  const vendor = invoiceVendor(extracted.vendor.name ?? '')
  const reference = details?.transaction_reference?.trim().slice(0, 200) || null
  return {
    invoiceReference: details?.invoice_reference?.trim() || null,
    transactionReference: reference && normalizePaymentReference(reference) ? reference : null,
    paymentDate: date,
    currency,
    amount,
    vendorName: vendor.name || null,
    vendorKey: vendor.key,
    paidBy: paidBy?.trim() || details?.payer_name?.trim().slice(0, 120) || null,
    method: details?.method ?? 'other',
    successful: details?.status === 'successful' || (details?.status !== 'unknown' && extracted.payment_status === 'paid'),
  }
}

export type MatchInvoice = {
  id: string
  invoiceDate: string | null
  invoiceNumber: string | null
  vendorKey: string
  currency: string | null
  total: string | null
  balanceDue: string | null
}

export function autoMatchReceipt(proof: ReceiptProof, candidates: MatchInvoice[], selectedId?: string): string | null {
  if (!proof.successful || !proof.vendorKey || !proof.transactionReference) return null

  const referencedNumber = proof.invoiceReference && normalizeInvoiceNumber(proof.invoiceReference)
  const candidatesWithVendor = candidates.filter((invoice) =>
    invoice.vendorKey === proof.vendorKey && invoice.currency === proof.currency && invoice.invoiceDate &&
    invoice.invoiceDate <= proof.paymentDate,
  )
  const matches = referencedNumber
    ? candidatesWithVendor.filter((invoice) => invoice.invoiceNumber &&
        normalizeInvoiceNumber(invoice.invoiceNumber) === referencedNumber)
    : candidatesWithVendor.filter((invoice) => [invoice.total, invoice.balanceDue].some((amount) =>
        amount !== null && asMinorUnits(amount) === asMinorUnits(proof.amount),
      ))

  const match = matches.length === 1 ? matches[0] : undefined
  if (!match || (selectedId && match.id !== selectedId)) return null
  if (!referencedNumber && (match.balanceDue === null || asMinorUnits(match.balanceDue) !== asMinorUnits(proof.amount))) return null
  return match.id
}

const monthNames = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
const extensions: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
}

export function documentFilename(invoiceId: string, date: string, mimeType: string, receiptNumber?: number): string {
  const [year, month] = date.split('-')
  const monthName = monthNames[Number(month) - 1]
  const extension = extensions[mimeType]
  if (!year || !monthName || !extension) throw new Error('Cannot name an invoice document without a valid date and format')
  const kind = receiptNumber === undefined
    ? '1_INVOICE'
    : '2_RECEIPT' + (receiptNumber > 1 ? '_' + String(receiptNumber).padStart(2, '0') : '')
  return [year + '-' + month, monthName, invoiceCode(invoiceId), kind].join('_') + '.' + extension
}

export function expenseFilename(id: string, date: string, description: string, mimeType: string): string {
  const extension = extensions[mimeType]
  if (!extension) throw new Error('Cannot name an expense receipt without a valid format')
  const label = description.normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 80).replace(/^-|-$/g, '')
  return [date, expenseCode(id), label || 'Receipt'].join('_') + '.' + extension
}
