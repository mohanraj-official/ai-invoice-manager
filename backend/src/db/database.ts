
import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const dataDirectory = join(process.cwd(), 'data')

mkdirSync(dataDirectory, { recursive: true })

const db: Database.Database = new Database(
  join(dataDirectory, 'invoices.db')
)

db.pragma('journal_mode = WAL')

db.exec(`
  CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    sha256 TEXT NOT NULL UNIQUE,
    uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`)


db.exec(`
  CREATE TABLE IF NOT EXISTS upload_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL,
    is_duplicate INTEGER NOT NULL DEFAULT 0,
    uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (invoice_id) REFERENCES invoices(id)
  );
`)


db.exec(`
  CREATE TABLE IF NOT EXISTS invoice_extractions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL UNIQUE,

    invoice_number TEXT,
    invoice_date TEXT,
    due_date TEXT,

    vendor_name TEXT,
    vendor_tax_id TEXT,
    vendor_address TEXT,

    customer_name TEXT,
    customer_tax_id TEXT,
    customer_address TEXT,

    currency TEXT,

    subtotal REAL,
    discount_total REAL,
    tax_total REAL,

    cgst REAL,
    sgst REAL,
    igst REAL,

    total REAL,

    payment_status TEXT NOT NULL DEFAULT 'unknown',
    category TEXT,

    billing_period_start TEXT,
    billing_period_end TEXT,

    line_items_json TEXT NOT NULL DEFAULT '[]',

    financial_check_status TEXT NOT NULL DEFAULT 'not_checked',

    extracted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (invoice_id)
      REFERENCES invoices(id)
      ON DELETE CASCADE
  );
`)



const invoiceColumns = db
  .prepare('PRAGMA table_info(invoices)')
  .all() as Array<{ name: string }>

const existingColumns = new Set(
  invoiceColumns.map((column) => column.name)
)

if (!existingColumns.has('drive_file_id')) {
  db.exec(`
    ALTER TABLE invoices
    ADD COLUMN drive_file_id TEXT
  `)
}

if (!existingColumns.has('drive_file_url')) {
  db.exec(`
    ALTER TABLE invoices
    ADD COLUMN drive_file_url TEXT
  `)
}

if (!existingColumns.has('drive_status')) {
  db.exec(`
    ALTER TABLE invoices
    ADD COLUMN drive_status TEXT NOT NULL DEFAULT 'not_uploaded'
  `)
}


export default db
