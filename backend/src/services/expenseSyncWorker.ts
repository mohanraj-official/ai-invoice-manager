import pool from '../db/postgres.js'
import { expenseColumns } from './expenseRecords.js'
import type { ExpenseRow } from './expenseRecords.js'
import { googleOAuthClient } from './googleAuth.js'
import { ensureExpenseSheetShortcut, expenseFolder, googleErrorCode, reserveDriveId, saveExpenseFile } from './googleDrive.js'
import { ensureExpenseSheet, saveExpenseToSheet } from './googleSheets.js'
import { queueSheet, transaction } from './invoiceRecords.js'
import { expenseCode, expenseFilename } from './invoiceWorkflow.js'

type Destination = { spreadsheetId: string; sheetId: number; folderId: string }
type ReceiptJob = {
  id: string
  description: string
  payment_date: string
  receipt_content: Buffer
  receipt_mime_type: string
  drive_upload_id: string | null
}

let running: Promise<void> | undefined
let destination: Destination | undefined
let setupRetryAt = 0

export function expenseStorageReady(): boolean {
  return Boolean(destination)
}

async function prepareDestination(spreadsheetId: string) {
  return transaction(async (client) => {
    const { rows: [lock] } = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS locked', ['expense-destination:' + spreadsheetId],
    )
    if (!lock?.locked) return undefined
    const folderId = await expenseFolder()
    const sheetId = await ensureExpenseSheet(spreadsheetId)
    try {
      await ensureExpenseSheetShortcut(folderId, spreadsheetId)
    } catch (error) {
      console.warn('Expense register shortcut setup:', googleErrorCode(error))
    }
    return { folderId, sheetId, spreadsheetId }
  })
}

async function syncNextReceipt(folderId: string): Promise<boolean> {
  const { rows: [job] } = await pool.query<ReceiptJob>(`
    UPDATE standalone_expenses SET sync_at = NOW() + INTERVAL '5 minutes'
    WHERE id = (
      SELECT id FROM standalone_expenses
      WHERE sync_at <= NOW() AND receipt_content IS NOT NULL AND receipt_url IS NULL
      ORDER BY sync_at, id LIMIT 1 FOR UPDATE SKIP LOCKED
    )
    RETURNING id, description, payment_date::text, receipt_content, receipt_mime_type, drive_upload_id
  `)
  if (!job) return false
  try {
    let fileId = job.drive_upload_id
    if (!fileId) {
      const { rows: [reserved] } = await pool.query<{ drive_upload_id: string }>(`
        UPDATE standalone_expenses SET drive_upload_id = COALESCE(drive_upload_id, $2)
        WHERE id = $1 RETURNING drive_upload_id
      `, [job.id, await reserveDriveId()])
      if (!reserved) return false
      fileId = reserved.drive_upload_id
    }
    const url = await saveExpenseFile({
      fileId,
      parentId: folderId,
      filename: expenseFilename(job.id, job.payment_date, job.description, job.receipt_mime_type),
      mimeType: job.receipt_mime_type,
      content: job.receipt_content,
      expenseId: expenseCode(job.id),
    })
    await pool.query(`
      UPDATE standalone_expenses SET receipt_url = $2, receipt_content = NULL, sync_at = NOW() WHERE id = $1
    `, [job.id, url])
  } catch (error) {
    await pool.query("UPDATE standalone_expenses SET sync_at = NOW() + INTERVAL '1 minute' WHERE id = $1", [job.id])
    console.warn('Expense receipt sync will retry:', job.id, googleErrorCode(error))
  }
  return true
}

async function syncNextExpense(target: Destination): Promise<boolean> {
  return transaction(async (client) => {
    const { rows: [lock] } = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS locked', ['expense-sheet:' + target.spreadsheetId],
    )
    if (!lock?.locked) return false
    const { rows: [expense] } = await client.query<ExpenseRow>(`
      SELECT ${expenseColumns} FROM standalone_expenses
      WHERE sync_at <= NOW() AND (receipt_sha256 IS NULL OR receipt_url IS NOT NULL)
      ORDER BY sync_at, id LIMIT 1 FOR UPDATE SKIP LOCKED
    `)
    if (!expense) return false
    try {
      await saveExpenseToSheet(target.spreadsheetId, target.sheetId, expense)
    } catch (error) {
      await client.query("UPDATE standalone_expenses SET sync_at = NOW() + INTERVAL '1 minute' WHERE id = $1", [expense.id])
      console.warn('Expense sheet sync will retry:', expense.id, googleErrorCode(error))
      return true
    }
    if (expense.linked_payment_id && expense.linked_invoice_id) {
      const { rowCount } = await client.query(`
        UPDATE invoice_payments p SET verified_by = COALESCE(verified_by, recorded_by), verified_at = COALESCE(verified_at, NOW())
        WHERE p.id = $1 AND EXISTS (
          SELECT 1 FROM invoice_payment_allocations a WHERE a.payment_id = p.id AND a.invoice_id = $2
        )
      `, [expense.linked_payment_id, expense.linked_invoice_id])
      if (rowCount) await queueSheet(expense.linked_invoice_id, client)
    }
    await client.query('UPDATE standalone_expenses SET sync_at = NULL WHERE id = $1', [expense.id])
    return true
  })
}

async function runWorker() {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID
  const connected = googleOAuthClient.credentials.refresh_token || googleOAuthClient.credentials.access_token
  if (!spreadsheetId || !connected) return
  if (!destination) {
    if (Date.now() < setupRetryAt) return
    try {
      destination = await prepareDestination(spreadsheetId)
    } catch (error) {
      setupRetryAt = Date.now() + 60_000
      console.warn('Expense storage setup will retry:', googleErrorCode(error))
    }
  }
  if (!destination) return
  for (let count = 0; count < 10 && await syncNextReceipt(destination.folderId); count++) { /* drain receipt jobs */ }
  for (let count = 0; count < 10 && await syncNextExpense(destination); count++) { /* drain sheet rows */ }
}

export function runExpenseSync(): Promise<void> {
  running ??= runWorker()
    .catch((error: unknown) => { console.error('Expense sync worker:', googleErrorCode(error)) })
    .finally(() => { running = undefined })
  return running
}

export function startExpenseSyncWorker(): void {
  void runExpenseSync()
  setInterval(() => { void runExpenseSync() }, 15_000).unref()
}
