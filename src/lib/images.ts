import { upgradeImageUrl } from '../../convex/lib/imageChecks'

// Crawled product images often carry a tiny lazy-load width (…&w=1). For display, ask the CDN for a proper size —
// the same upgrade the server applies before it uses the photo.
export function displayImage(url: string): string {
  return upgradeImageUrl(url) ?? url
}

export function formatPrice(price: number | null | undefined, currency: string | null | undefined): string | null {
  if (price === null || price === undefined) return null
  return currency ? `${currency} ${price}` : String(price)
}
