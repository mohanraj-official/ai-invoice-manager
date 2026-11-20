
import { Router } from 'express'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import {
  googleOAuthClient,
  getGoogleAuthUrl,
} from '../services/googleAuth.js'

const router = Router()

const STATE_COOKIE = 'invoice_oauth_state'
const STATE_TTL_MS = 10 * 60 * 1000

const pendingStates = new Map<string, number>()

function readCookie(
  cookieHeader: string | undefined,
  name: string
): string | undefined {
  const cookies = (cookieHeader ?? '').split(';')

  for (const cookie of cookies) {
    const separator = cookie.indexOf('=')

    if (separator === -1) continue

    const key = cookie.slice(0, separator).trim()
    const value = cookie.slice(separator + 1).trim()

    if (key === name) {
      return value
    }
  }

  return undefined
}

router.get('/login', (_req, res) => {
  const state = randomBytes(32).toString('hex')

  pendingStates.set(state, Date.now() + STATE_TTL_MS)

  res.cookie(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: false, // Localhost development only
    maxAge: STATE_TTL_MS,
    path: '/api/auth/google',
  })

  res.redirect(getGoogleAuthUrl(state))
})

router.get('/callback', async (req, res) => {
  const state =
    typeof req.query.state === 'string'
      ? req.query.state
      : ''

  const code =
    typeof req.query.code === 'string'
      ? req.query.code
      : ''

  const cookieState = readCookie(
    req.headers.cookie,
    STATE_COOKIE
  )

  res.clearCookie(STATE_COOKIE, {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    path: '/api/auth/google',
  })

  const expiresAt = pendingStates.get(state)
  pendingStates.delete(state)

  const stateMatches =
    state.length > 0 &&
    cookieState !== undefined &&
    state.length === cookieState.length &&
    timingSafeEqual(
      Buffer.from(state),
      Buffer.from(cookieState)
    )

  if (
    !stateMatches ||
    !expiresAt ||
    Date.now() > expiresAt ||
    !code
  ) {
    res.status(400).send('Invalid or expired authorization request')
    return
  }

  try {
    const { tokens } = await googleOAuthClient.getToken(code)

    googleOAuthClient.setCredentials(tokens)

    console.log('Google OAuth authorization succeeded')

    res.status(200).send(
      'Google authorization successful. You can close this tab.'
    )
  } catch (error) {
    console.error('Google OAuth exchange failed')

    res.status(500).send(
      'Google authorization failed. Please retry.'
    )
  }
})

export default router
