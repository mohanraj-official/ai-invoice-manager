import { Router } from 'express'
import { OAuth2Client } from 'google-auth-library'

const router = Router()

const clientId = process.env.GOOGLE_CLIENT_ID

if (!clientId) {
  throw new Error('GOOGLE_CLIENT_ID is missing')
}

const googleClient = new OAuth2Client(clientId)

const allowedEmails = new Set(
  (process.env.ALLOWED_USER_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
)

router.post('/login', async (req, res) => {
  const credential = req.body?.credential

  if (typeof credential !== 'string' || !credential) {
    res.status(400).json({ error: 'Google credential required' })
    return
  }

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: clientId,
    })

    const payload = ticket.getPayload()
    const email = payload?.email?.toLowerCase()

    if (
      !email ||
      payload?.email_verified !== true ||
      payload.hd !== 'chatdeal.in' ||
      !allowedEmails.has(email)
    ) {
      res.status(403).json({ error: 'Access denied' })
      return
    }

    req.session.regenerate((error) => {
      if (error) {
        res.status(500).json({ error: 'Session creation failed' })
        return
      }

      req.session.user = {
        email,
        name: payload.name ?? email,
      }

      req.session.save((saveError) => {
        if (saveError) {
          res.status(500).json({ error: 'Session save failed' })
          return
        }

        res.json({
          success: true,
          user: req.session.user,
        })
      })
    })
  } catch {
    res.status(401).json({ error: 'Invalid Google credential' })
  }
})

router.get('/me', (req, res) => {
  res.json({
    authenticated: Boolean(req.session.user),
    user: req.session.user ?? null,
  })
})

router.post('/logout', (req, res) => {
  req.session.destroy((error) => {
    if (error) {
      res.status(500).json({ error: 'Logout failed' })
      return
    }

    res.clearCookie('invoice.sid')
    res.json({ success: true })
  })
})

export default router