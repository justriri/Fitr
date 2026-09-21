# Fitr — See it on you. Know your fit. Find it in your size.

Built for the **Convex All Gas Hackathon** (Convex · OpenAI · Firecrawl · AgentMail).

| | |
|---|---|
| **Live app** | https://adjoining-opossum-824.convex.site (public, no invite; create an account to use it) |
| **Demo video (under 3 min)** | [Watch the demo on X](https://x.com/riri_unfiltered/status/2101934433108382159?s=46) |
| **GitHub repository** | [github.com/justriri/Fitr](https://github.com/justriri/Fitr) |

---

## The problem

Buying clothes online is a guessing game. Every retailer has a different size chart, a size that fits in one brand
doesn't in another, and a studio photo on a model tells you little about how a garment will look on **you**. When the
parcel arrives and it doesn't match the listing, most people give up rather than work out what to say to whom.

## What Fitr does

Paste a link to any item from any retailer. Fitr gives you, in one calm page:

1. **The item** — the product, extracted from the retailer's own page.
2. **Your fit** — one recommended size, chosen from your body measurements, the retailer's real size chart and how you
   like clothes to fit, with a confidence level and a plain-language reason ("Bust fits · Waist fits · Hip fits").
3. **See it on me** — the actual garment on your reference photo, generated from your measurements.
4. **After you buy** — if what arrives looks different from the listing, upload a photo. Fitr compares it with the
   listing, and if it finds specific differences it drafts a short, neutral message to the retailer. **You review and
   approve it; nothing is ever sent without you.** The retailer's reply lands back inside Fitr.

## How each sponsor is used

### Convex — the whole backend, and the host
- **Auth:** Convex Auth (password provider). Every read and write is scoped to the signed-in user; another user's data
  looks exactly like "not found".
- **Database + realtime:** seven tables (`bodyProfiles`, `products`, `tryOnResults`, `alternativeSearches`,
  `protectionCases`, `caseMessages`, `unmatchedInboundEmails`). Every screen is driven by reactive queries, so nothing polls:
  the product appears when extraction finishes, the try-on result appears when generation finishes, and a retailer's reply
  appears in the case timeline the moment it arrives. The size recommendation is derived on read, so it updates by itself
  when the profile or the product changes.
- **Server functions:** queries and mutations for the UI; actions for slow external work (page extraction, image
  generation, photo comparison, email delivery), started with the **scheduler**; internal functions for state transitions
  the client can never call.
- **File storage:** reference photos, generated try-on images and received-item photos.
- **HTTP actions:** the AgentMail webhook (Svix signature verified on the raw body, replay-protected) and the auth routes.
- **Component:** `@convex-dev/static-hosting` serves the frontend from the same deployment on `convex.site`.

### Firecrawl — reading real retailer pages
- Extracts name, price, images, listed sizes, description and details from **any** product URL.
- Copies the retailer's **size chart verbatim** and verifies it against the page text before it is trusted — a chart the
  page doesn't actually contain is rejected rather than guessed. It follows a linked size-guide page when the product page
  has none, and tells body-measurement charts from garment-measurement charts.
- Finds the retailer's support email **only if it is printed on the retailer's own site**.
- Searches for the same item at other retailers when the recommended size isn't listed.

### OpenAI — seeing and judging
- **`gpt-image-1`** (image edit, high quality/high input fidelity) generates "See it on me" from the reference photo, the
  retailer's product photo and the body measurements. The person's identity comes from the photo; the garment comes from
  the product photo.
- **`gpt-4.1` vision** compares the listing photo with the photo of what arrived and reports what is clearly different, aspect
  by aspect. The model does not decide: fixed, conservative server-side rules do, so a dark or oddly angled photo can't
  become an accusation.

### AgentMail — the post-purchase email loop
- Sends the **user-approved** message from an AgentMail inbox, with the received-item photo attached.
- Webhooks bring back **retailer replies** and delivered/bounced reports, which Fitr matches to the right case (thread id,
  then the case reference in the subject with a sender-domain check) and shows in the case timeline.
- One optional, user-triggered follow-up, allowed only after 72 hours with no reply.

## Key user flows
1. **Onboarding:** a short measurement wizard (cm or inches, converted correctly) + an optional reference photo.
2. **Discover → item:** paste a link; the page fills in live.
3. **Your fit:** recommended size, fit, confidence, per-measurement checks, and an expandable "Why this size?". If the size
   isn't listed, Fitr offers to find the same item elsewhere.
4. **See it on me:** generate, watch the staged progress, compare with the original photo.
5. **Something doesn't look right?** Upload a photo → possible mismatch with specific differences → review the drafted
   message → **Fitr suggests, you decide** → send → track replies → optional follow-up → mark resolved.

## Designed not to lie
- No invented facts: the message never contains an order number, date, refund amount or tracking number, because Fitr has none.
- Wording is neutral ("possible mismatch"), never an accusation; the complaint is a fixed template, not free-form model text.
- Recommendations report their **confidence** and fall back honestly to the user's usual size when there is no usable chart.
- Try-ons are labelled as estimates, not guarantees of fit.

## Verification (what was actually run)
- **225 unit tests** (`npm test`) covering size-chart parsing and verification, the recommender, alternative matching,
  the comparison verdict rules, the complaint and follow-up emails, the follow-up rule, reply matching and webhook signatures.
- A real end-to-end **try-on through the UI** with a real extraction: about 49 seconds from click to image, stored in
  Convex and displayed reactively.
- Browser walkthroughs of every screen at desktop, tablet and phone widths; cross-user access tests (one user cannot read or
  act on another's case); signed webhook tests including replay, tampering and spoofed-sender cases.

## Known limitations (honest)
- Try-on images and size recommendations are estimates. A recommendation is only as good as the size information the retailer publishes.
- Generation takes roughly a minute.
- Email from AgentMail's shared `agentmail.to` domain was accepted and reported as delivered by AgentMail in testing, but did not
  reliably appear in Gmail/Yahoo inboxes. A production version should send from a verified custom domain.
- Extraction quality depends on each retailer's page; some pages hide sizes or charts.

## Tech stack
React 19 + TypeScript + Vite · Convex (database, auth, functions, scheduler, storage, HTTP actions, static hosting) ·
Firecrawl · OpenAI · AgentMail. No UI library: the design system is plain CSS.

## Run it yourself
```bash
npm install
npx convex dev            # create/link a Convex project and push the backend
# set the Convex environment variables (see .env.example for the names):
#   FIRECRAWL_API_KEY, OPENAI_API_KEY, AGENTMAIL_API_KEY, AGENTMAIL_WEBHOOK_SECRET  (+ Convex Auth keys via `npx @convex-dev/auth`)
npm run dev               # http://localhost:5173
npm test                  # unit tests
npm run deploy            # push the backend and publish the frontend to https://<deployment>.convex.site
```
The AgentMail webhook is registered once with `npx convex run caseActions:registerWebhook`.
