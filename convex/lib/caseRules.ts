// Rules for post-purchase cases: statuses, the follow-up rule, the complaint email, retailer contact
// discovery, and matching retailer replies (and webhooks) to the right case. All pure, so all tested.

import { isSameRetailer } from './alternativeMatching'

// ---- Statuses ----

export const CASE_STATUSES = [
  'analyzing', //        photo uploaded, comparison running
  'analysis_failed', //  comparison couldn't run (recoverable: retry)
  'no_mismatch', //      no reliable mismatch (or photo unusable) — nothing to send
  'draft', //            possible mismatch found; waiting for the user to review
  'cancelled', //        the user chose not to send anything
  'sending', //          user approved; email is being sent
  'send_failed', //      sending failed (recoverable: retry / fix address)
  'complaint_sent', //   AgentMail accepted the complaint
  'waiting_for_retailer', // delivered (or given time to arrive); no reply yet
  'retailer_replied', // the retailer wrote back
  'follow_up_sent', //   the user sent one follow-up
  'resolved', //         the user closed the case
] as const
export type CaseStatus = (typeof CASE_STATUSES)[number]

// A case in one of these is still "open" for its product: a second one can't be started on top of it.
export const OPEN_STATUSES: CaseStatus[] = [
  'analyzing', 'analysis_failed', 'draft', 'sending', 'send_failed',
  'complaint_sent', 'waiting_for_retailer', 'retailer_replied', 'follow_up_sent',
]
// Statuses in which an email has actually gone out.
export const SENT_STATUSES: CaseStatus[] = ['complaint_sent', 'waiting_for_retailer', 'retailer_replied', 'follow_up_sent']
export const CANCELLABLE_STATUSES: CaseStatus[] = ['analysis_failed', 'no_mismatch', 'draft', 'send_failed']

// ---- The follow-up rule ----
//
// Never automatic. The customer may send ONE follow-up, and only when the retailer hasn't replied, no sooner
// than 72 hours after the complaint. After that Fitr stops: repeated emails don't help, and the customer can
// mark the case resolved or contact the retailer another way.

export const FOLLOW_UP_AFTER_MS = 72 * 60 * 60 * 1000
export const MAX_FOLLOW_UPS = 1
export const MAX_COMPLAINTS_PER_DAY = 5

export type FollowUpInput = {
  status: CaseStatus
  sentAt?: number
  followUpCount: number
  followUpInFlight?: boolean
  lastRetailerReplyAt?: number
}

export type FollowUpStatus = {
  allowed: boolean
  reason: 'ok' | 'not_sent' | 'resolved' | 'retailer_replied' | 'already_followed_up' | 'too_soon' | 'in_flight'
  availableAt: number | null
}

export function followUpStatus(c: FollowUpInput, now: number): FollowUpStatus {
  if (!(c.status === 'complaint_sent' || c.status === 'waiting_for_retailer') || c.sentAt === undefined) {
    return { allowed: false, reason: c.status === 'retailer_replied' ? 'retailer_replied' : c.status === 'follow_up_sent' ? 'already_followed_up' : c.status === 'resolved' ? 'resolved' : 'not_sent', availableAt: null }
  }
  if (c.lastRetailerReplyAt !== undefined) return { allowed: false, reason: 'retailer_replied', availableAt: null }
  if (c.followUpCount >= MAX_FOLLOW_UPS) return { allowed: false, reason: 'already_followed_up', availableAt: null }
  if (c.followUpInFlight) return { allowed: false, reason: 'in_flight', availableAt: null }
  const availableAt = c.sentAt + FOLLOW_UP_AFTER_MS
  return now >= availableAt ? { allowed: true, reason: 'ok', availableAt } : { allowed: false, reason: 'too_soon', availableAt }
}

// ---- Email addresses ----

export function isValidEmail(value: string): boolean {
  return value.length <= 254 && /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[A-Za-z]{2,}$/.test(value)
}

// "Name <a@b.com>" or "a@b.com" -> lower-cased address.
export function parseAddress(from: unknown): string | null {
  if (typeof from !== 'string') return null
  const angle = from.match(/<([^<>\s]+)>/)
  const address = (angle ? angle[1] : from).trim().toLowerCase()
  return isValidEmail(address) ? address : null
}

const domainOf = (address: string) => address.slice(address.lastIndexOf('@') + 1)

// A reply is from the retailer if it comes from the address we wrote to, or the same company domain
// (support desks often reply from a different mailbox on the same domain).
export function senderMatchesRetailer(sender: string | null, retailerEmail: string | undefined): boolean {
  if (!sender || !retailerEmail) return false
  return sender === retailerEmail.toLowerCase() || isSameRetailer(`https://${domainOf(sender)}`, `https://${domainOf(retailerEmail.toLowerCase())}`)
}

// ---- Case reference (goes in the subject so replies can be matched even if threading is lost) ----

const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export function newCaseRef(random: () => number = Math.random): string {
  let out = ''
  for (let i = 0; i < 6; i++) out += REF_ALPHABET[Math.floor(random() * REF_ALPHABET.length)]
  return `FTR-${out}`
}
export function caseRefFromText(text: string | undefined): string | null {
  const m = text?.toUpperCase().match(/FTR-([A-HJ-NP-Z2-9]{6})/)
  return m ? `FTR-${m[1]}` : null
}

// ---- The complaint (a template, never free-form model text: it can't invent facts) ----

export type ComplaintInput = {
  retailerName?: string | null
  productName?: string | null
  productUrl: string
  caseRef: string
  note?: string
}

// Web-page text (product and retailer names) goes into an email header and greeting: one line, no control characters.
const oneLine = (t: string | null | undefined, max: number) => {
  const s = (t ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s
}

// "Hi Zara Support," — or a plain "Hi there," when there is no real retailer name (the stored fallback is "the retailer").
const greetingFor = (retailerName: string | null | undefined) => {
  const retailer = oneLine(retailerName, 80)
  return retailer && !/^the retailer$/i.test(retailer) ? `Hi ${retailer} Support,` : 'Hi there,'
}

// A short, neutral, polite email. It says only what Fitr knows — a possible mismatch found by comparing the listing with the
// customer's photo — and never blames the retailer or invents an order number, date, amount or tracking detail.
// The case reference stays in the subject so replies can be matched to the case.
export function buildComplaintEmail(i: ComplaintInput): { subject: string; text: string } {
  const product = oneLine(i.productName, 100)
  const greeting = greetingFor(i.retailerName)

  const lines = [
    'Fitr Support',
    '',
    greeting,
    '',
    'We noticed a possible issue with an item received by a customer.',
    '',
    "Fitr compared the item with the original product listing and found a possible mismatch. We've attached a photo of the item received for reference.",
    '',
    ...(product ? [`Item: ${product}`] : []),
    `Listing: ${i.productUrl}`,
  ]
  const note = i.note?.trim()
  if (note) lines.push('', 'Additional details from the customer:', note)
  lines.push(
    '',
    'Could you please take a look and let us know how we can resolve this?',
    '',
    `Case: ${i.caseRef}`,
    '',
    'Thanks,',
    'Fitr Support',
  )
  return {
    subject: `Possible issue with ${product || 'a received item'} — Fitr Case ${i.caseRef}`,
    text: lines.join('\n'),
  }
}

// The one follow-up (see followUpStatus): same identity and tone as the complaint — short, polite, neutral. It refers to
// our own earlier message by its real send date and case reference, and adds nothing Fitr doesn't know.
export type FollowUpEmailInput = {
  retailerName?: string | null
  productName?: string | null
  caseRef: string
  sentAt: number
}

export function buildFollowUpEmail(i: FollowUpEmailInput): { text: string } {
  const product = oneLine(i.productName, 100)
  const date = new Date(i.sentAt).toISOString().slice(0, 10)
  return {
    text: [
      'Fitr Support',
      '',
      greetingFor(i.retailerName),
      '',
      `We're following up on our message of ${date} about a possible mismatch with an item received by a customer.`,
      ...(product ? ['', `Item: ${product}`] : []),
      '',
      "We haven't heard back yet. Could you please take a look and let us know how we can resolve this?",
      '',
      `Case: ${i.caseRef}`,
      '',
      'Thanks,',
      'Fitr Support',
    ].join('\n'),
  }
}

// ---- Finding the retailer's contact email (only addresses actually printed on the retailer's own pages) ----

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g
const IGNORED_EMAIL_DOMAINS = /(^|\.)(example\.com|sentry\.io|wixpress\.com|shopify\.com|domain\.com|email\.com)$/i
const BAD_LOCAL = /^(no-?reply|do-?not-?reply|privacy|press|media|careers?|jobs?|legal|dpo|gdpr|abuse|security|webmaster|marketing|wholesale|partner(ship)?s?|affiliates?|investors?|unsubscribe|bounces?|hr|recruit(ing|ment)?)$/i
const GOOD_LOCAL = ['support', 'help', 'customerservice', 'customer-service', 'customercare', 'customer-care', 'care', 'service', 'contact', 'hello', 'info', 'orders', 'returns', 'cs', 'team']

export function extractEmails(text: string): string[] {
  const found = new Set<string>()
  for (const m of text.matchAll(EMAIL_RE)) {
    const address = m[0].toLowerCase().replace(/[.,;:]+$/, '')
    if (!isValidEmail(address)) continue
    if (/\.(png|jpe?g|gif|webp|svg)$/.test(address)) continue
    found.add(address)
  }
  return [...found]
}

export function rankContactEmail(emails: string[], siteUrl: string): string | null {
  const scored = emails
    .filter((e) => !BAD_LOCAL.test(e.split('@')[0]) && !IGNORED_EMAIL_DOMAINS.test(domainOf(e)))
    .map((e) => {
      const local = e.split('@')[0]
      const goodIndex = GOOD_LOCAL.indexOf(local)
      const sameSite = isSameRetailer(`https://${domainOf(e)}`, siteUrl)
      return { e, score: (sameSite ? 100 : 0) + (goodIndex >= 0 ? GOOD_LOCAL.length - goodIndex : 0) }
    })
    // An address on some other domain is too likely to be a third party's; require it to be the retailer's.
    .filter((x) => x.score >= 100)
    .sort((a, b) => b.score - a.score)
  return scored[0]?.e ?? null
}

const CONTACT_LINK = /contact|customer[-_ ]?(service|care|support)|help|support|get[-_ ]?in[-_ ]?touch|faq/i
const NOT_CONTACT = /blog|journal|article|review|careers?|press|privacy|terms|cart|account|login|search|collection|product/i

// Same-site pages worth reading for a contact address; at most two.
export function findContactLinks(sourceUrl: string, links: string[]): string[] {
  let base: URL
  try {
    base = new URL(sourceUrl)
  } catch {
    return []
  }
  const seen = new Set<string>()
  const out: Array<{ url: string; score: number }> = []
  for (const raw of links) {
    let url: URL
    try {
      url = new URL(raw, base)
    } catch {
      continue
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') continue
    url.hash = ''
    const key = url.toString()
    if (seen.has(key) || !isSameRetailer(key, sourceUrl) || url.pathname === base.pathname) continue
    seen.add(key)
    const path = decodeURIComponent(url.pathname).toLowerCase()
    if (!CONTACT_LINK.test(path) || NOT_CONTACT.test(path)) continue
    out.push({ url: key, score: /contact/.test(path) ? 2 : 1 })
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 2).map((o) => o.url)
}

// ---- Inbound webhooks ----

// Pulls the identifiers used to match an AgentMail event to a case. Tolerant of the event-specific wrapper
// (message.received nests under `message`; delivery/bounce events nest under their own key).
export type InboundKeys = {
  eventType: string
  messageId?: string
  threadId?: string
  inReplyTo?: string
  sender: string | null
  subject?: string
  text?: string
  at: number
  bounceRecipients?: string[]
}

const str = (v: unknown, max = 20000): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v.slice(0, max) : undefined)

export function extractInboundKeys(event: unknown, now: number): InboundKeys | null {
  if (typeof event !== 'object' || event === null) return null
  const e = event as Record<string, unknown>
  const eventType = str(e.event_type, 80)
  if (!eventType) return null
  const inner = (e.message ?? e.bounce ?? e.delivery ?? e.send ?? e) as Record<string, unknown>
  if (typeof inner !== 'object' || inner === null) return null
  const ts = typeof inner.timestamp === 'string' ? Date.parse(inner.timestamp) : NaN
  const recipients = Array.isArray(inner.recipients)
    ? inner.recipients.map((r) => (typeof r === 'string' ? r : str((r as { address?: unknown })?.address))).filter((r): r is string => !!r)
    : undefined
  return {
    eventType,
    messageId: str(inner.message_id, 300),
    threadId: str(inner.thread_id, 300),
    inReplyTo: str(inner.in_reply_to, 300),
    sender: parseAddress(inner.from),
    subject: str(inner.subject, 500),
    text: str(inner.extracted_text) ?? str(inner.text) ?? str(inner.preview),
    at: Number.isFinite(ts) ? ts : now,
    bounceRecipients: recipients,
  }
}

// ---- Svix webhook signatures (what AgentMail uses) ----

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export async function verifySvixSignature(p: {
  secret: string
  id: string | null
  timestamp: string | null
  signatureHeader: string | null
  body: string
  nowSeconds: number
  toleranceSeconds?: number
}): Promise<boolean> {
  if (!p.id || !p.timestamp || !p.signatureHeader) return false
  const ts = Number(p.timestamp)
  if (!Number.isFinite(ts) || Math.abs(p.nowSeconds - ts) > (p.toleranceSeconds ?? 300)) return false
  let key: CryptoKey
  try {
    const raw = base64ToBytes(p.secret.startsWith('whsec_') ? p.secret.slice(6) : p.secret)
    key = await crypto.subtle.importKey('raw', raw as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  } catch {
    return false
  }
  const signed = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${p.id}.${p.timestamp}.${p.body}`))
  const expected = bytesToBase64(new Uint8Array(signed))
  return p.signatureHeader.split(' ').some((part) => {
    const [version, sig] = part.split(',')
    return version === 'v1' && !!sig && timingSafeEqual(sig, expected)
  })
}
