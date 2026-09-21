import { useAuthActions } from '@convex-dev/auth/react'
import { useConvexAuth, useQuery } from 'convex/react'
import { useEffect, useRef, useState } from 'react'
import type { Id } from '../convex/_generated/dataModel'
import { api } from '../convex/_generated/api'
import ErrorBoundary from './components/ErrorBoundary'
import AuthSheet from './features/auth/AuthSheet'
import Discover from './features/discover/Discover'
import Landing from './features/landing/Landing'
import ProductPage from './features/products/ProductPage'
import ProfilePage from './features/profile/ProfilePage'
import { hrefFor, looksLikeConvexId, navigate, useRoute } from './lib/router'

export default function App() {
  const { isAuthenticated, isLoading } = useConvexAuth()

  if (isLoading) {
    return (
      <div className="app" aria-busy="true">
        <div className="container page">
          <span className="skel" style={{ height: 28, width: 72 }} />
        </div>
      </div>
    )
  }

  return isAuthenticated ? <SignedInApp /> : <PublicApp />
}

// Signed out: the landing page, with sign-in as a sheet over it.
function PublicApp() {
  const [auth, setAuth] = useState<'signUp' | 'signIn' | null>(null)
  return (
    <>
      <Landing onStart={setAuth} />
      {auth && <AuthSheet initialMode={auth} onClose={() => setAuth(null)} />}
    </>
  )
}

function SignedInApp() {
  const { signOut } = useAuthActions()
  const route = useRoute()
  const profile = useQuery(api.profiles.getMyProfile)
  const [scrolled, setScrolled] = useState(false)
  const sentToProfile = useRef(false)

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8)
    on()
    window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [])

  // The default screen is Discover.
  useEffect(() => {
    if (route.name === 'home') navigate({ name: 'discover' }, { replace: true })
  }, [route.name])

  // A brand-new account starts by creating its body profile (once), then lands on Discover.
  useEffect(() => {
    if (profile === null && !sentToProfile.current && (route.name === 'home' || route.name === 'discover')) {
      sentToProfile.current = true
      navigate({ name: 'profile' }, { replace: true })
    }
  }, [profile, route.name])

  const current = route.name === 'item' ? 'discover' : route.name
  const routeKey = route.name === 'item' ? `item-${route.id}` : route.name

  return (
    <div className="app">
      <header className={`topbar ${scrolled ? 'topbar--scrolled' : ''}`}>
        <div className="container topbar__in">
          <a className="wordmark" href={hrefFor({ name: 'discover' })} aria-label="Fitr — Discover">
            Fitr
          </a>
          <nav className="topnav" aria-label="Main">
            <a href={hrefFor({ name: 'discover' })} aria-current={current === 'discover' ? 'page' : undefined}>
              Discover
            </a>
            <a href={hrefFor({ name: 'profile' })} aria-current={current === 'profile' ? 'page' : undefined}>
              Profile
            </a>
          </nav>
        </div>
      </header>

      <main className="app__main">
        <div className="container page route" key={routeKey}>
          {route.name === 'profile' ? (
            <ProfilePage onSignOut={() => void signOut()} />
          ) : route.name === 'item' ? (
            <ErrorBoundary resetKey={route.id} fallback={<ItemNotFound />}>
              {looksLikeConvexId(route.id) ? <ProductPage productId={route.id as Id<'products'>} /> : <ItemNotFound />}
            </ErrorBoundary>
          ) : (
            <Discover hasProfile={profile === undefined ? undefined : profile !== null} />
          )}
        </div>
      </main>

      <footer className="footer">
        <div className="container footer__in">
          <span>© Fitr</span>
          <span>Fit results and try-ons are estimates, not guarantees.</span>
        </div>
      </footer>
    </div>
  )
}

function ItemNotFound() {
  return (
    <div className="page--narrow">
      <p className="label">Not found</p>
      <h1 style={{ fontSize: 'var(--fs-h2)', margin: 'var(--s-3) 0 var(--s-4)' }}>We couldn’t find that item.</h1>
      <p className="muted">The link may be old, or the item may belong to a different account.</p>
      <div className="btn-row">
        <a className="btn" href={hrefFor({ name: 'discover' })}>
          Back to Discover
        </a>
      </div>
    </div>
  )
}
