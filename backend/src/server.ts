import 'dotenv/config'

import express from 'express'
import cors from 'cors'
import session from 'express-session'
import connectSqlite3 from 'connect-sqlite3'
import { join } from 'node:path'

import postgresUploadRouter from './routes/postgresUpload.js'
import postgresInvoicesRouter from './routes/postgresInvoices.js'

import googleAuthRouter from './routes/googleAuth.js'
import userAuthRouter from './routes/userAuth.js'

import { requireAuth } from './middleware/requireAuth.js'
import { requireAdmin } from './middleware/requireAdmin.js'

// -----------------------------------------
// 1. Application configuration
// -----------------------------------------

const app = express()

const PORT = Number(process.env.PORT) || 3001
const isProduction = process.env.NODE_ENV === 'production'

const frontendOrigin =
  process.env.FRONTEND_ORIGIN || 'http://localhost:5173'

const sessionSecret = process.env.SESSION_SECRET

if (!sessionSecret || sessionSecret.length < 32) {
  throw new Error('SESSION_SECRET is missing or too short')
}

if (isProduction) {
  app.set('trust proxy', 1)
}

// -----------------------------------------
// 2. CORS configuration
// -----------------------------------------

app.use(
  cors({
    origin: frontendOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
  })
)

app.use(express.json({ limit: '1mb' }))

// -----------------------------------------
// 3. Session configuration
// -----------------------------------------

const SQLiteStore = connectSqlite3(session)

app.use(
  session({
    store: new SQLiteStore({
      db: 'sessions.sqlite',
      dir: join(process.cwd(), 'data'),
    }) as unknown as session.Store,

    name: 'invoice.sid',
    secret: sessionSecret,

    resave: false,
    saveUninitialized: false,

    cookie: {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      maxAge: 8 * 60 * 60 * 1000,
    },
  })
)

// -----------------------------------------
// 4. Health check API
// -----------------------------------------

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'AI Invoice Manager API',
  })
})

// -----------------------------------------
// 5. User authentication
// -----------------------------------------

app.use('/api/auth/user', userAuthRouter)

// Only admins can authorize Google Drive / Sheets
app.use(
  '/api/auth/google',
  requireAuth,
  requireAdmin,
  googleAuthRouter
)

// -----------------------------------------
// 6. Protected PostgreSQL upload API
// -----------------------------------------

app.use(
  '/api/upload',
  requireAuth,
  postgresUploadRouter
)

// -----------------------------------------
// 7. Protected PostgreSQL dashboard APIs
// -----------------------------------------

app.use(
  '/api',
  requireAuth,
  postgresInvoicesRouter
)

// -----------------------------------------
// 8. Start backend
// -----------------------------------------

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Backend running on port ${PORT}`)
})