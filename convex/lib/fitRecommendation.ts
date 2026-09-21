// Transparent, rule-based size recommendation. No ML, no hidden weights: a
// size is chosen from (1) the retailer's size chart when it can be read, else
// (2) the person's usual size, then nudged one step for the difference between
// the item's cut and how they like clothes to fit. Confidence reflects how
// much real sizing data we had, not a statistical claim.

import {
  isOneSizeLabel,
  parseSize,
  parseSizeChart,
  tokenCanonicalLabel,
  type ChartRow,
  type MeasureKey,
  type ParsedChart,
  type SizeToken,
} from './sizeParsing'

export type FitKey = 'fitted' | 'regular' | 'relaxed' | 'oversized'
export type Confidence = 'high' | 'medium' | 'low'

export type BodyProfileInput = {
  bustChestCm: number
  waistCm: number
  hipCm: number
  usualClothingSize?: string
  preferredFit: FitKey
}

export type ProductInput = {
  name?: string
  description?: string
  category?: string
  fit?: string
  availableSizes?: string[]
  sizeChart?: string
}

// How one of the customer's body measurements sits against the recommended size's row on the retailer's chart.
export type FitCheck = {
  measure: 'bust' | 'waist' | 'hip'
  state: 'fits' | 'roomy' | 'snug'
  yourCm: number
  lo: number
  hi: number
}

export type FitRecommendation =
  | { status: 'no_profile' }
  | { status: 'insufficient_data'; message: string }
  | {
      status: 'ok'
      recommendedSize: string
      basis: 'measurements' | 'usual_size'
      availability: 'available' | 'unavailable' | 'unknown'
      closestAvailableSize: string | null
      closestAvailableDirection: 'smaller' | 'larger' | null
      likelyFit: FitKey
      confidence: Confidence
      explanation: string
      details: string[]
      checks: FitCheck[]
      notCompared: Array<'bust' | 'waist' | 'hip'>
    }

const FIT_STEP: Record<FitKey, number> = { fitted: 0, regular: 1, relaxed: 2, oversized: 3 }
const FIT_BY_STEP: FitKey[] = ['fitted', 'regular', 'relaxed', 'oversized']
const FIT_LABEL: Record<FitKey, string> = {
  fitted: 'fitted',
  regular: 'regular',
  relaxed: 'relaxed',
  oversized: 'oversized',
}
const MEASURE_NAME: Record<MeasureKey, string> = { chest: 'bust/chest', waist: 'waist', hip: 'hip' }

export type Category = 'top' | 'bottom' | 'dress' | 'unknown'
type GarmentFit = { key: FitKey; source: 'fit field' | 'listing text' }

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))
const cm = (n: number) => `${Math.round(n * 10) / 10} cm`

function validMeasurement(value: number | undefined, lo: number, hi: number): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= lo && value <= hi
    ? value
    : undefined
}

export function detectCategory(product: ProductInput): Category {
  const classify = (raw: string | undefined): Category => {
    if (!raw) return 'unknown'
    const t = raw
      .toLowerCase()
      .replace(/dress\s+(shirt|pants?|trousers?|shoes?)/g, '$1')
      .replace(/short[\s-]*sleeve/g, 'sleeve')
    if (/dress|gown|jumpsuit|romper|playsuit|dungaree|overall/.test(t)) return 'dress'
    if (
      /\b(t-?shirts?|tees?|shirts?|blouses?|tops?|sweaters?|jumpers?|hoodies?|sweatshirts?|pullovers?|cardigans?|jackets?|blazers?|coats?|vests?|polos?|tanks?|camis?|tunics?|bodysuits?|knitwear|parkas?|puffers?|anoraks?|gilets?)\b/.test(
        t,
      )
    )
      return 'top'
    if (/\b(jeans?|pants?|trousers?|chinos?|shorts?|skirts?|leggings?|joggers?|sweatpants|culottes?|slacks|bottoms?)\b/.test(t))
      return 'bottom'
    return 'unknown'
  }
  const fromCategory = classify(product.category)
  return fromCategory !== 'unknown' ? fromCategory : classify(product.name)
}

function classifyFit(text: string): FitKey | null {
  const t = text.toLowerCase()
  if (/oversized?|boxy|drop[\s-]?shoulder/.test(t)) return 'oversized'
  if (/relaxed|loose|baggy|roomy|wide[\s-]?leg|easy fit/.test(t)) return 'relaxed'
  if (/slim|skinny|fitted|tailored|body[\s-]?con|tight|figure[\s-]?hugging/.test(t)) return 'fitted'
  if (/regular|classic|standard|straight|true to size|comfort fit/.test(t)) return 'regular'
  return null
}

function detectGarmentFit(product: ProductInput): GarmentFit | null {
  if (product.fit) {
    const key = classifyFit(product.fit)
    if (key) return { key, source: 'fit field' }
  }
  // Fall back to explicit fit language in the listing, but only unambiguous phrases.
  const text = `${product.name ?? ''}. ${product.description ?? ''}`
  const phrase = text.match(
    /\b(oversized|boxy|(?:relaxed|loose|slim|skinny|tailored|regular|classic|straight|fitted)[\s-]*(?:fit|cut|leg|silhouette)|true to size)\b/i,
  )
  const key = phrase ? classifyFit(phrase[0]) : null
  return key ? { key, source: 'listing text' } : null
}

export function primaryKeys(category: Category): MeasureKey[] {
  if (category === 'top') return ['chest']
  if (category === 'bottom') return ['waist', 'hip']
  return ['chest', 'waist', 'hip']
}

type ChartMatch = {
  baseRow: ChartRow
  keysUsed: MeasureKey[]
  keysMissing: MeasureKey[]
  outOfRange: { key: MeasureKey; direction: 'above' | 'below'; byCm: number } | null
  bodyValues: Partial<Record<MeasureKey, number>>
}

// For each measurement pick the size row that fits it best, then take the
// largest of those rows ("size to your biggest measurement").
function matchChart(
  chart: ParsedChart,
  body: Partial<Record<MeasureKey, number>>,
  category: Category,
): ChartMatch | null {
  const wanted = primaryKeys(category)
  const keysUsed = wanted.filter((k) => body[k] !== undefined && chart.rows.some((r) => r[k]))
  if (keysUsed.length === 0) return null

  let baseIdx = -1
  let outOfRange: ChartMatch['outOfRange'] = null
  for (const key of keysUsed) {
    const u = body[key] as number
    const candidates = chart.rows
      .map((row, idx) => ({ idx, range: row[key] }))
      .filter((c): c is { idx: number; range: { lo: number; hi: number } } => c.range !== undefined)

    const containing = candidates.filter((c) => u >= c.range.lo - 0.5 && u <= c.range.hi + 0.5)
    let best: number
    if (containing.length > 0) {
      const dist = (c: (typeof containing)[number]) => Math.abs(u - (c.range.lo + c.range.hi) / 2)
      best = containing.reduce((a, b) => (dist(b) < dist(a) || (dist(b) === dist(a) && b.idx > a.idx) ? b : a)).idx
    } else {
      const edge = (c: (typeof candidates)[number]) => (u < c.range.lo ? c.range.lo - u : u - c.range.hi)
      best = candidates.reduce((a, b) => (edge(b) < edge(a) || (edge(b) === edge(a) && b.idx > a.idx) ? b : a)).idx
      const gap = edge(candidates.find((c) => c.idx === best) as (typeof candidates)[number])
      const last = candidates[candidates.length - 1]
      const first = candidates[0]
      if (gap > 4 && (best === last.idx || best === first.idx)) {
        const direction = best === last.idx && u > last.range.hi ? 'above' : 'below'
        if (!outOfRange || gap > outOfRange.byCm) outOfRange = { key, direction, byCm: Math.round(gap * 10) / 10 }
      }
    }
    baseIdx = Math.max(baseIdx, best)
  }

  return {
    baseRow: chart.rows[baseIdx],
    keysUsed,
    keysMissing: wanted.filter((k) => !keysUsed.includes(k)),
    outOfRange,
    bodyValues: body,
  }
}

// Scale used for stepping up/down. Alpha sizes step through contiguous ranks
// (so a missing "M" in a retailer's list doesn't get skipped over); numeric
// sizes step through the sizes the product actually offers.
function buildScale(kind: SizeToken['kind'], productTokens: SizeToken[], base: SizeToken): number[] {
  const values = [...productTokens.filter((t) => t.kind === kind).map((t) => t.value), base.value]
  const min = Math.min(...values)
  const max = Math.max(...values)
  if (kind === 'alpha') {
    const lo = productTokens.length === 0 ? Math.min(min, -3) : min
    const hi = productTokens.length === 0 ? Math.max(max, 5) : max
    return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i)
  }
  return [...new Set(values)].sort((a, b) => a - b)
}

export function computeFitRecommendation(
  profile: BodyProfileInput | null,
  product: ProductInput,
): FitRecommendation {
  if (profile === null) return { status: 'no_profile' }

  const body: Partial<Record<MeasureKey, number>> = {
    chest: validMeasurement(profile.bustChestCm, 60, 180),
    waist: validMeasurement(profile.waistCm, 45, 170),
    hip: validMeasurement(profile.hipCm, 60, 190),
  }
  const category = detectCategory(product)
  const garment = detectGarmentFit(product)
  const usualRaw = profile.usualClothingSize?.trim() || undefined
  const usual = usualRaw ? parseSize(usualRaw) : null
  const listedRaw = (product.availableSizes ?? []).map((s) => s.trim()).filter(Boolean)

  if (listedRaw.length > 0 && listedRaw.every(isOneSizeLabel)) {
    return {
      status: 'insufficient_data',
      message: 'This item is sold in a single size, so there is no size to choose between.',
    }
  }

  const listed = listedRaw
    .map((raw) => ({ raw, token: parseSize(raw) }))
    .filter((s): s is { raw: string; token: SizeToken } => s.token !== null)

  // ---- Read the size chart ----
  const details: string[] = []
  let match: ChartMatch | null = null
  let chart: ParsedChart | null = null
  let chartProblem: string | null = null

  if (!product.sizeChart) {
    chartProblem = 'No size chart was found for this item.'
  } else {
    const parsed = parseSizeChart(product.sizeChart)
    if (parsed.status === 'garment') {
      chartProblem =
        "The size chart lists garment measurements, which can't be compared directly with your body measurements."
    } else if (parsed.status === 'unreadable') {
      chartProblem = "We couldn't read the size chart for this item."
    } else {
      chart = parsed.chart
      match = matchChart(chart, body, category)
      if (match === null) {
        chartProblem = "The size chart doesn't include the measurements needed for this type of item."
      }
    }
  }

  // ---- Pick the base (body-matched or usual) size ----
  const productTokens = [...(chart?.rows.map((r) => r.token) ?? []), ...listed.map((l) => l.token)]
  let base: SizeToken
  let basis: 'measurements' | 'usual_size'

  if (match) {
    base = match.baseRow.token
    basis = 'measurements'
  } else if (usual) {
    if (productTokens.length > 0 && !productTokens.some((t) => t.kind === usual.kind)) {
      return {
        status: 'insufficient_data',
        message: `We couldn't match your usual size (${usualRaw}) to this item's sizes (${listedRaw.slice(0, 6).join(', ')}), and there's no readable size chart to convert between them.`,
      }
    }
    base = usual
    basis = 'usual_size'
  } else if (usualRaw) {
    return {
      status: 'insufficient_data',
      message: `We couldn't interpret your usual size ("${usualRaw}"), and this item has no readable size chart to go by. Try updating your profile with a size like M or 10.`,
    }
  } else {
    return {
      status: 'insufficient_data',
      message:
        'This item has no readable size chart, and your profile has no usual clothing size to fall back on. Add your usual size to your profile to get a recommendation.',
    }
  }

  // ---- Fit-preference adjustment ----
  // Size up when the person wants more room than the cut provides; size down
  // only when the cut is already relaxed/oversized. A regular/slim cut is never
  // sized down — that would mean negative ease.
  const prefStep = FIT_STEP[profile.preferredFit]
  const garmentStep = garment ? FIT_STEP[garment.key] : null
  let wantedOffset = 0
  if (garmentStep !== null) {
    const raw = prefStep - garmentStep
    wantedOffset = raw > 0 ? 1 : garmentStep >= 2 ? Math.max(raw, -1) : 0
  }

  const scale = buildScale(base.kind, productTokens, base)
  const baseIdx = scale.indexOf(base.value)
  const idealIdx = clamp(baseIdx + wantedOffset, 0, scale.length - 1)
  const appliedOffset = idealIdx - baseIdx
  const idealValue = scale[idealIdx]

  // ---- Availability ----
  const listedSameKind = listed.filter((l) => l.token.kind === base.kind)
  const inChart = chart?.rows.find((r) => r.token.kind === base.kind && r.token.value === idealValue)
  const inListed = listedSameKind.find((l) => l.token.value === idealValue)
  const recommendedSize =
    inListed?.raw ??
    inChart?.label ??
    (idealValue === base.value && basis === 'usual_size'
      ? (usualRaw as string)
      : tokenCanonicalLabel({ ...base, value: idealValue }))

  let availability: 'available' | 'unavailable' | 'unknown' = 'unknown'
  let closest: { raw: string; token: SizeToken } | null = null
  if (listedSameKind.length > 0) {
    if (inListed) {
      availability = 'available'
    } else {
      availability = 'unavailable'
      closest = listedSameKind.reduce((a, b) => {
        const da = Math.abs(scale.indexOf(a.token.value) - idealIdx)
        const db = Math.abs(scale.indexOf(b.token.value) - idealIdx)
        return db < da || (db === da && b.token.value > a.token.value) ? b : a
      })
    }
  }
  const closestDirection = closest
    ? closest.token.value > idealValue
      ? ('larger' as const)
      : ('smaller' as const)
    : null

  // ---- Likely fit ----
  const likelyStep = clamp((garmentStep ?? 1) + appliedOffset, 0, 3)
  const likelyFit = FIT_BY_STEP[likelyStep]

  // ---- Confidence (data quality, not statistics) ----
  let confidence: Confidence = 'low'
  const usualAgrees = usual !== null && match !== null && usual.kind === base.kind && usual.value === base.value
  const usualDisagrees = usual !== null && match !== null && usual.kind === base.kind && usual.value !== base.value
  if (basis === 'measurements' && match && chart) {
    confidence = 'high'
    const order: Confidence[] = ['high', 'medium', 'low']
    const demote = (to: Confidence) => {
      if (order.indexOf(to) > order.indexOf(confidence)) confidence = to
    }
    if (match.keysMissing.length > 0) demote('medium')
    if (chart.unitsInferred) demote('medium')
    if (category === 'unknown') demote('medium')
    if (usualDisagrees) demote('medium')
    if (match.outOfRange) demote('low')
  }

  // ---- Explanation ----
  const sizeLabel = recommendedSize
  const explanationParts: string[] = []
  if (basis === 'measurements' && match) {
    const signals = [
      `your ${listSentence(match.keysUsed.map((k) => MEASURE_NAME[k]))} measurement${match.keysUsed.length > 1 ? 's' : ''}`,
      "this retailer's size chart",
    ]
    if (garment) signals.push("the item's stated fit")
    if (appliedOffset !== 0) signals.push('your fit preference')
    explanationParts.push(`Based on ${listSentence(signals)}, ${sizeLabel} is the closest match.`)
    if (usualAgrees) explanationParts.push('It also matches the size you usually wear.')
    if (usualDisagrees) {
      explanationParts.push(
        `You usually wear ${usualRaw}, but this chart puts your measurements closer to ${match.baseRow.label}.`,
      )
    }
  } else {
    explanationParts.push(
      `We couldn't find enough sizing information for this item, so this recommendation is mainly based on your usual clothing size (${usualRaw}).`,
    )
  }
  if (appliedOffset !== 0 && garment) {
    explanationParts.push(
      `This item is cut ${FIT_LABEL[garment.key]} and you prefer a ${FIT_LABEL[profile.preferredFit]} fit, so we went ${appliedOffset > 0 ? 'up' : 'down'} a size.`,
    )
  } else if (!garment) {
    explanationParts.push("This item doesn't state its fit, so we assumed a standard cut.")
  } else if (garment.key === 'oversized' || garment.key === 'relaxed') {
    explanationParts.push(`This item is cut ${FIT_LABEL[garment.key]}, so expect extra room.`)
  }

  // ---- Details (what we used / caveats) ----
  if (match) {
    details.push(
      `Size chart: compared your ${match.keysUsed.map((k) => `${MEASURE_NAME[k]} (${cm(match.bodyValues[k] as number)})`).join(', ')}.`,
    )
    if (match.keysMissing.length > 0) {
      details.push(
        `Not compared: ${match.keysMissing.map((k) => MEASURE_NAME[k]).join(', ')} (missing from the chart or your profile).`,
      )
    }
    if (chart?.unitsInferred) details.push("Chart units weren't labelled, so we inferred them from the values.")
    if (match.outOfRange) {
      details.push(
        `Your ${MEASURE_NAME[match.outOfRange.key]} is ${cm(match.outOfRange.byCm)} ${match.outOfRange.direction === 'above' ? 'above the largest' : 'below the smallest'} size on this chart, so the fit may be off.`,
      )
    }
    if (category === 'unknown') details.push("We couldn't tell what type of garment this is, so we used every measurement available.")
  } else if (chartProblem) {
    details.push(chartProblem)
  }
  details.push(
    garment
      ? `Item fit: ${FIT_LABEL[garment.key]} (from the ${garment.source}).`
      : 'Item fit: not stated, so a standard cut was assumed.',
  )
  details.push(`Your fit preference: ${FIT_LABEL[profile.preferredFit]}.`)
  if (appliedOffset !== 0) details.push(`Size adjustment: ${appliedOffset > 0 ? 'one size up' : 'one size down'}.`)
  if (basis === 'usual_size' && usualRaw && /^(us|uk|eu|fr|it|au|nz|jp|cn|de)\b/i.test(usualRaw) && base.kind === 'numeric') {
    details.push(`We assumed this item's numeric sizes use the same system as your "${usualRaw}".`)
  }
  if (availability === 'unavailable' && closest) {
    details.push(
      `${sizeLabel} isn't listed among this item's available sizes; the closest listed size is ${closest.raw}, which will fit ${closestDirection === 'larger' ? 'roomier' : 'closer'}.`,
    )
  }
  if (listedRaw.length === 0) details.push("This page didn't list available sizes, so we couldn't check availability.")

  // Per-measurement checks: only when the size was chosen from a chart and the recommended size has a row on it.
  const MEASURE_LABEL = { chest: 'bust', waist: 'waist', hip: 'hip' } as const
  const checks: FitCheck[] = []
  if (basis === 'measurements' && match && inChart) {
    for (const key of match.keysUsed) {
      const range = inChart[key]
      const yours = match.bodyValues[key]
      if (!range || yours === undefined) continue
      const state = yours < range.lo - 0.5 ? 'roomy' : yours > range.hi + 0.5 ? 'snug' : 'fits'
      checks.push({ measure: MEASURE_LABEL[key], state, yourCm: yours, lo: range.lo, hi: range.hi })
    }
  }
  const notCompared = match ? match.keysMissing.map((k) => MEASURE_LABEL[k]) : []

  return {
    status: 'ok',
    recommendedSize: sizeLabel,
    basis,
    availability,
    closestAvailableSize: closest?.raw ?? null,
    closestAvailableDirection: closestDirection,
    likelyFit,
    confidence,
    explanation: explanationParts.join(' '),
    details,
    checks,
    notCompared,
  }
}

function listSentence(items: string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}
