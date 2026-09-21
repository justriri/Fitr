import assert from 'node:assert/strict'
import { findSizeGuideLinks } from '../convex/lib/sizeGuideLinks'

let passed = 0
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log('  ok  ', name) } catch (e) { console.log('  FAIL', name, '\n      ', (e as Error).message); process.exitCode = 1 }
}

const SRC = 'https://girlfriend.com/products/black-reset-baby-tee'
// Verbatim link list Firecrawl returned for the real tee page (full page, 49 links).
const TEE_LINKS = [
  '/products/black-reset-baby-tee#MainContent', '/', '/products/black-compressive-high-rise-legging', '/collections/all',
  '/collections/sale', '/collections/new-arrivals', '/collections/best-sellers', '/collections/underwear', '/products/e-giftcard',
  '/pages/bra-quiz', '/collections/all-bottoms', '/collections/leggings', '/collections/shorts', '/collections/all-tops',
  '/collections/bras', '/collections/tanks-tees', '/collections/unitards-dresses', '/collections/unitards', '/collections/bodysuits',
  '/customer_authentication/redirect?locale=en&region_country=US', 'https://account.girlfriend.com/?locale=en', '/search',
  'about:blank#cart-drawer', '/products/black-reset-baby-tee', '/pages/terms', '/pages/privacy', '/pages/ccpa-privacy-notice',
  '/pages/do-not-sell-my-personal-information', '/pages/data-request', '/cart', '/account', 'https://girlfriend.gorgias.help/en-US',
  '/pages/returns', 'https://girlfriend.gorgias.help/en-US#article-296777', 'https://girlfriend.gorgias.help/en-US/ssp/login',
  '/pages/contact', '/pages/sizing', '/pages/girlfriend-collective-reviews', '/pages/discounts', '/pages/check-gift-card-balance',
  '/pages/rewards', '/pages/about-us', '/pages/regirlfriend', '/pages/stockists', 'https://www.instagram.com/girlfriend/?hl=en',
  'https://www.tiktok.com/@girlfriend', 'https://www.facebook.com/Girlfriendcollective/', 'https://www.shopify.com/',
].map((l) => (l.startsWith('/') ? `https://girlfriend.com${l}` : l))

const find = (o: Partial<Parameters<typeof findSizeGuideLinks>[0]>) =>
  findSizeGuideLinks({ sourceUrl: SRC, markdown: '', links: [], kind: 'unknown', ...o }).map((c) => c.url)

test('real tee page: the only size-guide candidate is the footer "Sizing" link', () => {
  assert.deepEqual(find({ links: TEE_LINKS, markdown: '- [Sizing](https://girlfriend.com/pages/sizing)', kind: 'top' }), ['https://girlfriend.com/pages/sizing'])
})
test('real tee page without markdown anchor text still finds it from the URL alone', () => {
  assert.deepEqual(find({ links: TEE_LINKS, kind: 'top' }), ['https://girlfriend.com/pages/sizing'])
})
test('no site-wide crawling: help centre, socials, collections, cart are never candidates', () => {
  const got = find({ links: TEE_LINKS, kind: 'top' })
  assert.equal(got.length, 1)
})
test('a tops product prefers the tops guide and drops the bottoms guide', () => {
  const links = ['https://girlfriend.com/pages/size-guide-bottoms', 'https://girlfriend.com/pages/size-guide-tops', 'https://girlfriend.com/pages/sizing']
  const got = find({ links, kind: 'top' })
  assert.equal(got[0], 'https://girlfriend.com/pages/size-guide-tops')
  assert.ok(!got.includes('https://girlfriend.com/pages/size-guide-bottoms'))
})
test('a bottoms product prefers the bottoms guide', () => {
  const links = ['https://girlfriend.com/pages/size-guide-tops', 'https://girlfriend.com/pages/size-guide-bottoms']
  assert.deepEqual(find({ links, kind: 'bottom' }), ['https://girlfriend.com/pages/size-guide-bottoms'])
})
test('unknown garment kind keeps both size guides', () => {
  const links = ['https://girlfriend.com/pages/size-guide-tops', 'https://girlfriend.com/pages/size-guide-bottoms']
  assert.equal(find({ links, kind: 'unknown' }).length, 2)
})
test('anchor-text-only match ("Size Guide" -> opaque URL) is accepted', () => {
  assert.deepEqual(find({ markdown: '[Size Guide](/pages/12345)' }), ['https://girlfriend.com/pages/12345'])
})
test('long sentence anchors are not treated as a size-guide label', () => {
  assert.deepEqual(find({ markdown: '[Read our long article about how our sizing philosophy evolved over time](/pages/abc)' }), [])
})
test('other sites are rejected (third-party size widgets, other retailers)', () => {
  assert.deepEqual(find({ links: ['https://sizewidget.example.com/size-guide', 'https://otherbrand.com/pages/size-guide'] }), [])
})
test('www / bare / sub-domain of the same retailer are all the same site', () => {
  const got = findSizeGuideLinks({ sourceUrl: 'https://www.brand.com/p/1', markdown: '', links: ['https://brand.com/size-guide', 'https://help.brand.com/size-chart', 'https://brand.co.uk/size-guide'], kind: 'unknown' }).map((c) => c.url)
  assert.deepEqual(got.sort(), ['https://brand.com/size-guide', 'https://help.brand.com/size-chart'])
})
test('co.uk retailers are keyed correctly', () => {
  const got = findSizeGuideLinks({ sourceUrl: 'https://www.shop.co.uk/p/1', markdown: '', links: ['https://shop.co.uk/size-guide', 'https://other.co.uk/size-guide'], kind: 'unknown' }).map((c) => c.url)
  assert.deepEqual(got, ['https://shop.co.uk/size-guide'])
})
test('mailto / javascript / about / tel links and the page itself are ignored', () => {
  assert.deepEqual(find({ links: ['mailto:size-guide@girlfriend.com', 'javascript:openSizeGuide()', 'about:blank#size-guide', 'tel:123', SRC + '#size-guide'] }), [])
})
test('image and pdf assets are never followed', () => {
  assert.deepEqual(find({ links: ['https://girlfriend.com/files/size-chart.jpg', 'https://girlfriend.com/files/size-guide.pdf'] }), [])
})
test('blog / review / shipping pages that merely mention sizing are excluded', () => {
  assert.deepEqual(find({ links: ['https://girlfriend.com/blogs/news/sizing-tips', 'https://girlfriend.com/pages/shipping-and-sizing'] }), [])
})
test('at most 3 candidates are ever returned', () => {
  const links = Array.from({ length: 10 }, (_, i) => `https://girlfriend.com/pages/size-guide-${i}`)
  assert.equal(find({ links }).length, 3)
})
console.log(`\n${passed} passed`)
