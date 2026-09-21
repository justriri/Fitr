// Pure checks on image bytes/URLs, used to decide whether a crawled product
// photo is a real garment photo before it is sent to the image model.

export type SupportedImageType = 'image/jpeg' | 'image/png' | 'image/webp'

export const EXTENSION_FOR_TYPE: Record<SupportedImageType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

// Trust the file's own bytes, not the server's Content-Type header (CDNs often get it wrong).
export function sniffImageType(bytes: Uint8Array): SupportedImageType | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length > 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png'
  }
  if (
    bytes.length > 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  ) {
    return 'image/webp'
  }
  return null
}

// Pixel size read straight from the file header, so a lazy-load placeholder
// (a 1px-wide JPEG is only a few KB) can't be mistaken for a product photo.
export function readImageSize(bytes: Uint8Array, type: string): { w: number; h: number } | null {
  const b = bytes
  if (type === 'image/png' && b.length > 24) {
    const view = new DataView(b.buffer, b.byteOffset, b.byteLength)
    return { w: view.getUint32(16), h: view.getUint32(20) }
  }
  if (type === 'image/jpeg') {
    let i = 2
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++
        continue
      }
      const marker = b[i + 1]
      if (marker === 0xff) {
        i++
        continue
      }
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8] }
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2
        continue
      }
      i += 2 + ((b[i + 2] << 8) | b[i + 3])
    }
    return null
  }
  if (type === 'image/webp' && b.length > 30) {
    const chunk = String.fromCharCode(b[12], b[13], b[14], b[15])
    if (chunk === 'VP8 ') return { w: (b[26] | (b[27] << 8)) & 0x3fff, h: (b[28] | (b[29] << 8)) & 0x3fff }
    if (chunk === 'VP8L') {
      const bits = (b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)) >>> 0
      return { w: (bits & 0x3fff) + 1, h: ((bits >>> 14) & 0x3fff) + 1 }
    }
    if (chunk === 'VP8X') {
      return {
        w: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)),
        h: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)),
      }
    }
  }
  return null
}

// Crawled pages often give a tiny lazy-load size in the URL (…&w=1). Most
// image CDNs honor a larger width there, so try that first.
export function upgradeImageUrl(raw: string): string | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  let changed = false
  for (const key of ['w', 'width', 'wid']) {
    const value = url.searchParams.get(key)
    if (value !== null && /^\d+$/.test(value) && Number(value) < 400) {
      url.searchParams.set(key, '1024')
      changed = true
    }
  }
  return changed ? url.toString() : null
}

// Clearly-not-a-garment-photo URLs: formats the image model can't read,
// spacer pixels, logos and icons.
export function usableProductImageUrls(images: string[] | undefined): string[] {
  const urls: string[] = []
  for (const raw of images ?? []) {
    let url: URL
    try {
      url = new URL(raw)
    } catch {
      continue
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') continue
    const path = url.pathname.toLowerCase()
    if (/\.(svg|gif|avif|ico|bmp)$/.test(path)) continue
    if (/(transparent|placeholder|spacer|pixel|blank|sprite|logo|icon)/.test(path)) continue
    urls.push(url.toString())
  }
  return urls
}

export const MIN_GARMENT_PX = 300
