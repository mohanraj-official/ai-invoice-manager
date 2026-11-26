import pool from '../db/postgres.js'
import { googleOAuthClient } from './googleAuth.js'
import { googleErrorCode, invoiceYearFolder, reserveDriveId, saveInvoiceFile } from './googleDrive.js'
import { getInvoice, getPayments, queueSheet, transaction } from './invoiceRecords.js'
import { documentFilename, invoiceCode } from './invoiceWorkflow.js'
import { saveInvoiceToSheet } from './googleSheets.js'

const batchSize = 10
let running: Promise<void> | undefined

type DriveWork = {
  document_id: string
  target_invoice_id: string | null
  payment_id: string | null
  receipt_number: number | null
  content: Buffer
}

async function nextDocument(): Promise<DriveWork | undefined> {
  const { rows } = await pool.query<DriveWork>(`
    UPDATE invoice_work_files SET available_at = NOW() + INTERVAL '5 minutes'
    WHERE document_id = (
      SELECT document_id FROM invoice_work_files WHERE state = 'ready' AND available_at <= NOW()
      ORDER BY available_at, document_id LIMIT 1 FOR UPDATE SKIP LOCKED
    )
    RETURNING document_id, target_invoice_id, payment_id, receipt_number, content
  `)
  return rows[0]
}

async function writeDocument(work: DriveWork) {
  const invoiceId = work.target_invoice_id ?? work.document_id
  const invoice = await getInvoice(invoiceId)
  if (!invoice?.vendor_name || !invoice.invoice_date) throw new Error('Invoice folder details are missing')
  const { rows: [document] } = await pool.query<{ mime_type: string; drive_upload_id: string | null }>(
    'SELECT mime_type, drive_upload_id FROM invoices WHERE id = $1', [work.document_id],
  )
  if (!document) return
  let fileId = document.drive_upload_id
  if (!fileId) {
    const { rows: [reserved] } = await pool.query<{ drive_upload_id: string }>(`
      UPDATE invoices SET drive_upload_id = COALESCE(drive_upload_id, $2)
      WHERE id = $1 RETURNING drive_upload_id
    `, [work.document_id, await reserveDriveId()])
    if (!reserved) return
    fileId = reserved.drive_upload_id
  }

  const parentId = await invoiceYearFolder(invoice.vendor_name, invoice.invoice_date.slice(0, 4))
  const filename = documentFilename(
    invoiceId, invoice.invoice_date, document.mime_type, work.receipt_number ?? undefined,
  )
  const url = await saveInvoiceFile({
    fileId, parentId, filename, mimeType: document.mime_type,
    content: work.content, invoiceId: invoiceCode(invoiceId), documentId: work.document_id,
  })

  await transaction(async (client) => {
    const { rowCount } = await client.query(
      'DELETE FROM invoice_work_files WHERE document_id = $1 AND state = $2', [work.document_id, 'ready'],
    )
    if (!rowCount) return
    await client.query(`
      UPDATE invoices SET drive_file_url = $2, drive_file_id = $3, drive_status = 'uploaded'
      WHERE id = $1
    `, [work.document_id, url, fileId])
    if (work.payment_id) {
      await client.query(`
        UPDATE invoice_payments SET verified_by = recorded_by, verified_at = NOW()
        WHERE id = $1 AND verified_at IS NULL
      `, [work.payment_id])
    }
    await queueSheet(invoiceId, client)
  })
}

async function syncNextSheetRow(): Promise<boolean> {
  return transaction(async (client) => {
    const scope = [process.env.GOOGLE_SHEET_ID ?? '', process.env.GOOGLE_SHEET_TAB ?? 'INVOICES'].join(':')
    const { rows: [lock] } = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked', ['invoice-sheet:' + scope],
    )
    if (!lock?.locked) return false

    const { rows: [job] } = await client.query<{ invoice_id: string }>(`
      SELECT q.invoice_id FROM invoice_sheet_queue q JOIN invoices i ON i.id = q.invoice_id
      WHERE q.available_at <= NOW() AND i.drive_status = 'uploaded'
      ORDER BY q.available_at, q.invoice_id LIMIT 1 FOR UPDATE OF q SKIP LOCKED
    `)
    if (!job) return false

    const invoice = await getInvoice(job.invoice_id, client)
    if (invoice) {
      try {
        await saveInvoiceToSheet(invoice, await getPayments(invoice.id, client))
      } catch (error) {
        await client.query(`
          UPDATE invoice_sheet_queue SET available_at = NOW() + INTERVAL '1 minute' WHERE invoice_id = $1
        `, [job.invoice_id])
        console.warn('Invoice sheet sync will retry:', job.invoice_id, googleErrorCode(error))
        return true
      }
    }
    await client.query('DELETE FROM invoice_sheet_queue WHERE invoice_id = $1', [job.invoice_id])
    return true
  })
}

async function runWorker() {
  if (!googleOAuthClient.credentials.refresh_token && !googleOAuthClient.credentials.access_token) return
  for (let count = 0; count < batchSize; count++) {
    const work = await nextDocument()
    if (!work) break
    try {
      await writeDocument(work)
    } catch (error) {
      await pool.query(`
        UPDATE invoice_work_files SET available_at = NOW() + INTERVAL '1 minute' WHERE document_id = $1
      `, [work.document_id])
      console.warn('Invoice file sync will retry:', work.document_id, googleErrorCode(error))
    }
  }
  for (let count = 0; count < batchSize; count++) {
    if (!await syncNextSheetRow()) break
  }
}

export function runInvoiceSync(): Promise<void> {
  running ??= runWorker()
    .catch((error: unknown) => { console.error('Invoice sync worker:', googleErrorCode(error)) })
    .finally(() => { running = undefined })
  return running
}

export function startSheetSyncWorker(): void {
  void runInvoiceSync()
  setInterval(() => { void runInvoiceSync() }, 15_000).unref()
}
