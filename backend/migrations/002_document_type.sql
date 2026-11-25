ALTER TABLE public.invoice_extractions
ADD COLUMN IF NOT EXISTS document_type TEXT NOT NULL DEFAULT 'unknown'
CHECK (document_type IN ('invoice', 'receipt', 'unknown'));
