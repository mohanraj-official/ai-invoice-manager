import { Router, type Response } from 'express'
import { z } from 'zod'
import type { PoolClient } from 'pg'
import pool from '../db/postgres.js'

const router = Router()
const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
function toCents(value: string) {
  const [whole = '', fraction = ''] = value.replace(/^-/, '').split('.')
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
  return value.startsWith('-') ? -cents : cents
}

const money = z.string().regex(/^\d{1,16}(?:\.\d{1,2})?$/)
  .transform(toCents)
  .refine((value) => value > 0n)
const reference = z.string().trim().min(1).max(200)
const allocation = z.object({ invoiceId: id, amount: money })
const payment = z.object({
  paymentDate: z.iso.date(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  amount: money,
  method: z.enum(['bank', 'card', 'upi', 'cash', 'other']),
  reference: reference.optional(),
  receiptId: id.optional(),
  confirmed: z.boolean(),
  allocations: z.array(allocation).max(100),
})
const evidence = z.object({ reference: reference.optional(), receiptId: id.optional() })
  .refine((value) => value.reference !== undefined || value.receiptId !== undefined)

class PaymentError extends Error {}

function handleError(res: Response, error: unknown) {
  if (error instanceof PaymentError) {
    res.status(409).json({ error: error.message })
  } else if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
    res.status(409).json({ error: 'That payment reference or receipt is already recorded.' })
  } else {
    console.error('Payment reconciliation failed:', error)
    res.status(500).json({ error: 'Payment reconciliation failed.' })
  }
}

async function transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await operation(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

async function checkAllocations(
  client: PoolClient,
  currency: string,
  allocations: { invoiceId: number; amount: bigint }[],
) {
  if (allocations.length === 0) return
  const invoiceIds = allocations.map((entry) => entry.invoiceId)
  const { rows } = await client.query(`
    SELECT invoice_id, document_type, currency, total
    FROM invoice_extractions WHERE invoice_id = ANY($1::bigint[])
    ORDER BY invoice_id FOR UPDATE
  `, [invoiceIds])
  if (rows.length !== allocations.length || rows.some((row) =>
    row.document_type !== 'invoice' || row.currency !== currency || row.total === null
  )) {
    throw new PaymentError('Apply payments only to distinct invoices with a known total in the payment currency.')
  }
  const paid = await client.query(`
    SELECT a.invoice_id, SUM(a.amount) AS amount
    FROM invoice_payment_allocations a
    JOIN invoice_payments p ON p.id = a.payment_id
    WHERE p.verified_at IS NOT NULL AND a.invoice_id = ANY($1::bigint[])
    GROUP BY a.invoice_id
  `, [invoiceIds])
  const confirmed = new Map(paid.rows.map((row) => [row.invoice_id, row.amount]))
  const requested = new Map(allocations.map((row) => [row.invoiceId, row.amount]))
  for (const row of rows) {
    const remaining = toCents(row.total) - toCents(confirmed.get(row.invoice_id) ?? '0')
    if ((requested.get(Number(row.invoice_id)) ?? 0n) > remaining) {
      throw new PaymentError('An allocation exceeds the invoice’s remaining balance.')
    }
  }
}

async function attachReceipt(client: PoolClient, paymentId: string, receiptId: number, currency: string, actor: string) {
  const { rows } = await client.query(
    "SELECT 1 FROM invoice_extractions WHERE invoice_id = $1 AND document_type = 'receipt' AND currency = $2 FOR SHARE",
    [receiptId, currency],
  )
  if (!rows.length) throw new PaymentError('Choose an extracted receipt in the payment currency.')
  const result = await client.query(`
    INSERT INTO invoice_payment_receipts (receipt_id, payment_id, attached_by)
    VALUES ($1, $2, $3)
    ON CONFLICT (receipt_id) DO UPDATE SET receipt_id = EXCLUDED.receipt_id
      WHERE invoice_payment_receipts.payment_id = EXCLUDED.payment_id
  `, [receiptId, paymentId, actor])
  if (!result.rowCount) throw new PaymentError('This receipt is already attached to another payment.')
}

router.get('/payments', async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT p.id, p.payment_date::text AS "paymentDate", p.currency, p.amount, p.method,
        p.reference, p.recorded_by AS "recordedBy", p.verified_by AS "verifiedBy",
        p.verified_at AS "verifiedAt",
        (SELECT COALESCE(json_agg(json_build_object('invoiceId', a.invoice_id, 'amount', a.amount)
          ORDER BY a.invoice_id), '[]') FROM invoice_payment_allocations a WHERE a.payment_id = p.id) AS allocations,
        (SELECT COALESCE(json_agg(json_build_object('receiptId', r.receipt_id, 'url', i.drive_file_url)
          ORDER BY r.receipt_id), '[]') FROM invoice_payment_receipts r
          JOIN invoices i ON i.id = r.receipt_id WHERE r.payment_id = p.id) AS receipts
      FROM invoice_payments p ORDER BY p.id DESC LIMIT 100
    `)
    res.json({ payments: rows })
  } catch (error) {
    handleError(res, error)
  }
})

router.post('/payments', async (req, res) => {
  const input = payment.safeParse(req.body)
  const actor = req.session.user?.email
  if (!input.success || !actor) {
    res.status(400).json({ error: 'Enter a valid payment date, currency, amount and allocations.' })
    return
  }
  const value = input.data
  if (value.confirmed && !value.reference && !value.receiptId) {
    res.status(400).json({ error: 'Provide a transaction reference or attach a receipt to confirm payment.' })
    return
  }
  if (new Set(value.allocations.map((entry) => entry.invoiceId)).size !== value.allocations.length ||
      value.allocations.reduce((total, entry) => total + entry.amount, 0n) > value.amount) {
    res.status(400).json({ error: 'Use distinct invoices and keep allocations within the payment amount.' })
    return
  }
  try {
    const paymentId = await transaction(async (client) => {
      await checkAllocations(client, value.currency, value.allocations)
      const { rows } = await client.query(`
        INSERT INTO invoice_payments (payment_date, currency, amount, method, reference, recorded_by, verified_by, verified_at)
        VALUES ($1, $2, $3::numeric / 100, $4, $5, $6, CASE WHEN $7 THEN $6 ELSE NULL END,
          CASE WHEN $7 THEN NOW() ELSE NULL END)
        RETURNING id
      `, [value.paymentDate, value.currency, String(value.amount), value.method, value.reference ?? null, actor, value.confirmed])
      const newId: string = rows[0].id
      for (const entry of value.allocations) {
        await client.query(`
          INSERT INTO invoice_payment_allocations (payment_id, invoice_id, amount, allocated_by)
          VALUES ($1, $2, $3::numeric / 100, $4)
        `, [newId, entry.invoiceId, String(entry.amount), actor])
      }
      if (value.receiptId) await attachReceipt(client, newId, value.receiptId, value.currency, actor)
      return newId
    })
    res.status(201).json({ id: paymentId })
  } catch (error) {
    handleError(res, error)
  }
})

router.post('/payments/:id/allocations', async (req, res) => {
  const paymentId = id.safeParse(Number(req.params.id))
  const input = allocation.safeParse(req.body)
  const actor = req.session.user?.email
  if (!paymentId.success || !input.success || !actor) {
    res.status(400).json({ error: 'Choose an invoice and enter a valid amount.' })
    return
  }
  try {
    await transaction(async (client) => {
      const { rows } = await client.query(
        'SELECT amount, currency FROM invoice_payments WHERE id = $1 FOR UPDATE',
        [paymentId.data],
      )
      const entry = rows[0]
      if (!entry) throw new PaymentError('Payment was not found.')
      const applied = await client.query(
        'SELECT invoice_id, amount FROM invoice_payment_allocations WHERE payment_id = $1',
        [paymentId.data],
      )
      const used = applied.rows.reduce((sum, row) => sum + toCents(row.amount), 0n)
      if (used + input.data.amount > toCents(entry.amount)) {
        throw new PaymentError('The allocation exceeds the unapplied payment amount.')
      }
      await checkAllocations(client, entry.currency, [input.data])
      await client.query(`
        INSERT INTO invoice_payment_allocations (payment_id, invoice_id, amount, allocated_by)
        VALUES ($1, $2, $3::numeric / 100, $4)
        ON CONFLICT (payment_id, invoice_id) DO UPDATE
          SET amount = invoice_payment_allocations.amount + EXCLUDED.amount,
              allocated_by = EXCLUDED.allocated_by, allocated_at = NOW()
      `, [paymentId.data, input.data.invoiceId, String(input.data.amount), actor])
    })
    res.status(201).json({ success: true })
  } catch (error) {
    handleError(res, error)
  }
})

router.post('/payments/:id/evidence', async (req, res) => {
  const paymentId = id.safeParse(Number(req.params.id))
  const input = evidence.safeParse(req.body)
  const actor = req.session.user?.email
  if (!paymentId.success || !input.success || !actor) {
    res.status(400).json({ error: 'Enter a transaction reference or choose a receipt.' })
    return
  }
  try {
    await transaction(async (client) => {
      const { rows } = await client.query(
        'SELECT currency, reference, verified_at FROM invoice_payments WHERE id = $1 FOR UPDATE',
        [paymentId.data],
      )
      const existing = rows[0]
      if (!existing) throw new PaymentError('Payment was not found.')
      const value = input.data
      if (existing.reference && value.reference && existing.reference !== value.reference) {
        throw new PaymentError('This payment already has a different transaction reference.')
      }
      if (!existing.verified_at) {
        const allocations = await client.query(
          'SELECT invoice_id, amount FROM invoice_payment_allocations WHERE payment_id = $1',
          [paymentId.data],
        )
        await checkAllocations(client, existing.currency, allocations.rows.map((row) => ({
          invoiceId: Number(row.invoice_id), amount: toCents(row.amount),
        })))
      }
      if (value.receiptId) await attachReceipt(client, String(paymentId.data), value.receiptId, existing.currency, actor)
      await client.query(`
        UPDATE invoice_payments SET reference = COALESCE(reference, $2),
          verified_by = COALESCE(verified_by, $3), verified_at = COALESCE(verified_at, NOW())
        WHERE id = $1
      `, [paymentId.data, value.reference ?? null, actor])
    })
    res.json({ success: true })
  } catch (error) {
    handleError(res, error)
  }
})

export default router
