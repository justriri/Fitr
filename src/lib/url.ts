// Client-side mirror of the same check `convex/products.ts` runs
// server-side. Kept separate (Convex functions can't import from src/) but
// intentionally identical so the error message a user sees before ever
// hitting the network matches what they'd see if they somehow bypassed it.
export function normalizeProductUrl(raw: string): string | null {
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
