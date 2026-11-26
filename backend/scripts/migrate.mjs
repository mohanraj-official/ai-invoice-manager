import 'dotenv/config'
import { readdir, readFile } from 'node:fs/promises'
import pool from '../dist/db/postgres.js'

const directory = new URL('../migrations/', import.meta.url)
const client = await pool.connect()
try {
  await client.query('BEGIN')
  await client.query("SELECT pg_advisory_xact_lock(hashtext('chatdeal-invoice-migrations'))")
  for (const name of (await readdir(directory)).filter((item) => /\.sql$/.test(item)).sort()) {
    const sql = (await readFile(new URL(name, directory), 'utf8')).trim()
      .replace(/^BEGIN\s*;/i, '').replace(/COMMIT\s*;$/i, '')
    await client.query(sql)
    console.log('Checked migration', name)
  }
  await client.query('COMMIT')
} catch (error) {
  await client.query('ROLLBACK').catch(() => {})
  console.error('Invoice migrations failed:', error.code ?? error.name)
  process.exitCode = 1
} finally {
  client.release()
  await pool.end()
}
