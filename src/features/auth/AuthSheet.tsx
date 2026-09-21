import { useAuthActions } from '@convex-dev/auth/react'
import { useEffect, useState } from 'react'

// Sign in / create an account, as a sheet over the landing page so the visitor never leaves the story.
// The authentication itself is unchanged: Convex Auth's password provider.
export default function AuthSheet({ initialMode, onClose }: { initialMode: 'signUp' | 'signIn'; onClose: () => void }) {
  const { signIn } = useAuthActions()
  const [mode, setMode] = useState<'signUp' | 'signIn'>(initialMode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  async function submit() {
    setError('')
    setSubmitting(true)
    try {
      await signIn('password', { email, password, flow: mode })
    } catch (e: unknown) {
      setError(
        mode === 'signIn'
          ? "We couldn't sign you in. Check your email and password, or create an account."
          : e instanceof Error && e.message
            ? 'We couldn’t create that account. Use a valid email and a password of at least 8 characters.'
            : 'Something went wrong. Please try again.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <div className="sheet-scrim" onClick={onClose} />
      <aside className="sheet" role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <button className="sheet__close" onClick={onClose}>
          Close
        </button>
        <span className="wordmark" style={{ marginTop: 'var(--s-4)' }}>
          Fitr
        </span>
        <h2 id="auth-title">{mode === 'signUp' ? 'Create your account.' : 'Welcome back.'}</h2>
        <p className="sheet__lede">
          {mode === 'signUp'
            ? 'Start with your measurements once. Every item you check is then fitted to you.'
            : 'Sign in to pick up where you left off.'}
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <div className="field">
            <label className="field-label-row" htmlFor="auth-email">
              <span className="field-label">Email</span>
            </label>
            <input
              id="auth-email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting}
            />
          </div>
          <div className="field">
            <label className="field-label-row" htmlFor="auth-password">
              <span className="field-label">Password</span>
              {mode === 'signUp' && <span className="field-badge">At least 8 characters</span>}
            </label>
            <input
              id="auth-password"
              type="password"
              autoComplete={mode === 'signUp' ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
            />
          </div>
          {error && (
            <p className="error-text" role="alert" style={{ marginBottom: 'var(--s-4)' }}>
              {error}
            </p>
          )}
          <button type="submit" className="btn btn--block" disabled={submitting}>
            {submitting ? 'One moment…' : mode === 'signUp' ? 'Create account' : 'Sign in'}
          </button>
        </form>
        <p className="sheet__switch">
          {mode === 'signUp' ? 'Already have an account? ' : 'New to Fitr? '}
          <button
            type="button"
            onClick={() => {
              setError('')
              setMode(mode === 'signUp' ? 'signIn' : 'signUp')
            }}
          >
            {mode === 'signUp' ? 'Sign in' : 'Create an account'}
          </button>
        </p>
      </aside>
    </>
  )
}
