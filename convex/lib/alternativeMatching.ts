// Decides whether a product found on another retailer is the SAME item as the
// one the shopper is viewing, and whether their size is listed there.
//
// "Same item" is decided by rules over facts read from the pages (brand,
// manufacturer style number, name, colour, gender) — never by a model
// declaring a match. A look-alike from another brand is not a match at all;
// the same brand with a different colour or a differently-named product is
// only ever a "possible" alternative and is labelled that way.

import { parseSize } from './sizeParsing'

export type ProductIdentity = {
  productName?: string
  brand?: string
  styleNumber?: string
  color?: string
}

export type MatchType = 'exact' | 'possible'
export type MatchAssessment = { matchType: MatchType | 'none'; notes: string[] }

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'for', 'with', 'in', 'of', 'to', 'by', 'from', 'new', 'sale', 'buy', 'shop', 'online',
])
const GENDER_WORDS: Record<string, 'men' | 'women' | 'kids'> = {
  men: 'men', mens: 'men', man: 'men', male: 'men',
  women: 'women', womens: 'women', woman: 'women', ladies: 'women', female: 'women',
  kids: 'kids', kid: 'kids', boys: 'kids', boy: 'kids', girls: 'kids', girl: 'kids', youth: 'kids', junior: 'kids', toddler: 'kids',
}
const COLOR_SYNONYMS: Record<string, string> = { gray: 'grey', charcoal: 'grey', navy: 'blue', ivory: 'white', cream: 'white', offwhite: 'white' }
// Words that describe a shade rather than a distinct colour.
const SHADE_WORDS = new Set(['dark', 'light', 'heather', 'heathered', 'melange', 'marl', 'washed', 'deep', 'pale', 'bright'])

function fold(text: string): string {
  return text.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/['’`]/g, '')
}

function tokens(text: string | undefined): string[] {
  if (!text) return []
  return fold(text)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0)
    .map((t) => (t.length > 3 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t))
}

const alnum = (text: string | undefined): string => (text ? fold(text).replace(/[^a-z0-9]/g, '') : '')

// Does a value the model read from a page actually appear in that page's text?
export function appearsOnPage(value: string | undefined, pageMarkdown: string): boolean {
  if (!value) return false
  const page = alnum(pageMarkdown)
  const needle = alnum(value)
  return needle.length >= 3 && page.includes(needle)
}

function colorTokens(color: string | undefined): string[] {
  return tokens(color)
    .filter((t) => !SHADE_WORDS.has(t))
    .map((t) => COLOR_SYNONYMS[t] ?? t)
}

type Signal = 'match' | 'mismatch' | 'unknown'

function colorSignal(a: string | undefined, b: string | undefined): Signal {
  const x = colorTokens(a)
  const y = colorTokens(b)
  if (x.length === 0 || y.length === 0) return 'unknown'
  return x.some((t) => y.includes(t)) ? 'match' : 'mismatch'
}

function genderOf(text: string | undefined): 'men' | 'women' | 'kids' | null {
  for (const t of tokens(text)) if (GENDER_WORDS[t]) return GENDER_WORDS[t]
  return null
}

function styleSignal(a: string | undefined, b: string | undefined): 'match' | 'mismatch' | 'none' {
  const x = alnum(a)
  const y = alnum(b)
  if (x.length < 4 || y.length < 4) return 'none'
  if (x === y) return 'match'
  // A retailer may append a colour or size suffix to the manufacturer's style number.
  if (x.length >= 6 && y.length >= 6 && (x.startsWith(y) || y.startsWith(x))) return 'match'
  return 'mismatch'
}

function brandSignal(sourceBrand: string | undefined, candidate: ProductIdentity): Signal {
  const sb = tokens(sourceBrand)
  if (sb.length === 0) return 'unknown'
  const cb = tokens(candidate.brand)
  if (cb.length > 0) {
    const same = sb.every((t) => cb.includes(t)) || cb.every((t) => sb.includes(t))
    return same ? 'match' : 'mismatch'
  }
  // No brand field: accept it only if the product name itself carries the brand.
  const nameTokens = tokens(candidate.productName)
  return sb.every((t) => nameTokens.includes(t)) ? 'match' : 'unknown'
}

// Tokens that identify the product itself (not the brand, colour, gender or filler).
function coreTokens(name: string | undefined, brand: string | undefined, color: string | undefined): Set<string> {
  const drop = new Set([...tokens(brand), ...colorTokens(color), ...tokens(color)])
  return new Set(
    tokens(name).filter((t) => !STOPWORDS.has(t) && !drop.has(t) && !GENDER_WORDS[t] && !SHADE_WORDS.has(t) && !(t in COLOR_SYNONYMS)),
  )
}

function nameSimilarity(source: ProductIdentity, candidate: ProductIdentity) {
  const a = coreTokens(source.productName, source.brand, source.color)
  const b = coreTokens(candidate.productName, source.brand, candidate.color ?? source.color)
  if (a.size === 0 || b.size === 0) return { containment: 0, jaccard: 0 }
  let shared = 0
  for (const t of a) if (b.has(t)) shared++
  return { containment: shared / a.size, jaccard: shared / (a.size + b.size - shared) }
}

export function assessMatch(source: ProductIdentity, candidate: ProductIdentity): MatchAssessment {
  const notes: string[] = []

  const sg = genderOf(source.productName)
  const cg = genderOf(candidate.productName)
  if (sg && cg && sg !== cg) return { matchType: 'none', notes: ['Different department'] }

  const brand = brandSignal(source.brand, candidate)
  if (brand === 'mismatch') return { matchType: 'none', notes: ['Different brand'] }

  const style = styleSignal(source.styleNumber, candidate.styleNumber)
  if (style === 'mismatch') {
    // Two different manufacturer style numbers are two different products, however alike they look.
    return { matchType: 'none', notes: ['Different style number'] }
  }
  const color = colorSignal(source.color, candidate.color)
  const name = nameSimilarity(source, candidate)
  const sameName = name.containment >= 0.8 && name.jaccard >= 0.6

  const brandKnown = brand === 'match'
  if (style === 'match' && color !== 'mismatch') {
    notes.push(`Same style number (${candidate.styleNumber})`)
    if (brandKnown) notes.push('Same brand')
    if (color === 'match') notes.push('Same colour')
    return { matchType: 'exact', notes }
  }
  if (brandKnown && sameName && color === 'match') {
    return { matchType: 'exact', notes: ['Same brand', 'Same product name', 'Same colour'] }
  }
  if (brandKnown && sameName && color === 'unknown' && !source.color && !candidate.color) {
    return { matchType: 'exact', notes: ['Same brand', 'Same product name'] }
  }

  // Not confirmed identical. Only show it if it is plausibly the same product line.
  if (brand === 'unknown' && !sameName) return { matchType: 'none', notes: [] }
  if (name.containment < 0.5) return { matchType: 'none', notes: [] }

  if (brandKnown) notes.push('Same brand')
  if (color === 'mismatch') notes.push(`Different colour${candidate.color ? ` (${candidate.color})` : ''}`)
  else if (color === 'unknown') notes.push('Colour not confirmed')
  if (!sameName) notes.push('Product name differs')
  if (style === 'none') notes.push('Style number not confirmed')
  return { matchType: 'possible', notes }
}

// Is the recommended size among the sizes the page lists? (Never "in stock".)
export function sizeListedStatus(recommended: string, listed: string[] | undefined): 'listed' | 'not_listed' | 'unknown' {
  if (!listed || listed.length === 0) return 'unknown'
  const want = parseSize(recommended)
  if (!want) return 'unknown'
  const tokensListed = listed.map((s) => parseSize(s)).filter((t): t is NonNullable<ReturnType<typeof parseSize>> => t !== null)
  const sameKind = tokensListed.filter((t) => t.kind === want.kind)
  if (sameKind.length === 0) return 'unknown'
  return sameKind.some((t) => t.value === want.value) ? 'listed' : 'not_listed'
}

// ---- Search ----

// Not "another retailer": social/forum/reference sites, resale marketplaces (one-off used items with
// meaningless size lists), and review/blog sites.
const EXCLUDED_HOSTS = [
  'facebook.com', 'instagram.com', 'pinterest.', 'tiktok.com', 'youtube.com', 'youtu.be', 'twitter.com', 'x.com', 'reddit.com',
  'wikipedia.org', 'linkedin.com', 'quora.com', 'google.', 'bing.com', 'yahoo.com', 'duckduckgo.com', 'tumblr.com', 'medium.com',
  'ebay.', 'poshmark.', 'depop.', 'mercari.', 'thredup.', 'therealreal.', 'vinted.', 'treet.co', 'grailed.', 'offerup.', 'craigslist.',
]
const EXCLUDED_HOST_WORDS = /review|reviews|blog|forum|coupon|deals?$/i
const EXCLUDED_PATH = /\/(blogs?|journal|news|articles?|reviews?|guides?|help|support|search|category|categories|collections?|stores?|brands?|shop-all)(\/|$)/i

// Same retailer = same registrable-ish domain, so "www.shop.com" and "shop.com" match.
function siteKey(hostname: string): string {
  const parts = hostname.toLowerCase().replace(/^www\./, '').split('.')
  const twoPartTld = parts.length > 2 && parts[parts.length - 1].length === 2 && ['co', 'com', 'org', 'net', 'ac', 'gov'].includes(parts[parts.length - 2])
  return parts.slice(twoPartTld ? -3 : -2).join('.')
}

export function isSameRetailer(urlA: string, urlB: string): boolean {
  try {
    return siteKey(new URL(urlA).hostname) === siteKey(new URL(urlB).hostname)
  } catch {
    return false
  }
}

// Candidate pages worth reading: other retailers' product-looking pages, not social/forum/blog/listing pages.
export function isCandidateUrl(candidateUrl: string, sourceUrl: string): boolean {
  let url: URL
  try {
    url = new URL(candidateUrl)
  } catch {
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  if (isSameRetailer(candidateUrl, sourceUrl)) return false
  const host = url.hostname.toLowerCase()
  if (EXCLUDED_HOSTS.some((h) => host.includes(h)) || EXCLUDED_HOST_WORDS.test(host.replace(/^www\./, '').split('.')[0])) return false
  if (EXCLUDED_PATH.test(url.pathname)) return false
  if (/\.(pdf|jpe?g|png|gif|webp|svg)$/i.test(url.pathname)) return false
  return true
}

// Search operators that push results away from the source retailer and from non-retail noise.
const NOISE_SITES = ['reddit.com', 'facebook.com', 'pinterest.com', 'ebay.com', 'poshmark.com']

export function buildSearchQueries(source: ProductIdentity, sourceHost?: string): string[] {
  const brand = source.brand?.trim()
  const name = source.productName?.trim()
  const operators = [
    ...(sourceHost ? [`-site:${sourceHost.replace(/^www\./, '')}`] : []),
    ...NOISE_SITES.map((h) => `-site:${h}`),
  ].join(' ')

  const core: string[] = []
  if (source.styleNumber && alnum(source.styleNumber).length >= 4) {
    core.push([`"${source.styleNumber.trim()}"`, brand].filter(Boolean).join(' '))
  }
  if (name) {
    // Don't repeat the brand if the product name already contains it.
    const nameHasBrand = brand ? tokens(brand).every((t) => tokens(name).includes(t)) : false
    core.push([nameHasBrand ? '' : brand, name, source.color?.trim()].filter(Boolean).join(' '))
  }
  return [...new Set(core.map((q) => q.replace(/\s+/g, ' ').trim()).filter((q) => q.length > 0))]
    .slice(0, 2)
    .map((q) => `${q} ${operators}`.trim())
}

// How much of a value (e.g. a product name) is actually present in the page text, 0..1.
export function fractionOnPage(value: string | undefined, pageMarkdown: string): number {
  const wanted = [...new Set(tokens(value).filter((t) => !STOPWORDS.has(t)))]
  if (wanted.length === 0) return 0
  const page = new Set(tokens(pageMarkdown))
  return wanted.filter((t) => page.has(t)).length / wanted.length
}

// Sort: confirmed matches first; within a group, sizes listed before unknown before not listed.
const SIZE_ORDER = { listed: 0, unknown: 1, not_listed: 2 } as const
export function rankResults<T extends { matchType: MatchType; sizeStatus: 'listed' | 'not_listed' | 'unknown' }>(results: T[]): T[] {
  return [...results].sort(
    (a, b) => (a.matchType === b.matchType ? 0 : a.matchType === 'exact' ? -1 : 1) || SIZE_ORDER[a.sizeStatus] - SIZE_ORDER[b.sizeStatus],
  )
}

// A page that is a used / consignment listing is not "another retailer" selling the item new.
export function looksLikeResale(pageMarkdown: string): boolean {
  return /\b(pre-?owned|gently used|pre-?loved|second-?hand|consignment|resale)\b/i.test(pageMarkdown.slice(0, 8000))
}

// Extraction sometimes returns a generic word ("Shop") as the store name; fall back to the domain then.
const GENERIC_STORE_NAMES = new Set(['shop', 'store', 'home', 'online store', 'online shop', 'website', 'site', 'buy', 'cart'])
export function retailerLabel(extracted: string | undefined, url: string): string {
  const host = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, '')
    } catch {
      return url
    }
  })()
  const name = extracted?.trim()
  if (!name || name.length < 4 || GENERIC_STORE_NAMES.has(name.toLowerCase())) return host
  return name
}
