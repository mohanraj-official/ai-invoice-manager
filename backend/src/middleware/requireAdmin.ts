import type { RequestHandler } from 'express'

export const requireAdmin: RequestHandler = (req, res, next) => {
  const adminEmail = process.env.ADMIN_USER_EMAIL?.trim().toLowerCase()
  const userEmail = req.session.user?.email?.trim().toLowerCase()

  if (!adminEmail || !userEmail || userEmail !== adminEmail) {
    res.status(403).json({
      success: false,
      error: 'Administrator access required',
    })
    return
  }

  next()
}