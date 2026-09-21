import assert from 'node:assert/strict'
import { parseSizeChart } from '../convex/lib/sizeParsing'
import { computeFitRecommendation } from '../convex/lib/fitRecommendation'

let passed = 0
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log('  ok  ', name) } catch (e) { console.log('  FAIL', name, '\n      ', (e as Error).message); process.exitCode = 1 }
}

console.log('shoe sizes / foot length are never a body-measurement chart (real Allbirds model outputs)')
test('column of numeric EU shoe sizes', () => {
  const t = `| Size |\n| --- |\n| 40 |\n| 41 |\n| 42 |\n| 43 |\n| 44 |`
  assert.equal(parseSizeChart(t).status, 'unreadable')
})
test('foot length table (run 1)', () => {
  const t = `| Size | Foot Length |\n|------|-------------|\n| 8    | 25.4 cm     |\n| 9    | 26.0 cm     |\n| 10   | 26.7 cm     |\n| 11   | 27.3 cm     |`
  assert.equal(parseSizeChart(t).status, 'unreadable')
})
test('size + EU size + foot length table (run 3)', () => {
  const t = `| Size | EU Size | Foot Length |\n|------|---------|-------------|\n| 8 | 41 | 26.0 cm |\n| 8.5 | 41.5 | 26.5 cm |\n| 9 | 42 | 27.0 cm |`
  assert.equal(parseSizeChart(t).status, 'unreadable')
})
test('generic Length table (Zara run 2) is unreadable', () => {
  const t = `| Size | Length |\n|  S | 123–126 cm |\n|  M | 126–129 cm |\n|  L | 129–132 cm |`
  assert.equal(parseSizeChart(t).status, 'unreadable')
})
test('a table headed "Range" (Zara run 3) has no bust/waist/hip heading => unreadable', () => {
  const t = `| Size | Range |\n|------|-------|\n| 36 | 86–90 |\n| 38 | 91–95 |\n| 40 | 96–100 |`
  assert.equal(parseSizeChart(t).status, 'unreadable')
})

console.log('\nthe stored tee chart (with its "Size guide:" source line) is consumed unchanged by the recommender')
const TEE_CHART = `Size guide: https://girlfriend.com/pages/sizing
|     | **Bust** |
| --- | --- |
| XXS | 29" - 31" |
| XS  | 31" - 33" |
| S   | 33" - 35" |
| M   | 35" - 37 1/2" |
| L   | 37 1/2" - 40 1/2" |
| XL  | 40 1/2" - 43" |
| XXL | 43" - 46 1/2" |
| XXXL| 46 1/2" - 50" |
| 4XL | 50" - 53 1/2" |
| 5XL | 53 1/2" - 57" |
| 6XL | 57" - 60 1/2" |`
test('source line does not disturb parsing (11 rows, inches, no inference)', () => {
  const r = parseSizeChart(TEE_CHART)
  assert.equal(r.status, 'ok')
  if (r.status !== 'ok') return
  assert.equal(r.chart.rows.length, 11)
  assert.equal(r.chart.unitsInferred, false)
  assert.deepEqual(r.chart.rows.find((x) => x.label === 'M')!.chest, { lo: 88.9, hi: 95.3 })
})
test('recommender uses the linked-page Bust chart for the tee (measurement basis)', () => {
  const rec: any = computeFitRecommendation(
    { bustChestCm: 92, waistCm: 72, hipCm: 98, usualClothingSize: 'M', preferredFit: 'regular' },
    { name: 'Black Reset Baby Tee', category: 'T-shirt', fit: 'Relaxed', availableSizes: ['S', 'M', 'L', 'XL'], sizeChart: TEE_CHART },
  )
  assert.equal(rec.status, 'ok')
  assert.equal(rec.basis, 'measurements')
  assert.equal(rec.confidence, 'high')
  console.log('        ->', rec.recommendedSize, '|', rec.confidence, '|', rec.explanation)
})
console.log(`\n${passed} passed`)
