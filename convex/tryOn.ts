import { getAuthUserId } from '@convex-dev/auth/server'
import { v, type ObjectType } from 'convex/values'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import {
  internalAction,
  internalMutation,
  mutation,
  query,
  type ActionCtx,
  type QueryCtx,
} from './_generated/server'
import {
  EXTENSION_FOR_TYPE,
  MIN_GARMENT_PX,
  readImageSize,
  sniffImageType,
  upgradeImageUrl,
  usableProductImageUrls,
} from './lib/imageChecks'
import { buildTryOnPrompt, measurementWarning } from './lib/tryOnPrompt'

const DEFAULT_IMAGE_MODEL = 'gpt-image-1'

// The only formats the OpenAI image edit endpoint accepts.
const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']

// A generation that has been "generating" for less than this is treated as
// still running, so a double-click can't start (and pay for) a second one.
const IN_FLIGHT_MS = 5 * 60 * 1000

// ---- Readiness: everything that must be true before we spend an OpenAI request ----

export type TryOnBlocker = 'no_profile' | 'no_photo' | 'photo_unsupported' | 'no_product_image'

const BLOCKER_MESSAGES: Record<TryOnBlocker, string> = {
  no_profile: 'Create your body profile first.',
  no_photo: 'Add a reference photo to your profile to see a personalized visualization.',
  photo_unsupported:
    "Your reference photo is in a format we can't use. Re-upload it as a JPG, PNG or WebP in your profile.",
  no_product_image: "This product doesn't have a photo we can use to visualize it.",
}

type Readiness =
  | { blocker: TryOnBlocker }
  | { blocker: null; profile: Doc<'bodyProfiles'>; photoId: Id<'_storage'>; imageUrls: string[] }

async function checkReadiness(
  ctx: Pick<QueryCtx, 'db'>,
  userId: Id<'users'>,
  product: Doc<'products'>,
): Promise<Readiness> {
  const profile = await ctx.db
    .query('bodyProfiles')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .unique()
  if (profile === null) return { blocker: 'no_profile' }

  if (!profile.photoId) return { blocker: 'no_photo' }
  const photo = await ctx.db.system.get('_storage', profile.photoId)
  if (photo === null) return { blocker: 'no_photo' }
  if (!SUPPORTED_IMAGE_TYPES.includes((photo.contentType ?? '').toLowerCase())) {
    return { blocker: 'photo_unsupported' }
  }

  const imageUrls = usableProductImageUrls(product.images)
  if (imageUrls.length === 0) return { blocker: 'no_product_image' }

  return { blocker: null, profile, photoId: profile.photoId, imageUrls }
}

// Reactive pre-check so the UI can explain what's missing *before* the
// person clicks anything. startTryOn re-checks the same rules server-side.
export const getTryOnReadiness = query({
  args: { productId: v.id('products') },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (userId === null) return null

    const product = await ctx.db.get('products', args.productId)
    if (product === null || product.userId !== userId || product.status !== 'ready') return null

    const readiness = await checkReadiness(ctx, userId, product)
    const profile = await ctx.db
      .query('bodyProfiles')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .unique()
    // Non-blocking: measurements that look like the wrong unit are left out of the prompt, so say so.
    return { blocker: readiness.blocker, measurementWarning: profile ? measurementWarning(profile) : null }
  },
})

export const startTryOn = mutation({
  args: { productId: v.id('products') },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (userId === null) {
      throw new Error('Not authenticated')
    }

    const product = await ctx.db.get('products', args.productId)
    if (product === null || product.userId !== userId) {
      throw new Error('Product not found.')
    }
    if (product.status !== 'ready') {
      throw new Error('This product is still loading — try again once it finishes.')
    }

    const readiness = await checkReadiness(ctx, userId, product)
    if (readiness.blocker !== null) {
      throw new Error(BLOCKER_MESSAGES[readiness.blocker])
    }
    const { profile, photoId, imageUrls } = readiness

    // Already generating for this product? Reuse it rather than paying twice.
    const latest = await ctx.db
      .query('tryOnResults')
      .withIndex('by_productId', (q) => q.eq('productId', product._id))
      .order('desc')
      .first()
    if (
      latest !== null &&
      latest.userId === userId &&
      latest.status === 'generating' &&
      Date.now() - latest._creationTime < IN_FLIGHT_MS
    ) {
      return latest._id
    }

    const tryOnId = await ctx.db.insert('tryOnResults', {
      userId,
      productId: product._id,
      bodyProfileId: profile._id,
      status: 'generating',
    })

    await ctx.scheduler.runAfter(0, internal.tryOn.runGeneration, {
      tryOnId,
      productImageUrls: imageUrls.slice(0, 3),
      productName: product.name,
      productCategory: product.category,
      productColor: product.color,
      productMaterial: product.material,
      productFit: product.fit,
      productDescription: product.description,
      photoId,
      heightCm: profile.heightCm,
      bustChestCm: profile.bustChestCm,
      waistCm: profile.waistCm,
      hipCm: profile.hipCm,
      shoulderWidthCm: profile.shoulderWidthCm,
      torsoLengthCm: profile.torsoLengthCm,
      inseamCm: profile.inseamCm,
      upperArmCm: profile.upperArmCm,
      neckCm: profile.neckCm,
      sleeveLengthCm: profile.sleeveLengthCm,
      thighCm: profile.thighCm,
      riseCm: profile.riseCm,
      preferredFit: profile.preferredFit,
      usualClothingSize: profile.usualClothingSize,
      skinTone: profile.skinTone,
      hairColor: profile.hairColor,
    })

    return tryOnId
  },
})

export const getLatestTryOn = query({
  args: { productId: v.id('products') },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (userId === null) {
      return null
    }

    const latest = await ctx.db
      .query('tryOnResults')
      .withIndex('by_productId', (q) => q.eq('productId', args.productId))
      .order('desc')
      .first()

    if (latest === null || latest.userId !== userId) {
      return null
    }

    const resultImageUrl = latest.resultImageId ? await ctx.storage.getUrl(latest.resultImageId) : null

    return { ...latest, resultImageUrl }
  },
})

export const markTryOnComplete = internalMutation({
  args: { tryOnId: v.id('tryOnResults'), resultImageId: v.id('_storage') },
  handler: async (ctx, args) => {
    await ctx.db.patch('tryOnResults', args.tryOnId, {
      status: 'completed',
      resultImageId: args.resultImageId,
      errorMessage: undefined,
    })
  },
})

export const markTryOnFailed = internalMutation({
  args: { tryOnId: v.id('tryOnResults'), errorMessage: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch('tryOnResults', args.tryOnId, {
      status: 'failed',
      errorMessage: args.errorMessage,
    })
  },
})

function base64ToBlob(base64: string, contentType: string): Blob {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new Blob([bytes], { type: contentType })
}

const MAX_GARMENT_FETCHES = 6

// First candidate that actually downloads as a real, supported, full-size photo.
async function loadGarmentImage(urls: string[]): Promise<{ blob: Blob; filename: string } | null> {
  const candidates: string[] = []
  for (const url of urls) {
    const upgraded = upgradeImageUrl(url)
    if (upgraded !== null) candidates.push(upgraded)
    candidates.push(url)
  }

  for (const url of candidates.slice(0, MAX_GARMENT_FETCHES)) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 20_000)
    try {
      const res = await fetch(url, {
        headers: { Accept: 'image/jpeg,image/png,image/webp;q=0.9,*/*;q=0.1' },
        signal: controller.signal,
      })
      if (!res.ok) continue
      const bytes = new Uint8Array(await res.arrayBuffer())
      const type = sniffImageType(bytes)
      if (type === null || bytes.length > 20 * 1024 * 1024) continue
      const size = readImageSize(bytes, type)
      if (size === null || Math.min(size.w, size.h) < MIN_GARMENT_PX) continue
      return { blob: new Blob([bytes], { type }), filename: `garment.${EXTENSION_FOR_TYPE[type]}` }
    } catch {
      continue
    } finally {
      clearTimeout(timeoutId)
    }
  }
  return null
}

const generationArgs = {
  tryOnId: v.id('tryOnResults'),
  productImageUrls: v.array(v.string()),
  productName: v.optional(v.string()),
  productCategory: v.optional(v.string()),
  productColor: v.optional(v.string()),
  productMaterial: v.optional(v.string()),
  productFit: v.optional(v.string()),
  productDescription: v.optional(v.string()),
  photoId: v.id('_storage'),
  heightCm: v.number(),
  bustChestCm: v.number(),
  waistCm: v.number(),
  hipCm: v.number(),
  shoulderWidthCm: v.optional(v.number()),
  torsoLengthCm: v.optional(v.number()),
  inseamCm: v.optional(v.number()),
  upperArmCm: v.optional(v.number()),
  neckCm: v.optional(v.number()),
  sleeveLengthCm: v.optional(v.number()),
  thighCm: v.optional(v.number()),
  riseCm: v.optional(v.number()),
  preferredFit: v.union(
    v.literal('fitted'),
    v.literal('regular'),
    v.literal('relaxed'),
    v.literal('oversized'),
  ),
  usualClothingSize: v.optional(v.string()),
  skinTone: v.optional(v.string()),
  hairColor: v.optional(v.string()),
}

type GenerationArgs = ObjectType<typeof generationArgs>

// Turns OpenAI's error response into something a person can act on. The raw
// status/code is logged server-side (never the API key or the images).
function describeOpenAiFailure(status: number, code: string, detail: string): string {
  if (status === 401 || status === 403) {
    return 'Personalized visualization is misconfigured — OpenAI rejected the configured API key.'
  }
  if (
    status === 402 ||
    /insufficient_quota|billing/i.test(code) ||
    (status === 429 && /quota|billing|credit/i.test(detail))
  ) {
    return 'The visualization service has reached its usage limit (OpenAI quota or billing).'
  }
  if (status === 429) return 'Too many requests right now. Please try again in a moment.'
  if (status === 404 || /model_not_found/i.test(code) || /model .*(does not exist|not found|not available)/i.test(detail)) {
    return "The configured OpenAI image model isn't available for this account."
  }
  if (/moderation/i.test(code)) {
    return "OpenAI's safety filters declined this photo and garment combination. Try a different product or photo."
  }
  if (status === 400) return "OpenAI couldn't process this request — try a different product or photo."
  return 'The visualization service had a problem generating this image. Please try again.'
}

async function generate(ctx: ActionCtx, args: GenerationArgs): Promise<void> {
  const fail = (errorMessage: string) =>
    ctx.runMutation(internal.tryOn.markTryOnFailed, { tryOnId: args.tryOnId, errorMessage })

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    await fail("Personalized visualization isn't configured yet — OPENAI_API_KEY is missing on the Convex deployment.")
    return
  }

  const personBlob = await ctx.storage.get(args.photoId)
  if (personBlob === null) {
    await fail('Your reference photo could not be found. Please re-upload it in your profile.')
    return
  }
  const personType = (personBlob.type || 'image/jpeg').toLowerCase()
  const personExt = EXTENSION_FOR_TYPE[personType as keyof typeof EXTENSION_FOR_TYPE] ?? 'jpg'

  const garment = await loadGarmentImage(args.productImageUrls)
  if (garment === null) {
    await fail("Couldn't load a usable product photo for the visualization.")
    return
  }

  const prompt = buildTryOnPrompt(args)
  const model = process.env.OPENAI_IMAGE_MODEL || DEFAULT_IMAGE_MODEL

  const form = new FormData()
  form.append('model', model)
  form.append('prompt', prompt)
  form.append('image[]', personBlob, `person.${personExt}`)
  form.append('image[]', garment.blob, garment.filename)
  form.append('size', '1024x1536')
  // Highest fidelity the edit endpoint offers: stick closely to the input photos' details
  // (especially the person's face) and render at high quality.
  form.append('input_fidelity', 'high')
  form.append('quality', 'high')

  const startedAt = Date.now()
  console.log(
    `Fitr try-on: sending OpenAI images/edits request model=${model} quality=high input_fidelity=high promptChars=${prompt.length} person=${personType}/${Math.round(personBlob.size / 1024)}KB garment=${garment.blob.type}/${Math.round(garment.blob.size / 1024)}KB`,
  )

  let response: Response
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 150_000)
    try {
      response = await fetch('https://api.openai.com/v1/images/edits', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeoutId)
    }
  } catch (e) {
    const timedOut = e instanceof Error && e.name === 'AbortError'
    await fail(
      timedOut
        ? 'The visualization took too long to generate. Please try again.'
        : "Couldn't reach the visualization service. Check your connection and try again.",
    )
    return
  }

  if (!response.ok) {
    let code = ''
    let detail = ''
    try {
      const errBody: unknown = await response.json()
      const err = (errBody as { error?: { code?: unknown; type?: unknown; message?: unknown } } | null)?.error
      code = String(err?.code ?? err?.type ?? '')
      detail = String(err?.message ?? '')
    } catch {
      // Non-JSON error body: fall through with the status alone.
    }
    console.log(`Fitr try-on: OpenAI request failed status=${response.status} code=${code} message=${detail.slice(0, 200)}`)
    await fail(describeOpenAiFailure(response.status, code, detail))
    return
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    await fail('The visualization service returned an unexpected response.')
    return
  }

  const b64 = extractB64Image(body)
  if (b64 === null) {
    await fail('The visualization service did not return an image.')
    return
  }

  const resultBlob = base64ToBlob(b64, 'image/png')
  const resultImageId = await ctx.storage.store(resultBlob)
  console.log(
    `Fitr try-on: OpenAI responded in ${Math.round((Date.now() - startedAt) / 100) / 10}s; stored result ${Math.round(resultBlob.size / 1024)}KB as ${resultImageId}`,
  )

  await ctx.runMutation(internal.tryOn.markTryOnComplete, {
    tryOnId: args.tryOnId,
    resultImageId,
  })
}

export const runGeneration = internalAction({
  args: generationArgs,
  handler: async (ctx, args) => {
    try {
      await generate(ctx, args)
    } catch (e) {
      // Never leave a row stuck on "generating": any unexpected error becomes a retryable failure.
      console.log('Fitr try-on: unexpected error', e instanceof Error ? e.message : String(e))
      await ctx.runMutation(internal.tryOn.markTryOnFailed, {
        tryOnId: args.tryOnId,
        errorMessage: 'Something went wrong generating this visualization. Please try again.',
      })
    }
  },
})

function extractB64Image(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null
  const top = body as Record<string, unknown>
  if (!Array.isArray(top.data) || top.data.length === 0) return null
  const first = top.data[0] as unknown
  if (typeof first !== 'object' || first === null) return null
  const b64 = (first as Record<string, unknown>).b64_json
  return typeof b64 === 'string' && b64.length > 0 ? b64 : null
}
