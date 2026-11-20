
import 'dotenv/config'
import { google } from 'googleapis'

import {
  loadGoogleTokens,
  saveGoogleTokens,
} from './googleTokenStorage.js'

const clientId = process.env.GOOGLE_CLIENT_ID
const clientSecret = process.env.GOOGLE_CLIENT_SECRET
const redirectUri = process.env.GOOGLE_REDIRECT_URI

if (!clientId || !clientSecret || !redirectUri) {
  throw new Error(
    'Google OAuth credentials are missing from backend/.env'
  )
}

export const googleOAuthClient = new google.auth.OAuth2(
  clientId,
  clientSecret,
  redirectUri
)

// Restore previously saved authorization
const savedTokens = loadGoogleTokens()

if (savedTokens) {
  googleOAuthClient.setCredentials(savedTokens)
  console.log('Saved Google authorization restored')
}

// Save refreshed Google tokens
googleOAuthClient.on('tokens', (tokens) => {
  const current = googleOAuthClient.credentials

  const updated = {
    ...current,
    ...tokens,
    refresh_token:
      tokens.refresh_token ??
      current.refresh_token ??
      savedTokens?.refresh_token ??
      null,
  }

  googleOAuthClient.setCredentials(updated)
  saveGoogleTokens(updated)
})

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/spreadsheets',
]

export function getGoogleAuthUrl(state: string): string {
  return googleOAuthClient.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: GOOGLE_SCOPES,
    state,
  })
}
