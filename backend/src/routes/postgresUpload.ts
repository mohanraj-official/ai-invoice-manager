import { createHash } from 'node:crypto'
import { Router } from 'express'
import type { Response } from 'express'
import { fileTypeFromBuffer } from 'file-type'
import multer from 'multer'
import { z } from 'zod'
import { extractInvoice } from '../services/invoiceExtractor.js'
import { findDuplicateDocument, storeInvoice, storeReceipt } from '../services/invoiceRecords.js'
import type { WorkFile } from '../services/invoiceRecords.js'
import { InvoiceWorkflowError } from '../services/invoiceWorkflow.js'
import { runInvoiceSync } from '../services/sheetSyncWorker.js'

const router = Router()
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 3, parts: 4 },
}).single('files')
const document = z.object({
  kind: z.enum(['invoice', 'receipt']).default('invoice'),
  invoiceId: z.string().regex(/^[1-9]\d{0,17}$/).optional(),
  paidBy: z.string().trim().max(120).optional(),
})
const allowed = new Set(['application/pdf', 'image/jpeg', 'image/png'])

export function sendWorkflowError(res: Response, error: unknown) {
  if (error instanceof InvoiceWorkflowError) {
    res.status(error.status).json({ error: error.message })
  } else {
    console.error('Invoice request failed:', error instanceof Error ? error.name : 'Unknown error')
    res.status(500).json({ error: 'The invoice app could not save this change. Try again.' })
  }
}

export const acceptDocument: import('express').RequestHandler = (req, res, next) => {
  upload(req, res, (error: unknown) => {
    if (!error) {
      next()
      return
    }
    const message = error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE'
      ? 'The document is larger than 10 MB.'
      : 'Choose one PDF, JPG, or PNG to upload.'
    res.status(400).json({ error: message })
  })
}

export async function readUploadedDocument(uploaded: Express.Multer.File): Promise<WorkFile> {
  const { originalname, buffer } = uploaded
  const detected = await fileTypeFromBuffer(buffer).catch(() => undefined)
  if (!detected || !allowed.has(detected.mime)) {
    throw new InvoiceWorkflowError('Choose a valid PDF, JPG, or PNG.', 415)
  }
  return {
    filename: originalname, mimeType: detected.mime, buffer,
    hash: createHash('sha256').update(buffer).digest('hex'),
  }
}

router.post('/', acceptDocument, async (req, res) => {
  const input = document.safeParse(req.body)
  const actor = req.session.user?.email
  const uploaded = req.file
  if (!input.success || !uploaded || !actor) {
    res.status(400).json({ error: 'Choose an invoice or a payment proof to upload.' })
    return
  }
  const { kind, invoiceId, paidBy } = input.data
  try {
    const file = await readUploadedDocument(uploaded)
    const existing = await findDuplicateDocument(file.hash, kind, invoiceId)
    if (existing) {
      void runInvoiceSync()
      res.json(existing)
      return
    }

    const extraction = await extractInvoice(file.buffer, file.mimeType).catch(() => {
      throw new InvoiceWorkflowError('The document reader could not return a complete result. Try again with a clear PDF or image.', 502)
    })
    const result = kind === 'invoice'
      ? await storeInvoice(file, extraction)
      : await storeReceipt(file, extraction, actor, invoiceId, paidBy)
    void runInvoiceSync()
    res.status(result.kind === 'duplicate' ? 200 : result.kind === 'review' ? 202 : 201).json(result)
  } catch (error) {
    sendWorkflowError(res, error)
  }
})

export default router
