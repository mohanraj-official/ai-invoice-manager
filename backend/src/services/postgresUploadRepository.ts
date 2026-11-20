import pool from '../db/postgres.js'

export type StoredInvoice = {
  id: number
  duplicate: boolean
  driveStatus: string
  driveFileUrl: string | null
}

export async function registerInvoice(
  filename: string,
  mimeType: string,
  fileSize: number,
  sha256: string,
): Promise<StoredInvoice> {
  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    const inserted = await client.query<{ id: string }>(
      `
        INSERT INTO invoices (
          filename,
          mime_type,
          file_size,
          sha256
        )
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (sha256) DO NOTHING
        RETURNING id
      `,
      [filename, mimeType, fileSize, sha256]
    )

    const duplicate = inserted.rowCount === 0

    const result = await client.query<{
      id: string
      drive_status: string
      drive_file_url: string | null
    }>(
      `
        SELECT id, drive_status, drive_file_url
        FROM invoices
        WHERE sha256 = $1
      `,
      [sha256]
    )

    const invoice = result.rows[0]

    if (!invoice) {
      throw new Error('Failed to retrieve invoice record')
    }

    await client.query(
      `
        INSERT INTO upload_events (
          invoice_id,
          is_duplicate
        )
        VALUES ($1, $2)
      `,
      [invoice.id, duplicate]
    )

    await client.query('COMMIT')

    const id = Number(invoice.id)

    if (!Number.isSafeInteger(id)) {
      throw new Error('Invoice ID exceeds JavaScript safe integer range')
    }

    return {
      id,
      duplicate,
      driveStatus: invoice.drive_status,
      driveFileUrl: invoice.drive_file_url,
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

export async function updateInvoiceDrive(
  invoiceId: number,
  status: 'uploaded' | 'failed',
  fileId?: string,
  fileUrl?: string,
): Promise<void> {
  await pool.query(
    `
      UPDATE invoices
      SET
        drive_status = $1,
        drive_file_id = COALESCE($2, drive_file_id),
        drive_file_url = COALESCE($3, drive_file_url)
      WHERE id = $4
    `,
    [status, fileId ?? null, fileUrl ?? null, invoiceId]
  )
}

export async function hasInvoiceExtraction(
  invoiceId: number,
): Promise<boolean> {
  const result = await pool.query(
    `
      SELECT 1
      FROM invoice_extractions
      WHERE invoice_id = $1
      LIMIT 1
    `,
    [invoiceId]
  )

  return result.rowCount !== null && result.rowCount > 0
}

export async function getInvoiceDrive(
  invoiceId: number,
): Promise<{
  fileId: string | null
  fileUrl: string | null
}> {
  const result = await pool.query<{
    drive_file_id: string | null
    drive_file_url: string | null
  }>(
    `
      SELECT drive_file_id, drive_file_url
      FROM invoices
      WHERE id = $1
    `,
    [invoiceId]
  )

  const invoice = result.rows[0]

  if (!invoice) {
    throw new Error('Invoice not found')
  }

  return {
    fileId: invoice.drive_file_id,
    fileUrl: invoice.drive_file_url,
  }
}