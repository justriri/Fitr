import { defineSchema, defineTable } from 'convex/server'
import { authTables } from '@convex-dev/auth/server'
import { v } from 'convex/values'

export default defineSchema({
  ...authTables,

  // One body profile per user. Measurements are always stored in
  // centimeters regardless of the unit the person entered them in, so
  // downstream fit/visualization logic never has to reconcile mixed units —
  // `unitPreference` only controls how values are displayed/edited.
  //
  // Extended (optional) measurements are separated from the core required
  // ones so more can be added later — for specific body/profile types —
  // without restructuring this table; every new field just needs to be
  // optional to stay backwards compatible with existing profiles.
  bodyProfiles: defineTable({
    userId: v.id('users'),
    unitPreference: v.union(v.literal('cm'), v.literal('in')),

    // Core required measurements (stored in cm). Most people don't know
    // their shoulder width, torso length, or inseam off-hand, so only the
    // measurements someone can typically state without a tape measure in
    // hand are required — the rest moved to the optional section below.
    heightCm: v.number(),
    bustChestCm: v.number(),
    waistCm: v.number(),
    hipCm: v.number(),

    // The size someone usually buys off the rack (e.g. "M", "8", "UK 10")
    // — lets us anchor a size recommendation even before exact measurements
    // are known. Required going forward (enforced in convex/profiles.ts'
    // mutation args); optional here so pre-existing profiles saved before
    // this field existed don't fail schema validation.
    usualClothingSize: v.optional(v.string()),

    // Optional extended measurements — relevant for some body types/styles
    // or for extra precision, not required to save a profile.
    shoulderWidthCm: v.optional(v.number()),
    torsoLengthCm: v.optional(v.number()),
    inseamCm: v.optional(v.number()),
    upperArmCm: v.optional(v.number()),
    neckCm: v.optional(v.number()),
    sleeveLengthCm: v.optional(v.number()),
    thighCm: v.optional(v.number()),
    riseCm: v.optional(v.number()),
    shoeSize: v.optional(v.string()),

    // "relaxed" is kept as a valid literal for backwards compatibility with
    // profiles saved before the onboarding simplification (which offers
    // only fitted/regular/oversized) — dropping it here would fail schema
    // validation against any existing row still holding that value.
    preferredFit: v.union(
      v.literal('fitted'),
      v.literal('regular'),
      v.literal('relaxed'),
      v.literal('oversized'),
    ),
    skinTone: v.optional(v.string()),
    hairColor: v.optional(v.string()),
    photoId: v.optional(v.id('_storage')),

    updatedAt: v.number(),
  }).index('by_userId', ['userId']),

  // One row per "paste a URL and analyze it" request. Crawling happens in a
  // scheduled action after this row is created, so `status` starts at
  // "pending" and the client watches it become "ready" or "failed" via a
  // reactive query — no polling needed.
  //
  // Extracted fields are all optional: Firecrawl may not find every field on
  // every retailer's page, and we store exactly what was found rather than
  // fabricating anything.
  products: defineTable({
    userId: v.id('users'),
    sourceUrl: v.string(),
    status: v.union(v.literal('pending'), v.literal('ready'), v.literal('failed')),
    errorMessage: v.optional(v.string()),

    name: v.optional(v.string()),
    retailer: v.optional(v.string()),
    description: v.optional(v.string()),
    price: v.optional(v.number()),
    currency: v.optional(v.string()),
    images: v.optional(v.array(v.string())),
    availableSizes: v.optional(v.array(v.string())),
    sizeChart: v.optional(v.string()),
    category: v.optional(v.string()),
    color: v.optional(v.string()),
    material: v.optional(v.string()),
    fit: v.optional(v.string()),

    crawledAt: v.optional(v.number()),
  }).index('by_userId', ['userId']),

  // One row per "See it on me" attempt for a given product. Append-only:
  // retrying after a failure inserts a new row rather than mutating the old
  // one, so `getLatestTryOn` just takes the newest row for that product.
  // There is no "ready" status stored here — the client treats "no row yet"
  // as the Ready state.
  tryOnResults: defineTable({
    userId: v.id('users'),
    productId: v.id('products'),
    bodyProfileId: v.id('bodyProfiles'),
    status: v.union(v.literal('generating'), v.literal('completed'), v.literal('failed')),
    errorMessage: v.optional(v.string()),
    resultImageId: v.optional(v.id('_storage')),
  }).index('by_productId', ['productId']),

  // One row per "Something wrong with your order?" case. Every read and write is scoped to `userId`
  // (see convex/cases.ts) — a case is never visible to, or actionable by, another user. The row is a
  // small state machine (see CASE_STATUSES in convex/lib/caseRules.ts) that the UI follows reactively.
  // Nothing here is invented: order numbers, purchase dates and refund amounts are not stored because
  // Fitr doesn't have them.
  protectionCases: defineTable({
    userId: v.id('users'),
    productId: v.id('products'),
    // Short reference that also appears in the email subject, so replies can be matched to the case.
    caseRef: v.string(),
    status: v.union(
      v.literal('analyzing'),
      v.literal('analysis_failed'),
      v.literal('no_mismatch'),
      v.literal('draft'),
      v.literal('cancelled'),
      v.literal('sending'),
      v.literal('send_failed'),
      v.literal('complaint_sent'),
      v.literal('waiting_for_retailer'),
      v.literal('retailer_replied'),
      v.literal('follow_up_sent'),
      v.literal('resolved'),
    ),
    errorMessage: v.optional(v.string()),

    // The photo the customer took of what arrived.
    receivedPhotoId: v.id('_storage'),
    comparison: v.optional(
      v.object({
        verdict: v.union(
          v.literal('possible_mismatch'),
          v.literal('no_reliable_mismatch'),
          v.literal('cannot_assess'),
        ),
        summary: v.string(),
        expected: v.string(),
        observed: v.string(),
        differences: v.array(v.object({ aspect: v.string(), expected: v.string(), observed: v.string() })),
        matches: v.array(v.string()),
        model: v.string(),
      }),
    ),

    retailerName: v.string(),
    retailerEmail: v.optional(v.string()),
    retailerEmailSource: v.optional(v.union(v.literal('found_on_site'), v.literal('entered_by_user'))),
    retailerEmailSourceUrl: v.optional(v.string()),
    contactSearched: v.optional(v.boolean()),

    // The exact message that was approved and sent (built from the stored comparison + the user's note).
    userNote: v.optional(v.string()),
    subject: v.optional(v.string()),
    body: v.optional(v.string()),

    // AgentMail identifiers, used to match replies and delivery events to this case.
    inboxId: v.optional(v.string()),
    threadId: v.optional(v.string()),
    firstMessageId: v.optional(v.string()),
    actualRecipient: v.optional(v.string()),

    sendingAt: v.optional(v.number()),
    sentAt: v.optional(v.number()),
    followUpCount: v.number(),
    followUpInFlight: v.optional(v.boolean()),
    lastFollowUpAt: v.optional(v.number()),
    lastRetailerReplyAt: v.optional(v.number()),
    resolvedAt: v.optional(v.number()),
  })
    .index('by_userId', ['userId'])
    .index('by_productId', ['productId'])
    .index('by_threadId', ['threadId'])
    .index('by_caseRef', ['caseRef']),

  // The conversation on a case: what Fitr sent and what the retailer replied.
  caseMessages: defineTable({
    caseId: v.id('protectionCases'),
    userId: v.id('users'),
    direction: v.union(v.literal('outbound'), v.literal('inbound')),
    kind: v.union(v.literal('complaint'), v.literal('follow_up'), v.literal('reply')),
    fromAddress: v.string(),
    toAddress: v.string(),
    subject: v.string(),
    text: v.string(),
    agentmailMessageId: v.string(),
    at: v.number(),
    // What AgentMail later reported about delivery (from its message.delivered / message.bounced webhooks).
    deliveryStatus: v.optional(v.union(v.literal('delivered'), v.literal('bounced'))),
    deliveryAt: v.optional(v.number()),
  })
    .index('by_caseId', ['caseId'])
    .index('by_agentmailMessageId', ['agentmailMessageId']),

  // Inbound emails that could not be matched to any case. Internal only: never returned to a client,
  // so one user can never read mail that belongs to nobody (or to someone else).
  unmatchedInboundEmails: defineTable({
    agentmailMessageId: v.string(),
    fromAddress: v.optional(v.string()),
    subject: v.optional(v.string()),
    receivedAt: v.number(),
    reason: v.string(),
  }).index('by_agentmailMessageId', ['agentmailMessageId']),

  // One row per "Find this item elsewhere" search for a product whose
  // recommended size isn't listed on the current page. Append-only like
  // tryOnResults: retrying inserts a new row and the UI reads the newest.
  // `results` is capped at a handful of entries by the search action, so it
  // stays a small embedded array. Sizes are only ever "listed on the page",
  // never a stock claim.
  alternativeSearches: defineTable({
    userId: v.id('users'),
    productId: v.id('products'),
    recommendedSize: v.string(),
    status: v.union(v.literal('searching'), v.literal('completed'), v.literal('failed')),
    errorMessage: v.optional(v.string()),
    queries: v.optional(v.array(v.string())),
    pagesChecked: v.optional(v.number()),
    results: v.optional(
      v.array(
        v.object({
          url: v.string(),
          retailer: v.string(),
          productName: v.string(),
          matchType: v.union(v.literal('exact'), v.literal('possible')),
          matchNotes: v.array(v.string()),
          sizeStatus: v.union(v.literal('listed'), v.literal('not_listed'), v.literal('unknown')),
          sizes: v.array(v.string()),
          price: v.optional(v.number()),
          currency: v.optional(v.string()),
          imageUrl: v.optional(v.string()),
          color: v.optional(v.string()),
        }),
      ),
    ),
  }).index('by_productId', ['productId']),
})
