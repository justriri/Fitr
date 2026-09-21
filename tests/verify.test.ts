import assert from 'node:assert/strict'
import { parseSizeChart, verifyChartAgainstPage } from '../convex/lib/sizeParsing'

let passed = 0
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log('  ok  ', name) } catch (e) { console.log('  FAIL', name, '\n      ', (e as Error).message); process.exitCode = 1 }
}

// Verbatim from the real girlfriend.com page markdown (surrounded by unrelated page text).
const PAGE = `Close

## BOTTOMS

|     |     |     |
| --- | --- | --- |
|  | **Waist** | **Hip** |
| XXS | 22" - 24" | 32" - 34" |
| XS | 24" - 26" | 34" - 36" |
| S | 26" - 28" | 36" - 39" |
| M | 28" - 30 1/2" | 39" - 41 1/2" |
| L | 30 1/2" - 33" | 41 1/2" - 44" |
| XL | 33" - 35 1/2" | 44" - 46 1/2" |
| XXL | 35 1/2" - 39" | 46 1/2" - 50" |

## FAQS
Are your garments true to size? Yes.`

const FAITHFUL = `| Size | Waist | Hip |
|---|---|---|
| XXS | 22" - 24" | 32" - 34" |
| XS | 24" - 26" | 34" - 36" |
| S | 26" - 28" | 36" - 39" |
| M | 28" - 30 1/2" | 39" - 41 1/2" |
| L | 30 1/2" - 33" | 41 1/2" - 44" |
| XL | 33" - 35 1/2" | 44" - 46 1/2" |
| XXL | 35 1/2" - 39" | 46 1/2" - 50" |`

// Failure mode 1 observed live: bust column fabricated by copying waist.
const FABRICATED_BUST = `| Size | Bust/Chest | Waist | Hip |
|---|---|---|---|
| XXS | 22-24 | 22-24 | 32-34 |
| XS | 24-26 | 24-26 | 34-36 |
| S | 26-28 | 26-28 | 36-39 |
| M | 28-30.5 | 28-30.5 | 39-41.5 |`

// Failure mode 2 observed live: hip values placed in the waist column.
const SHIFTED = `| Size | Waist | Hip |
|---|---|---|
| XXS | 32-34 | 32-34 |
| XS | 34-36 | 34-36 |
| S | 36-39 | 36-39 |
| M | 39-41.5 | 39-41.5 |`

console.log('parsing the real page table')
test('inch-mark ranges with fractions parse; M waist = 28-30.5 in => 71.1-77.5 cm', () => {
  const r = parseSizeChart(FAITHFUL)
  assert.equal(r.status, 'ok')
  if (r.status !== 'ok') return
  assert.equal(r.chart.rows.length, 7)
  assert.equal(r.chart.unitsInferred, false)
  const m = r.chart.rows.find((x) => x.label === 'M')!
  assert.deepEqual(m.waist, { lo: 71.1, hi: 77.5 })
  assert.deepEqual(m.hip, { lo: 99.1, hi: 105.4 })
  assert.equal(m.chest, undefined)
})
test('page markdown itself (unlabelled first header cell, bold headings) also parses', () => {
  const r = parseSizeChart(PAGE)
  assert.equal(r.status, 'ok')
  if (r.status === 'ok') assert.deepEqual(r.chart.rows[0].waist, { lo: 55.9, hi: 61 })
})

console.log('verifying against the page')
test('faithful copy verifies', () => assert.equal(verifyChartAgainstPage(FAITHFUL, PAGE), true))
test('copy that drops a column still verifies (waist only)', () => {
  const waistOnly = `| Size | Waist |\n|---|---|\n| XXS | 22" - 24" |\n| XS | 24" - 26" |\n| S | 26" - 28" |`
  assert.equal(verifyChartAgainstPage(waistOnly, PAGE), true)
})
test('reformatted numbers (30 1/2 -> 30.5, dash styles) still verify', () => {
  const reformatted = `| Size | Waist | Hip |\n|---|---|---|\n| XXS | 22-24 | 32-34 |\n| XS | 24–26 | 34–36 |\n| S | 26-28 | 36-39 |\n| M | 28-30.5 | 39-41.5 |`
  assert.equal(verifyChartAgainstPage(reformatted, PAGE), true)
})
test('fabricated bust column (copied waist) is rejected', () => assert.equal(verifyChartAgainstPage(FABRICATED_BUST, PAGE), false))
test('hip values shifted into the waist column are rejected', () => assert.equal(verifyChartAgainstPage(SHIFTED, PAGE), false))
test('a single wrong value in every row is rejected', () => {
  const wrong = FAITHFUL.replace(/22" - 24"/, '23" - 24"').replace(/24" - 26"/, '25" - 26"').replace(/26" - 28"/, '27" - 28"').replace(/28" - 30 1\/2"/, '29" - 30 1/2"')
  assert.equal(verifyChartAgainstPage(wrong, PAGE), false)
})
test('heading not on the page (Bust added) is rejected even if numbers exist', () => {
  const t = `| Size | Bust | Waist | Hip |\n|---|---|---|---|\n| XXS | 22" - 24" | 22" - 24" | 32" - 34" |\n| XS | 24" - 26" | 24" - 26" | 34" - 36" |`
  assert.equal(verifyChartAgainstPage(t, PAGE), false)
})
test('no page markdown => cannot verify => rejected', () => assert.equal(verifyChartAgainstPage(FAITHFUL, ''), false))
test('chart from a different product/page is rejected', () => {
  const other = `## Sizing\n| Size | Waist | Hip |\n|---|---|---|\n| S | 70-74 | 96-100 |\n| M | 75-79 | 101-105 |`
  assert.equal(verifyChartAgainstPage(FAITHFUL, other), false)
})
test('text-line pages (no pipes) verify a pipe copy', () => {
  const linePage = `S: Bust 82-86 cm, Waist 64-68 cm, Hip 90-94 cm\nM: Bust 86-92 cm, Waist 68-74 cm, Hip 94-100 cm\nL: Bust 92-98 cm, Waist 74-80 cm, Hip 100-106 cm`
  const copy = `| Size | Bust | Waist | Hip |\n|---|---|---|---|\n| S | 82-86 | 64-68 | 90-94 |\n| M | 86-92 | 68-74 | 94-100 |\n| L | 92-98 | 74-80 | 100-106 |`
  assert.equal(verifyChartAgainstPage(copy, linePage), true)
})
console.log(`\n${passed} passed`)
