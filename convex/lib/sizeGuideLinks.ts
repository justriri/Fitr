// Picks which links on a product page (if any) are worth following to find
// the retailer's size guide. Deliberately conservative: same retailer site
// only, the link itself must say "size guide/chart/sizing" (in its URL or as
// short anchor text), and links clearly about a different garment type are
// ranked out. The caller follows at most a couple of the best candidates.

export type GarmentKind = 'top' | 'bottom' | 'dress' | 'unknown'
export type SizeGuideCandidate = { url: string; score: number; text: string }

const KEYWORD = /size[\s_-]*(guides?|charts?)|sizing|fit[\s_-]*guide|measurement[\s_-]*guide/i
const EXCLUDED_PATH = /blog|journal|article|review|gift|shipping|return|cart|account|login|search|privacy|terms|contact|career/i
const FILE_EXTENSION = /\.(jpe?g|png|gif|webp|svg|pdf|css|js|zip|mp4)$/i

const KIND_TERMS: Record<Exclude<GarmentKind, 'unknown'>, RegExp> = {
  top: /\b(tops?|tees?|shirts?|bras?|blouses?|sweaters?|hoodies?|jackets?|coats?|tanks?)\b/i,
  bottom: /\b(bottoms?|leggings?|pants?|jeans|shorts?|skirts?|trousers?)\b/i,
  dress: /\b(dress(es)?|jumpsuits?|rompers?|unitards?)\b/i,
}

// Rough registrable domain: "shop.brand.com" and "brand.com" match, "brand.co.uk" is handled.
function siteKey(hostname: string): string {
  const parts = hostname.toLowerCase().replace(/^www\./, '').split('.')
  const secondLevel = ['co', 'com', 'org', 'net', 'ac', 'gov']
  const twoPartTld =
    parts.length > 2 && parts[parts.length - 1].length === 2 && secondLevel.includes(parts[parts.length - 2])
  return parts.slice(twoPartTld ? -3 : -2).join('.')
}

function kindsMentioned(text: string): Set<string> {
  const found = new Set<string>()
  for (const [kind, re] of Object.entries(KIND_TERMS)) if (re.test(text)) found.add(kind)
  return found
}

export function findSizeGuideLinks(input: {
  sourceUrl: string
  markdown: string
  links: string[]
  kind: GarmentKind
}): SizeGuideCandidate[] {
  let base: URL
  try {
    base = new URL(input.sourceUrl)
  } catch {
    return []
  }

  // href -> best anchor text seen for it
  const entries = new Map<string, string>()
  const add = (href: string, text: string) => {
    let url: URL
    try {
      url = new URL(href, base)
    } catch {
      return
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return
    url.hash = ''
    const key = url.toString()
    const prev = entries.get(key)
    if (prev === undefined || (prev === '' && text !== '')) entries.set(key, text.trim())
  }
  for (const href of input.links) if (typeof href === 'string') add(href, '')
  for (const m of input.markdown.matchAll(/\[([^\]]{0,120})\]\((\S+?)(?:\s+"[^"]*")?\)/g)) add(m[2], m[1])

  const candidates: SizeGuideCandidate[] = []
  for (const [href, text] of entries) {
    const url = new URL(href)
    if (siteKey(url.hostname) !== siteKey(base.hostname)) continue
    if (url.pathname === base.pathname && url.hostname === base.hostname) continue
    if (FILE_EXTENSION.test(url.pathname)) continue

    let path: string
    try {
      path = decodeURIComponent(url.pathname).toLowerCase()
    } catch {
      path = url.pathname.toLowerCase()
    }
    if (EXCLUDED_PATH.test(path)) continue

    const pathMatch = KEYWORD.test(path)
    const shortText = text.length > 0 && text.length <= 40
    const textMatch = shortText && KEYWORD.test(text)
    if (!pathMatch && !textMatch) continue

    let score = (pathMatch ? 3 : 0) + (textMatch ? 3 : 0)
    if (input.kind !== 'unknown') {
      const mentioned = kindsMentioned(`${path} ${text}`)
      if (mentioned.has(input.kind)) score += 3
      else if (mentioned.size > 0) score -= 3
    }
    if (score >= 3) candidates.push({ url: href, score, text })
  }

  return candidates.sort((a, b) => b.score - a.score).slice(0, 3)
}
