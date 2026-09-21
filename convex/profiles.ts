import { getAuthUserId } from '@convex-dev/auth/server'
import { v } from 'convex/values'
import { mutation, query } from './_generated/server'

const preferredFitValidator = v.union(
  v.literal('fitted'),
  v.literal('regular'),
  v.literal('relaxed'),
  v.literal('oversized'),
)

const profileFieldsValidator = {
  unitPreference: v.union(v.literal('cm'), v.literal('in')),

  // Core required measurements — the ones most people can state without a
  // tape measure in hand.
  heightCm: v.number(),
  bustChestCm: v.number(),
  waistCm: v.number(),
  hipCm: v.number(),
  usualClothingSize: v.string(),

  // Optional, more detailed measurements. These stay optional in the
  // mutation args (not just the schema) since the wizard no longer collects
  // them as required and callers may legitimately omit them.
  shoulderWidthCm: v.optional(v.number()),
  torsoLengthCm: v.optional(v.number()),
  inseamCm: v.optional(v.number()),
  upperArmCm: v.optional(v.number()),
  neckCm: v.optional(v.number()),
  sleeveLengthCm: v.optional(v.number()),
  thighCm: v.optional(v.number()),
  riseCm: v.optional(v.number()),
  shoeSize: v.optional(v.string()),

  preferredFit: preferredFitValidator,
  skinTone: v.optional(v.string()),
  hairColor: v.optional(v.string()),
  photoId: v.optional(v.id('_storage')),
}

export const getMyProfile = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    if (userId === null) {
      return null
    }

    const profile = await ctx.db
      .query('bodyProfiles')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .unique()

    if (profile === null) {
      return null
    }

    const photoUrl = profile.photoId ? await ctx.storage.getUrl(profile.photoId) : null

    return { ...profile, photoUrl }
  },
})

export const upsertProfile = mutation({
  args: profileFieldsValidator,
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (userId === null) {
      throw new Error('Not authenticated')
    }

    const existing = await ctx.db
      .query('bodyProfiles')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .unique()

    const now = Date.now()

    if (existing !== null) {
      await ctx.db.patch('bodyProfiles', existing._id, { ...args, updatedAt: now })
      return existing._id
    }

    return await ctx.db.insert('bodyProfiles', { ...args, userId, updatedAt: now })
  },
})

// Used by the client to upload an optional reference photo directly to
// Convex file storage before calling `upsertProfile` with the resulting
// storage id.
export const generatePhotoUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    if (userId === null) {
      throw new Error('Not authenticated')
    }
    return await ctx.storage.generateUploadUrl()
  },
})
