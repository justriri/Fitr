// Pure helpers for reading size labels and free-text size charts. Firecrawl
// hands us `sizeChart` as an LLM-written text/markdown summary, so this is
// deliberately forgiving about layout (markdown tables, transposed tables,
// one-size-per-line text) but strict about sanity: anything that doesn't look
// like a plausible human body measurement is dropped rather than guessed at.

export type SizeToken = {
  label: string
  kind: 'alpha' | 'numeric'
  // alpha: M = 0, L = 1, XL = 2, XXL = 3, S = -1, XS = -2 ... numeric: the number itself.
  value: number
}

export type MeasureKey = 'chest' | 'waist' | 'hip'
export type Range = { lo: number; hi: number }
export type ChartRow = { label: string; token: SizeToken } & Partial<Record<MeasureKey, Range>>
export type ParsedChart = { rows: ChartRow[]; unitsInferred: boolean }
export type ChartParseResult =
  | { status: 'ok'; chart: ParsedChart }
  | { status: 'unreadable' }
  | { status: 'garment' }

const CM_PER_INCH = 2.54

const WORD_REPLACEMENTS: Array<[RegExp, string]> = [
  [/EXTRA[\s-]*EXTRA[\s-]*LARGE/g, 'XXL'],
  [/EXTRA[\s-]*EXTRA[\s-]*SMALL/g, 'XXS'],
  [/EXTRA[\s-]*LARGE|X-LARGE/g, 'XL'],
  [/EXTRA[\s-]*SMALL|X-SMALL/g, 'XS'],
  [/\bSMALL\b/g, 'S'],
  [/\bMEDIUM\b/g, 'M'],
  [/\bLARGE\b/g, 'L'],
]

const REGION_PREFIX = /^(?:US|UK|EU|FR|IT|AU|NZ|JP|CN|DE)\s*/

export function isOneSizeLabel(raw: string): boolean {
  return /one[\s-]*size|free[\s-]*size|^os$|^o\/s$/i.test(raw.trim())
}

// "M", "XL", "2XL", "Medium", "UK 10", "W32", "32/34" -> a comparable token.
// Combined sizes such as "S/M" and non-sizes return null.
export function parseSize(raw: string): SizeToken | null {
  let s = raw.trim().toUpperCase()
  if (s === '' || isOneSizeLabel(s)) return null
  s = s.replace(/^SIZE\s*[:-]?\s*/, '')
  for (const [re, replacement] of WORD_REPLACEMENTS) s = s.replace(re, replacement)
  s = s.replace(REGION_PREFIX, '').trim()

  const alpha = s.match(/^(\d)?(X{0,3})([SML])(?![A-Z/])/)
  if (alpha && !(alpha[1] && !alpha[2])) {
    const x = alpha[1] ? Number(alpha[1]) : alpha[2].length
    const letter = alpha[3]
    const value = letter === 'M' ? 0 : letter === 'L' ? 1 + x : -1 - x
    return { label: raw.trim(), kind: 'alpha', value }
  }

  const numeric = s.match(/^[A-Z]{0,2}\s*(\d{1,2}(?:\.5)?)(?!\d)/)
  if (numeric) {
    const value = Number(numeric[1])
    if (value <= 70) return { label: raw.trim(), kind: 'numeric', value }
  }
  return null
}

export function alphaRankToLabel(rank: number): string {
  if (rank === 0) return 'M'
  if (rank > 0) return rank === 1 ? 'L' : rank === 2 ? 'XL' : rank === 3 ? 'XXL' : `${rank - 1}XL`
  return rank === -1 ? 'S' : rank === -2 ? 'XS' : rank === -3 ? 'XXS' : `${-rank - 1}XS`
}

export function tokenCanonicalLabel(token: SizeToken): string {
  return token.kind === 'alpha' ? alphaRankToLabel(token.value) : String(token.value)
}

// ---- Size chart parsing ----

type Unit = 'cm' | 'in'
type Candidate = { lo: number; hi: number; unit?: Unit }

const SANE: Record<MeasureKey, Range> = {
  chest: { lo: 60, hi: 180 },
  waist: { lo: 45, hi: 170 },
  hip: { lo: 60, hi: 190 },
}

const KEY_PATTERNS: Array<[MeasureKey, RegExp]> = [
  ['chest', /bust|chest/i],
  ['waist', /waist/i],
  ['hip', /hip/i],
]

function keyOf(cell: string): MeasureKey | null {
  if (/under[\s-]?bust/i.test(cell)) return null
  for (const [key, re] of KEY_PATTERNS) if (re.test(cell)) return key
  return null
}

function detectUnit(s: string): Unit | null {
  const hasCm = /\bcm\b|centimet/i.test(s)
  const hasIn = /inch|\(\s*in\s*\)|\d\s*(?:in\b|["”″])/i.test(s)
  if (hasCm && !hasIn) return 'cm'
  if (hasIn && !hasCm) return 'in'
  return null
}

function normalizeNumbers(s: string): string {
  return s
    .replace(/[–—−]/g, '-')
    .replace(/(\d)\s*½/g, '$1.5')
    .replace(/(\d)\s*¼/g, '$1.25')
    .replace(/(\d)\s*¾/g, '$1.75')
    .replace(/(\d+)\s+1\/2/g, '$1.5')
    .replace(/(\d+)\s+1\/4/g, '$1.25')
    .replace(/(\d+)\s+3\/4/g, '$1.75')
    .replace(/(\d),(\d)(?!\d)/g, '$1.$2')
}

const UNIT_MARK = String.raw`(cm|centimet(?:er|re)s?|inches|inch|in(?![a-z])|"|”|″)`
const NUMBER_RANGE = new RegExp(
  String.raw`(\d+(?:\.\d+)?)\s*${UNIT_MARK}?(?:\s*(?:-|to)\s*(\d+(?:\.\d+)?))?\s*${UNIT_MARK}?`,
  'gi',
)

function parseCandidates(text: string, headerUnit?: Unit | null): Candidate[] {
  const out: Candidate[] = []
  for (const m of normalizeNumbers(text).matchAll(NUMBER_RANGE)) {
    const a = Number(m[1])
    const b = m[3] !== undefined ? Number(m[3]) : a
    const mark = m[4] ?? m[2]
    const explicit: Unit | undefined = mark ? (/^c/i.test(mark) ? 'cm' : 'in') : undefined
    out.push({ lo: Math.min(a, b), hi: Math.max(a, b), unit: explicit ?? headerUnit ?? undefined })
  }
  return out
}

function guessUnit(key: MeasureKey, hi: number): Unit {
  // Adult circumferences in cm are almost never below ~55; in inches almost never above ~60.
  return hi <= (key === 'waist' ? 52 : 64) ? 'in' : 'cm'
}

type Accumulator = Map<
  number,
  { token: SizeToken; label: string; cands: Partial<Record<MeasureKey, Candidate[]>> }
>

function addCands(acc: Accumulator, label: string, key: MeasureKey, cands: Candidate[]) {
  if (cands.length === 0) return
  const token = parseSize(label)
  if (!token) return
  // Distinct sizes are keyed by kind+value so duplicate rows/tables merge instead of clobbering.
  const id = token.kind === 'alpha' ? token.value : 1000 + token.value
  let entry = acc.get(id)
  if (!entry) {
    entry = { token, label: label.trim(), cands: {} }
    acc.set(id, entry)
  }
  entry.cands[key] = [...(entry.cands[key] ?? []), ...cands]
}

function splitCells(line: string): string[] | null {
  const sep = line.includes('|') ? '|' : line.includes('\t') ? '\t' : null
  if (!sep) return null
  const cells = line.split(sep).map((c) => c.trim())
  if (cells[0] === '') cells.shift()
  if (cells.length > 0 && cells[cells.length - 1] === '') cells.pop()
  return cells.length >= 2 ? cells : null
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.every((c) => /^:?-{2,}:?$/.test(c) || c === '')
}

function parseTable(rows: string[][]): Accumulator {
  const acc: Accumulator = new Map()

  // Columnar: one row per size, measurement names in the header.
  const headerIdx = rows.findIndex(
    (r, i) => i < 3 && r.some((c, ci) => ci >= 1 && keyOf(c) !== null),
  )
  if (headerIdx >= 0) {
    const header = rows[headerIdx]
    const sizeCol = Math.max(
      0,
      header.findIndex((c) => /^size$/i.test(c.trim())),
    )
    const cols = header
      .map((c, i) => ({ i, key: keyOf(c), unit: detectUnit(c) }))
      .filter((c) => c.key !== null && c.i !== sizeCol)
    for (const row of rows.slice(headerIdx + 1)) {
      const label = row[sizeCol]
      if (!label) continue
      for (const col of cols) {
        addCands(acc, label, col.key as MeasureKey, parseCandidates(row[col.i] ?? '', col.unit))
      }
    }
    return acc
  }

  // Transposed: sizes across the top, one measurement per row.
  const sizeRowIdx = rows.findIndex((r) => r.slice(1).filter((c) => parseSize(c) !== null).length >= 2)
  if (sizeRowIdx >= 0) {
    const sizeRow = rows[sizeRowIdx]
    for (const row of rows) {
      const key = keyOf(row[0] ?? '')
      if (!key) continue
      const unit = detectUnit(row[0])
      for (let i = 1; i < sizeRow.length; i++) {
        if (parseSize(sizeRow[i]) === null) continue
        addCands(acc, sizeRow[i], key, parseCandidates(row[i] ?? '', unit))
      }
    }
  }
  return acc
}

function parseLines(lines: string[]): Accumulator {
  const acc: Accumulator = new Map()
  for (const line of lines) {
    const keywordRe = /\b(bust|chest|waist|hips?)\b/gi
    const hits = [...line.matchAll(keywordRe)].filter(
      (m) => !/under[\s-]?$/i.test(line.slice(Math.max(0, m.index - 7), m.index)),
    )
    if (hits.length === 0) continue
    const head = line.slice(0, hits[0].index)
    const label = head.match(/^\W*(?:size\s*)?([A-Za-z0-9]{1,6})\b/i)?.[1]
    if (!label) continue
    hits.forEach((m, i) => {
      const segment = line.slice(m.index + m[0].length, hits[i + 1]?.index ?? line.length)
      addCands(acc, label, keyOf(m[0]) as MeasureKey, parseCandidates(segment))
    })
  }
  return acc
}

function score(acc: Accumulator): number {
  let s = 0
  for (const e of acc.values()) s += Object.keys(e.cands).length
  return s
}

function finalize(acc: Accumulator, chartUnit: Unit | null): ParsedChart | null {
  let unitsInferred = false
  let rows: ChartRow[] = []

  for (const entry of acc.values()) {
    const row: ChartRow = { label: entry.label, token: entry.token }
    for (const key of Object.keys(entry.cands) as MeasureKey[]) {
      const cands = entry.cands[key] ?? []
      const cm = cands.find((c) => (c.unit ?? chartUnit) === 'cm')
      const inch = cands.find((c) => (c.unit ?? chartUnit) === 'in')
      let pick: Candidate | undefined
      let unit: Unit
      if (cm) {
        pick = cm
        unit = 'cm'
      } else if (inch) {
        pick = inch
        unit = 'in'
      } else {
        pick = cands[0]
        if (!pick) continue
        unit = guessUnit(key, pick.hi)
        unitsInferred = true
      }
      const factor = unit === 'in' ? CM_PER_INCH : 1
      const range = {
        lo: Math.round(pick.lo * factor * 10) / 10,
        hi: Math.round(pick.hi * factor * 10) / 10,
      }
      const sane = SANE[key]
      if (range.lo < sane.lo || range.hi > sane.hi || range.hi - range.lo > 30) continue
      row[key] = range
    }
    if (row.chest || row.waist || row.hip) rows.push(row)
  }

  if (rows.length === 0) return null
  const kind = rows[0].token.kind
  rows = rows.filter((r) => r.token.kind === kind).sort((a, b) => a.token.value - b.token.value)

  // Drop a measurement if it isn't present on 2+ sizes or doesn't grow with size —
  // that means we misread the layout, and a wrong chart is worse than none.
  for (const key of ['chest', 'waist', 'hip'] as MeasureKey[]) {
    const mids = rows.filter((r) => r[key]).map((r) => ((r[key] as Range).lo + (r[key] as Range).hi) / 2)
    const monotonic = mids.every((m, i) => i === 0 || m >= mids[i - 1] - 1)
    if (mids.length < 2 || !monotonic) rows.forEach((r) => delete r[key])
  }
  rows = rows.filter((r) => r.chest || r.waist || r.hip)
  return rows.length >= 2 ? { rows, unitsInferred } : null
}

export function parseSizeChart(text: string): ChartParseResult {
  const isGarmentChart =
    /garment (?:measurements|dimensions)|product (?:measurements|dimensions)|flat measurements|laid flat|pit[\s-]to[\s-]pit/i.test(
      text,
    ) && !/body measurements/i.test(text)
  if (isGarmentChart) return { status: 'garment' }

  const lines = text
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const chartUnit = detectUnit(text)

  // Group consecutive table-looking lines, parse each table, keep the richest one.
  const tables: string[][][] = []
  let current: string[][] = []
  for (const line of lines) {
    const cells = splitCells(line)
    if (cells) {
      if (!isSeparatorRow(cells)) current.push(cells)
    } else if (current.length > 0) {
      tables.push(current)
      current = []
    }
  }
  if (current.length > 0) tables.push(current)

  let best: Accumulator | null = null
  for (const t of tables) {
    const acc = parseTable(t)
    if (best === null || score(acc) > score(best)) best = acc
  }
  if (best === null || score(best) === 0) best = parseLines(lines)

  const chart = finalize(best, chartUnit)
  return chart ? { status: 'ok', chart } : { status: 'unreadable' }
}

// ---- Verifying an LLM-copied chart against the page it came from ----

const numbersOf = (text: string): number[] =>
  [...normalizeNumbers(text).matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]))

const labelOf = (cell: string): string => cell.replace(/[*_`\s:;,.|]/g, '').toUpperCase()

function isSubsequence<T>(needle: T[], haystack: T[]): boolean {
  let i = 0
  for (const h of haystack) if (i < needle.length && h === needle[i]) i++
  return i === needle.length
}

// The model is asked to copy the chart verbatim, but LLMs can still remap or
// invent cells. Every data row must correspond to a real row on the page:
// same size label, and its numbers must appear, in order, in that page row.
// A column the model dropped is fine; a value it made up or shifted is not.
export function verifyChartAgainstPage(table: string, pageMarkdown: string): boolean {
  if (!pageMarkdown) return false

  const toRows = (text: string): string[][] =>
    text
      .replace(/\r/g, '')
      .split('\n')
      .map((line) => splitCells(line) ?? line.trim().split(/\s+/))
      .filter((cells) => cells.length >= 2 && !isSeparatorRow(cells))

  const tableRows = toRows(table)
  const pageRows = toRows(pageMarkdown).map((cells) => ({
    label: labelOf(cells[0]),
    nums: numbersOf(cells.slice(1).join(' ')),
    keys: cells.map(keyOf).filter((k): k is MeasureKey => k !== null),
  }))

  const dataRows = tableRows
    .map((cells) => ({ label: labelOf(cells[0]), nums: numbersOf(cells.slice(1).join(' ')) }))
    .filter((r) => r.nums.length > 0)
  if (dataRows.length < 2) return false

  const verified = dataRows.filter((r) =>
    pageRows.some((p) => p.label === r.label && isSubsequence(r.nums, p.nums)),
  ).length
  if (verified / dataRows.length < 0.8) return false

  // A columnar chart's headings must also exist, in the same order, on the page.
  const header = tableRows.find((cells) => cells.some((c, i) => i >= 1 && keyOf(c) !== null))
  if (header) {
    const keys = header.map(keyOf).filter((k): k is MeasureKey => k !== null)
    if (!pageRows.some((p) => isSubsequence(keys, p.keys))) return false
  }
  return true
}
