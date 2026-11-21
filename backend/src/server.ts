import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import 'dotenv/config'
import { initializeGoogleAuthorization } from './services/googleAuth.js'
import express from 'express'
import cors from 'cors'
import session from 'express-session'
import connectPgSimple from 'connect-pg-simple'

import pool from './db/postgres.js'

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
  throw new Error(
    'SESSION_SECRET must contain at least 32 characters'
  )
}

// Trust the first proxy in production.
// Required when deployed behind a trusted HTTPS proxy.
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

// -----------------------------------------
// 3. Request body configuration
// -----------------------------------------

app.use(
  express.json({
    limit: '1mb',
  })
)

// -----------------------------------------
// 4. PostgreSQL session configuration
// -----------------------------------------

const PostgresStore = connectPgSimple(session)

app.use(
  session({
    store: new PostgresStore({
      pool,
      tableName: 'user_sessions',
      createTableIfMissing: true,
      pruneSessionInterval: 60 * 15,
    }),

    name: 'invoice.sid',

    secret: sessionSecret,

    resave: false,
    saveUninitialized: false,
    rolling: false,

    cookie: {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      maxAge: 8 * 60 * 60 * 1000,
      path: '/',
    },
  })
)

// -----------------------------------------
// 5. Health check API
// -----------------------------------------

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'AI Invoice Manager API',
  })
})

// -----------------------------------------
// 6. User authentication
// -----------------------------------------

app.use(
  '/api/auth/user',
  userAuthRouter
)

// -----------------------------------------
// 7. Admin-only Google authorization
// -----------------------------------------

app.use(
  '/api/auth/google',
  requireAuth,
  requireAdmin,
  googleAuthRouter
)

// -----------------------------------------
// 8. Protected invoice upload API
// -----------------------------------------

app.use(
  '/api/upload',
  requireAuth,
  postgresUploadRouter
)

// -----------------------------------------
// 9. Protected invoice dashboard APIs
// -----------------------------------------

app.use(
  '/api',
  requireAuth,
  postgresInvoicesRouter
)


// -----------------------------------------
// Serve React frontend in production
// -----------------------------------------

if (isProduction) {
  const currentDirectory = dirname(fileURLToPath(import.meta.url))

  const frontendDist = join(
    currentDirectory,
    '../../frontend/dist'
  )

  app.use(express.static(frontendDist))

  app.use((req, res, next) => {
    if (req.path === '/api' || req.path.startsWith('/api/')) {
      res.status(404).json({
        success: false,
        error: 'API endpoint not found',
      })
      return
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next()
      return
    }

    res.sendFile(join(frontendDist, 'index.html'))
  })
}



// -----------------------------------------
// 10. API error handler
// -----------------------------------------

app.use(
  (
    error: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error('API error:', error)

    if (res.headersSent) {
      _next(error)
      return
    }

    res.status(500).json({
      success: false,
      error: 'Internal server error',
    })
  }
)

// -----------------------------------------
// 11. Start backend server
// -----------------------------------------

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Backend running on port ${PORT}`)
})



async function startServer() {
  try {
    await initializeGoogleAuthorization()

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Backend running on port ${PORT}`)
    })
  } catch (error) {
    console.error(
      'Backend startup failed:',
      error instanceof Error ? error.message : 'Unknown error'
    )

    process.exitCode = 1
  }
}

void startServer()