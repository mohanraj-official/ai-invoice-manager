import { Router } from 'express'
import multer from 'multer'
import { fileTypeFromBuffer } from 'file-type'
import { createHash } from 'node:crypto'

import { extractInvoice } from '../services/invoiceExtractor.js'
import { checkInvoiceTotals } from '../validators/invoiceValidator.js'
import { uploadInvoiceToDrive } from '../services/googleDrive.js'
import { saveInvoiceToSheet } from '../services/googleSheets.js'
import { saveInvoiceExtractionPg } from '../services/postgresInvoiceRepository.js'

import {
  registerInvoice,
  updateInvoiceDrive,
  hasInvoiceExtraction,
  getInvoiceDrive,
} from '../services/postgresUploadRepository.js'

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

router.post('/', (req, res) => {
  upload.array('files', 10)(req, res, async (error) => {
    if (error) {
      res.status(400).json({
        success: false,
        error: 'Upload rejected',
        details: error.message,
      })
      return
    }

    const files = req.files as Express.Multer.File[] | undefined

    if (!files?.length) {
      res.status(400).json({
        success: false,
        error: 'No files uploaded',
      })
      return
    }

    try {
      // -----------------------------------------
      // 1. Validate all files
      // -----------------------------------------

      const validatedFiles = []

      for (const file of files) {
        const detected = await fileTypeFromBuffer(file.buffer)

        if (!detected || !allowedTypes.has(detected.mime)) {
          res.status(400).json({
            success: false,
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

      // -----------------------------------------
      // 2. Process each invoice
      // -----------------------------------------

      for (const item of validatedFiles) {
        const { file, mimeType, hash } = item

        const stored = await registerInvoice(
          file.originalname,
          mimeType,
          file.size,
          hash
        )

        const invoiceId = stored.id
        const duplicate = stored.duplicate

        let driveStatus = stored.driveStatus
        let driveFileUrl = stored.driveFileUrl

        // -----------------------------------------
        // 3. Upload to Google Drive
        // -----------------------------------------

        if (driveStatus !== 'uploaded') {
          try {
            const uploaded = await uploadInvoiceToDrive(
              file.buffer,
              file.originalname,
              mimeType
            )

            await updateInvoiceDrive(
              invoiceId,
              'uploaded',
              uploaded.fileId,
              uploaded.webViewLink
            )

            driveStatus = 'uploaded'
            driveFileUrl = uploaded.webViewLink

            console.log(
              `Invoice ${invoiceId} uploaded to Google Drive`
            )
          } catch (driveError) {
            driveStatus = 'failed'

            await updateInvoiceDrive(
              invoiceId,
              'failed'
            )

            console.error(
              `Google Drive upload failed for invoice ${invoiceId}:`,
              driveError
            )
          }
        }

        // -----------------------------------------
        // 4. Check existing AI extraction
        // -----------------------------------------

        const alreadyExtracted =
          await hasInvoiceExtraction(invoiceId)

        let extractionStatus: ExtractionStatus =
          alreadyExtracted ? 'completed' : 'not_processed'

        // -----------------------------------------
        // 5. Extract invoice with Gemini
        // -----------------------------------------

        if (driveStatus === 'uploaded' && !alreadyExtracted) {
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

            // -----------------------------------------
            // 6. Save extraction to PostgreSQL
            // -----------------------------------------

            await saveInvoiceExtractionPg(
              invoiceId,
              extracted,
              financialStatus
            )

            extractionStatus = 'completed'

            console.log(
              `Invoice ${invoiceId} saved to Neon PostgreSQL`
            )

            // -----------------------------------------
            // 7. Synchronize Google Sheets
            // -----------------------------------------

            try {
              const driveRecord =
                await getInvoiceDrive(invoiceId)

              if (
                driveRecord.fileId &&
                driveRecord.fileUrl
              ) {
                await saveInvoiceToSheet(
                  invoiceId,
                  extracted,
                  financialStatus,
                  driveRecord.fileId,
                  driveRecord.fileUrl
                )

                console.log(
                  `Invoice ${invoiceId} synced to Google Sheets`
                )
              }
            } catch (sheetError) {
              console.error(
                `Google Sheets sync failed for invoice ${invoiceId}:`,
                sheetError
              )
            }
          } catch (extractionError) {
            extractionStatus = 'failed'

            console.error(
              `AI extraction failed for invoice ${invoiceId}:`,
              extractionError
            )
          }
        }

        // -----------------------------------------
        // 8. Collect upload result
        // -----------------------------------------

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

      // -----------------------------------------
      // 9. Return results
      // -----------------------------------------

      res.json({
        success: true,
        count: results.length,
        files: results,
      })
    } catch (processingError) {
      console.error(
        'PostgreSQL upload processing failed:',
        processingError
      )

      res.status(500).json({
        success: false,
        error: 'File processing failed',
      })
    }
  })
})

export default router