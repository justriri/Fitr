import { getAuthUserId } from '@convex-dev/auth/server'
import { v } from 'convex/values'
import { internal } from './_generated/api'
import { internalAction, internalMutation, mutation, query } from './_generated/server'
import { detectCategory, primaryKeys, type Category } from './lib/fitRecommendation'
import { findSizeGuideLinks } from './lib/sizeGuideLinks'
import { parseSizeChart, verifyChartAgainstPage } from './lib/sizeParsing'

// The size chart is copied as a table exactly as the page shows it, not
// remapped into fields: asking the model to re-assign cells to
// bust/waist/hip columns proved unreliable on real pages (it copied waist
// into bust and shifted hip into waist). A verbatim copy can be checked
// against the page's own text, so we only keep charts that really are there.
const SIZE_CHART_SCHEMA = {
  type: 'object',
  description:
    "The retailer's size chart, ONLY if the page shows a table with numeric bust/chest, waist or hip " +
    'measurements. Omit this field entirely if there is no such table, if it is only a text note ' +
    '(e.g. "runs small"), or if you cannot copy the numbers reliably. Never estimate, convert or fill in values.',
  properties: {
    chartType: {
      type: 'string',
      enum: ['body', 'garment'],
      description:
        '"body" if the numbers are the wearer\'s body measurements (headed e.g. "Bust", "Waist", "Hip", ' +
        '"Body measurements", "To fit"). "garment" if they are measurements of the clothing itself ' +
        '(e.g. "Garment measurements", "Product measurements", "Flat", "Pit to pit", lengths, sleeve length).',
    },
    unit: {
      type: 'string',
      enum: ['cm', 'in'],
      description:
        'The unit the chart numbers are in. If the page shows both centimeters and inches, copy the ' +
        'centimeter values in the table and set this to "cm".',
    },
    table: {
      type: 'string',
      description:
        'The chart copied exactly as shown, as a markdown table: first the header row exactly as on the page ' +
        '(e.g. "| Size | Waist | Hip |"), then one row per size. Keep every cell as written, including ranges ' +
        'and unit marks (e.g. 28" - 30 1/2"). Keep the columns in the same order as the page. Do not add, ' +
        'rename, reorder, convert, average or infer any column or value. If the chart has no bust/chest column, ' +
        'do not add one.',
    },
  },
}

// Fields we ask Firecrawl's LLM-based JSON extraction to pull off a single
// product page. Nothing is `required` at the schema level — a missing field
// should come back as "not present" rather than the model inventing a value.
const FIRECRAWL_EXTRACT_SCHEMA = {
  type: 'object',
  properties: {
    productName: { type: 'string' },
    retailer: { type: 'string', description: 'The store or brand selling this item.' },
    description: { type: 'string' },
    price: { type: 'number', description: 'The current numeric price, no currency symbol.' },
    currency: { type: 'string', description: '3-letter ISO code (e.g. USD, EUR) if determinable.' },
    images: {
      type: 'array',
      items: { type: 'string' },
      description: 'Direct URLs to photos of this product.',
    },
    availableSizes: {
      type: 'array',
      items: { type: 'string' },
      description: 'The size options offered for this item (e.g. S, M, L or numeric sizes).',
    },
    sizeChart: SIZE_CHART_SCHEMA,
    category: { type: 'string', description: 'The type of garment, e.g. blazer, t-shirt, jeans.' },
    color: { type: 'string' },
    material: { type: 'string' },
    fit: { type: 'string', description: 'The described fit of the garment, e.g. slim, relaxed, oversized.' },
  },
}

const SIZE_CHART_INSTRUCTIONS =
  'For sizeChart: find the size guide / size chart table (it may be in a collapsed section or modal) and ' +
  'copy it exactly as shown, cell for cell, keeping ranges such as "86–90 cm" as written. Do not remap, ' +
  'convert or fill in any cell, and do not add a bust/chest, waist or hip column the chart does not have. ' +
  'Say whether it is a body-measurement chart (the wearer\'s bust/waist/hip) or a garment-measurement ' +
  'chart (the clothing\'s own dimensions). If the page has several charts (for example tops and bottoms), ' +
  'use the one that matches this product. If there is a size chart but you cannot copy it reliably, or it ' +
  'has no bust/chest, waist or hip numbers, omit sizeChart entirely — never guess.'

const FIRECRAWL_EXTRACT_PROMPT =
  'Extract details about the single clothing/fashion product shown on this page. ' +
  'Only include information that is actually present on the page — do not guess or invent values. ' +
  'If a field is not present, omit it entirely. ' +
  SIZE_CHART_INSTRUCTIONS

function normalizeProductUrl(raw: string): string | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  return parsed.toString()
}

export const startCrawl = mutation({
  args: { url: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (userId === null) {
      throw new Error('Not authenticated')
    }

    const normalizedUrl = normalizeProductUrl(args.url)
    if (normalizedUrl === null) {
      throw new Error(
        "That doesn't look like a valid URL. Make sure it starts with https:// and points to a product page.",
      )
    }

    const productId = await ctx.db.insert('products', {
      userId,
      sourceUrl: normalizedUrl,
      status: 'pending',
    })

    await ctx.scheduler.runAfter(0, internal.products.runCrawl, {
      productId,
      sourceUrl: normalizedUrl,
    })

    return productId
  },
})

// The signed-in user's recently checked items (newest first), for the Discover page. Owner-scoped, bounded, and it
// returns only what a product card needs — never another user's rows, never the raw crawl.
export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    if (userId === null) return []
    const rows = await ctx.db
      .query('products')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .order('desc')
      .take(24)
    return rows
      .filter((p) => p.status !== 'failed')
      .map((p) => ({
        _id: p._id,
        status: p.status,
        name: p.name ?? null,
        retailer: p.retailer ?? null,
        image: p.images?.[0] ?? null,
        price: p.price ?? null,
        currency: p.currency ?? null,
        sourceUrl: p.sourceUrl,
      }))
  },
})

export const getProduct = query({
  args: { productId: v.id('products') },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (userId === null) {
      return null
    }

    const product = await ctx.db.get('products', args.productId)
    if (product === null || product.userId !== userId) {
      // Don't distinguish "doesn't exist" from "not yours" — both should
      // look like "not found" to the caller.
      return null
    }

    return product
  },
})

const extractedFieldsValidator = {
  name: v.optional(v.string()),
  retailer: v.optional(v.string()),
  description: v.optional(v.string()),
  price: v.optional(v.number()),
  currency: v.optional(v.string()),
  images: v.optional(v.array(v.string())),
  availableSizes: v.optional(v.array(v.string())),
  sizeChart: v.optional(v.string()),
  category: v.optional(v.string()),
  color: v.optional(v.string()),
  material: v.optional(v.string()),
  fit: v.optional(v.string()),
}

export const saveCrawlResult = internalMutation({
  args: {
    productId: v.id('products'),
    ...extractedFieldsValidator,
  },
  handler: async (ctx, args) => {
    const { productId, ...fields } = args
    await ctx.db.patch('products', productId, {
      ...fields,
      status: 'ready',
      errorMessage: undefined,
      crawledAt: Date.now(),
    })
  },
})

export const markCrawlFailed = internalMutation({
  args: { productId: v.id('products'), errorMessage: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch('products', args.productId, {
      status: 'failed',
      errorMessage: args.errorMessage,
      crawledAt: Date.now(),
    })
  },
})

type ExtractedFields = {
  name?: string
  retailer?: string
  description?: string
  price?: number
  currency?: string
  images?: string[]
  availableSizes?: string[]
  sizeChart?: string
  category?: string
  color?: string
  material?: string
  fit?: string
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function optionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const strings = value.filter((v): v is string => typeof v === 'string' && v.trim() !== '')
  return strings.length > 0 ? strings.slice(0, 8) : undefined
}

// Turns Firecrawl's copied chart into the text stored in `products.sizeChart`,
// or undefined when it isn't a chart we can trust. A chart is kept only if it:
//  - is declared a body-measurement chart (garment charts can't be compared
//    with a person's measurements),
//  - is read back successfully by the same parser the fit recommender uses
//    (which also rejects implausible numbers and non-monotonic columns), and
//  - is verified against the page's own text: every row's numbers must exist,
//    in order, in the matching page row, so remapped or invented cells fail.
// Anything else is dropped rather than guessed at.
function formatSizeChart(raw: unknown, pageMarkdown: string): string | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const chart = raw as Record<string, unknown>
  if (chart.chartType !== 'body') return undefined
  if (typeof chart.table !== 'string') return undefined

  let table = chart.table.trim()
  if (table === '' || table.length > 8000) return undefined
  if (!verifyChartAgainstPage(table, pageMarkdown)) return undefined

  const parsed = parseSizeChart(table)
  if (parsed.status !== 'ok') return undefined

  // If the copied table carries no unit marks at all, use the unit Firecrawl
  // read from the page rather than leaving the parser to guess by magnitude.
  if (parsed.chart.unitsInferred && (chart.unit === 'cm' || chart.unit === 'in')) {
    const withUnit = `Measurements in ${chart.unit === 'cm' ? 'centimeters (cm)' : 'inches (in)'}\n${table}`
    if (parseSizeChart(withUnit).status === 'ok') table = withUnit
  }
  return table
}

// Firecrawl's response body is untyped JSON over the wire — narrow every
// field before trusting it, per Convex's http/external-data guidelines.
function extractProductFields(body: unknown): ExtractedFields | null {
  if (typeof body !== 'object' || body === null) return null
  const top = body as Record<string, unknown>
  if (top.success !== true || typeof top.data !== 'object' || top.data === null) return null

  const data = top.data as Record<string, unknown>
  if (typeof data.json !== 'object' || data.json === null) return null
  const j = data.json as Record<string, unknown>

  const fields: ExtractedFields = {
    name: optionalString(j.productName),
    retailer: optionalString(j.retailer),
    description: optionalString(j.description),
    price: optionalNumber(j.price),
    currency: optionalString(j.currency),
    images: optionalStringArray(j.images),
    availableSizes: optionalStringArray(j.availableSizes),
    sizeChart: formatSizeChart(j.sizeChart, typeof data.markdown === 'string' ? data.markdown : ''),
    category: optionalString(j.category),
    color: optionalString(j.color),
    material: optionalString(j.material),
    fit: optionalString(j.fit),
  }

  const hasAnythingUseful =
    fields.name !== undefined ||
    fields.price !== undefined ||
    (fields.images !== undefined && fields.images.length > 0)

  return hasAnythingUseful ? fields : null
}

// ---- Fallback: a size guide on a separate, linked page ----
//
// Some retailers keep the body-measurement chart off the product page. Only
// when the product page itself gave no verified chart do we look for a
// size-guide link, and we follow at most MAX_GUIDE_FOLLOWS of them. The chart
// found there goes through exactly the same checks as a product-page chart
// (body-not-garment, parseable, verified against that page's own text), plus
// a check that it has the measurements this type of garment needs.

const MAX_GUIDE_FOLLOWS = 2

const SIZE_GUIDE_SCHEMA = {
  type: 'object',
  properties: { sizeChart: SIZE_CHART_SCHEMA },
}

function sizeGuidePrompt(product: ExtractedFields): string {
  const item = [product.name, product.category].filter(Boolean).join(' — ').slice(0, 160)
  return (
    "This page is a clothing retailer's size guide, not a product page. " +
    `The shopper is looking at: ${item || 'a clothing item'}. ` +
    'Only include information that is actually present on the page — do not guess or invent values. ' +
    'Find the body-measurement chart that applies to that type of garment (for example tops and bras use ' +
    'bust/chest; bottoms, leggings and pants use waist and hip; dresses use bust, waist and hip) and copy only ' +
    'that chart. ' +
    SIZE_CHART_INSTRUCTIONS
  )
}

// Best-effort Firecrawl call for the fallback path: any failure just means "no chart".
async function scrapeBestEffort(
  apiKey: string,
  payload: Record<string, unknown>,
  timeoutMs: number,
): Promise<Record<string, unknown> | null> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch('https://api.firecrawl.dev/v2/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    if (!response.ok) return null
    const body: unknown = await response.json()
    if (typeof body !== 'object' || body === null) return null
    const top = body as Record<string, unknown>
    if (top.success !== true || typeof top.data !== 'object' || top.data === null) return null
    return top.data as Record<string, unknown>
  } catch {
    return null
  } finally {
    clearTimeout(timeoutId)
  }
}

function chartServesCategory(table: string, category: Category): boolean {
  const parsed = parseSizeChart(table)
  if (parsed.status !== 'ok') return false
  return primaryKeys(category).some((key) => parsed.chart.rows.some((row) => row[key]))
}

// Label where the chart came from, unless doing so would change how it parses.
function withSourceNote(table: string, guideUrl: string): string {
  const noted = `Size guide: ${guideUrl}\n${table}`
  const before = parseSizeChart(table)
  const after = parseSizeChart(noted)
  const unchanged =
    before.status === 'ok' &&
    after.status === 'ok' &&
    before.chart.unitsInferred === after.chart.unitsInferred &&
    JSON.stringify(before.chart.rows) === JSON.stringify(after.chart.rows)
  return unchanged ? noted : table
}

async function findLinkedSizeChart(
  apiKey: string,
  sourceUrl: string,
  product: ExtractedFields,
): Promise<string | undefined> {
  try {
    const category = detectCategory({ category: product.category, name: product.name })

    // The size-guide link is usually in the site header/footer, which the
    // main-content scrape strips, so look at the whole page for links.
    const page = await scrapeBestEffort(
      apiKey,
      { url: sourceUrl, onlyMainContent: false, formats: ['links', 'markdown'] },
      30_000,
    )
    if (page === null) return undefined

    const candidates = findSizeGuideLinks({
      sourceUrl,
      markdown: typeof page.markdown === 'string' ? page.markdown : '',
      links: Array.isArray(page.links) ? page.links.filter((l): l is string => typeof l === 'string') : [],
      kind: category,
    }).slice(0, MAX_GUIDE_FOLLOWS)

    for (const candidate of candidates) {
      console.log(`Fitr: no verified size chart on product page; following size guide ${candidate.url}`)
      const guide = await scrapeBestEffort(
        apiKey,
        {
          url: candidate.url,
          onlyMainContent: true,
          formats: [
            { type: 'json', schema: SIZE_GUIDE_SCHEMA, prompt: sizeGuidePrompt(product) },
            'markdown',
          ],
        },
        45_000,
      )
      if (guide === null) continue

      const json = typeof guide.json === 'object' && guide.json !== null ? (guide.json as Record<string, unknown>) : {}
      const table = formatSizeChart(json.sizeChart, typeof guide.markdown === 'string' ? guide.markdown : '')
      if (table === undefined || !chartServesCategory(table, category)) continue

      console.log(`Fitr: stored verified size chart from ${candidate.url}`)
      return withSourceNote(table, candidate.url)
    }
  } catch (e) {
    console.log('Fitr: size guide lookup failed', e instanceof Error ? e.message : String(e))
  }
  return undefined
}

export const runCrawl = internalAction({
  args: { productId: v.id('products'), sourceUrl: v.string() },
  handler: async (ctx, args) => {
    const apiKey = process.env.FIRECRAWL_API_KEY
    if (!apiKey) {
      await ctx.runMutation(internal.products.markCrawlFailed, {
        productId: args.productId,
        errorMessage:
          "Product crawling isn't configured yet — FIRECRAWL_API_KEY is missing on the Convex deployment.",
      })
      return
    }

    let response: Response
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 45_000)
      try {
        response = await fetch('https://api.firecrawl.dev/v2/scrape', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            url: args.sourceUrl,
            onlyMainContent: true,
            formats: [
              {
                type: 'json',
                schema: FIRECRAWL_EXTRACT_SCHEMA,
                prompt: FIRECRAWL_EXTRACT_PROMPT,
              },
              // Only used server-side to verify the extracted size chart against the page text.
              'markdown',
            ],
          }),
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timeoutId)
      }
    } catch (e) {
      const timedOut = e instanceof Error && e.name === 'AbortError'
      await ctx.runMutation(internal.products.markCrawlFailed, {
        productId: args.productId,
        errorMessage: timedOut
          ? 'That page took too long to load. Please try again.'
          : "Couldn't reach the crawling service. Check your connection and try again.",
      })
      return
    }

    if (!response.ok) {
      let message = 'The crawling service had a problem retrieving that page. Please try again.'
      if (response.status === 401 || response.status === 403) {
        message = 'Product crawling is misconfigured — Firecrawl rejected the configured API key.'
      } else if (response.status === 402) {
        message = 'The crawling service has reached its usage limit.'
      } else if (response.status === 429) {
        message = 'Too many requests right now. Please try again in a moment.'
      } else if (response.status === 404) {
        message = "That page couldn't be found. Double check the URL."
      }
      await ctx.runMutation(internal.products.markCrawlFailed, {
        productId: args.productId,
        errorMessage: message,
      })
      return
    }

    let body: unknown
    try {
      body = await response.json()
    } catch {
      await ctx.runMutation(internal.products.markCrawlFailed, {
        productId: args.productId,
        errorMessage: 'The crawling service returned an unexpected response.',
      })
      return
    }

    const extracted = extractProductFields(body)
    if (extracted === null) {
      await ctx.runMutation(internal.products.markCrawlFailed, {
        productId: args.productId,
        errorMessage:
          "We couldn't find product details on that page. Make sure the URL points directly to a product page.",
      })
      return
    }

    // The product page had no verified chart: try the retailer's linked size guide.
    const sizeChart =
      extracted.sizeChart ?? (await findLinkedSizeChart(apiKey, args.sourceUrl, extracted))

    await ctx.runMutation(internal.products.saveCrawlResult, {
      productId: args.productId,
      ...extracted,
      sizeChart,
    })
  },
})
