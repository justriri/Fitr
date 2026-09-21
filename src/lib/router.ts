import { useEffect, useState } from 'react'

// A tiny hash router: every screen has a URL, so reload, back/forward and shared links work,
// without adding a dependency.
//   #/discover        paste a link, recent items
//   #/item/<id>       one product: the item, your fit, see it on me, after you buy
//   #/profile         body profile

export type Route = { name: 'discover' } | { name: 'profile' } | { name: 'item'; id: string } | { name: 'home' }

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, '').split('?')[0]
  const [first, second] = path.split('/')
  if (first === 'discover') return { name: 'discover' }
  if (first === 'profile') return { name: 'profile' }
  if (first === 'item' && second) return { name: 'item', id: decodeURIComponent(second) }
  return { name: 'home' }
}

export function hrefFor(route: Route): string {
  switch (route.name) {
    case 'discover':
      return '#/discover'
    case 'profile':
      return '#/profile'
    case 'item':
      return `#/item/${encodeURIComponent(route.id)}`
    default:
      return '#/'
  }
}

export function navigate(route: Route, opts?: { replace?: boolean }) {
  const next = hrefFor(route)
  if (opts?.replace) {
    window.history.replaceState(null, '', next)
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  } else {
    window.location.hash = next
  }
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash))
  useEffect(() => {
    const onChange = () => {
      setRoute(parseHash(window.location.hash))
      window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
    }
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}

// Convex ids are 32 lowercase letters/digits; anything else is "not found" before it ever reaches the server.
export function looksLikeConvexId(value: string): boolean {
  return /^[a-z0-9]{28,36}$/.test(value)
}
