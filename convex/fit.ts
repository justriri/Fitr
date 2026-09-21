import { getAuthUserId } from '@convex-dev/auth/server'
import { v } from 'convex/values'
import { query } from './_generated/server'
import { computeFitRecommendation } from './lib/fitRecommendation'

// Derived on read from the caller's body profile + the product row — nothing
// is stored, so the result updates reactively when either document changes.
export const getFitRecommendation = query({
  args: { productId: v.id('products') },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (userId === null) {
      return null
    }

    const product = await ctx.db.get('products', args.productId)
    if (product === null || product.userId !== userId || product.status !== 'ready') {
      return null
    }

    const profile = await ctx.db
      .query('bodyProfiles')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .unique()

    return computeFitRecommendation(profile, product)
  },
})
