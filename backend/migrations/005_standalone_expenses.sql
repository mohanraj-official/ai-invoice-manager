CREATE TABLE IF NOT EXISTS standalone_expenses (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_id UUID NOT NULL UNIQUE,
  description TEXT NOT NULL,
  vendor TEXT,
  vendor_key TEXT,
  payment_date DATE NOT NULL,
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  amount NUMERIC(18, 2) NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL DEFAULT 'other'
    CHECK (payment_method IN ('bank', 'card', 'upi', 'cash', 'other')),
  payment_reference TEXT,
  reference_key TEXT,
  receipt_number TEXT,
  receipt_number_key TEXT,
  receipt_sha256 TEXT UNIQUE,
  receipt_mime_type TEXT,
  receipt_content BYTEA,
  drive_upload_id TEXT,
  receipt_url TEXT,
  linked_invoice_id BIGINT,
  linked_payment_id BIGINT UNIQUE,
  recorded_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sync_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK ((linked_invoice_id IS NULL) = (linked_payment_id IS NULL)),
  CHECK ((receipt_sha256 IS NULL) = (receipt_mime_type IS NULL)),
  CHECK (receipt_sha256 IS NULL OR receipt_content IS NOT NULL OR receipt_url IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS standalone_expenses_payment_reference_key
  ON standalone_expenses (currency, reference_key) WHERE reference_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS standalone_expenses_receipt_number_key
  ON standalone_expenses (vendor_key, receipt_number_key)
  WHERE vendor_key IS NOT NULL AND receipt_number_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS standalone_expenses_sync_idx
  ON standalone_expenses (sync_at, id) WHERE sync_at IS NOT NULL;
