BEGIN;

CREATE TABLE IF NOT EXISTS public.invoice_payments (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payment_date DATE NOT NULL,
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  amount NUMERIC(18, 2) NOT NULL CHECK (amount > 0),
  method TEXT NOT NULL CHECK (method IN ('bank', 'card', 'upi', 'cash', 'other')),
  reference TEXT,
  recorded_by TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verified_by TEXT,
  verified_at TIMESTAMPTZ,
  CHECK ((verified_by IS NULL) = (verified_at IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS invoice_payments_reference_key
  ON public.invoice_payments (method, currency, lower(reference))
  WHERE reference IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.invoice_payment_allocations (
  payment_id BIGINT NOT NULL REFERENCES public.invoice_payments(id) ON DELETE RESTRICT,
  invoice_id BIGINT NOT NULL REFERENCES public.invoice_extractions(invoice_id) ON DELETE RESTRICT,
  amount NUMERIC(18, 2) NOT NULL CHECK (amount > 0),
  allocated_by TEXT NOT NULL,
  allocated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (payment_id, invoice_id)
);

CREATE INDEX IF NOT EXISTS invoice_payment_allocations_invoice_idx
  ON public.invoice_payment_allocations (invoice_id);

CREATE TABLE IF NOT EXISTS public.invoice_payment_receipts (
  receipt_id BIGINT PRIMARY KEY REFERENCES public.invoice_extractions(invoice_id) ON DELETE RESTRICT,
  payment_id BIGINT NOT NULL REFERENCES public.invoice_payments(id) ON DELETE RESTRICT,
  attached_by TEXT NOT NULL,
  attached_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMIT;
