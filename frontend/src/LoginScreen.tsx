import { useState } from 'react'
import { GoogleLogin } from '@react-oauth/google'

type User = {
  email: string
  name: string
}

type LoginScreenProps = {
  onLogin: (user: User) => void
}

export default function LoginScreen({ onLogin }: LoginScreenProps) {
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleLogin(credential: string) {
    setLoading(true)
    setError('')

    try {
      const response = await fetch('/api/auth/user/login', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ credential }),
      })

      const data = await response.json()

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Login failed')
      }

      onLogin(data.user)
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Login failed'
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f6f8fc',
        padding: '20px',
      }}
    >
      <section
        style={{
          background: 'white',
          borderRadius: '16px',
          padding: '48px',
          maxWidth: '420px',
          width: '100%',
          textAlign: 'center',
          boxShadow: '0 8px 30px rgba(0,0,0,0.08)',
        }}
      >
        <h1>AI Invoice Manager</h1>

        <p>Secure Business Login</p>

        <p>
          Sign in using your authorized Google Workspace account.
        </p>

        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            marginTop: '24px',
          }}
        >
          <GoogleLogin
            onSuccess={(response) => {
              if (response.credential) {
                void handleLogin(response.credential)
              } else {
                setError('Google did not return a credential')
              }
            }}
            onError={() => {
              setError('Google sign-in failed')
            }}
          />
        </div>

        {loading && <p>Signing in...</p>}

        {error && (
          <p style={{ color: '#dc2626', marginTop: '16px' }}>
            {error}
          </p>
        )}
      </section>
    </main>
  )
}