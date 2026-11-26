
import { z } from 'zod'

const nullableString = z.string().nullable()
const nullableNumber = z.number().finite().nullable()

const partySchema = z.object({
  name: nullableString,
  tax_id: nullableString,
  address: nullableString,
}).strict()

const lineItemSchema = z.object({
  description: nullableString,
  quantity: nullableNumber,
  unit_price: nullableNumber,
  tax_rate: nullableNumber,
  amount: nullableNumber,
  hsn_sac: nullableString,
}).strict()

export const extractedInvoiceSchema = z.object({
  document_type: z.enum(['invoice', 'receipt', 'unknown']).default('unknown'),
  receipt_details: z.object({
    invoice_reference: nullableString,
    transaction_reference: nullableString,
    payment_date: nullableString,
    amount_paid: nullableNumber,
    payer_name: nullableString,
    method: z.enum(['bank', 'card', 'upi', 'cash', 'other']),
    status: z.enum(['successful', 'pending', 'failed', 'unknown']),
  }).strict().nullable().default(null),
  invoice_number: nullableString,
  invoice_date: nullableString,
  due_date: nullableString,

  vendor: partySchema,
  customer: partySchema,

  currency: nullableString,

  subtotal: nullableNumber,
  discount_total: nullableNumber,
  tax_total: nullableNumber,

  cgst: nullableNumber,
  sgst: nullableNumber,
  igst: nullableNumber,

  total: nullableNumber,

  payment_status: z.enum([
    'paid',
    'unpaid',
    'partially_paid',
    'unknown',
  ]),

  category: nullableString,

  billing_period_start: nullableString,
  billing_period_end: nullableString,

  line_items: z.array(lineItemSchema),
}).strict()

export function validateExtractedInvoice(data: unknown) {
  return extractedInvoiceSchema.parse(data)
}


export function checkInvoiceTotals(
  data: unknown
): {
  valid: boolean
  message: string
} {
  const invoice = extractedInvoiceSchema.parse(data)

  const {
    subtotal,
    discount_total,
    tax_total,
    total,
  } = invoice

  if (
    subtotal === null ||
    tax_total === null ||
    total === null
  ) {
    return {
      valid: false,
      message: 'Insufficient amounts to verify invoice total',
    }
  }

  const discount = discount_total ?? 0

  const expectedTotal = Math.round(
    (subtotal - discount + tax_total) * 100
  ) / 100

  const difference = Math.abs(expectedTotal - total)

  if (difference > 0.01) {
    return {
      valid: false,
      message:
        `Total mismatch: expected ${expectedTotal}, ` +
        `extracted ${total}`,
    }
  }

  return {
    valid: true,
    message: 'Invoice total verified successfully',
  }
}

