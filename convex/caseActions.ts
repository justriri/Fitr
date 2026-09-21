import { v } from 'convex/values'
import { internal } from './_generated/api'
import { internalAction } from './_generated/server'
import {
  buildComparisonUserText,
  COMPARISON_JSON_SCHEMA,
  COMPARISON_SYSTEM_PROMPT,
  decideVerdict,
  parseModelComparison,
  type Decision,
} from './lib/caseComparison'
import { buildFollowUpEmail, extractEmails, findContactLinks, isValidEmail, rankContactEmail } from './lib/caseRules'
import { MIN_GARMENT_PX, readImageSize, sniffImageType, upgradeImageUrl, usableProductImageUrls } from './lib/imageChecks'

const DEFAULT_VISION_MODEL = 'gpt-4.1'
const INBOX_CLIENT_ID = 'fitr-post-purchase-protection'

// Optional overrides so failure paths can be exercised without touching the real API keys.
const firecrawlBase = () => (process.env.FIRECRAWL_BASE_URL || 'https://api.firecrawl.dev').replace(/\/$/, '')
const agentmailBase = () => (process.env.AGENTMAIL_BASE_URL || 'https://api.agentmail.to').replace(/\/$/, '')

function toBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

const cannotAssess = (summary: string): Decision => ({ verdict: 'cannot_assess', summary, differences: [], matches: [] })

// ---------------------------------------------------------------------------------------------
// 1. Compare what was ordered with what was received
// ---------------------------------------------------------------------------------------------

async function loadListingImage(images: string[] | undefined): Promise<{ bytes: Uint8Array; type: string } | null> {
  const candidates: string[] = []
  for (const url of usableProductImageUrls(images).slice(0, 3)) {
    const upgraded = upgradeImageUrl(url)
    if (upgraded) candidates.push(upgraded)
    candidates.push(url)
  }
  for (const url of candidates.slice(0, 5)) {
    try {
      const res = await fetch(url, { headers: { Accept: 'image/jpeg,image/png,image/webp;q=0.9,*/*;q=0.1' }, signal: AbortSignal.timeout(20_000) })
      if (!res.ok) continue
      const bytes = new Uint8Array(await res.arrayBuffer())
      const type = sniffImageType(bytes)
      const size = type ? readImageSize(bytes, type) : null
      if (type && size && Math.min(size.w, size.h) >= MIN_GARMENT_PX && bytes.length < 15 * 1024 * 1024) return { bytes, type }
    } catch {
      continue
    }
  }
  return null
}

class CompareError extends Error {}

async function compareWithVision(
  apiKey: string,
  model: string,
  listingText: string,
  listing: { bytes: Uint8Array; type: string },
  received: { bytes: Uint8Array; type: string },
): Promise<unknown> {
  let res: Response
  try {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: COMPARISON_SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'text', text: listingText },
              // Each image is labelled where it sits: with two unlabelled images the model sometimes decided the
              // second one had "not come through" when it closely resembled the listing photo.
              { type: 'text', text: 'Image 1 — the LISTING photo:' },
              { type: 'image_url', image_url: { url: `data:${listing.type};base64,${toBase64(listing.bytes)}`, detail: 'high' } },
              { type: 'text', text: 'Image 2 — the shopper photo of the item they received:' },
              { type: 'image_url', image_url: { url: `data:${received.type};base64,${toBase64(received.bytes)}`, detail: 'high' } },
            ],
          },
        ],
        response_format: { type: 'json_schema', json_schema: { name: 'received_item_comparison', strict: true, schema: COMPARISON_JSON_SCHEMA } },
      }),
      signal: AbortSignal.timeout(120_000),
    })
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')
    throw new CompareError(timedOut ? 'The comparison took too long. Please try again.' : "Couldn't reach the comparison service. Please try again.")
  }
  if (!res.ok) {
    let code = ''
    let detail = ''
    try {
      const err = ((await res.json()) as { error?: { code?: unknown; message?: unknown } })?.error
      code = String(err?.code ?? '')
      detail = String(err?.message ?? '')
    } catch {
      // non-JSON error body
    }
    console.log(`Fitr case comparison: OpenAI failed status=${res.status} code=${code} message=${detail.slice(0, 200)}`)
    if (res.status === 401 || res.status === 403) throw new CompareError('The photo comparison is misconfigured — OpenAI rejected the configured API key.')
    if (res.status === 429 && /quota|billing|credit/i.test(detail + code)) throw new CompareError('The photo comparison has reached its usage limit (OpenAI quota or billing).')
    if (res.status === 429) throw new CompareError('Too many requests right now. Please try again in a moment.')
    if (res.status === 404 || /model_not_found/i.test(code)) throw new CompareError("The configured OpenAI model isn't available for this account.")
    throw new CompareError('The comparison service had a problem. Please try again.')
  }
  const body = (await res.json().catch(() => null)) as { choices?: Array<{ message?: { content?: unknown; refusal?: unknown } }> } | null
  const content = body?.choices?.[0]?.message?.content
  if (typeof content !== 'string') throw new CompareError("The comparison service couldn't assess these photos. Please try again with clearer photos.")
  try {
    return JSON.parse(content)
  } catch {
    throw new CompareError('The comparison service returned an unexpected response. Please try again.')
  }
}

// ---- Finding the retailer's contact email: only an address printed on the retailer's own pages ----

async function scrapeMarkdownAndLinks(apiKey: string, url: string, full: boolean): Promise<{ markdown: string; links: string[] } | null> {
  try {
    const res = await fetch(`${firecrawlBase()}/v2/scrape`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ url, onlyMainContent: !full, formats: full ? ['links', 'markdown'] : ['markdown'] }),
      signal: AbortSignal.timeout(40_000),
    })
    if (!res.ok) return null
    const body = (await res.json()) as { success?: unknown; data?: { markdown?: unknown; links?: unknown } }
    if (body?.success !== true || typeof body.data !== 'object' || body.data === null) return null
    return {
      markdown: typeof body.data.markdown === 'string' ? body.data.markdown : '',
      links: Array.isArray(body.data.links) ? body.data.links.filter((l): l is string => typeof l === 'string') : [],
    }
  } catch {
    return null
  }
}

async function discoverContact(apiKey: string, sourceUrl: string): Promise<{ email: string; sourceUrl: string } | null> {
  // The footer of the product page itself often lists the address.
  const page = await scrapeMarkdownAndLinks(apiKey, sourceUrl, true)
  if (page === null) return null
  const direct = rankContactEmail(extractEmails(page.markdown), sourceUrl)
  if (direct) return { email: direct, sourceUrl }
  for (const link of findContactLinks(sourceUrl, page.links)) {
    const contact = await scrapeMarkdownAndLinks(apiKey, link, false)
    const email = contact ? rankContactEmail(extractEmails(contact.markdown), sourceUrl) : null
    if (email) return { email, sourceUrl: link }
  }
  return null
}

export const runComparison = internalAction({
  args: { caseId: v.id('protectionCases') },
  handler: async (ctx, args): Promise<void> => {
    const fail = (errorMessage: string) => ctx.runMutation(internal.cases.markAnalysisFailed, { caseId: args.caseId, errorMessage })
    const save = (d: Decision, expected: string, observed: string, model: string) =>
      ctx.runMutation(internal.cases.saveComparison, {
        caseId: args.caseId, verdict: d.verdict, summary: d.summary, expected, observed, differences: d.differences, matches: d.matches, model,
      })

    try {
      const context = await ctx.runQuery(internal.cases.getComparisonContext, { caseId: args.caseId })
      if (context === null) return
      const { case: c, product } = context

      const apiKey = process.env.OPENAI_API_KEY
      if (!apiKey) {
        await fail("Photo comparison isn't configured yet — OPENAI_API_KEY is missing on the Convex deployment.")
        return
      }

      // The customer's photo: must be a real, readable image.
      const blob = await ctx.storage.get(c.receivedPhotoId)
      const receivedBytes = blob ? new Uint8Array(await blob.arrayBuffer()) : null
      const receivedType = receivedBytes ? sniffImageType(receivedBytes) : null
      const receivedSize = receivedBytes && receivedType ? readImageSize(receivedBytes, receivedType) : null
      if (!receivedBytes || !receivedType || !receivedSize || Math.min(receivedSize.w, receivedSize.h) < 200) {
        await save(cannotAssess("That file isn't a readable photo. Please try again with a JPG or PNG photo of the item you received."), '', '', 'none')
        return
      }

      // The original listing photo we compare against.
      const listing = await loadListingImage(product.images)
      if (listing === null) {
        await save(cannotAssess("We couldn't load a usable photo of the original listing to compare with, so we can't check this."), '', '', 'none')
        return
      }

      const model = process.env.OPENAI_VISION_MODEL || DEFAULT_VISION_MODEL
      const started = Date.now()
      const raw = await compareWithVision(apiKey, model, buildComparisonUserText({
        name: product.name, category: product.category, color: product.color, material: product.material,
        fit: product.fit, description: product.description, retailer: product.retailer,
      }), listing, { bytes: receivedBytes, type: receivedType })

      const parsed = parseModelComparison(raw)
      if (parsed === null) {
        await fail('The comparison returned an unexpected result. Please try again.')
        return
      }
      const decision = decideVerdict(parsed)
      console.log(`Fitr case comparison: model=${model} verdict=${decision.verdict} differences=${decision.differences.length} in ${Math.round((Date.now() - started) / 100) / 10}s`)
      await save(decision, parsed.listingSummary, parsed.receivedSummary, model)

      // Only when there is something to report do we look for where to report it. Never fatal.
      if (decision.verdict === 'possible_mismatch') {
        const firecrawlKey = process.env.FIRECRAWL_API_KEY
        let found: { email: string; sourceUrl: string } | null = null
        if (firecrawlKey) {
          try {
            found = await discoverContact(firecrawlKey, product.sourceUrl)
          } catch (e) {
            console.log('Fitr case: contact discovery failed', e instanceof Error ? e.message : String(e))
          }
        }
        await ctx.runMutation(internal.cases.saveContact, { caseId: args.caseId, email: found?.email, sourceUrl: found?.sourceUrl })
      }
    } catch (e) {
      console.log('Fitr case comparison: failed', e instanceof Error ? e.message : String(e))
      await fail(e instanceof CompareError ? e.message : 'Something went wrong comparing your photo. Please try again.')
    }
  },
})

// ---------------------------------------------------------------------------------------------
// 2. AgentMail (server-side only)
// ---------------------------------------------------------------------------------------------

class MailError extends Error {
  status: number
  constructor(message: string, status = 0) {
    super(message)
    this.status = status
  }
}

async function agentmail(method: 'GET' | 'POST', path: string, body?: unknown): Promise<Record<string, unknown>> {
  const key = process.env.AGENTMAIL_API_KEY
  if (!key) throw new MailError("Sending email isn't configured yet — AGENTMAIL_API_KEY is missing on the Convex deployment.")
  let res: Response
  try {
    res = await fetch(`${agentmailBase()}${path}`, {
      method,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    })
  } catch {
    throw new MailError("Couldn't reach the email service. Please try again.")
  }
  if (!res.ok) {
    let detail = ''
    let code = ''
    try {
      const err = (await res.json()) as { message?: unknown; name?: unknown; code?: unknown }
      detail = String(err?.message ?? err?.name ?? '').slice(0, 160)
      code = String(err?.code ?? '').slice(0, 60)
    } catch {
      // non-JSON error body
    }
    // Status, AgentMail's error code and message are safe to log; the key never is.
    console.log(`Fitr case: AgentMail ${method} ${path.replace(/\/inboxes\/[^/]+/, '/inboxes/…')} failed status=${res.status} code=${code} ${detail}`)
    // 401 means the key itself was refused. 403 means the key is valid but not allowed to do this (permission, plan or scope).
    if (res.status === 401) throw new MailError('Email sending is misconfigured — AgentMail rejected the configured API key.', res.status)
    if (res.status === 403) throw new MailError(`AgentMail accepted the API key but denied this action${code ? ` (${code})` : ''}. Check the key's permissions and your AgentMail plan.`, res.status)
    if (res.status === 429) throw new MailError('The email service is busy. Please try again in a moment.', res.status)
    if (res.status === 400 || res.status === 422) throw new MailError(`The email service rejected this message${detail ? ` (${detail})` : ''}. Please check the retailer's address.`, res.status)
    throw new MailError('The email service had a problem. Please try again.', res.status)
  }
  return ((await res.json().catch(() => ({}))) as Record<string, unknown>) ?? {}
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined)

// One shared Fitr inbox. Reuse an inbox the account already has (Fitr's own, else the first one) and only create
// one when there is none: an account may not be allowed to create more (AgentMail answers 403 `inbox_create`).
// Replies are matched by thread, not by inbox.
async function ensureInbox(): Promise<string> {
  const list = await agentmail('GET', '/v0/inboxes?limit=100')
  const inboxes = Array.isArray(list.inboxes) ? (list.inboxes as Array<Record<string, unknown>>) : []
  const existing = str((inboxes.find((i) => i.client_id === INBOX_CLIENT_ID) ?? inboxes[0])?.inbox_id)
  if (existing) return existing

  const created = await agentmail('POST', '/v0/inboxes', { client_id: INBOX_CLIENT_ID, display_name: 'Fitr Support' })
  const id = str(created.inbox_id)
  if (!id) throw new MailError("Couldn't set up the sending inbox. Please try again.")
  return id
}

// In a dev deployment, AGENTMAIL_TEST_RECIPIENT redirects every outgoing email to that address so no
// real retailer is contacted while testing. The redirect is stated in the subject and the body.
function outgoing(retailerEmail: string, subject: string, text: string) {
  const test = process.env.AGENTMAIL_TEST_RECIPIENT?.trim()
  if (test && isValidEmail(test)) {
    return {
      to: test,
      subject: `[Fitr test — intended for ${retailerEmail}] ${subject}`,
      text: `[Fitr test mode: this message would normally be sent to ${retailerEmail}]\n\n${text}`,
    }
  }
  return { to: retailerEmail, subject, text }
}

export const deliverComplaint = internalAction({
  args: { caseId: v.id('protectionCases') },
  handler: async (ctx, args): Promise<void> => {
    const context = await ctx.runQuery(internal.cases.getSendContext, { caseId: args.caseId })
    if (context === null || context.case.status !== 'sending') return
    const c = context.case
    const fail = (errorMessage: string) => ctx.runMutation(internal.cases.markSendFailed, { caseId: args.caseId, errorMessage })

    let sent: { inboxId: string; threadId: string; messageId: string; to: string }
    try {
      if (!c.retailerEmail || !c.subject || !c.body) {
        await fail("Add the retailer's email address, then try again.")
        return
      }
      const blob = await ctx.storage.get(c.receivedPhotoId)
      if (blob === null) {
        await fail('Your photo could not be found. Please start the check again.')
        return
      }
      const bytes = new Uint8Array(await blob.arrayBuffer())
      const type = sniffImageType(bytes) ?? 'image/jpeg'

      const inboxId = await ensureInbox()
      const mail = outgoing(c.retailerEmail, c.subject, c.body)
      const res = await agentmail('POST', `/v0/inboxes/${encodeURIComponent(inboxId)}/messages/send`, {
        to: [mail.to],
        subject: mail.subject,
        text: mail.text,
        attachments: [{ filename: type === 'image/png' ? 'item-received.png' : type === 'image/webp' ? 'item-received.webp' : 'item-received.jpg', content_type: type, content: toBase64(bytes) }],
        labels: ['fitr-protection', c.caseRef],
      })
      const messageId = str(res.message_id)
      const threadId = str(res.thread_id)
      if (!messageId || !threadId) throw new MailError('The email service returned an unexpected response. Please try again.')
      sent = { inboxId, threadId, messageId, to: mail.to }
    } catch (e) {
      console.log('Fitr case: complaint not sent', e instanceof Error ? e.message : String(e))
      await fail(e instanceof MailError ? e.message : 'Something went wrong sending your complaint. Please try again.')
      return
    }
    await ctx.runMutation(internal.cases.markSent, { caseId: args.caseId, inboxId: sent.inboxId, threadId: sent.threadId, messageId: sent.messageId, actualRecipient: sent.to })
  },
})

export const deliverFollowUp = internalAction({
  args: { caseId: v.id('protectionCases') },
  handler: async (ctx, args): Promise<void> => {
    const context = await ctx.runQuery(internal.cases.getSendContext, { caseId: args.caseId })
    if (context === null) return
    const c = context.case
    const fail = (errorMessage: string) => ctx.runMutation(internal.cases.markFollowUpFailed, { caseId: args.caseId, errorMessage })

    let result: { messageId: string; subject: string; text: string }
    try {
      if (!c.retailerEmail || !c.inboxId || !c.firstMessageId || c.sentAt === undefined || !c.subject) {
        await fail("We couldn't find the original email to follow up on.")
        return
      }
      const { text: rawText } = buildFollowUpEmail({ retailerName: c.retailerName, productName: context.productName, caseRef: c.caseRef, sentAt: c.sentAt })
      const mail = outgoing(c.retailerEmail, `Re: ${c.subject}`, rawText)

      // Preferably in the same thread; if the reply endpoint refuses, send it as a new message that carries the reference.
      let res: Record<string, unknown>
      try {
        res = await agentmail('POST', `/v0/inboxes/${encodeURIComponent(c.inboxId)}/messages/${encodeURIComponent(c.firstMessageId)}/reply`, { to: [mail.to], text: mail.text })
      } catch (e) {
        if (!(e instanceof MailError) || e.status < 400 || e.status >= 500 || e.status === 401 || e.status === 403 || e.status === 429) throw e
        res = await agentmail('POST', `/v0/inboxes/${encodeURIComponent(c.inboxId)}/messages/send`, { to: [mail.to], subject: mail.subject, text: mail.text, labels: ['fitr-protection', c.caseRef] })
      }
      const messageId = str(res.message_id)
      if (!messageId) throw new MailError('The email service returned an unexpected response. Please try again.')
      result = { messageId, subject: mail.subject, text: mail.text }
    } catch (e) {
      console.log('Fitr case: follow-up not sent', e instanceof Error ? e.message : String(e))
      await fail(e instanceof MailError ? e.message : 'Something went wrong sending your follow-up. Please try again.')
      return
    }
    await ctx.runMutation(internal.cases.markFollowUpSent, { caseId: args.caseId, messageId: result.messageId, text: result.text, subject: result.subject })
  },
})

// One-time setup: `npx convex run caseActions:registerWebhook` registers this deployment's webhook URL with
// AgentMail and returns the signing secret to store as AGENTMAIL_WEBHOOK_SECRET.
export const registerWebhook = internalAction({
  args: {},
  handler: async (): Promise<{ webhookId: string | null; url: string; secret: string | null }> => {
    const site = process.env.CONVEX_SITE_URL
    if (!site) throw new Error('CONVEX_SITE_URL is not available on this deployment.')
    const url = `${site.replace(/\/$/, '')}/agentmail/webhook`
    const res = await agentmail('POST', '/v0/webhooks', {
      url,
      event_types: ['message.received', 'message.delivered', 'message.bounced'],
      client_id: 'fitr-post-purchase-protection',
    })
    return { webhookId: str(res.webhook_id) ?? null, url, secret: str(res.secret) ?? null }
  },
})
