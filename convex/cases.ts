import { getAuthUserId } from '@convex-dev/auth/server'
import { v } from 'convex/values'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from './_generated/server'
import {
  buildComplaintEmail,
  caseRefFromText,
  CANCELLABLE_STATUSES,
  extractInboundKeys,
  followUpStatus,
  FOLLOW_UP_AFTER_MS,
  isValidEmail,
  MAX_COMPLAINTS_PER_DAY,
  newCaseRef,
  OPEN_STATUSES,
  SENT_STATUSES,
  senderMatchesRetailer,
  type InboundKeys,
} from './lib/caseRules'

// The photo is attached to the email (AgentMail allows 6 MB of attachments, and base64 adds a third).
const MAX_PHOTO_BYTES = 4 * 1024 * 1024
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
// A complaint that has been "sending" longer than this is treated as stuck and may be retried.
const SENDING_STUCK_MS = 5 * 60 * 1000
// After a send, give delivery a moment; if AgentMail hasn't reported yet, the case is simply "waiting".
const WAITING_AFTER_MS = 5 * 60 * 1000

// ---- Access control: every case is reached through these, and "not yours" looks exactly like "doesn't exist" ----

async function requireUserId(ctx: QueryCtx | MutationCtx): Promise<Id<'users'>> {
  const userId = await getAuthUserId(ctx)
  if (userId === null) throw new Error('Not authenticated')
  return userId
}

async function getOwnedCase(ctx: QueryCtx | MutationCtx, caseId: Id<'protectionCases'>, userId: Id<'users'>) {
  const c = await ctx.db.get('protectionCases', caseId)
  if (c === null || c.userId !== userId) throw new Error('Case not found.')
  return c
}

// ---- Starting a case ----

export const generateReceivedPhotoUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireUserId(ctx)
    return await ctx.storage.generateUploadUrl()
  },
})

export const startCase = mutation({
  args: { productId: v.id('products'), photoId: v.id('_storage') },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    const product = await ctx.db.get('products', args.productId)
    if (product === null || product.userId !== userId) throw new Error('Product not found.')
    if (product.status !== 'ready') throw new Error('This product is still loading — try again once it finishes.')

    // One open case per product: a second submission returns the first instead of starting another.
    const existing = await ctx.db
      .query('protectionCases')
      .withIndex('by_productId', (q) => q.eq('productId', product._id))
      .order('desc')
      .take(10)
    const open = existing.find((c) => c.userId === userId && OPEN_STATUSES.includes(c.status))
    if (open) return open._id

    const photo = await ctx.db.system.get('_storage', args.photoId)
    if (photo === null) throw new Error('Add a photo of the item you received.')
    if (!IMAGE_TYPES.includes((photo.contentType ?? '').toLowerCase())) {
      throw new Error("That file isn't a photo we can use. Please upload a JPG, PNG or WebP image.")
    }
    if (photo.size > MAX_PHOTO_BYTES) throw new Error('That photo is too large. Please choose one under 4 MB.')

    let caseRef = newCaseRef()
    while ((await ctx.db.query('protectionCases').withIndex('by_caseRef', (q) => q.eq('caseRef', caseRef)).first()) !== null) {
      caseRef = newCaseRef()
    }

    const caseId = await ctx.db.insert('protectionCases', {
      userId,
      productId: product._id,
      caseRef,
      status: 'analyzing',
      receivedPhotoId: args.photoId,
      retailerName: product.retailer ?? safeHostname(product.sourceUrl) ?? 'the retailer',
      followUpCount: 0,
    })
    await ctx.scheduler.runAfter(0, internal.caseActions.runComparison, { caseId })
    return caseId
  },
})

function safeHostname(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

export const retryComparison = mutation({
  args: { caseId: v.id('protectionCases') },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    const c = await getOwnedCase(ctx, args.caseId, userId)
    if (c.status !== 'analysis_failed') throw new Error("This case isn't waiting for a retry.")
    await ctx.db.patch('protectionCases', c._id, { status: 'analyzing', errorMessage: undefined })
    await ctx.scheduler.runAfter(0, internal.caseActions.runComparison, { caseId: c._id })
  },
})

// ---- Reading a case (reactive) ----

export const getCaseForProduct = query({
  args: { productId: v.id('products') },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (userId === null) return null

    const product = await ctx.db.get('products', args.productId)
    if (product === null || product.userId !== userId) return null

    const cases = await ctx.db
      .query('protectionCases')
      .withIndex('by_productId', (q) => q.eq('productId', product._id))
      .order('desc')
      .take(10)
    const c = cases.find((x) => x.userId === userId)
    if (c === undefined) return null

    const messages = await ctx.db
      .query('caseMessages')
      .withIndex('by_caseId', (q) => q.eq('caseId', c._id))
      .order('desc')
      .take(50)
    messages.reverse()

    // Whether the state allows a follow-up, and the earliest moment it does. The clock check itself
    // happens on the client (for display) and in `sendFollowUp` (for real) — queries don't read the time.
    const atEarliest = c.sentAt !== undefined ? followUpStatus(c, c.sentAt + FOLLOW_UP_AFTER_MS) : null

    return {
      _id: c._id,
      status: c.status,
      caseRef: c.caseRef,
      errorMessage: c.errorMessage ?? null,
      comparison: c.comparison ?? null,
      photoUrl: await ctx.storage.getUrl(c.receivedPhotoId),
      retailer: {
        name: c.retailerName,
        email: c.retailerEmail ?? null,
        source: c.retailerEmailSource ?? null,
        sourceUrl: c.retailerEmailSourceUrl ?? null,
        searched: c.contactSearched ?? false,
      },
      userNote: c.userNote ?? null,
      product: {
        name: product.name ?? null,
        sourceUrl: product.sourceUrl,
        image: product.images?.[0] ?? null,
        color: product.color ?? null,
      },
      sentAt: c.sentAt ?? null,
      lastRetailerReplyAt: c.lastRetailerReplyAt ?? null,
      followUp: {
        stateAllows: atEarliest?.allowed ?? false,
        earliestAt: atEarliest?.availableAt ?? null,
        count: c.followUpCount,
        inFlight: c.followUpInFlight ?? false,
      },
      messages: messages.map((m) => ({
        _id: m._id,
        direction: m.direction,
        kind: m.kind,
        from: m.fromAddress,
        to: m.toAddress,
        subject: m.subject,
        text: m.text,
        at: m.at,
        deliveryStatus: m.deliveryStatus ?? null,
      })),
    }
  },
})

// ---- User actions ----

export const setRetailerEmail = mutation({
  args: { caseId: v.id('protectionCases'), email: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    const c = await getOwnedCase(ctx, args.caseId, userId)
    if (c.status !== 'draft' && c.status !== 'send_failed') throw new Error("The retailer's address can't be changed now.")
    const email = args.email.trim().toLowerCase()
    if (!isValidEmail(email)) throw new Error("That doesn't look like a valid email address.")
    await ctx.db.patch('protectionCases', c._id, {
      retailerEmail: email,
      retailerEmailSource: 'entered_by_user',
      retailerEmailSourceUrl: undefined,
    })
  },
})

// The user chose not to send. Nothing has been (or ever will be) sent for a cancelled case.
export const cancelCase = mutation({
  args: { caseId: v.id('protectionCases') },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    const c = await getOwnedCase(ctx, args.caseId, userId)
    if (c.status === 'cancelled') return
    if (!CANCELLABLE_STATUSES.includes(c.status)) {
      throw new Error(SENT_STATUSES.includes(c.status) ? 'This complaint has already been sent — you can mark it resolved instead.' : "This case can't be cancelled right now.")
    }
    await ctx.db.patch('protectionCases', c._id, { status: 'cancelled', errorMessage: undefined })
  },
})

// The ONLY path that sends a complaint, and it exists only as an explicit user action on a reviewed draft.
export const sendComplaint = mutation({
  args: { caseId: v.id('protectionCases'), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    const c = await getOwnedCase(ctx, args.caseId, userId)

    // Duplicate submission: a second click on a complaint that is already going out (or gone) does nothing.
    if (SENT_STATUSES.includes(c.status) || c.status === 'sending') return

    if (c.status !== 'draft' && c.status !== 'send_failed') throw new Error("This case isn't ready to send.")
    if (c.comparison?.verdict !== 'possible_mismatch') throw new Error('There is no possible mismatch to report.')
    if (!c.retailerEmail || !isValidEmail(c.retailerEmail)) {
      throw new Error("Add the retailer's email address first — Fitr couldn't find one.")
    }

    // A modest daily cap so Fitr can't be used to mass-email.
    const recent = await ctx.db.query('protectionCases').withIndex('by_userId', (q) => q.eq('userId', userId)).order('desc').take(50)
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000
    if (recent.filter((r) => r._id !== c._id && r.sentAt !== undefined && r.sentAt > dayAgo).length >= MAX_COMPLAINTS_PER_DAY) {
      throw new Error('You have sent several complaints today. Please try again tomorrow.')
    }

    const product = await ctx.db.get('products', c.productId)
    if (product === null) throw new Error('Product not found.')
    const note = args.note?.trim().slice(0, 1500) || undefined
    const email = buildComplaintEmail({
      retailerName: c.retailerName,
      productName: product.name,
      productUrl: product.sourceUrl,
      caseRef: c.caseRef,
      note,
    })
    await ctx.db.patch('protectionCases', c._id, {
      status: 'sending',
      sendingAt: Date.now(),
      errorMessage: undefined,
      userNote: note,
      subject: email.subject,
      body: email.text,
    })
    await ctx.scheduler.runAfter(0, internal.caseActions.deliverComplaint, { caseId: c._id })
  },
})

// A follow-up is the user's decision, allowed by a fixed rule (see followUpStatus): once, and only after
// 72 hours without a reply. Fitr never sends one on its own.
export const sendFollowUp = mutation({
  args: { caseId: v.id('protectionCases') },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    const c = await getOwnedCase(ctx, args.caseId, userId)
    const rule = followUpStatus(c, Date.now())
    if (!rule.allowed) {
      const why: Record<string, string> = {
        not_sent: "This complaint hasn't been sent yet.",
        resolved: 'This case is already resolved.',
        retailer_replied: 'The retailer has already replied.',
        already_followed_up: "You've already sent a follow-up. If there's still no reply, you can mark this resolved or contact the retailer another way.",
        too_soon: `A follow-up is available 72 hours after the complaint was sent.`,
        in_flight: 'Your follow-up is already being sent.',
      }
      throw new Error(why[rule.reason] ?? "A follow-up isn't available right now.")
    }
    await ctx.db.patch('protectionCases', c._id, { followUpInFlight: true, errorMessage: undefined })
    await ctx.scheduler.runAfter(0, internal.caseActions.deliverFollowUp, { caseId: c._id })
  },
})

export const markResolved = mutation({
  args: { caseId: v.id('protectionCases') },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    const c = await getOwnedCase(ctx, args.caseId, userId)
    if (c.status === 'resolved') return
    if (!SENT_STATUSES.includes(c.status)) throw new Error('Only a complaint that has been sent can be marked resolved.')
    await ctx.db.patch('protectionCases', c._id, { status: 'resolved', resolvedAt: Date.now(), followUpInFlight: false })
  },
})

// ---- Internal state transitions (called by actions and the webhook) ----

export const getComparisonContext = internalQuery({
  args: { caseId: v.id('protectionCases') },
  handler: async (ctx, args) => {
    const c = await ctx.db.get('protectionCases', args.caseId)
    if (c === null) return null
    const product = await ctx.db.get('products', c.productId)
    if (product === null) return null
    return { case: c, product }
  },
})

export const getSendContext = internalQuery({
  args: { caseId: v.id('protectionCases') },
  handler: async (ctx, args) => {
    const c = await ctx.db.get('protectionCases', args.caseId)
    if (c === null) return null
    const product = await ctx.db.get('products', c.productId)
    return { case: c, productName: product?.name ?? null }
  },
})

export const saveComparison = internalMutation({
  args: {
    caseId: v.id('protectionCases'),
    verdict: v.union(v.literal('possible_mismatch'), v.literal('no_reliable_mismatch'), v.literal('cannot_assess')),
    summary: v.string(),
    expected: v.string(),
    observed: v.string(),
    differences: v.array(v.object({ aspect: v.string(), expected: v.string(), observed: v.string() })),
    matches: v.array(v.string()),
    model: v.string(),
  },
  handler: async (ctx, args) => {
    const c = await ctx.db.get('protectionCases', args.caseId)
    if (c === null || c.status !== 'analyzing') return // cancelled or already handled meanwhile
    const { caseId, ...comparison } = args
    await ctx.db.patch('protectionCases', caseId, {
      comparison,
      status: args.verdict === 'possible_mismatch' ? 'draft' : 'no_mismatch',
      errorMessage: undefined,
    })
  },
})

export const markAnalysisFailed = internalMutation({
  args: { caseId: v.id('protectionCases'), errorMessage: v.string() },
  handler: async (ctx, args) => {
    const c = await ctx.db.get('protectionCases', args.caseId)
    if (c === null || c.status !== 'analyzing') return
    await ctx.db.patch('protectionCases', args.caseId, { status: 'analysis_failed', errorMessage: args.errorMessage })
  },
})

export const saveContact = internalMutation({
  args: { caseId: v.id('protectionCases'), email: v.optional(v.string()), sourceUrl: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const c = await ctx.db.get('protectionCases', args.caseId)
    if (c === null) return
    // Never overwrite an address the user already typed.
    const keepUsers = c.retailerEmailSource === 'entered_by_user'
    await ctx.db.patch('protectionCases', args.caseId, {
      contactSearched: true,
      ...(args.email && !keepUsers
        ? { retailerEmail: args.email, retailerEmailSource: 'found_on_site' as const, retailerEmailSourceUrl: args.sourceUrl }
        : {}),
    })
  },
})

export const markSent = internalMutation({
  args: {
    caseId: v.id('protectionCases'),
    inboxId: v.string(),
    threadId: v.string(),
    messageId: v.string(),
    actualRecipient: v.string(),
  },
  handler: async (ctx, args) => {
    const c = await ctx.db.get('protectionCases', args.caseId)
    if (c === null) return
    const now = Date.now()
    await ctx.db.patch('protectionCases', args.caseId, {
      status: 'complaint_sent',
      errorMessage: undefined,
      inboxId: args.inboxId,
      threadId: args.threadId,
      firstMessageId: args.messageId,
      actualRecipient: args.actualRecipient,
      sentAt: now,
      lastRetailerReplyAt: undefined,
    })
    await ctx.db.insert('caseMessages', {
      caseId: args.caseId,
      userId: c.userId,
      direction: 'outbound',
      kind: 'complaint',
      fromAddress: args.inboxId,
      toAddress: c.retailerEmail ?? args.actualRecipient,
      subject: c.subject ?? '',
      text: c.body ?? '',
      agentmailMessageId: args.messageId,
      at: now,
    })
    await ctx.scheduler.runAfter(WAITING_AFTER_MS, internal.cases.advanceToWaiting, { caseId: args.caseId })
  },
})

export const markSendFailed = internalMutation({
  args: { caseId: v.id('protectionCases'), errorMessage: v.string() },
  handler: async (ctx, args) => {
    const c = await ctx.db.get('protectionCases', args.caseId)
    if (c === null || c.status !== 'sending') return
    await ctx.db.patch('protectionCases', args.caseId, { status: 'send_failed', errorMessage: args.errorMessage })
  },
})

export const markFollowUpSent = internalMutation({
  args: { caseId: v.id('protectionCases'), messageId: v.string(), text: v.string(), subject: v.string() },
  handler: async (ctx, args) => {
    const c = await ctx.db.get('protectionCases', args.caseId)
    if (c === null) return
    const now = Date.now()
    await ctx.db.patch('protectionCases', args.caseId, {
      status: 'follow_up_sent',
      followUpCount: c.followUpCount + 1,
      lastFollowUpAt: now,
      followUpInFlight: false,
      errorMessage: undefined,
    })
    await ctx.db.insert('caseMessages', {
      caseId: args.caseId,
      userId: c.userId,
      direction: 'outbound',
      kind: 'follow_up',
      fromAddress: c.inboxId ?? '',
      toAddress: c.retailerEmail ?? c.actualRecipient ?? '',
      subject: args.subject,
      text: args.text,
      agentmailMessageId: args.messageId,
      at: now,
    })
  },
})

export const markFollowUpFailed = internalMutation({
  args: { caseId: v.id('protectionCases'), errorMessage: v.string() },
  handler: async (ctx, args) => {
    const c = await ctx.db.get('protectionCases', args.caseId)
    if (c === null) return
    await ctx.db.patch('protectionCases', args.caseId, { followUpInFlight: false, errorMessage: args.errorMessage })
  },
})

export const advanceToWaiting = internalMutation({
  args: { caseId: v.id('protectionCases') },
  handler: async (ctx, args) => {
    const c = await ctx.db.get('protectionCases', args.caseId)
    if (c !== null && c.status === 'complaint_sent') await ctx.db.patch('protectionCases', args.caseId, { status: 'waiting_for_retailer' })
  },
})

// A "sending" case that never finished (e.g. the action was interrupted) becomes retryable.
export const releaseStuckSending = mutation({
  args: { caseId: v.id('protectionCases') },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    const c = await getOwnedCase(ctx, args.caseId, userId)
    if (c.status !== 'sending') return
    if (Date.now() - (c.sendingAt ?? 0) < SENDING_STUCK_MS) throw new Error('Your complaint is still being sent.')
    await ctx.db.patch('protectionCases', c._id, {
      status: 'send_failed',
      errorMessage: "Sending didn't finish. Please check the address and try again.",
    })
  },
})

// ---- Inbound events from AgentMail (already signature-verified by the HTTP route) ----

type Matched = { case: Doc<'protectionCases'>; by: 'thread' | 'in_reply_to' | 'message_id' | 'case_ref' }

async function findCase(ctx: MutationCtx, k: InboundKeys): Promise<Matched | null> {
  if (k.threadId) {
    const c = await ctx.db.query('protectionCases').withIndex('by_threadId', (q) => q.eq('threadId', k.threadId)).first()
    if (c) return { case: c, by: 'thread' }
  }
  for (const [id, by] of [[k.inReplyTo, 'in_reply_to'], [k.messageId, 'message_id']] as const) {
    if (!id) continue
    const m = await ctx.db.query('caseMessages').withIndex('by_agentmailMessageId', (q) => q.eq('agentmailMessageId', id)).first()
    const c = m ? await ctx.db.get('protectionCases', m.caseId) : null
    if (c) return { case: c, by }
  }
  const ref = caseRefFromText(k.subject)
  if (ref) {
    const c = await ctx.db.query('protectionCases').withIndex('by_caseRef', (q) => q.eq('caseRef', ref)).first()
    if (c) return { case: c, by: 'case_ref' }
  }
  return null
}

export const handleAgentmailEvent = internalMutation({
  args: { event: v.any() },
  handler: async (ctx, args): Promise<{ handled: boolean; reason: string }> => {
    const k = extractInboundKeys(args.event, Date.now())
    if (k === null) return { handled: false, reason: 'unrecognised payload' }

    if (k.eventType === 'message.received') return await handleReceived(ctx, k)

    if (k.eventType === 'message.delivered' || k.eventType === 'message.bounced') {
      const m = await findCase(ctx, k)
      if (m === null) return { handled: false, reason: 'no matching case' }
      // Remember what AgentMail reported for this particular email, so the UI can show it.
      const row = k.messageId
        ? await ctx.db.query('caseMessages').withIndex('by_agentmailMessageId', (q) => q.eq('agentmailMessageId', k.messageId as string)).first()
        : null
      if (row !== null) {
        await ctx.db.patch('caseMessages', row._id, { deliveryStatus: k.eventType === 'message.delivered' ? 'delivered' : 'bounced', deliveryAt: k.at })
      }
      if (k.eventType === 'message.delivered') {
        if (m.case.status === 'complaint_sent') await ctx.db.patch('protectionCases', m.case._id, { status: 'waiting_for_retailer' })
        return { handled: true, reason: 'delivered' }
      }
      // A bounce means the address couldn't receive the email — recoverable by fixing the address and resending.
      if (SENT_STATUSES.includes(m.case.status) && m.case.followUpCount === 0 && m.case.lastRetailerReplyAt === undefined) {
        await ctx.db.patch('protectionCases', m.case._id, {
          status: 'send_failed',
          errorMessage: "The retailer's email address couldn't receive our message. Please check the address and send again.",
        })
      }
      return { handled: true, reason: 'bounced' }
    }
    return { handled: false, reason: `ignored ${k.eventType}` }
  },
})

async function handleReceived(ctx: MutationCtx, k: InboundKeys): Promise<{ handled: boolean; reason: string }> {
  if (!k.messageId) return { handled: false, reason: 'no message id' }
  const messageId = k.messageId

  // AgentMail retries deliveries: the same message must never be recorded twice.
  const dupe = await ctx.db.query('caseMessages').withIndex('by_agentmailMessageId', (q) => q.eq('agentmailMessageId', messageId)).first()
  const dupeUnmatched = await ctx.db.query('unmatchedInboundEmails').withIndex('by_agentmailMessageId', (q) => q.eq('agentmailMessageId', messageId)).first()
  if (dupe !== null || dupeUnmatched !== null) return { handled: true, reason: 'duplicate' }

  const unmatched = async (reason: string) => {
    await ctx.db.insert('unmatchedInboundEmails', {
      agentmailMessageId: messageId,
      fromAddress: k.sender ?? undefined,
      subject: k.subject?.slice(0, 300),
      receivedAt: k.at,
      reason,
    })
    return { handled: false, reason }
  }

  const m = await findCase(ctx, k)
  if (m === null) return await unmatched('no matching case')
  // Our own outgoing mail echoed back is not a reply.
  if (k.sender !== null && k.sender === m.case.inboxId?.toLowerCase()) return { handled: true, reason: 'own message' }
  // A match that rests only on the reference in the subject must come from the retailer's own domain.
  if (m.by === 'case_ref' && !senderMatchesRetailer(k.sender, m.case.retailerEmail)) return await unmatched('reference matched but sender is not the retailer')

  await ctx.db.insert('caseMessages', {
    caseId: m.case._id,
    userId: m.case.userId,
    direction: 'inbound',
    kind: 'reply',
    fromAddress: k.sender ?? 'unknown sender',
    toAddress: m.case.inboxId ?? '',
    subject: k.subject ?? '(no subject)',
    text: (k.text ?? '').slice(0, 8000),
    agentmailMessageId: messageId,
    at: k.at,
  })
  const patch: Partial<Doc<'protectionCases'>> = { lastRetailerReplyAt: k.at }
  if (SENT_STATUSES.includes(m.case.status)) patch.status = 'retailer_replied'
  await ctx.db.patch('protectionCases', m.case._id, patch)
  return { handled: true, reason: `matched by ${m.by}` }
}
