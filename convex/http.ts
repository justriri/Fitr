import { registerStaticRoutes } from '@convex-dev/static-hosting'
import { httpRouter } from 'convex/server'
import { components, internal } from './_generated/api'
import { httpAction } from './_generated/server'
import { auth } from './auth'
import { verifySvixSignature } from './lib/caseRules'

const http = httpRouter()

// Convex Auth requires these HTTP routes to handle
// sign-in, sign-out, and session callbacks.
auth.addHttpRoutes(http)

// AgentMail delivers retailer replies (and delivery/bounce events) here. Every request is authenticated by
// its Svix signature over the raw body before anything is read from it; unsigned or stale requests are refused.
http.route({
  path: '/agentmail/webhook',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.AGENTMAIL_WEBHOOK_SECRET
    if (!secret) return new Response('Webhook is not configured', { status: 503 })

    const body = await request.text()
    const valid = await verifySvixSignature({
      secret,
      id: request.headers.get('svix-id'),
      timestamp: request.headers.get('svix-timestamp'),
      signatureHeader: request.headers.get('svix-signature'),
      body,
      nowSeconds: Math.floor(Date.now() / 1000),
    })
    if (!valid) return new Response('Invalid signature', { status: 401 })

    let event: unknown
    try {
      event = JSON.parse(body)
    } catch {
      return new Response('Invalid JSON', { status: 400 })
    }

    const result = await ctx.runMutation(internal.cases.handleAgentmailEvent, { event })
    // Always 200 for a valid, signed request — even if it matched no case — so AgentMail doesn't retry forever.
    return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }),
})

// Serve the built Fitr frontend from the same deployment (https://<deployment>.convex.site). Registered last:
// exact routes above (auth, the AgentMail webhook) win over the static catch-all, so their URLs never change.
registerStaticRoutes(http, components.staticHosting)

export default http
