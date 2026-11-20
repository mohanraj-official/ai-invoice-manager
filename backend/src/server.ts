
import express from 'express'
import cors from 'cors'
import 'dotenv/config'

const app = express()
const PORT = Number(process.env.PORT) || 3001

app.use(cors({
  origin: 'http://localhost:5173'
}))

app.use(express.json({ limit: '1mb' }))

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'AI Invoice Manager API'
  })
})

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Backend running on port ${PORT}`)
})
