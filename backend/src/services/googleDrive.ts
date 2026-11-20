
import 'dotenv/config'

import { google } from 'googleapis'
import { Readable } from 'node:stream'

import { googleOAuthClient } from './googleAuth.js'

const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID

const allowedTypes = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
])

export type DriveUploadResult = {
  fileId: string
  fileName: string
  webViewLink: string
}

export async function uploadInvoiceToDrive(
  buffer: Buffer,
  originalName: string,
  mimeType: string
): Promise<DriveUploadResult> {
  if (!folderId) {
    throw new Error('GOOGLE_DRIVE_FOLDER_ID is missing')
  }

  if (!allowedTypes.has(mimeType)) {
    throw new Error('Unsupported invoice file type')
  }

  if (buffer.length === 0) {
    throw new Error('Cannot upload an empty file')
  }

  if (buffer.length > 10 * 1024 * 1024) {
    throw new Error('File exceeds the 10 MB limit')
  }

  const drive = google.drive({
    version: 'v3',
    auth: googleOAuthClient,
  })

  // Use a safe filename without path separators.
  const safeName = originalName
    .replace(/[\/\\]/g, '_')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .slice(0, 180) || 'invoice'

  const response = await drive.files.create({
    requestBody: {
      name: safeName,
      parents: [folderId],
    },

    media: {
      mimeType,
      body: Readable.from(buffer),
    },

    fields: 'id,name,webViewLink',
  })

  const fileId = response.data.id

  if (!fileId) {
    throw new Error('Google Drive did not return a file ID')
  }

  return {
    fileId,
    fileName: response.data.name ?? safeName,
    webViewLink:
      response.data.webViewLink ??
      `https://drive.google.com/file/d/${fileId}/view`,
  }
}
