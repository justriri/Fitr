// Prepares the photo of the received item for upload: confirms it is a real, decodable image, and shrinks
// large phone photos so the upload is quick and the email attachment stays well under AgentMail's limit.

const MAX_EDGE = 1600
const MIN_EDGE = 200
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const PASS_THROUGH_BYTES = 1.5 * 1024 * 1024

export class PhotoError extends Error {}

export async function preparePhoto(file: File): Promise<Blob> {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    throw new PhotoError("That file isn't a photo we can use. Please choose a JPG, PNG or WebP image.")
  }

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new PhotoError("We couldn't read that image — it may be damaged. Please choose a different photo.")
  }

  try {
    const { width, height } = bitmap
    if (Math.min(width, height) < MIN_EDGE) {
      throw new PhotoError('That photo is too small to compare. Please use a clearer, larger photo of the item.')
    }
    const scale = Math.min(1, MAX_EDGE / Math.max(width, height))
    if (scale === 1 && file.size <= PASS_THROUGH_BYTES) return file

    const canvas = document.createElement('canvas')
    canvas.width = Math.round(width * scale)
    canvas.height = Math.round(height * scale)
    const context = canvas.getContext('2d')
    if (!context) return file
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86))
    return blob ?? file
  } finally {
    bitmap.close()
  }
}
