
import 'dotenv/config'
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

const tokenPath = join(
  process.cwd(),
  'data',
  'google-oauth.enc'
)

type GoogleTokens = {
  access_token?: string | null
  refresh_token?: string | null
  expiry_date?: number | null
  token_type?: string | null
  scope?: string
  id_token?: string | null
}

function getEncryptionKey(): Buffer {
  const value = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY

  if (!value || !/^[a-fA-F0-9]{64}$/.test(value)) {
    throw new Error('Invalid Google token encryption key')
  }

  return Buffer.from(value, 'hex')
}

export function saveGoogleTokens(
  tokens: GoogleTokens
): void {
  const key = getEncryptionKey()
  const iv = randomBytes(12)

  const cipher = createCipheriv(
    'aes-256-gcm',
    key,
    iv
  )

  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(tokens), 'utf8'),
    cipher.final(),
  ])

  const tag = cipher.getAuthTag()

  const payload = Buffer.concat([
    iv,
    tag,
    encrypted,
  ])

  mkdirSync(join(process.cwd(), 'data'), {
    recursive: true,
  })

  writeFileSync(tokenPath, payload, {
    mode: 0o600,
  })
}

export function loadGoogleTokens(): GoogleTokens | null {
  if (!existsSync(tokenPath)) {
    return null
  }

  const key = getEncryptionKey()
  const payload = readFileSync(tokenPath)

  if (payload.length < 29) {
    throw new Error('Invalid encrypted Google token file')
  }

  const iv = payload.subarray(0, 12)
  const tag = payload.subarray(12, 28)
  const encrypted = payload.subarray(28)

  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    iv
  )

  decipher.setAuthTag(tag)

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ])

  return JSON.parse(decrypted.toString('utf8')) as GoogleTokens
}
