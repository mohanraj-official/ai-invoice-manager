BEGIN;

ALTER TABLE invoice_extractions
  ADD COLUMN IF NOT EXISTS vendor_key TEXT,
  ADD COLUMN IF NOT EXISTS invoice_number_key TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS invoice_vendor_number_key
  ON invoice_extractions (vendor_key, invoice_number_key)
  WHERE document_type = 'invoice' AND vendor_key IS NOT NULL AND invoice_number_key IS NOT NULL;

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS drive_upload_id TEXT;

ALTER TABLE invoice_payments
  ADD COLUMN IF NOT EXISTS payer_name TEXT,
  ADD COLUMN IF NOT EXISTS reference_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS invoice_payments_normalized_reference_key
  ON invoice_payments (currency, reference_key)
  WHERE reference_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS invoice_work_files (
  document_id BIGINT PRIMARY KEY REFERENCES invoices(id) ON DELETE CASCADE,
  content BYTEA NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('review', 'ready')),
  target_invoice_id BIGINT REFERENCES invoices(id) ON DELETE CASCADE,
  proof JSONB,
  payment_id BIGINT REFERENCES invoice_payments(id) ON DELETE CASCADE,
  receipt_number INTEGER,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS invoice_work_ready_idx
  ON invoice_work_files (available_at, document_id) WHERE state = 'ready';

CREATE TABLE IF NOT EXISTS invoice_sheet_queue (
  invoice_id BIGINT PRIMARY KEY REFERENCES invoices(id) ON DELETE CASCADE,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS invoice_drive_folders (
  parent_id TEXT NOT NULL,
  name TEXT NOT NULL,
  drive_id TEXT NOT NULL,
  PRIMARY KEY (parent_id, name)
);

CREATE OR REPLACE VIEW invoice_register AS
SELECT
  i.id, i.filename, i.uploaded_at, i.drive_file_id, i.drive_file_url, i.drive_status,
  e.invoice_number, e.invoice_date, e.due_date, e.vendor_name, e.vendor_key,
  e.invoice_number_key, e.vendor_tax_id, e.customer_name, e.currency,
  e.subtotal, e.tax_total, e.total, e.category, e.financial_check_status,
  e.billing_period_start, e.billing_period_end,
  COALESCE(e.description, e.line_items_json -> 0 ->> 'description') AS description,
  COALESCE(p.paid, 0)::numeric(18, 2) AS amount_paid,
  CASE WHEN e.total IS NOT NULL THEN GREATEST(e.total - COALESCE(p.paid, 0), 0) END AS balance_due,
  CASE WHEN e.total IS NOT NULL THEN GREATEST(COALESCE(p.paid, 0) - e.total, 0) END AS overpayment,
  p.paid_date::text AS payment_date,
  CASE
    WHEN p.paid IS NULL OR p.paid = 0 OR e.total IS NULL THEN 'unpaid'
    WHEN p.paid > e.total THEN 'overpaid'
    WHEN p.paid = e.total THEN 'paid'
    ELSE 'partially_paid'
  END AS payment_status,
  EXISTS (SELECT 1 FROM invoice_sheet_queue q WHERE q.invoice_id = i.id)
    OR EXISTS (
      SELECT 1 FROM invoice_work_files w
      WHERE w.state = 'ready' AND (w.document_id = i.id OR w.target_invoice_id = i.id)
    ) AS sync_pending
FROM invoices i
JOIN invoice_extractions e ON i.id = e.invoice_id AND e.document_type = 'invoice'
LEFT JOIN LATERAL (
  SELECT SUM(a.amount) AS paid, MAX(p.payment_date) AS paid_date
  FROM invoice_payment_allocations a
  JOIN invoice_payments p ON p.id = a.payment_id
  WHERE a.invoice_id = i.id AND p.verified_at IS NOT NULL
) p ON true;

COMMIT;
