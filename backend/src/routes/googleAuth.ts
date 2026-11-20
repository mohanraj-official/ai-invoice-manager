import { Router } from 'express'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import 'express-session'

import {
  googleOAuthClient,
  getGoogleAuthUrl,
} from '../services/googleAuth.js'

import { saveGoogleTokens } from '../services/googleTokenStorage.js'

declare module 'express-session' {
  interface SessionData {
    googleAuthorization?: {
      state: string
      expiresAt: number
    }
  }
}

const router = Router()

const STATE_TTL_MS = 10 * 60 * 1000

router.get('/login', (req, res) => {
  const state = randomBytes(32).toString('hex')

  req.session.googleAuthorization = {
    state,
    expiresAt: Date.now() + STATE_TTL_MS,
  }

  req.session.save((error) => {
    if (error) {
      res.status(500).send('Unable to start Google authorization')
      return
    }

    res.redirect(getGoogleAuthUrl(state))
  })
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

  const pending = req.session.googleAuthorization

  delete req.session.googleAuthorization

  const stateMatches =
    Boolean(pending) &&
    state.length > 0 &&
    state.length === pending!.state.length &&
    timingSafeEqual(
      Buffer.from(state),
      Buffer.from(pending!.state)
    )

  if (
    !stateMatches ||
    !pending ||
    Date.now() > pending.expiresAt ||
    !code
  ) {
    res.status(400).send('Invalid or expired authorization request')
    return
  }

  try {
    const previous = googleOAuthClient.credentials

    const { tokens } = await googleOAuthClient.getToken(code)

    const updated = {
      ...previous,
      ...tokens,
      refresh_token:
        tokens.refresh_token ??
        previous.refresh_token ??
        null,
    }

    // Persist before accepting the authorization.
    await saveGoogleTokens(updated)

    googleOAuthClient.setCredentials(updated)

    await new Promise<void>((resolve, reject) => {
      req.session.save((error) => {
        if (error) reject(error)
        else resolve()
      })
    })

    console.log('Google authorization saved successfully')

    res.status(200).send(
      'Google authorization successful. You can close this tab.'
    )
  } catch (error) {
    console.error(
      'Google authorization failed:',
      error instanceof Error ? error.message : 'Unknown error'
    )

    res.status(500).send(
      'Google authorization failed. Please retry.'
    )
  }
})

export default router