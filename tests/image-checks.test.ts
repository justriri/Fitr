import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { readImageSize, sniffImageType, upgradeImageUrl, usableProductImageUrls } from '../convex/lib/imageChecks'

let passed = 0
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log('  ok  ', name) } catch (e) { console.log('  FAIL', name, '\n      ', (e as Error).message); process.exitCode = 1 }
}
const fixture = (name: string) => new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))))

console.log('image type + pixel size, on real encoder output')
test('1x3 JPEG (lazy-load placeholder shape) reads as tiny', () => {
  const b = fixture('placeholder-1x3.jpg')
  assert.equal(sniffImageType(b), 'image/jpeg')
  assert.deepEqual(readImageSize(b, 'image/jpeg'), { w: 1, h: 3 })
})
test('320x480 JPEG', () => assert.deepEqual(readImageSize(fixture('photo-320x480.jpg'), 'image/jpeg'), { w: 320, h: 480 }))
test('320x480 PNG', () => {
  const b = fixture('photo-320x480.png')
  assert.equal(sniffImageType(b), 'image/png')
  assert.deepEqual(readImageSize(b, 'image/png'), { w: 320, h: 480 })
})
test('320x480 WebP', () => {
  const b = fixture('photo-320x480.webp')
  assert.equal(sniffImageType(b), 'image/webp')
  assert.deepEqual(readImageSize(b, 'image/webp'), { w: 320, h: 480 })
})
test('an HTML "Access Denied" page is not an image', () => {
  assert.equal(sniffImageType(new TextEncoder().encode('<HTML><HEAD><TITLE>Access Denied</TITLE>')), null)
})
test('garbage bytes => unreadable size (treated as unusable)', () => assert.equal(readImageSize(new Uint8Array(50).fill(7), 'image/jpeg'), null))

console.log('\nhand-built headers')
test('WebP VP8X 900x1350', () => {
  const b = new Uint8Array(40); b.set([0x52, 0x49, 0x46, 0x46], 0); b.set([0x57, 0x45, 0x42, 0x50], 8); b.set([0x56, 0x50, 0x38, 0x58], 12)
  const w = 900 - 1, h = 1350 - 1
  b.set([w & 255, (w >> 8) & 255, (w >> 16) & 255, h & 255, (h >> 8) & 255, (h >> 16) & 255], 24)
  assert.deepEqual(readImageSize(b, 'image/webp'), { w: 900, h: 1350 })
})
test('WebP VP8L 800x1200', () => {
  const b = new Uint8Array(40); b.set([0x52, 0x49, 0x46, 0x46], 0); b.set([0x57, 0x45, 0x42, 0x50], 8); b.set([0x56, 0x50, 0x38, 0x4c], 12); b[20] = 0x2f
  const bits = ((800 - 1) | ((1200 - 1) << 14)) >>> 0
  b.set([bits & 255, (bits >> 8) & 255, (bits >> 16) & 255, (bits >>> 24) & 255], 21)
  assert.deepEqual(readImageSize(b, 'image/webp'), { w: 800, h: 1200 })
})

console.log('\nURL handling')
test('w=1 (Zara lazy-load placeholder) is upgraded to 1024, other params untouched', () => {
  assert.equal(upgradeImageUrl('https://static.zara.net/x/a.jpg?ts=123&w=1'), 'https://static.zara.net/x/a.jpg?ts=123&w=1024')
})
test('Shopify-style width=100 is upgraded', () => assert.equal(upgradeImageUrl('https://cdn.shop.com/a.jpg?v=1&width=100'), 'https://cdn.shop.com/a.jpg?v=1&width=1024'))
test('already-large / absent / non-numeric width => no upgrade', () => {
  assert.equal(upgradeImageUrl('https://x.com/a.jpg?w=1200'), null)
  assert.equal(upgradeImageUrl('https://x.com/a.jpg?ts=1'), null)
  assert.equal(upgradeImageUrl('https://x.com/a.jpg?w=auto'), null)
})
test('SVG-only / spacer-only image lists are unusable; real photos pass', () => {
  assert.deepEqual(usableProductImageUrls(['https://a.com/x/transparent-background.png', 'https://a.com/logo.svg', 'https://a.com/i.gif', 'data:image/png;base64,AAAA']), [])
  assert.deepEqual(usableProductImageUrls(['https://a.com/dress.jpg?w=1', 'https://a.com/dress-2.webp']).length, 2)
  assert.deepEqual(usableProductImageUrls(undefined), [])
})
console.log(`\n${passed} passed`)
