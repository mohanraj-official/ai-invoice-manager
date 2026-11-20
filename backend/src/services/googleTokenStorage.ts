import 'dotenv/config'

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto'

import {
  existsSync,
  readFileSync,
} from 'node:fs'

import { join } from 'node:path'
import type { Credentials } from 'google-auth-library'
import pool from '../db/postgres.js'

const legacyTokenPath = join(
  process.cwd(),
  'data',
  'google-oauth.enc'
)

function getEncryptionKey(): Buffer {
  const value = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY

  if (!value || !/^[a-fA-F0-9]{64}$/.test(value)) {
    throw new Error('Invalid Google token encryption key')
  }

  return Buffer.from(value, 'hex')
}

async function ensureTokenTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS google_oauth_tokens (
      id TEXT PRIMARY KEY,
      encrypted_payload BYTEA NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
}

function encryptTokens(tokens: Credentials): Buffer {
  const iv = randomBytes(12)

  const cipher = createCipheriv(
    'aes-256-gcm',
    getEncryptionKey(),
    iv
  )

  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(tokens), 'utf8'),
    cipher.final(),
  ])

  return Buffer.concat([
    iv,
    cipher.getAuthTag(),
    encrypted,
  ])
}

function decryptTokens(payload: Buffer): Credentials {
  if (payload.length < 29) {
    throw new Error('Invalid encrypted Google token payload')
  }

  const iv = payload.subarray(0, 12)
  const tag = payload.subarray(12, 28)
  const encrypted = payload.subarray(28)

  const decipher = createDecipheriv(
    'aes-256-gcm',
    getEncryptionKey(),
    iv
  )

  decipher.setAuthTag(tag)

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ])

  return JSON.parse(decrypted.toString('utf8')) as Credentials
}

export async function saveGoogleTokens(
  tokens: Credentials
): Promise<void> {
  await ensureTokenTable()

  const encrypted = encryptTokens(tokens)

  await pool.query(
    `
      INSERT INTO google_oauth_tokens (
        id,
        encrypted_payload
      )
      VALUES ($1, $2)
      ON CONFLICT (id)
      DO UPDATE SET
        encrypted_payload = EXCLUDED.encrypted_payload,
        updated_at = NOW()
    `,
    ['workspace', encrypted]
  )
}

export async function loadGoogleTokens(): Promise<Credentials | null> {
  await ensureTokenTable()

  const result = await pool.query<{
    encrypted_payload: Buffer
  }>(
    `
      SELECT encrypted_payload
      FROM google_oauth_tokens
      WHERE id = $1
    `,
    ['workspace']
  )

  if (result.rows[0]) {
    return decryptTokens(result.rows[0].encrypted_payload)
  }

  // One-time migration from existing Codespaces storage.
  if (existsSync(legacyTokenPath)) {
    const legacyTokens = decryptTokens(
      readFileSync(legacyTokenPath)
    )

    await saveGoogleTokens(legacyTokens)

    console.log('Google authorization migrated to PostgreSQL')

    return legacyTokens
  }

  return null
}