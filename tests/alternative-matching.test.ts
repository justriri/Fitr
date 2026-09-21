import assert from 'node:assert/strict'
import {
  appearsOnPage,
  assessMatch,
  buildSearchQueries,
  fractionOnPage,
  isCandidateUrl,
  isSameRetailer,
  looksLikeResale,
  rankResults,
  retailerLabel,
  sizeListedStatus,
} from '../convex/lib/alternativeMatching'

let passed = 0
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log('  ok  ', name) } catch (e) { console.log('  FAIL', name, '\n      ', (e as Error).message); process.exitCode = 1 }
}

const LEGGING = { productName: 'Black Compressive High-Rise Legging', brand: 'Girlfriend Collective', color: 'Black' }

console.log('exact match: same item')
test('same brand + same product + same colour => exact', () => {
  const r = assessMatch(LEGGING, { productName: 'Girlfriend Collective Compressive High-Rise Legging - Black', brand: 'Girlfriend Collective', color: 'Black' })
  assert.equal(r.matchType, 'exact')
  assert.deepEqual(r.notes, ['Same brand', 'Same product name', 'Same colour'])
})
test('manufacturer style number match => exact, even when names are worded differently', () => {
  const src = { productName: 'Nike Dunk Low Retro', brand: 'Nike', styleNumber: 'DD1391-100', color: 'White/Black' }
  const r = assessMatch(src, { productName: "Men's Nike Dunk Low Retro Basketball Shoes", brand: 'Nike', styleNumber: 'DD1391 100', color: 'White/Black' })
  assert.equal(r.matchType, 'exact')
  assert.match(r.notes.join(' '), /Same style number/)
})
test('style number with a retailer colour/size suffix still matches', () => {
  const r = assessMatch({ ...LEGGING, styleNumber: 'GC12345' }, { ...LEGGING, styleNumber: 'GC12345-BLK', productName: 'Compressive High-Rise Legging' })
  assert.equal(r.matchType, 'exact')
})
test('colour synonyms count as the same colour (gray = grey)', () => {
  const r = assessMatch({ productName: 'Merino Crew Sweater', brand: 'Acme', color: 'Grey' }, { productName: 'Acme Merino Crew Sweater', brand: 'Acme', color: 'Gray' })
  assert.equal(r.matchType, 'exact')
})
test('brand only in the product name (no brand field) still counts as the brand', () => {
  const r = assessMatch(LEGGING, { productName: 'Girlfriend Collective Compressive High-Rise Legging Black', color: 'Black' })
  assert.equal(r.matchType, 'exact')
})

console.log('\nnot the same item: never presented as a match')
test('look-alike from a different brand is not shown at all', () => {
  assert.equal(assessMatch(LEGGING, { productName: 'Align High-Rise Legging 25"', brand: 'lululemon', color: 'Black' }).matchType, 'none')
})
test('different style number => a different product, however similar', () => {
  const r = assessMatch({ ...LEGGING, styleNumber: 'GC12345' }, { ...LEGGING, productName: 'Girlfriend Collective Compressive High-Rise Legging', styleNumber: 'GC99999' })
  assert.equal(r.matchType, 'none')
})
test('men\'s vs women\'s version of a product is not a match', () => {
  const r = assessMatch({ productName: "Women's Wool Runner", brand: 'Allbirds', color: 'Natural Black' }, { productName: "Men's Wool Runner", brand: 'Allbirds', color: 'Natural Black' })
  assert.equal(r.matchType, 'none')
})
test('same brand but an unrelated product => none', () => {
  assert.equal(assessMatch(LEGGING, { productName: 'Float Seamless Sports Bra', brand: 'Girlfriend Collective', color: 'Black' }).matchType, 'none')
})
test('own-brand retailer item (Zara) is not matched by a different brand\'s "Long Knit Dress"', () => {
  assert.equal(assessMatch({ productName: 'LONG KNIT DRESS', brand: 'Zara', color: 'grey' }, { productName: 'Long Knit Dress', brand: 'Mango', color: 'grey' }).matchType, 'none')
})

console.log('\npossible alternative: clearly not confirmed')
test('same product in a different colour => possible, and says so', () => {
  const r = assessMatch(LEGGING, { productName: 'Girlfriend Collective Compressive High-Rise Legging - Moon', brand: 'Girlfriend Collective', color: 'Moon' })
  assert.equal(r.matchType, 'possible')
  assert.ok(r.notes.some((n) => /Different colour \(Moon\)/.test(n)), r.notes.join(' | '))
})
test('same brand, similar but differently-named product => possible with "name differs"', () => {
  const r = assessMatch(LEGGING, { productName: 'Compressive High-Rise Legging - 28.5" Inseam Pocket', brand: 'Girlfriend Collective', color: 'Black' })
  assert.notEqual(r.matchType, 'none')
  if (r.matchType === 'possible') assert.ok(r.notes.some((n) => /Product name differs|Style number not confirmed/.test(n)))
})
test('unknown source brand can never be "exact" by name alone', () => {
  const r = assessMatch({ productName: 'Compressive High-Rise Legging', color: 'Black' }, { productName: 'Compressive High-Rise Legging', brand: 'Girlfriend Collective', color: 'Black' })
  assert.equal(r.matchType, 'possible')
  assert.ok(r.notes.includes('Style number not confirmed'))
})
test('colour missing on the candidate => possible, "colour not confirmed"', () => {
  const r = assessMatch(LEGGING, { productName: 'Girlfriend Collective Compressive High-Rise Legging', brand: 'Girlfriend Collective' })
  assert.equal(r.matchType, 'possible')
  assert.ok(r.notes.includes('Colour not confirmed'))
})

console.log('\nsize: "listed", never "in stock"')
test('recommended size listed / not listed', () => {
  assert.equal(sizeListedStatus('M', ['XS', 'S', 'M', 'L']), 'listed')
  assert.equal(sizeListedStatus('M', ['XS', 'S', 'L']), 'not_listed')
})
test('label variants of the same size match (Medium = M, 2XL = XXL, UK 10 = 10)', () => {
  assert.equal(sizeListedStatus('M', ['Small', 'Medium', 'Large']), 'listed')
  assert.equal(sizeListedStatus('XXL', ['XL', '2XL']), 'listed')
  assert.equal(sizeListedStatus('UK 10', ['8', '10', '12']), 'listed')
})
test('no sizes shown on the page => unknown (we never assume)', () => {
  assert.equal(sizeListedStatus('M', undefined), 'unknown')
  assert.equal(sizeListedStatus('M', []), 'unknown')
})
test('a different size system (M vs numeric-only) => unknown rather than a wrong answer', () => {
  assert.equal(sizeListedStatus('M', ['28', '30', '32']), 'unknown')
  assert.equal(sizeListedStatus('???', ['S', 'M']), 'unknown')
})

console.log('\nsearch: other retailers only, no site crawling')
test('same retailer (any subdomain / www) is excluded', () => {
  assert.ok(isSameRetailer('https://www.girlfriend.com/p/1', 'https://girlfriend.com/p/2'))
  assert.ok(!isCandidateUrl('https://girlfriend.com/products/other-colour', 'https://www.girlfriend.com/products/x'))
  assert.ok(!isCandidateUrl('https://help.shop.co.uk/a', 'https://www.shop.co.uk/p'))
})
test('social, forum, wiki, blog, collection and asset URLs are not candidates', () => {
  const src = 'https://girlfriend.com/products/x'
  for (const u of ['https://www.instagram.com/p/abc', 'https://www.reddit.com/r/x/comments/1', 'https://en.wikipedia.org/wiki/Legging', 'https://www.pinterest.com/pin/1', 'https://shop.com/blogs/news/best-leggings', 'https://shop.com/collections/leggings', 'https://shop.com/img/x.jpg', 'ftp://shop.com/p', 'not a url']) {
    assert.ok(!isCandidateUrl(u, src), `should exclude ${u}`)
  }
})
test('a different retailer\'s product page is a candidate', () => {
  assert.ok(isCandidateUrl('https://www.nordstrom.com/s/girlfriend-collective-legging/123', 'https://girlfriend.com/products/x'))
})
const OPS = '-site:reddit.com -site:facebook.com -site:pinterest.com -site:ebay.com -site:poshmark.com'
test('queries: style number first, then brand + name + colour, brand not repeated, max 2', () => {
  assert.deepEqual(
    buildSearchQueries({ productName: 'Nike Dunk Low Retro', brand: 'Nike', styleNumber: 'DD1391-100', color: 'White' }),
    [`"DD1391-100" Nike ${OPS}`, `Nike Dunk Low Retro White ${OPS}`],
  )
  assert.deepEqual(buildSearchQueries(LEGGING), [`Girlfriend Collective Black Compressive High-Rise Legging Black ${OPS}`])
  assert.deepEqual(buildSearchQueries({}), [])
})
test('queries steer away from the source retailer itself, so OTHER retailers surface', () => {
  const q = buildSearchQueries(LEGGING, 'www.girlfriend.com')[0]
  assert.ok(q.includes('-site:girlfriend.com') && !q.includes('www.'))
})
test('resale marketplaces, review sites and store/brand hub pages are not "another retailer"', () => {
  const src = 'https://girlfriend.com/products/x'
  for (const u of ['https://www.ebay.com/itm/137443251333', 'https://poshmark.com/listing/Black-Legging-123', 'https://girlfriend.treet.co/l/black-legging/64bf', 'https://www.garagegymreviews.com/equipment/legging', 'https://www.amazon.com/stores/GirlfriendCollective/page/C28D177B', 'https://www.depop.com/products/x']) {
    assert.ok(!isCandidateUrl(u, src), `should exclude ${u}`)
  }
  // ...but real retailers found by the live search are kept.
  for (const u of ['https://thesportsedit.com/products/girlfriend-collective-black-compressive-legging', 'https://www.boozt.com/eu/en/girlfriend-collective/compressive-high-rise-legging-long_32645058', 'https://www.johnlewis.com/girlfriend-collective-compressive-high-rise-7-8-leggings/black/p5497952']) {
    assert.ok(isCandidateUrl(u, src), `should keep ${u}`)
  }
})
test('name grounding: how much of a model-read name is really on the page', () => {
  const page = 'Girlfriend Collective Compressive High-Rise Legging - Black. Squat-proof.'
  assert.equal(fractionOnPage('Compressive High-Rise Legging', page), 1)
  assert.ok(fractionOnPage('Compressive Float Seamless Legging', page) < 0.8)
  assert.equal(fractionOnPage(undefined, page), 0)
})
test('grounding: a value the model claims must actually appear on the page', () => {
  const page = 'Girlfriend Collective\n# Compressive High-Rise Legging\nStyle GC-12345 | Black'
  assert.ok(appearsOnPage('GC12345', page) && appearsOnPage('Girlfriend Collective', page))
  assert.ok(!appearsOnPage('ZZ99999', page) && !appearsOnPage(undefined, page) && !appearsOnPage('ab', 'ab'))
})
test('ranking: confirmed matches first, then sizes listed > unknown > not listed', () => {
  const r = rankResults([
    { id: 1, matchType: 'possible' as const, sizeStatus: 'listed' as const },
    { id: 2, matchType: 'exact' as const, sizeStatus: 'not_listed' as const },
    { id: 3, matchType: 'exact' as const, sizeStatus: 'listed' as const },
    { id: 4, matchType: 'exact' as const, sizeStatus: 'unknown' as const },
  ])
  assert.deepEqual(r.map((x) => x.id), [3, 4, 2, 1])
})
test('used / consignment / resale pages are recognised; ordinary shop pages are not', () => {
  assert.ok(looksLikeResale('Girlfriend Collective Legging - Pre-owned, gently used, size M'))
  assert.ok(looksLikeResale('Shop our consignment collection'))
  assert.ok(!looksLikeResale('Free returns on all unworn items. Add to bag. Size M in stock.'))
  assert.ok(!looksLikeResale('x'.repeat(9000) + ' pre-owned'), 'only the top of the page is inspected')
})
test('generic extracted store names fall back to the domain', () => {
  assert.equal(retailerLabel('Shop', 'https://editorialist.com/p/x'), 'editorialist.com')
  assert.equal(retailerLabel(undefined, 'https://www.blu-kat.com/products/x'), 'blu-kat.com')
  assert.equal(retailerLabel('The Sports Edit', 'https://thesportsedit.com/x'), 'The Sports Edit')
  assert.equal(retailerLabel('  ', 'not a url'), 'not a url')
})
console.log(`\n${passed} passed`)
