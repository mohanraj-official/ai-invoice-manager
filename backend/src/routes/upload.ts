
import db from '../db/database.js'
import { Router } from 'express'
import multer from 'multer'
import { fileTypeFromBuffer } from 'file-type'
import { createHash } from 'node:crypto'

import { extractInvoice } from '../services/invoiceExtractor.js'
import { saveInvoiceExtraction } from '../services/invoiceRepository.js'
import { checkInvoiceTotals } from '../validators/invoiceValidator.js'
import { uploadInvoiceToDrive } from '../services/googleDrive.js'

const router = Router()

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 10,
  },
})

const allowedTypes = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
])

type ExtractionStatus =
  | 'completed'
  | 'failed'
  | 'not_processed'

type DriveStatus = 'uploaded' | 'failed'

type ExistingInvoice = {
  id: number
  drive_status: string
  drive_file_url: string | null
}

router.post('/', (req, res) => {
  upload.array('files', 10)(req, res, async (error) => {
    if (error) {
      res.status(400).json({
        error: 'Upload rejected',
        details: error.message,
      })
      return
    }

    const files = req.files as Express.Multer.File[] | undefined

    if (!files?.length) {
      res.status(400).json({ error: 'No files uploaded' })
      return
    }

    try {
      const validatedFiles = []

      // Validate files before database changes
      for (const file of files) {
        const detected = await fileTypeFromBuffer(file.buffer)

        if (!detected || !allowedTypes.has(detected.mime)) {
          res.status(400).json({
            error: 'Unsupported file format',
            filename: file.originalname,
          })
          return
        }

        const hash = createHash('sha256')
          .update(file.buffer)
          .digest('hex')

        validatedFiles.push({
          file,
          mimeType: detected.mime,
          hash,
        })
      }

      const results = []

      for (const item of validatedFiles) {
        const { file, mimeType, hash } = item

        const existing = db.prepare(`
          SELECT id, drive_status, drive_file_url
          FROM invoices
          WHERE sha256 = ?
        `).get(hash) as ExistingInvoice | undefined

        let invoiceId: number
        const duplicate = Boolean(existing)

        if (existing) {
          invoiceId = existing.id

          db.prepare(`
            INSERT INTO upload_events (invoice_id, is_duplicate)
            VALUES (?, 1)
          `).run(invoiceId)
        } else {
          invoiceId = db.transaction(() => {
            const inserted = db.prepare(`
              INSERT INTO invoices (
                filename,
                mime_type,
                file_size,
                sha256,
                drive_status
              )
              VALUES (?, ?, ?, ?, 'not_uploaded')
            `).run(
              file.originalname,
              mimeType,
              file.size,
              hash
            )

            const id = Number(inserted.lastInsertRowid)

            db.prepare(`
              INSERT INTO upload_events (invoice_id, is_duplicate)
              VALUES (?, 0)
            `).run(id)

            return id
          })()
        }

        let driveStatus: DriveStatus = 'failed'
        let driveFileUrl = existing?.drive_file_url ?? null

        // Upload only if the file is not already in Drive
        if (existing?.drive_status === 'uploaded') {
          driveStatus = 'uploaded'
        } else {
          try {
            const driveFile = await uploadInvoiceToDrive(
              file.buffer,
              file.originalname,
              mimeType
            )

            db.prepare(`
              UPDATE invoices
              SET
                drive_file_id = ?,
                drive_file_url = ?,
                drive_status = 'uploaded'
              WHERE id = ?
            `).run(
              driveFile.fileId,
              driveFile.webViewLink,
              invoiceId
            )

            driveStatus = 'uploaded'
            driveFileUrl = driveFile.webViewLink

            console.log(`Invoice ${invoiceId} saved to Drive`)
          } catch (driveError) {
            console.error(
              `Google Drive upload failed for invoice ${invoiceId}:`,
              driveError instanceof Error
                ? driveError.message
                : 'Unknown error'
            )

            db.prepare(`
              UPDATE invoices
              SET drive_status = 'failed'
              WHERE id = ?
            `).run(invoiceId)
          }
        }

        const savedExtraction = db.prepare(`
          SELECT id
          FROM invoice_extractions
          WHERE invoice_id = ?
        `).get(invoiceId)

        let extractionStatus: ExtractionStatus =
          savedExtraction ? 'completed' : 'not_processed'

        // Extract only after Drive upload succeeds
        if (driveStatus === 'uploaded' && !savedExtraction) {
          try {
            const extracted = await extractInvoice(
              file.buffer,
              mimeType
            )

            const verification = checkInvoiceTotals(extracted)

            const financialStatus =
              verification.valid
                ? 'verified'
                : verification.message.startsWith('Total mismatch:')
                  ? 'mismatch'
                  : 'not_checked'

            saveInvoiceExtraction(
              invoiceId,
              extracted,
              financialStatus
            )

            extractionStatus = 'completed'

            console.log(
              `Invoice ${invoiceId} extracted successfully`
            )
          } catch (extractionError) {
            extractionStatus = 'failed'

            console.error(
              `Invoice ${invoiceId} extraction failed:`,
              extractionError instanceof Error
                ? extractionError.message
                : 'Unknown error'
            )
          }
        }

        results.push({
          filename: file.originalname,
          size: file.size,
          mimeType,
          sha256: hash,
          duplicate,
          invoiceId,
          driveStatus,
          driveFileUrl,
          extractionStatus,
        })
      }

      res.json({
        success: true,
        count: results.length,
        files: results,
      })
    } catch (processingError) {
      console.error('Upload processing failed:', processingError)

      res.status(500).json({
        success: false,
        error: 'File processing failed',
      })
    }
  })
})

export default router
