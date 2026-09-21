import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import {
  buildComplaintEmail,
  buildFollowUpEmail,
  caseRefFromText,
  extractEmails,
  extractInboundKeys,
  findContactLinks,
  followUpStatus,
  FOLLOW_UP_AFTER_MS,
  isValidEmail,
  newCaseRef,
  parseAddress,
  rankContactEmail,
  senderMatchesRetailer,
  verifySvixSignature,
} from '../convex/lib/caseRules'

let passed = 0
function test(name: string, fn: () => void | Promise<void>) {
  const run = async () => {
    try { await fn(); passed++; console.log('  ok  ', name) } catch (e) { console.log('  FAIL', name, '\n      ', (e as Error).message); process.exitCode = 1 }
  }
  queue.push(run)
}
const queue: Array<() => Promise<void>> = []

const HOUR = 3_600_000
const SENT = 1_000_000_000_000
const base = { status: 'complaint_sent' as const, sentAt: SENT, followUpCount: 0 }

console.log('follow-up rule: one, never automatic, only after 72h, only without a reply')
test('too soon: not allowed just before 72 hours, and says when it becomes available', () => {
  const r = followUpStatus(base, SENT + FOLLOW_UP_AFTER_MS - 1)
  assert.deepEqual(r, { allowed: false, reason: 'too_soon', availableAt: SENT + 72 * HOUR })
})
test('allowed from exactly 72 hours after the complaint', () => {
  assert.equal(followUpStatus(base, SENT + 72 * HOUR).allowed, true)
  assert.equal(followUpStatus({ ...base, status: 'waiting_for_retailer' }, SENT + 100 * HOUR).allowed, true)
})
test('never once the retailer has replied', () => {
  assert.equal(followUpStatus({ ...base, lastRetailerReplyAt: SENT + HOUR }, SENT + 999 * HOUR).reason, 'retailer_replied')
  assert.equal(followUpStatus({ ...base, status: 'retailer_replied' }, SENT + 999 * HOUR).allowed, false)
})
test('only ONE follow-up: not after one was sent, however long ago', () => {
  assert.equal(followUpStatus({ ...base, status: 'follow_up_sent', followUpCount: 1 }, SENT + 9999 * HOUR).allowed, false)
  assert.equal(followUpStatus({ ...base, followUpCount: 1 }, SENT + 9999 * HOUR).reason, 'already_followed_up')
})
test('not while one is being sent (no duplicate submission)', () => {
  assert.equal(followUpStatus({ ...base, followUpInFlight: true }, SENT + 100 * HOUR).reason, 'in_flight')
  assert.equal(followUpStatus({ ...base, status: 'resolved' }, SENT + 100 * HOUR).reason, 'resolved')
})
test('not for a case that was never sent', () => {
  for (const status of ['draft', 'sending', 'send_failed', 'analyzing', 'cancelled', 'no_mismatch', 'resolved'] as const) {
    assert.equal(followUpStatus({ status, followUpCount: 0 }, SENT + 999 * HOUR).allowed, false, status)
  }
})

console.log('\nemail addresses')
test('validation', () => {
  for (const ok of ['hello@girlfriend.com', 'a.b+c@sub.example.co.uk']) assert.ok(isValidEmail(ok), ok)
  for (const bad of ['', 'no-at.com', 'a@b', 'a b@c.com', '<a@b.com>', 'a@b.c', 'x'.repeat(250) + '@a.com']) assert.ok(!isValidEmail(bad), bad)
})
test('parseAddress handles display names and case', () => {
  assert.equal(parseAddress('Support Team <Help@Shop.COM>'), 'help@shop.com')
  assert.equal(parseAddress('help@shop.com'), 'help@shop.com')
  assert.equal(parseAddress('not an address'), null)
  assert.equal(parseAddress(undefined), null)
})
test('a reply counts as the retailer\'s only from that address or the same company domain', () => {
  assert.ok(senderMatchesRetailer('hello@girlfriend.com', 'hello@girlfriend.com'))
  assert.ok(senderMatchesRetailer('agent.sam@girlfriend.com', 'hello@girlfriend.com'), 'another mailbox at the company')
  assert.ok(senderMatchesRetailer('support@help.girlfriend.com', 'hello@girlfriend.com'), 'their help-desk subdomain')
  assert.ok(!senderMatchesRetailer('attacker@evil.com', 'hello@girlfriend.com'))
  assert.ok(!senderMatchesRetailer('hello@girlfriend.com.evil.com', 'hello@girlfriend.com'))
  assert.ok(!senderMatchesRetailer(null, 'hello@girlfriend.com') && !senderMatchesRetailer('a@b.com', undefined))
})

console.log('\ncase reference')
test('format, alphabet and uniqueness', () => {
  const refs = new Set(Array.from({ length: 200 }, () => newCaseRef()))
  assert.ok(refs.size > 190)
  for (const r of refs) assert.match(r, /^FTR-[A-HJ-NP-Z2-9]{6}$/)
})
test('found in a reply subject, case-insensitively; absent otherwise', () => {
  assert.equal(caseRefFromText('Re: Possible product mismatch: LONG KNIT DRESS [FTR-K7M2QX]'), 'FTR-K7M2QX')
  assert.equal(caseRefFromText('re: ftr-k7m2qx thanks'), 'FTR-K7M2QX')
  assert.equal(caseRefFromText('Hello there'), null)
  assert.equal(caseRefFromText(undefined), null)
})

console.log('\ncomplaint email: short, neutral, and says only what Fitr knows')
const COMPLAINT = {
  retailerName: 'Zara', productName: 'LONG KNIT DRESS', productUrl: 'https://www.zara.com/ww/en/long-knit-dress-p02142156.html',
  caseRef: 'FTR-K7M2QX',
}
test('subject: simple, with the product name and the case reference', () => {
  assert.equal(buildComplaintEmail(COMPLAINT).subject, 'Possible issue with LONG KNIT DRESS — Fitr Case FTR-K7M2QX')
})
test('subject falls back safely (no invented product) when the product name is unavailable', () => {
  for (const productName of [undefined, null, '', '   ']) {
    assert.equal(buildComplaintEmail({ ...COMPLAINT, productName }).subject, 'Possible issue with a received item — Fitr Case FTR-K7M2QX')
  }
})
test('subject keeps the case reference (needed to match replies) even for a very long product name, and stays on one line', () => {
  const { subject } = buildComplaintEmail({ ...COMPLAINT, productName: 'A'.repeat(400) })
  assert.ok(subject.endsWith('— Fitr Case FTR-K7M2QX') && subject.length < 160)
  const injected = buildComplaintEmail({ ...COMPLAINT, productName: 'Dress\r\nBcc: attacker@evil.example' }).subject
  assert.ok(!/[\r\n]/.test(injected))
  assert.equal(caseRefFromText(subject), 'FTR-K7M2QX')
})
test('body is exactly the short, polite message: Fitr Support, greeting, what happened, photo, ask, case, thanks', () => {
  assert.equal(
    buildComplaintEmail(COMPLAINT).text,
    [
      'Fitr Support',
      '',
      'Hi Zara Support,',
      '',
      'We noticed a possible issue with an item received by a customer.',
      '',
      "Fitr compared the item with the original product listing and found a possible mismatch. We've attached a photo of the item received for reference.",
      '',
      'Item: LONG KNIT DRESS',
      'Listing: https://www.zara.com/ww/en/long-knit-dress-p02142156.html',
      '',
      'Could you please take a look and let us know how we can resolve this?',
      '',
      'Case: FTR-K7M2QX',
      '',
      'Thanks,',
      'Fitr Support',
    ].join('\n'),
  )
})
test('it is short', () => {
  const { text } = buildComplaintEmail(COMPLAINT)
  assert.ok(text.length < 700 && text.split('\n').length <= 20, `${text.length} chars`)
})
test('says "possible mismatch" and never blames the retailer', () => {
  const { text } = buildComplaintEmail(COMPLAINT)
  assert.match(text, /possible mismatch/)
  assert.ok(!/\b(wrong item|you sent|sent the wrong|your mistake|your fault|fraud|scam|refuse|demand|legal|sue|complain|complaint)\b/i.test(text))
})
test('invents no order number, purchase date, refund amount, tracking or delivery date', () => {
  const { text } = buildComplaintEmail(COMPLAINT)
  assert.ok(!/(order (number|no\.?|#|id)|tracking|refund|invoice|purchased on|delivered on|delivery date|[$£€]\s?\d|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i.test(text), text)
})
test('without a product name it does not make one up', () => {
  const { text } = buildComplaintEmail({ ...COMPLAINT, productName: null })
  assert.ok(!/Item:/.test(text) && text.includes('Listing: https://www.zara.com/'))
})
test('greeting: uses the retailer name, and a plain "Hi there," when there is no real name', () => {
  assert.match(buildComplaintEmail(COMPLAINT).text, /\nHi Zara Support,\n/)
  for (const retailerName of [undefined, null, '', 'the retailer']) assert.match(buildComplaintEmail({ ...COMPLAINT, retailerName }).text, /\nHi there,\n/)
})
test('the customer\'s optional note is included verbatim when given, and absent when blank', () => {
  assert.match(buildComplaintEmail({ ...COMPLAINT, note: 'Order placed under the name R. Kalu.' }).text, /Additional details from the customer:\nOrder placed under the name R\. Kalu\.\n\nCould you please/)
  assert.ok(!/Additional details/.test(buildComplaintEmail({ ...COMPLAINT, note: '   ' }).text))
})
test('deterministic: what the user reviews is exactly what is sent', () => {
  assert.equal(buildComplaintEmail(COMPLAINT).text, buildComplaintEmail({ ...COMPLAINT }).text)
})
console.log('\nfollow-up email: same identity and tone as the complaint')
const FOLLOW_UP = { retailerName: 'Zara', productName: 'LONG KNIT DRESS', caseRef: 'FTR-K7M2QX', sentAt: Date.UTC(2026, 8, 10) }
test('follow-up body is exactly the short, polite message, signed "Fitr Support" like the complaint', () => {
  assert.equal(
    buildFollowUpEmail(FOLLOW_UP).text,
    [
      'Fitr Support',
      '',
      'Hi Zara Support,',
      '',
      "We're following up on our message of 2026-09-10 about a possible mismatch with an item received by a customer.",
      '',
      'Item: LONG KNIT DRESS',
      '',
      "We haven't heard back yet. Could you please take a look and let us know how we can resolve this?",
      '',
      'Case: FTR-K7M2QX',
      '',
      'Thanks,',
      'Fitr Support',
    ].join('\n'),
  )
})
test('follow-up uses the same identity, greeting and closing as the complaint, and the old signature is gone', () => {
  const complaint = buildComplaintEmail({ ...COMPLAINT, productName: 'LONG KNIT DRESS' }).text
  const followUp = buildFollowUpEmail(FOLLOW_UP).text
  for (const t of [complaint, followUp]) {
    assert.ok(t.startsWith('Fitr Support\n\nHi Zara Support,\n') && t.endsWith('\n\nThanks,\nFitr Support') && t.includes('Case: FTR-K7M2QX'))
  }
  assert.ok(!/on behalf of a customer|Fitr, on/i.test(followUp))
})
test('follow-up is short, neutral and says "possible mismatch" without blaming anyone', () => {
  const { text } = buildFollowUpEmail(FOLLOW_UP)
  assert.ok(text.length < 500 && text.split('\n').length <= 16, `${text.length} chars`)
  assert.match(text, /possible mismatch/)
  assert.ok(!/\b(wrong item|you sent|sent the wrong|your mistake|your fault|fraud|scam|refuse|demand|legal|sue|complain|complaint|ignored|unacceptable|urgent)\b/i.test(text))
})
test('follow-up refers to the earlier message by its real send date and invents nothing', () => {
  const { text } = buildFollowUpEmail(FOLLOW_UP)
  assert.match(text, /our message of 2026-09-10/)
  assert.ok(!/(order (number|no\.?|#|id)|tracking|refund|invoice|purchased on|delivered on|delivery date|[$£€]\s?\d)/i.test(text), text)
})
test('follow-up: no product name => no "Item:" line; no real retailer name => "Hi there,"', () => {
  const noProduct = buildFollowUpEmail({ ...FOLLOW_UP, productName: null }).text
  assert.ok(!/Item:/.test(noProduct) && !/\n\n\n/.test(noProduct))
  for (const retailerName of [undefined, null, '', 'the retailer']) assert.match(buildFollowUpEmail({ ...FOLLOW_UP, retailerName }).text, /\nHi there,\n/)
})
test('follow-up web-page text stays on one line (no header/line injection through names)', () => {
  const { text } = buildFollowUpEmail({ ...FOLLOW_UP, productName: 'Dress\r\nBcc: attacker@evil.example', retailerName: 'Zara\nBcc: x@y.z' })
  assert.ok(text.includes('Item: Dress Bcc: attacker@evil.example') && text.includes('Hi Zara Bcc: x@y.z Support,'))
})

console.log('\nfinding the retailer\'s contact email (only what is printed on their own pages)')
test('reads the real address from the Girlfriend Collective sizing page text', () => {
  const md = "If you're still unsure about your size, drop us a line at [hello@girlfriend.com](mailto:hello@girlfriend.com) and we'd be happy to help."
  assert.deepEqual(extractEmails(md), ['hello@girlfriend.com'])
  assert.equal(rankContactEmail(extractEmails(md), 'https://girlfriend.com/products/x'), 'hello@girlfriend.com')
})
test('prefers a support desk over a generic mailbox, on the retailer\'s own domain', () => {
  assert.equal(rankContactEmail(['info@shop.com', 'support@shop.com', 'privacy@shop.com'], 'https://www.shop.com/p/1'), 'support@shop.com')
})
test('ignores no-reply, privacy, careers, press and image-like strings', () => {
  const emails = extractEmails('noreply@shop.com privacy@shop.com careers@shop.com press@shop.com logo@2x.png sprite@shop.com.png')
  assert.equal(rankContactEmail(emails, 'https://shop.com/p'), null)
})
test('never picks an address on some other domain (third parties, trackers)', () => {
  assert.equal(rankContactEmail(['support@zendesk.com', 'x@sentry.io', 'someone@gmail.com'], 'https://shop.com/p'), null)
})
test('contact links: same site only, contact/help pages, at most two, never the product page or shop pages', () => {
  const links = ['/pages/contact', '/pages/returns', '/collections/leggings', '/products/x', 'https://help.brand.com/en/contact-us', 'https://www.instagram.com/brand', '/blogs/news/contact-tips', '/pages/faq', '/pages/customer-service']
  const got = findContactLinks('https://brand.com/products/x', links)
  assert.ok(got.length <= 2 && got.every((u) => /brand\.com/.test(u)))
  assert.ok(got[0].includes('contact'))
  assert.ok(!got.some((u) => /collections|products|instagram|blogs/.test(u)))
})

console.log('\ninbound webhook events')
test('message.received: identifiers, sender, subject and reply text (extracted_text preferred over quoted text)', () => {
  const k = extractInboundKeys({
    event_type: 'message.received', event_id: 'e1',
    message: { inbox_id: 'inb', thread_id: 't1', message_id: 'm2', from: 'Sam <sam@shop.com>', subject: 'Re: X [FTR-K7M2QX]', text: 'Sure.\n> quoted old text', extracted_text: 'Sure.', in_reply_to: 'm1', timestamp: '2026-09-12T10:00:00Z' },
  }, 5)!
  assert.equal(k.eventType, 'message.received')
  assert.equal(k.threadId, 't1'); assert.equal(k.messageId, 'm2'); assert.equal(k.inReplyTo, 'm1')
  assert.equal(k.sender, 'sam@shop.com'); assert.equal(k.text, 'Sure.')
  assert.equal(k.at, Date.parse('2026-09-12T10:00:00Z'))
})
test('message.bounced: reads the bounce object and its recipients', () => {
  const k = extractInboundKeys({ event_type: 'message.bounced', bounce: { message_id: 'm1', thread_id: 't1', inbox_id: 'inb', type: 'Permanent', recipients: [{ address: 'bad@shop.com', status: 'bounced' }], timestamp: '2026-09-12T10:00:00Z' } }, 5)!
  assert.equal(k.threadId, 't1'); assert.deepEqual(k.bounceRecipients, ['bad@shop.com'])
})
test('message.delivered: tolerant of the wrapper key (identifiers still found)', () => {
  for (const wrapper of ['delivery', 'message', 'send']) {
    const k = extractInboundKeys({ event_type: 'message.delivered', [wrapper]: { message_id: 'm1', thread_id: 't1' } }, 5)!
    assert.equal(k.messageId, 'm1'); assert.equal(k.threadId, 't1')
  }
})
test('garbage is rejected, not guessed at', () => {
  for (const bad of [null, 'x', 42, {}, { event_type: '' }, []]) assert.equal(extractInboundKeys(bad, 0), null)
})

console.log('\nsvix signature (checked against an independent node:crypto implementation)')
const SECRET_BYTES = Buffer.from('a-test-signing-secret-32-bytes!!')
const SECRET = `whsec_${SECRET_BYTES.toString('base64')}`
const sign = (id: string, ts: string, body: string, key = SECRET_BYTES) => `v1,${createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64')}`
const NOW = 1_800_000_000
const BODY = JSON.stringify({ event_type: 'message.received', message: { thread_id: 't1' } })
test('a correctly signed payload verifies', async () => {
  assert.equal(await verifySvixSignature({ secret: SECRET, id: 'msg_1', timestamp: String(NOW), signatureHeader: sign('msg_1', String(NOW), BODY), body: BODY, nowSeconds: NOW }), true)
})
test('also works with the secret given without the whsec_ prefix, and with several signatures in the header', async () => {
  const header = `v1,AAAAbad ${sign('msg_1', String(NOW), BODY)}`
  assert.equal(await verifySvixSignature({ secret: SECRET_BYTES.toString('base64'), id: 'msg_1', timestamp: String(NOW), signatureHeader: header, body: BODY, nowSeconds: NOW }), true)
})
test('rejects a tampered body, wrong id, wrong secret, and non-v1 signatures', async () => {
  const args = { secret: SECRET, id: 'msg_1', timestamp: String(NOW), signatureHeader: sign('msg_1', String(NOW), BODY), body: BODY, nowSeconds: NOW }
  assert.equal(await verifySvixSignature({ ...args, body: BODY.replace('t1', 't2') }), false)
  assert.equal(await verifySvixSignature({ ...args, id: 'msg_2' }), false)
  assert.equal(await verifySvixSignature({ ...args, secret: `whsec_${Buffer.from('another-secret-value-entirely!!!!').toString('base64')}` }), false)
  assert.equal(await verifySvixSignature({ ...args, signatureHeader: args.signatureHeader.replace('v1,', 'v2,') }), false)
})
test('rejects stale (replayed) and missing headers', async () => {
  const old = String(NOW - 3600)
  assert.equal(await verifySvixSignature({ secret: SECRET, id: 'msg_1', timestamp: old, signatureHeader: sign('msg_1', old, BODY), body: BODY, nowSeconds: NOW }), false)
  assert.equal(await verifySvixSignature({ secret: SECRET, id: null, timestamp: String(NOW), signatureHeader: 'v1,x', body: BODY, nowSeconds: NOW }), false)
  assert.equal(await verifySvixSignature({ secret: SECRET, id: 'msg_1', timestamp: String(NOW), signatureHeader: null, body: BODY, nowSeconds: NOW }), false)
})
test('a malformed secret fails closed', async () => {
  assert.equal(await verifySvixSignature({ secret: 'whsec_!!!not-base64!!!', id: 'a', timestamp: String(NOW), signatureHeader: 'v1,x', body: BODY, nowSeconds: NOW }), false)
})

;(async () => {
  for (const run of queue) await run()
  console.log(`\n${passed} passed`)
})()
