
export type InvoiceLineItem = {
  description: string | null
  quantity: number | null
  unit_price: number | null
  tax_rate: number | null
  amount: number | null
  hsn_sac: string | null
}

export type InvoiceParty = {
  name: string | null
  tax_id: string | null
  address: string | null
}

export type DocumentType = 'invoice' | 'receipt' | 'unknown'

export type ExtractedInvoice = {
  document_type?: DocumentType
  invoice_number: string | null
  invoice_date: string | null
  due_date: string | null

  vendor: InvoiceParty
  customer: InvoiceParty

  currency: string | null

  subtotal: number | null
  discount_total: number | null
  tax_total: number | null

  cgst: number | null
  sgst: number | null
  igst: number | null

  total: number | null

  payment_status:
    | 'paid'
    | 'unpaid'
    | 'partially_paid'
    | 'unknown'

  category: string | null
  billing_period_start: string | null
  billing_period_end: string | null

  line_items: InvoiceLineItem[]
}
