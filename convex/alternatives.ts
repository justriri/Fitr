import { getAuthUserId } from '@convex-dev/auth/server'
import { v } from 'convex/values'
import { internal } from './_generated/api'
import { internalAction, internalMutation, mutation, query } from './_generated/server'
import { computeFitRecommendation } from './lib/fitRecommendation'
import {
  assessMatch,
  buildSearchQueries,
  fractionOnPage,
  appearsOnPage,
  isCandidateUrl,
  looksLikeResale,
  rankResults,
  retailerLabel,
  sizeListedStatus,
  type MatchType,
  type ProductIdentity,
} from './lib/alternativeMatching'
import { upgradeImageUrl } from './lib/imageChecks'

// A search still "searching" for less than this is treated as running, so a
// double-click can't start (and pay for) a second one.
const IN_FLIGHT_MS = 3 * 60 * 1000
const MAX_CANDIDATES = 5
const MAX_EXACT = 4
const MAX_POSSIBLE = 3

// FIRECRAWL_BASE_URL is optional and exists so the failure path can be exercised without touching the API key.
const firecrawlBase = () => (process.env.FIRECRAWL_BASE_URL || 'https://api.firecrawl.dev').replace(/\/$/, '')

// ---- Public API ----

// Only valid when the recommended size really is not listed on the current page.
// The recommendation is recomputed here — the client's word is never trusted.
export const startSearch = mutation({
  args: { productId: v.id('products') },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (userId === null) throw new Error('Not authenticated')

    const product = await ctx.db.get('products', args.productId)
    if (product === null || product.userId !== userId) throw new Error('Product not found.')
    if (product.status !== 'ready') throw new Error('This product is still loading — try again once it finishes.')

    const profile = await ctx.db
      .query('bodyProfiles')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .unique()
    const fit = computeFitRecommendation(profile, product)
    if (fit.status !== 'ok') throw new Error('We need a size recommendation for this item before searching elsewhere.')
    if (fit.availability !== 'unavailable') {
      throw new Error('Your recommended size is listed on this page, so there is no need to look elsewhere.')
    }

    const latest = await ctx.db
      .query('alternativeSearches')
      .withIndex('by_productId', (q) => q.eq('productId', product._id))
      .order('desc')
      .first()
    if (
      latest !== null &&
      latest.userId === userId &&
      latest.status === 'searching' &&
      latest.recommendedSize === fit.recommendedSize &&
      Date.now() - latest._creationTime < IN_FLIGHT_MS
    ) {
      return latest._id
    }

    const searchId = await ctx.db.insert('alternativeSearches', {
      userId,
      productId: product._id,
      recommendedSize: fit.recommendedSize,
      status: 'searching',
    })

    await ctx.scheduler.runAfter(0, internal.alternatives.runSearch, {
      searchId,
      sourceUrl: product.sourceUrl,
      recommendedSize: fit.recommendedSize,
      productName: product.name,
      retailer: product.retailer,
      color: product.color,
    })

    return searchId
  },
})

export const getSearch = query({
  args: { productId: v.id('products') },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (userId === null) return null

    const latest = await ctx.db
      .query('alternativeSearches')
      .withIndex('by_productId', (q) => q.eq('productId', args.productId))
      .order('desc')
      .first()
    if (latest === null || latest.userId !== userId) return null
    return latest
  },
})

// ---- Internal state transitions ----

const resultValidator = v.object({
  url: v.string(),
  retailer: v.string(),
  productName: v.string(),
  matchType: v.union(v.literal('exact'), v.literal('possible')),
  matchNotes: v.array(v.string()),
  sizeStatus: v.union(v.literal('listed'), v.literal('not_listed'), v.literal('unknown')),
  sizes: v.array(v.string()),
  price: v.optional(v.number()),
  currency: v.optional(v.string()),
  imageUrl: v.optional(v.string()),
  color: v.optional(v.string()),
})

export const saveResults = internalMutation({
  args: {
    searchId: v.id('alternativeSearches'),
    results: v.array(resultValidator),
    queries: v.array(v.string()),
    pagesChecked: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch('alternativeSearches', args.searchId, {
      status: 'completed',
      results: args.results,
      queries: args.queries,
      pagesChecked: args.pagesChecked,
      errorMessage: undefined,
    })
  },
})

export const markFailed = internalMutation({
  args: { searchId: v.id('alternativeSearches'), errorMessage: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch('alternativeSearches', args.searchId, { status: 'failed', errorMessage: args.errorMessage })
  },
})

// ---- The search itself (Firecrawl search + page reads) ----

// What we read from each page: enough to identify the item, plus what the shopper needs to see.
const IDENTITY_SCHEMA = {
  type: 'object',
  properties: {
    productName: { type: 'string', description: 'The name of the single clothing product on this page.' },
    brand: {
      type: 'string',
      description:
        'The label/maker of the item (e.g. "Levi\'s", "Nike"), not the shop selling it — unless the shop sells its own label.',
    },
    styleNumber: {
      type: 'string',
      description: 'The manufacturer style / model / SKU code exactly as printed on the page. Omit if none is shown.',
    },
    color: { type: 'string', description: 'The colour of the item shown.' },
    retailer: { type: 'string', description: 'The name of the store selling it.' },
    price: { type: 'number', description: 'The current numeric price, no currency symbol.' },
    currency: { type: 'string', description: '3-letter ISO code if determinable.' },
    images: { type: 'array', items: { type: 'string' }, description: 'Direct URLs to photos of this product.' },
    availableSizes: {
      type: 'array',
      items: { type: 'string' },
      description: 'The size options this page offers for the item (e.g. S, M, L or numeric sizes).',
    },
  },
}

const IDENTITY_PROMPT =
  'Extract identifying details of the single clothing product on this page. Only include what is actually ' +
  'present on the page — never guess or infer. If this page is not a single product page (for example a ' +
  'category, search results, store, blog, review or listing page), omit productName entirely. Omit any field ' +
  'that is not shown.'

type PageIdentity = ProductIdentity & {
  retailer?: string
  price?: number
  currency?: string
  imageUrl?: string
  sizes: string[]
}

const str = (value: unknown, max = 160): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, max) : undefined

// Reads one page. Everything the model claims (name, brand, style number, colour) must appear in the page's own
// text, otherwise it is dropped — a model can't invent an identity for a page that doesn't carry it.
async function readPage(apiKey: string, url: string, timeoutMs: number): Promise<PageIdentity | null> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${firecrawlBase()}/v2/scrape`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        url,
        onlyMainContent: true,
        formats: [{ type: 'json', schema: IDENTITY_SCHEMA, prompt: IDENTITY_PROMPT }, 'markdown'],
      }),
      signal: controller.signal,
    })
    if (!response.ok) return null
    const body: unknown = await response.json()
    const data = (body as { success?: unknown; data?: Record<string, unknown> } | null)?.data
    if ((body as { success?: unknown } | null)?.success !== true || typeof data !== 'object' || data === null) return null
    const json = data.json
    if (typeof json !== 'object' || json === null) return null
    const j = json as Record<string, unknown>
    const markdown = typeof data.markdown === 'string' ? data.markdown : ''

    const productName = str(j.productName)
    if (productName === undefined || fractionOnPage(productName, markdown) < 0.8) return null
    if (looksLikeResale(markdown)) return null

    const brand = str(j.brand, 80)
    const styleNumber = str(j.styleNumber, 60)
    const color = str(j.color, 60)
    const sizes = Array.isArray(j.availableSizes)
      ? j.availableSizes.filter((s): s is string => typeof s === 'string' && s.trim() !== '').map((s) => s.trim().slice(0, 12)).slice(0, 14)
      : []
    const firstImage = Array.isArray(j.images) ? j.images.find((i): i is string => typeof i === 'string' && /^https?:\/\//.test(i)) : undefined

    return {
      productName,
      brand: brand && appearsOnPage(brand, markdown) ? brand : undefined,
      styleNumber: styleNumber && appearsOnPage(styleNumber, markdown) ? styleNumber : undefined,
      color: color && appearsOnPage(color, markdown) ? color : undefined,
      retailer: str(j.retailer, 80),
      price: typeof j.price === 'number' && Number.isFinite(j.price) && j.price > 0 ? j.price : undefined,
      currency: str(j.currency, 3),
      imageUrl: firstImage ? (upgradeImageUrl(firstImage) ?? firstImage) : undefined,
      sizes,
    }
  } catch {
    return null
  } finally {
    clearTimeout(timeoutId)
  }
}

class SearchError extends Error {}

async function webSearch(apiKey: string, query: string): Promise<string[]> {
  let response: Response
  try {
    response = await fetch(`${firecrawlBase()}/v2/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ query, limit: 10 }),
      signal: AbortSignal.timeout(40_000),
    })
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')
    throw new SearchError(
      timedOut ? 'The search took too long. Please try again.' : "Couldn't reach the search service. Check your connection and try again.",
    )
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new SearchError('Search is misconfigured — Firecrawl rejected the configured API key.')
    if (response.status === 402) throw new SearchError('The search service has reached its usage limit.')
    if (response.status === 429) throw new SearchError('Too many searches right now. Please try again in a moment.')
    throw new SearchError('The search service had a problem. Please try again.')
  }
  const body: unknown = await response.json().catch(() => null)
  const data = (body as { data?: unknown } | null)?.data
  const list = Array.isArray(data) ? data : Array.isArray((data as { web?: unknown } | undefined)?.web) ? ((data as { web: unknown[] }).web) : []
  return list.map((r) => (r as { url?: unknown })?.url).filter((u): u is string => typeof u === 'string')
}

export const runSearch = internalAction({
  args: {
    searchId: v.id('alternativeSearches'),
    sourceUrl: v.string(),
    recommendedSize: v.string(),
    productName: v.optional(v.string()),
    retailer: v.optional(v.string()),
    color: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    const fail = (errorMessage: string) => ctx.runMutation(internal.alternatives.markFailed, { searchId: args.searchId, errorMessage })
    try {
      const apiKey = process.env.FIRECRAWL_API_KEY
      if (!apiKey) {
        await fail("Searching other retailers isn't configured yet — FIRECRAWL_API_KEY is missing on the Convex deployment.")
        return
      }

      // 1. Who is the source product? (brand + manufacturer style number are what make an "exact" match possible.)
      const sourceRead = await readPage(apiKey, args.sourceUrl, 45_000)
      const source: ProductIdentity = {
        productName: sourceRead?.productName ?? args.productName,
        brand: sourceRead?.brand,
        styleNumber: sourceRead?.styleNumber,
        color: sourceRead?.color ?? args.color,
      }
      if (!source.productName) {
        await fail("We couldn't read enough about this item to search for it elsewhere.")
        return
      }

      // 2. Search the web for it, steering away from the source retailer.
      const sourceHost = new URL(args.sourceUrl).hostname
      const queries = buildSearchQueries(source, sourceHost)
      const found = new Set<string>()
      for (const q of queries) {
        for (const url of await webSearch(apiKey, q)) if (isCandidateUrl(url, args.sourceUrl)) found.add(url)
      }
      const candidateUrls = [...found].slice(0, MAX_CANDIDATES)

      // 3. Read each candidate page and decide, by rule, whether it is the same item.
      const pages = await Promise.all(candidateUrls.map(async (url) => ({ url, page: await readPage(apiKey, url, 50_000) })))
      if (candidateUrls.length > 0 && pages.every((p) => p.page === null)) {
        await fail("We couldn't read the other retailers' pages. Please try again.")
        return
      }

      const results: Array<{
        url: string; retailer: string; productName: string; matchType: MatchType; matchNotes: string[]
        sizeStatus: 'listed' | 'not_listed' | 'unknown'; sizes: string[]
        price?: number; currency?: string; imageUrl?: string; color?: string
      }> = []
      for (const { url, page } of pages) {
        if (page === null) continue
        const match = assessMatch(source, page)
        if (match.matchType === 'none') continue
        results.push({
          url,
          retailer: retailerLabel(page.retailer, url),
          productName: page.productName ?? '',
          matchType: match.matchType,
          matchNotes: match.notes,
          sizeStatus: sizeListedStatus(args.recommendedSize, page.sizes),
          sizes: page.sizes,
          price: page.price,
          currency: page.currency,
          imageUrl: page.imageUrl,
          color: page.color,
        })
      }

      const ranked = rankResults(results)
      const exact = ranked.filter((r) => r.matchType === 'exact').slice(0, MAX_EXACT)
      const possible = ranked.filter((r) => r.matchType === 'possible').slice(0, MAX_POSSIBLE)
      console.log(
        `Fitr alternatives: queries=${queries.length} candidates=${candidateUrls.length} exact=${exact.length} possible=${possible.length}`,
      )

      await ctx.runMutation(internal.alternatives.saveResults, {
        searchId: args.searchId,
        results: [...exact, ...possible],
        queries,
        pagesChecked: candidateUrls.length,
      })
    } catch (e) {
      console.log('Fitr alternatives: search failed', e instanceof Error ? e.message : String(e))
      await fail(e instanceof SearchError ? e.message : 'Something went wrong searching other retailers. Please try again.')
    }
  },
})
