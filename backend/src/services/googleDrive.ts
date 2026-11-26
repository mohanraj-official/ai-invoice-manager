import { google } from 'googleapis'
import { Readable } from 'node:stream'
import pool from '../db/postgres.js'
import { googleOAuthClient } from './googleAuth.js'

const folderMimeType = 'application/vnd.google-apps.folder'
const requestOptions = { timeout: 20_000 }

function driveClient() {
  return google.drive({ version: 'v3', auth: googleOAuthClient })
}

export function googleErrorCode(error: unknown): string | number {
  if (typeof error === 'object' && error !== null && 'code' in error &&
      (typeof error.code === 'number' || typeof error.code === 'string')) return error.code
  return 'unavailable'
}

function escapeQuery(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

function safeFolder(name: string) {
  return name.replace(/[/\\\x00-\x1f\x7f]/g, '_').trim().slice(0, 160) || 'Vendor'
}

export async function reserveDriveId(): Promise<string> {
  const response = await driveClient().files.generateIds({ count: 1, space: 'drive' }, requestOptions)
  const id = response.data.ids?.[0]
  if (!id) throw new Error('Google Drive did not reserve a file ID')
  return id
}

async function ensureFolder(parent: string, label: string): Promise<string> {
  const name = safeFolder(label)
  const drive = driveClient()
  const lookup = () => pool.query<{ drive_id: string }>(
    'SELECT drive_id FROM invoice_drive_folders WHERE parent_id = $1 AND name = $2', [parent, name],
  )
  let id = (await lookup()).rows[0]?.drive_id

  if (!id) {
    const folder = await drive.files.list({
      q: "'" + escapeQuery(parent) + "' in parents and trashed = false and mimeType = '" +
        folderMimeType + "' and name = '" + escapeQuery(name) + "'",
      fields: 'nextPageToken,files(id)',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      pageSize: 10,
    }, requestOptions)
    const files = folder.data.files ?? []
    if (files.length > 1 || folder.data.nextPageToken) {
      throw new Error('More than one Drive folder has the same name under this parent')
    }
    const existingId = files[0]?.id
    const reservedId = existingId ?? await reserveDriveId()
    const stored = await pool.query<{ drive_id: string }>(`
      INSERT INTO invoice_drive_folders (parent_id, name, drive_id)
      VALUES ($1, $2, $3) ON CONFLICT (parent_id, name) DO NOTHING RETURNING drive_id
    `, [parent, name, reservedId])
    id = stored.rows[0]?.drive_id ?? (await lookup()).rows[0]?.drive_id
    if (id && id === existingId) return id
  }

  if (!id) throw new Error('Google Drive folder ID could not be recorded')
  try {
    const existing = await drive.files.get({
      fileId: id, supportsAllDrives: true, fields: 'id,parents,trashed,mimeType',
    }, requestOptions)
    if (existing.data.trashed || existing.data.mimeType !== folderMimeType || !existing.data.parents?.includes(parent)) {
      throw new Error('An invoice folder was moved or sent to Trash')
    }
  } catch (error) {
    if (Number(googleErrorCode(error)) !== 404) throw error
    try {
      await drive.files.create({
        supportsAllDrives: true,
        requestBody: { id, name, mimeType: folderMimeType, parents: [parent] },
        fields: 'id',
      }, requestOptions)
    } catch (createError) {
      if (Number(googleErrorCode(createError)) !== 409) throw createError
    }
  }
  return id
}

export async function invoiceYearFolder(vendor: string, year: string): Promise<string> {
  const root = process.env.GOOGLE_DRIVE_FOLDER_ID
  if (!root) throw new Error('GOOGLE_DRIVE_FOLDER_ID is missing')
  return ensureFolder(await ensureFolder(root, vendor), year)
}

export async function saveInvoiceFile(input: {
  fileId: string
  parentId: string
  filename: string
  mimeType: string
  content: Buffer
  invoiceId: string
  documentId: string
}): Promise<string> {
  const drive = driveClient()
  let link: string | null | undefined
  try {
    const response = await drive.files.create({
      supportsAllDrives: true,
      requestBody: {
        id: input.fileId,
        name: input.filename,
        parents: [input.parentId],
        appProperties: { invoiceId: input.invoiceId, documentId: input.documentId },
      },
      media: { mimeType: input.mimeType, body: Readable.from(input.content) },
      fields: 'id,webViewLink',
    }, requestOptions)
    if (response.data.id !== input.fileId) throw new Error('Drive returned an unexpected document ID')
    link = response.data.webViewLink
  } catch (error) {
    if (Number(googleErrorCode(error)) !== 409) throw error
    const existing = await drive.files.get({
      fileId: input.fileId, supportsAllDrives: true, fields: 'id,parents,trashed,appProperties,webViewLink',
    }, requestOptions)
    if (existing.data.trashed || existing.data.appProperties?.documentId !== input.documentId ||
        !existing.data.parents?.includes(input.parentId)) {
      throw new Error('The reserved Drive document is outside its invoice folder')
    }
    link = existing.data.webViewLink
  }
  return link ?? 'https://drive.google.com/file/d/' + input.fileId + '/view'
}
