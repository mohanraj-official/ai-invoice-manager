import db from '../db/database.js'
import { Router } from 'express'
import multer from 'multer'
import { fileTypeFromBuffer } from 'file-type'
import { createHash } from 'node:crypto'

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
      const results = []

      for (const file of files) {
        const detected = await fileTypeFromBuffer(file.buffer)

        if (!detected || !allowedTypes.has(detected.mime)) {
          res.status(400).json({
            error: 'Unsupported file format',
          })
          return
        }

        const hash = createHash('sha256')
          .update(file.buffer)
          .digest('hex')


        const existing = db
          .prepare('SELECT id FROM invoices WHERE sha256 = ?')
          .get(hash) as { id: number } | undefined

        if (existing) {

          db.prepare(`
  INSERT INTO upload_events (invoice_id, is_duplicate)
  VALUES (?, ?)
`).run(existing.id, 1)

          results.push({
            filename: file.originalname,
            size: file.size,
            mimeType: detected.mime,
            sha256: hash,
            duplicate: true,
            invoiceId: existing.id,
          })
          continue
        }

        const insert = db.prepare(`
  INSERT INTO invoices (filename, mime_type, file_size, sha256)
  VALUES (?, ?, ?, ?)
`)

        const result = insert.run(
          file.originalname,
          detected.mime,
          file.size,
          hash
        )


        db.prepare(`
  INSERT INTO upload_events (invoice_id, is_duplicate)
  VALUES (?, ?)
`).run(Number(result.lastInsertRowid), 0)


        results.push({
          filename: file.originalname,
          size: file.size,
          mimeType: detected.mime,
          sha256: hash,
          duplicate: false,
          invoiceId: Number(result.lastInsertRowid),
        })

      }

      res.json({
        success: true,
        count: results.length,
        files: results,
      })
    } catch {
      res.status(500).json({
        error: 'File processing failed',
      })
    }
  })
})

export default router
