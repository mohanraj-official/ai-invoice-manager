import 'dotenv/config'
import { google } from 'googleapis'
import pool from '../dist/db/postgres.js'
import { googleOAuthClient, initializeGoogleAuthorization } from '../dist/services/googleAuth.js'
import { isInvoiceSheetHeader } from '../dist/services/googleSheets.js'

const [mode, host, targetSheet, targetTab] = process.argv.slice(2)
const spreadsheetId = process.env.GOOGLE_SHEET_ID
const tab = process.env.GOOGLE_SHEET_TAB
const databaseHost = new URL(process.env.DATABASE_URL).hostname
const tables = [
  'invoice_work_files', 'invoice_sheet_queue', 'invoice_payment_receipts', 'invoice_payment_allocations',
  'invoice_payments', 'upload_events', 'invoice_extractions', 'invoices',
].map((table) => 'public.' + table)
const options = { timeout: 20_000 }

async function reset() {
  if (!spreadsheetId || !tab || !['--plan', '--apply'].includes(mode)) {
    throw new Error('Set GOOGLE_SHEET_ID and GOOGLE_SHEET_TAB. Use --plan or --apply <database-host> <sheet-id> <tab>.')
  }
  if (mode === '--apply' && (host !== databaseHost || targetSheet !== spreadsheetId || targetTab !== tab)) {
    throw new Error('The supplied reset targets differ from the configured database or Sheet tab.')
  }

  await initializeGoogleAuthorization()
  const sheets = google.sheets({ version: 'v4', auth: googleOAuthClient })
  const range = "'" + tab.replace(/'/g, "''") + "'!"
  const initial = await sheets.spreadsheets.values.batchGet({
    spreadsheetId, ranges: [range + '1:1', range + 'A2:Y'],
  }, options)
  if (!isInvoiceSheetHeader(initial.data.valueRanges?.[0]?.values?.[0] ?? [])) {
    throw new Error('The sheet header does not match the invoice register.')
  }
  const sheetRows = initial.data.valueRanges?.[1]?.values?.filter((row) => row.some((value) => value !== '')).length ?? 0
  const { rows } = await pool.query(tables.map((table) =>
    "SELECT '" + table + "' AS table_name, count(*)::int AS rows FROM " + table,
  ).join(' UNION ALL '))
  console.log(JSON.stringify({ databaseHost, spreadsheetId, tab, sheetRows, tables: rows }, null, 2))
  if (mode === '--plan') return

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query("SET LOCAL lock_timeout = '5s'")
    await client.query('TRUNCATE ' + tables.join(', ') + ' CONTINUE IDENTITY')
    await sheets.spreadsheets.values.clear({ spreadsheetId, range: range + 'A2:Y' }, options)
    const after = await sheets.spreadsheets.values.get({ spreadsheetId, range: range + 'A2:Y' }, options)
    if (after.data.values?.length) throw new Error('The invoice tab still contains values after clearing.')
    await client.query('COMMIT')
    console.log('Invoice records and sheet rows are clear.')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    console.error('Reset interrupted. Run --plan against the same targets before retrying.')
    throw error
  } finally {
    client.release()
  }
}

try {
  await reset()
} catch (error) {
  console.error('Invoice reset failed:', error.code ?? (error.name === 'Error' ? error.message : error.name))
  process.exitCode = 1
} finally {
  await pool.end()
}
