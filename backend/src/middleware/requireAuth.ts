import type { RequestHandler } from 'express'
import 'express-session'

declare module 'express-session' {
  interface SessionData {
    user?: {
      email: string
      name: string
    }
  }
}

const allowedEmails = new Set(
  (process.env.ALLOWED_USER_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
)

export const requireAuth: RequestHandler = (req, res, next) => {
  const email = req.session.user?.email?.toLowerCase()

  if (!email) {
    res.status(401).json({
      success: false,
      error: 'Authentication required',
    })
    return
  }

  if (!allowedEmails.has(email)) {
    res.status(403).json({
      success: false,
      error: 'Access denied',
    })
    return
  }

  next()
}