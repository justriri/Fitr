import assert from 'node:assert/strict'
import { computeFitRecommendation } from '../convex/lib/fitRecommendation'
import { parseSize, parseSizeChart } from '../convex/lib/sizeParsing'

let passed = 0
function test(name: string, fn: () => void) {
  try {
    fn()
    passed++
    console.log('  ok  ', name)
  } catch (e) {
    console.log('  FAIL', name, '\n      ', (e as Error).message)
    process.exitCode = 1
  }
}

// Woman: bust 90, waist 72, hip 98, usually M, regular fit.
const profile = { bustChestCm: 90, waistCm: 72, hipCm: 98, usualClothingSize: 'M', preferredFit: 'regular' as const }
const CM_TABLE = `| Size | Bust (cm) | Waist (cm) | Hip (cm) |
|---|---|---|---|
| XS | 78-82 | 60-64 | 86-90 |
| S | 82-86 | 64-68 | 90-94 |
| M | 86-92 | 68-74 | 94-100 |
| L | 92-98 | 74-80 | 100-106 |
| XL | 98-104 | 80-86 | 106-112 |`

function ok(r: ReturnType<typeof computeFitRecommendation>) {
  assert.equal(r.status, 'ok', JSON.stringify(r))
  return r as Extract<typeof r, { status: 'ok' }>
}

console.log('parsing')
test('parseSize alpha/numeric/regional', () => {
  assert.equal(parseSize('M')?.value, 0)
  assert.equal(parseSize('XL')?.value, 2)
  assert.equal(parseSize('2XL')?.value, 3)
  assert.equal(parseSize('XXL')?.value, 3)
  assert.equal(parseSize('XS')?.value, -2)
  assert.equal(parseSize('Medium')?.value, 0)
  assert.equal(parseSize('UK 10')?.value, 10)
  assert.equal(parseSize('W32 L34')?.value, 32)
  assert.equal(parseSize('S/M'), null)
  assert.equal(parseSize('One Size'), null)
})
test('columnar cm table', () => {
  const r = parseSizeChart(CM_TABLE)
  assert.equal(r.status, 'ok')
  if (r.status === 'ok') {
    assert.equal(r.chart.rows.length, 5)
    assert.deepEqual(r.chart.rows[2].chest, { lo: 86, hi: 92 })
    assert.equal(r.chart.unitsInferred, false)
  }
})
test('inch table converts to cm', () => {
  const r = parseSizeChart(`| Size | Bust (in) | Waist (in) |\n|--|--|--|\n| S | 32-34 | 25-27 |\n| M | 34-36 | 27-29 |\n| L | 36-38 | 29-31 |`)
  assert.equal(r.status, 'ok')
  if (r.status === 'ok') assert.deepEqual(r.chart.rows[1].chest, { lo: 86.4, hi: 91.4 })
})
test('unlabeled units inferred by magnitude', () => {
  const r = parseSizeChart(`| Size | Chest | Waist |\n|--|--|--|\n| S | 34-36 | 28-30 |\n| M | 38-40 | 32-34 |\n| L | 42-44 | 36-38 |`)
  assert.equal(r.status, 'ok')
  if (r.status === 'ok') {
    assert.equal(r.chart.unitsInferred, true)
    assert.ok(Math.abs((r.chart.rows[0].chest?.lo ?? 0) - 86.4) < 0.2)
  }
})
test('dual-unit cell prefers cm', () => {
  const r = parseSizeChart(`| Size | Chest |\n|--|--|\n| S | 34-36 in (86-91 cm) |\n| M | 38-40 in (97-102 cm) |`)
  assert.equal(r.status, 'ok')
  if (r.status === 'ok') assert.deepEqual(r.chart.rows[0].chest, { lo: 86, hi: 91 })
})
test('transposed table', () => {
  const r = parseSizeChart(`| Size | S | M | L |\n|--|--|--|--|\n| Chest (cm) | 86-91 | 92-97 | 98-103 |\n| Waist (cm) | 70-75 | 76-81 | 82-87 |`)
  assert.equal(r.status, 'ok')
  if (r.status === 'ok') assert.deepEqual(r.chart.rows[1].waist, { lo: 76, hi: 81 })
})
test('one-size-per-line text', () => {
  const r = parseSizeChart(`S: Chest 86-91 cm, Waist 70-75 cm\nM: Chest 92-97 cm, Waist 76-81 cm\nL: Chest 98-103 cm, Waist 82-87 cm`)
  assert.equal(r.status, 'ok')
  if (r.status === 'ok') assert.equal(r.chart.rows.length, 3)
})
test('garment-measurement chart is refused, not misused', () => {
  assert.equal(parseSizeChart(`Garment measurements (flat):\n| Size | Chest |\n| S | 50 |\n| M | 53 |`).status, 'garment')
})
test('nonsense chart is unreadable', () => {
  assert.equal(parseSizeChart('Sizes run small. See model info.').status, 'unreadable')
})

console.log('recommendations')
test('no profile', () => {
  assert.equal(computeFitRecommendation(null, { availableSizes: ['S', 'M'] }).status, 'no_profile')
})
test('chart + all measurements => M, high confidence, available', () => {
  const r = ok(computeFitRecommendation(profile, { category: 'Dress', fit: 'regular', availableSizes: ['XS', 'S', 'M', 'L', 'XL'], sizeChart: CM_TABLE }))
  assert.equal(r.recommendedSize, 'M')
  assert.equal(r.basis, 'measurements')
  assert.equal(r.confidence, 'high')
  assert.equal(r.availability, 'available')
  assert.equal(r.likelyFit, 'regular')
})
test('biggest measurement wins (hip in L => L for a dress)', () => {
  const r = ok(computeFitRecommendation({ ...profile, hipCm: 103 }, { category: 'dress', fit: 'regular', sizeChart: CM_TABLE, availableSizes: ['S', 'M', 'L'] }))
  assert.equal(r.recommendedSize, 'L')
})
test('top uses chest only', () => {
  const r = ok(computeFitRecommendation({ ...profile, hipCm: 110 }, { category: 't-shirt', fit: 'regular', sizeChart: CM_TABLE, availableSizes: ['S', 'M', 'L'] }))
  assert.equal(r.recommendedSize, 'M')
})
test('usual size unavailable => ideal stays M, closest listed offered', () => {
  const r = ok(computeFitRecommendation(profile, { category: 'top', fit: 'regular', sizeChart: CM_TABLE, availableSizes: ['XS', 'S', 'L'] }))
  assert.equal(r.recommendedSize, 'M')
  assert.equal(r.availability, 'unavailable')
  assert.equal(r.closestAvailableSize, 'L') // tie between S and L => larger
  assert.equal(r.closestAvailableDirection, 'larger')
})
test('slim cut + regular preference => size up, likely fit regular', () => {
  const r = ok(computeFitRecommendation(profile, { category: 'top', fit: 'slim fit', sizeChart: CM_TABLE, availableSizes: ['S', 'M', 'L'] }))
  assert.equal(r.recommendedSize, 'L')
  assert.equal(r.likelyFit, 'regular')
})
test('oversized cut + regular preference => size down, likely fit relaxed', () => {
  const r = ok(computeFitRecommendation(profile, { category: 'hoodie', fit: 'Oversized', sizeChart: CM_TABLE, availableSizes: ['S', 'M', 'L'] }))
  assert.equal(r.recommendedSize, 'S')
  assert.equal(r.likelyFit, 'relaxed')
})
test('oversized cut + oversized preference => stay at body size', () => {
  const r = ok(computeFitRecommendation({ ...profile, preferredFit: 'oversized' }, { category: 'hoodie', fit: 'Oversized', sizeChart: CM_TABLE }))
  assert.equal(r.recommendedSize, 'M')
  assert.equal(r.likelyFit, 'oversized')
})
test('fitted preference never sizes down a regular cut', () => {
  const r = ok(computeFitRecommendation({ ...profile, preferredFit: 'fitted' }, { category: 'top', fit: 'regular', sizeChart: CM_TABLE }))
  assert.equal(r.recommendedSize, 'M')
})
test('legacy "relaxed" preference still works', () => {
  const r = ok(computeFitRecommendation({ ...profile, preferredFit: 'relaxed' }, { category: 'top', fit: 'regular', sizeChart: CM_TABLE }))
  assert.equal(r.recommendedSize, 'L')
})
test('no chart => usual size, low confidence, honest wording', () => {
  const r = ok(computeFitRecommendation(profile, { category: 'top', availableSizes: ['S', 'M', 'L'] }))
  assert.equal(r.basis, 'usual_size')
  assert.equal(r.confidence, 'low')
  assert.equal(r.recommendedSize, 'M')
  assert.match(r.explanation, /mainly based on your usual clothing size/)
  assert.ok(r.details.some((d) => /No size chart/.test(d)))
})
test('no sizes and no chart => still falls back to usual size, availability unknown', () => {
  const r = ok(computeFitRecommendation(profile, { category: 'top' }))
  assert.equal(r.recommendedSize, 'M')
  assert.equal(r.availability, 'unknown')
  assert.equal(r.confidence, 'low')
})
test('older profile without usual size + chart => measurement based', () => {
  const { usualClothingSize: _u, ...older } = profile
  const r = ok(computeFitRecommendation(older, { category: 'dress', sizeChart: CM_TABLE, availableSizes: ['S', 'M', 'L'] }))
  assert.equal(r.recommendedSize, 'M')
  assert.equal(r.confidence, 'high')
})
test('older profile without usual size + no chart => insufficient_data', () => {
  const { usualClothingSize: _u, ...older } = profile
  assert.equal(computeFitRecommendation(older, { availableSizes: ['S', 'M'] }).status, 'insufficient_data')
})
test('usual size disagrees with chart => medium confidence, chart wins', () => {
  const r = ok(computeFitRecommendation({ ...profile, usualClothingSize: 'S' }, { category: 'dress', fit: 'regular', sizeChart: CM_TABLE, availableSizes: ['S', 'M', 'L'] }))
  assert.equal(r.recommendedSize, 'M')
  assert.equal(r.confidence, 'medium')
  assert.match(r.explanation, /You usually wear S/)
})
test('missing waist/hip in profile => partial coverage, medium', () => {
  const r = ok(computeFitRecommendation({ ...profile, waistCm: 0, hipCm: NaN }, { category: 'dress', sizeChart: CM_TABLE, availableSizes: ['S', 'M', 'L'] }))
  assert.equal(r.recommendedSize, 'M')
  assert.equal(r.confidence, 'medium')
})
test('measurements far above chart => low confidence and warning', () => {
  const r = ok(computeFitRecommendation({ ...profile, bustChestCm: 120 }, { category: 'top', sizeChart: CM_TABLE, availableSizes: ['S', 'M', 'L', 'XL'] }))
  assert.equal(r.recommendedSize, 'XL')
  assert.equal(r.confidence, 'low')
  assert.ok(r.details.some((d) => /above the largest/.test(d)))
})
test('XS-XXL scale with 2XL labels', () => {
  const r = ok(computeFitRecommendation({ ...profile, usualClothingSize: 'XL' }, { category: 'top', availableSizes: ['XS', 'S', 'M', 'L', 'XL', '2XL'] }))
  assert.equal(r.recommendedSize, 'XL')
  assert.equal(r.availability, 'available')
})
test('numeric jeans sizes with usual numeric size', () => {
  const r = ok(computeFitRecommendation({ ...profile, usualClothingSize: '10' }, { category: 'jeans', fit: 'skinny', availableSizes: ['6', '8', '10', '12', '14'] }))
  // skinny(fitted) + regular pref => up one => 12
  assert.equal(r.recommendedSize, '12')
})
test('usual alpha vs numeric-only product with no chart => insufficient_data with reason', () => {
  const r = computeFitRecommendation(profile, { category: 'jeans', availableSizes: ['28', '30', '32'] })
  assert.equal(r.status, 'insufficient_data')
})
test('unreadable chart falls back to usual size and says why', () => {
  const r = ok(computeFitRecommendation(profile, { category: 'top', sizeChart: 'Sizes run small.', availableSizes: ['S', 'M', 'L'] }))
  assert.equal(r.basis, 'usual_size')
  assert.ok(r.details.some((d) => /couldn't read the size chart/.test(d)))
})
test('one-size item', () => {
  assert.equal(computeFitRecommendation(profile, { availableSizes: ['One Size'] }).status, 'insufficient_data')
})
test('stated fit picked up from description when fit field missing', () => {
  const r = ok(computeFitRecommendation(profile, { category: 'top', description: 'A relaxed fit cotton tee.', availableSizes: ['S', 'M', 'L'] }))
  assert.ok(r.details.some((d) => /listing text/.test(d)))
  // relaxed cut + regular preference => sized down one, landing on a regular fit
  assert.equal(r.recommendedSize, 'S')
  assert.equal(r.likelyFit, 'regular')
})
test('short-sleeve shirt is a top, not a bottom', () => {
  const r = ok(computeFitRecommendation({ ...profile, hipCm: 120 }, { category: 'Short sleeve shirt', sizeChart: CM_TABLE, availableSizes: ['S', 'M', 'L'] }))
  assert.equal(r.recommendedSize, 'M')
})

console.log('\nper-measurement checks (additive: what the UI shows as "Bust fits")')
test('a dress on a matching chart row: bust, waist and hip are each checked against the RECOMMENDED size', () => {
  const r = ok(computeFitRecommendation(profile, { category: 'dress', sizeChart: CM_TABLE, availableSizes: ['XS', 'S', 'M', 'L', 'XL'] }))
  assert.equal(r.recommendedSize, 'M')
  assert.deepEqual(r.checks.map((c) => [c.measure, c.state]), [['bust', 'fits'], ['waist', 'fits'], ['hip', 'fits']])
  assert.deepEqual(r.checks[0], { measure: 'bust', state: 'fits', yourCm: 90, lo: 86, hi: 92 })
  assert.deepEqual(r.notCompared, [])
})
test('a top is judged on the bust only, and the other measurements are not claimed', () => {
  const r = ok(computeFitRecommendation(profile, { category: 'top', sizeChart: CM_TABLE, availableSizes: ['S', 'M', 'L'] }))
  assert.deepEqual(r.checks.map((c) => c.measure), ['bust'])
})
test('a size chosen by preference (one size up) reports roomy honestly instead of "fits"', () => {
  const r = ok(computeFitRecommendation({ ...profile, preferredFit: 'relaxed' }, { category: 'dress', fit: 'fitted', sizeChart: CM_TABLE, availableSizes: ['S', 'M', 'L', 'XL'] }))
  assert.equal(r.recommendedSize, 'L')
  assert.ok(r.checks.length === 3 && r.checks.every((c) => c.state === 'roomy'), JSON.stringify(r.checks))
})
test('measurements missing from the chart are listed as not compared', () => {
  const noHip = `| Size | Bust (cm) | Waist (cm) |\n|---|---|---|\n| S | 82-86 | 64-68 |\n| M | 86-92 | 68-74 |\n| L | 92-98 | 74-80 |`
  const r = ok(computeFitRecommendation(profile, { category: 'dress', sizeChart: noHip, availableSizes: ['S', 'M', 'L'] }))
  assert.deepEqual(r.checks.map((c) => c.measure), ['bust', 'waist'])
  assert.deepEqual(r.notCompared, ['hip'])
})
test('no chart (usual-size fallback): no checks are invented', () => {
  const r = ok(computeFitRecommendation(profile, { category: 'top', availableSizes: ['S', 'M', 'L'] }))
  assert.equal(r.basis, 'usual_size')
  assert.deepEqual(r.checks, [])
})
test('adding the checks did not change the recommendation itself', () => {
  const r = ok(computeFitRecommendation(profile, { category: 'dress', sizeChart: CM_TABLE, availableSizes: ['XS', 'S', 'M', 'L', 'XL'] }))
  assert.equal(r.recommendedSize, 'M')
  assert.equal(r.likelyFit, 'regular')
  assert.equal(r.confidence, 'high')
  assert.equal(r.availability, 'available')
})

console.log(`\n${passed} passed`)
