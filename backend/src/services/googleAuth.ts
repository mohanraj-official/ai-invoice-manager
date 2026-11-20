
import 'dotenv/config'
import { google } from 'googleapis'

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
