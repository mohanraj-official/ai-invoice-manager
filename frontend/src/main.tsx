import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { GoogleOAuthProvider } from '@react-oauth/google'

import App from './App'
import LoginScreen from './LoginScreen'
import './index.css'

type User = {
  email: string
  name: string
}

const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID

if (!googleClientId) {
  throw new Error('VITE_GOOGLE_CLIENT_ID is missing')
}

export function AuthGate() {
  const [user, setUser] = useState<User | null>(null)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    const controller = new AbortController()

    async function checkSession() {
      try {
        const response = await fetch('/api/auth/user/me', {
          credentials: 'include',
          signal: controller.signal,
        })

        if (!response.ok) {
          throw new Error('Session check failed')
        }

        const data = await response.json()

        if (!controller.signal.aborted) {
          setUser(data.authenticated ? data.user : null)
        }
      } catch {
        if (!controller.signal.aborted) {
          setUser(null)
        }
      } finally {
        if (!controller.signal.aborted) {
          setChecking(false)
        }
      }
    }

    void checkSession()

    return () => controller.abort()
  }, [])

  async function handleLogout() {
    try {
      const response = await fetch('/api/auth/user/logout', {
        method: 'POST',
        credentials: 'include',
      })

      if (!response.ok) {
        throw new Error('Logout failed')
      }

      setUser(null)
    } catch {
      alert('Logout failed. Please try again.')
    }
  }

  if (checking) {
    return <p style={{ padding: '24px' }}>Checking login...</p>
  }

  if (!user) {
    return <LoginScreen onLogin={setUser} />
  }

  return <App user={user} onLogout={() => void handleLogout()} />
}

ReactDOM.createRoot(
  document.getElementById('root')!
).render(
  <React.StrictMode>
    <GoogleOAuthProvider clientId={googleClientId}>
      <AuthGate />
    </GoogleOAuthProvider>
  </React.StrictMode>
)
