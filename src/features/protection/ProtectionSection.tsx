import { useMutation, useQuery } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import { useEffect, useState } from 'react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { buildComplaintEmail, isValidEmail } from '../../../convex/lib/caseRules'
import Dropzone from '../../components/Dropzone'
import { displayImage } from '../../lib/images'
import { PhotoError, preparePhoto } from './preparePhoto'

interface ProtectionSectionProps {
  productId: Id<'products'>
}

type CaseView = NonNullable<FunctionReturnType<typeof api.cases.getCaseForProduct>>

const STATUS_LABEL: Record<CaseView['status'], string> = {
  analyzing: 'Checking your photo',
  analysis_failed: 'Check failed',
  no_mismatch: 'Nothing stands out',
  draft: 'Waiting for you',
  cancelled: 'Cancelled',
  sending: 'Sending',
  send_failed: 'Not sent',
  complaint_sent: 'Message sent',
  waiting_for_retailer: 'Waiting for the retailer',
  retailer_replied: 'Retailer replied',
  follow_up_sent: 'Follow-up sent',
  resolved: 'Resolved',
}

const STATUS_TONE: Partial<Record<CaseView['status'], 'ok' | 'warn' | 'err' | 'busy'>> = {
  analyzing: 'busy',
  sending: 'busy',
  analysis_failed: 'err',
  send_failed: 'err',
  draft: 'warn',
  retailer_replied: 'ok',
  resolved: 'ok',
}

const SENT_STATUSES: CaseView['status'][] = ['complaint_sent', 'waiting_for_retailer', 'retailer_replied', 'follow_up_sent']

// "After you buy": What I ordered → What I received → Possible mismatch → Review → You approve → Fitr sends → Fitr tracks.
// Everything that matters happens on the server; this component renders the reactive case and offers the next explicit
// step. Nothing is ever sent unless the person presses the send button on the review screen.
export default function ProtectionSection({ productId }: ProtectionSectionProps) {
  const current = useQuery(api.cases.getCaseForProduct, { productId })
  const [picking, setPicking] = useState(false)

  if (current === undefined) return null

  // A cancelled case, or a check that found nothing, doesn't block starting a new check.
  const active = current !== null && current.status !== 'cancelled' && !(current.status === 'no_mismatch' && picking) ? current : null

  const head = (
    <header className="after__head">
      <p className="label">After you buy</p>
      <h2>Something doesn’t look right?</h2>
      <p className="after__lede">
        Upload a photo of what you received. Fitr compares it with the original listing — and only reaches out to the
        retailer if you decide to.
      </p>
    </header>
  )

  if (active === null) {
    return (
      <div className="protect protect-card">
        {head}
        {current?.status === 'cancelled' && !picking && (
          <p className="hint-text" style={{ marginBottom: 'var(--s-4)' }}>
            Your last check was cancelled. Nothing was sent to the retailer.
          </p>
        )}
        {picking ? (
          <PhotoPicker productId={productId} onDone={() => setPicking(false)} onCancel={() => setPicking(false)} />
        ) : (
          <>
            <ol className="how">
              <li>
                <span className="how__no">1</span> Upload what you received
              </li>
              <li>
                <span className="how__no">2</span> Fitr compares it with the listing
              </li>
              <li>
                <span className="how__no">3</span> You review, and decide what happens next
              </li>
            </ol>
            <button className="btn btn--secondary" onClick={() => setPicking(true)}>
              Check what I received
            </button>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="protect protect-card">
      {head}
      <div className="protect__status">
        <span className={`status ${STATUS_TONE[active.status] ? `status--${STATUS_TONE[active.status]}` : ''}`}>
          {STATUS_LABEL[active.status]}
        </span>
      </div>
      <CaseBody c={active} onNewPhoto={() => setPicking(true)} />
    </div>
  )
}

// ---- Step 1: what I received ----

function PhotoPicker({ productId, onDone, onCancel }: { productId: Id<'products'>; onDone: () => void; onCancel: () => void }) {
  const generateUploadUrl = useMutation(api.cases.generateReceivedPhotoUploadUrl)
  const startCase = useMutation(api.cases.startCase)
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleCompare() {
    if (!file) {
      setError('Add a photo of the item you received first — Fitr needs it to compare with the listing.')
      return
    }
    setError('')
    setBusy(true)
    try {
      const prepared = await preparePhoto(file)
      const uploadUrl = await generateUploadUrl()
      const res = await fetch(uploadUrl, { method: 'POST', headers: { 'Content-Type': prepared.type || 'image/jpeg' }, body: prepared })
      if (!res.ok) throw new Error("The photo couldn't be uploaded. Please try again.")
      const { storageId } = (await res.json()) as { storageId: Id<'_storage'> }
      await startCase({ productId, photoId: storageId })
      onDone()
    } catch (e) {
      setError(e instanceof PhotoError ? e.message : cleanError(e, 'Something went wrong starting the check. Please try again.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="picker">
      <h3 className="picker__title">What did you receive?</h3>
      <p className="hint-text" style={{ marginBottom: 'var(--s-4)' }}>
        A clear photo of the item itself, laid flat or held up in good light. You don’t need an order number or any other
        details.
      </p>
      <Dropzone
        file={file}
        onFile={(f) => {
          setFile(f)
          setError('')
        }}
        title="Add a photo of the item"
        hint="Drag one here, or choose from your device."
        ariaLabel="Photo of the item you received"
        disabled={busy}
      />
      <div className="btn-row" style={{ marginTop: 'var(--s-5)' }}>
        <button className="btn" onClick={() => void handleCompare()} disabled={busy}>
          {busy ? 'Uploading…' : 'Compare with the listing'}
        </button>
        <button className="btn--text" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

// ---- The case, by status ----

function CaseBody({ c, onNewPhoto }: { c: CaseView; onNewPhoto: () => void }) {
  switch (c.status) {
    case 'analyzing':
      return (
        <div className="working" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          <div>
            <p className="working__title">Comparing your photo with the listing…</p>
            <p className="hint-text">This usually takes under a minute. Nothing is sent to anyone.</p>
          </div>
        </div>
      )
    case 'analysis_failed':
      return <AnalysisFailed c={c} />
    case 'no_mismatch':
      return <NoMismatch c={c} onNewPhoto={onNewPhoto} />
    case 'draft':
    case 'send_failed':
      return <Review c={c} />
    case 'sending':
      return <Sending c={c} />
    default:
      return <Tracking c={c} />
  }
}

function AnalysisFailed({ c }: { c: CaseView }) {
  const retry = useMutation(api.cases.retryComparison)
  const cancel = useMutation(api.cases.cancelCase)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function run(fn: () => Promise<unknown>) {
    setError('')
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      setError(cleanError(e, 'Something went wrong. Please try again.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="notice notice--err" role="alert">
        {c.errorMessage ?? "We couldn't compare your photo."}
      </div>
      <div className="btn-row" style={{ marginTop: 'var(--s-5)' }}>
        <button className="btn" onClick={() => void run(() => retry({ caseId: c._id }))} disabled={busy}>
          Try again
        </button>
        <button className="btn--text" onClick={() => void run(() => cancel({ caseId: c._id }))} disabled={busy}>
          Cancel
        </button>
      </div>
      {error && <p className="error-text">{error}</p>}
    </>
  )
}

// ---- Step 3 (no mismatch): honest about what Fitr could and couldn't tell ----

function NoMismatch({ c, onNewPhoto }: { c: CaseView; onNewPhoto: () => void }) {
  const comparison = c.comparison
  const cannotAssess = comparison?.verdict === 'cannot_assess'
  return (
    <div className="calm">
      <p className="calm__title">{comparison?.summary ?? "We couldn't confidently identify a mismatch."}</p>
      {!cannotAssess && comparison && comparison.matches.length > 0 && (
        <p className="hint-text" style={{ marginTop: 'var(--s-3)' }}>
          These looked consistent with the listing: {comparison.matches.join(', ').toLowerCase()}.
        </p>
      )}
      {!cannotAssess && (
        <p className="hint-text" style={{ marginTop: 'var(--s-2)' }}>
          A photo can hide details, so this doesn't prove the item is right — but Fitr won't contact the retailer without a
          clear, specific difference to point to.
        </p>
      )}
      <div className="btn-row" style={{ marginTop: 'var(--s-5)' }}>
        <button className="btn btn--secondary" onClick={onNewPhoto}>
          Use a different photo
        </button>
      </div>
    </div>
  )
}

// ---- Steps 3–5: possible mismatch → review the message → you approve ----

function Review({ c }: { c: CaseView }) {
  const setRetailerEmail = useMutation(api.cases.setRetailerEmail)
  const sendComplaint = useMutation(api.cases.sendComplaint)
  const cancel = useMutation(api.cases.cancelCase)
  const [email, setEmail] = useState(c.retailer.email ?? '')
  const [note, setNote] = useState(c.userNote ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // The address may arrive after this screen opens (contact discovery finishes in the background).
  const savedEmail = c.retailer.email ?? ''
  useEffect(() => {
    setEmail((prev) => (prev === '' ? savedEmail : prev))
  }, [savedEmail])

  const comparison = c.comparison
  if (!comparison) return null

  const trimmedNote = note.trim().slice(0, 1500) || undefined
  const draft = buildComplaintEmail({
    retailerName: c.retailer.name,
    productName: c.product.name,
    productUrl: c.product.sourceUrl,
    caseRef: c.caseRef,
    note: trimmedNote,
  })

  const typed = email.trim().toLowerCase()
  const emailOk = isValidEmail(typed)
  const searching = !c.retailer.searched && c.retailer.email === null

  async function handleSend() {
    if (!emailOk) {
      setError("Add the retailer's email address first — Fitr couldn't find one, and won't guess.")
      return
    }
    setError('')
    setBusy(true)
    try {
      if (typed !== savedEmail) await setRetailerEmail({ caseId: c._id, email: typed })
      await sendComplaint({ caseId: c._id, note: trimmedNote })
    } catch (e) {
      setError(cleanError(e, "Your message couldn't be sent. Please try again."))
    } finally {
      setBusy(false)
    }
  }

  async function handleCancel() {
    setError('')
    setBusy(true)
    try {
      await cancel({ caseId: c._id })
    } catch (e) {
      setError(cleanError(e, 'Something went wrong. Please try again.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="review">
      <div className="verdict">
        <h3 className="verdict__title">Possible mismatch</h3>
        <p>
          We found {comparison.differences.length === 1 ? 'something' : 'a few things'} that may differ from the original
          listing. This isn’t a verdict that the retailer made a mistake — photos can mislead — so please check for
          yourself before anything is sent.
        </p>
      </div>

      <div className="sidebyside">
        <figure>
          {c.product.image ? (
            <img src={displayImage(c.product.image)} alt="The original listing" referrerPolicy="no-referrer" />
          ) : (
            <span className="sidebyside__empty">No listing photo</span>
          )}
          <figcaption className="label">The listing</figcaption>
        </figure>
        <figure>
          {c.photoUrl ? <img src={c.photoUrl} alt="The item you received" /> : <span className="sidebyside__empty">Your photo</span>}
          <figcaption className="label">What you received</figcaption>
        </figure>
      </div>

      <div className="diffs" role="table" aria-label="Differences Fitr noticed">
        <div className="diffs__row diffs__row--head" role="row">
          <span role="columnheader" className="label">
            Detail
          </span>
          <span role="columnheader" className="label">
            The listing
          </span>
          <span role="columnheader" className="label">
            Your photo
          </span>
        </div>
        {comparison.differences.map((d) => (
          <div className="diffs__row" role="row" key={d.aspect}>
            <span role="cell" className="diffs__aspect">
              {d.aspect}
            </span>
            <span role="cell" data-label="The listing">
              {d.expected}
            </span>
            <span role="cell" data-label="Your photo">
              {d.observed}
            </span>
          </div>
        ))}
      </div>

      <div className="review__message">
        <h3 className="review__h">Your message to {c.retailer.name}</h3>
        <p className="hint-text">Fitr drafted this for you. Read it, add your own words if you like, then decide.</p>

        <div className="field" style={{ marginTop: 'var(--s-5)' }}>
          <label className="field-label-row" htmlFor="retailer-email">
            <span className="field-label">Send to</span>
          </label>
          <input
            id="retailer-email"
            type="email"
            value={email}
            placeholder={searching ? 'Looking for a contact address…' : 'customer-service@retailer.com'}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
          />
          <p className="field-hint">
            {c.retailer.source === 'found_on_site' && typed === savedEmail ? (
              <>
                Found on the retailer’s own site
                {c.retailer.sourceUrl && (
                  <>
                    {' '}
                    (
                    <a href={c.retailer.sourceUrl} target="_blank" rel="noopener noreferrer">
                      source ↗
                    </a>
                    )
                  </>
                )}
                . Please make sure it’s the right place for order issues.
              </>
            ) : c.retailer.source === 'entered_by_user' && typed === savedEmail ? (
              'Entered by you.'
            ) : searching ? (
              'Fitr is checking the retailer’s site for a contact address.'
            ) : (
              "Fitr couldn't find a contact address on the retailer's site. Enter the one from your order confirmation or their help page."
            )}
          </p>
        </div>

        <div className="field">
          <label className="field-label-row" htmlFor="complaint-note">
            <span className="field-label">Add your own words</span>
            <span className="field-badge">Optional</span>
          </label>
          <textarea
            id="complaint-note"
            rows={3}
            value={note}
            maxLength={1500}
            placeholder="Anything else the retailer should know — only what you're sure of."
            onChange={(e) => setNote(e.target.value)}
            disabled={busy}
          />
        </div>

        <div className="letter">
          <div className="letter__subject">
            <span className="label">Subject</span>
            <span>{draft.subject}</span>
          </div>
          <pre className="letter__body">{draft.text}</pre>
        </div>
        <p className="hint-text" style={{ marginTop: 'var(--s-3)' }}>
          Your photo will be attached. The message doesn’t include an order number, purchase date or refund amount — Fitr
          doesn’t have them, and won’t make them up.
        </p>
      </div>

      {c.status === 'send_failed' && c.errorMessage && (
        <div className="notice notice--err" role="alert" style={{ marginTop: 'var(--s-5)' }}>
          {c.errorMessage}
        </div>
      )}

      <div className="approve">
        <p className="approve__kicker label">You’re in control</p>
        <h3 className="approve__title">Fitr suggests. You decide.</h3>
        <p className="approve__text">
          Nothing is sent to {c.retailer.name} unless you press the button below. You can cancel at any time.
        </p>
        {error && (
          <p className="approve__error" role="alert">
            {error}
          </p>
        )}
        <div className="approve__actions">
          <button className="btn btn--light" onClick={() => void handleSend()} disabled={busy}>
            {busy ? 'Sending…' : c.status === 'send_failed' ? 'Try sending again' : `Send to ${c.retailer.name}`}
          </button>
          <button className="btn--text approve__cancel" onClick={() => void handleCancel()} disabled={busy}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

function Sending({ c }: { c: CaseView }) {
  const release = useMutation(api.cases.releaseStuckSending)
  const [error, setError] = useState('')
  const [showReset, setShowReset] = useState(false)

  // If the send hasn't finished after a few minutes, let the person reset it instead of being stuck.
  useEffect(() => {
    const t = setTimeout(() => setShowReset(true), 5 * 60 * 1000 + 2000)
    return () => clearTimeout(t)
  }, [])

  return (
    <>
      <div className="working" role="status" aria-live="polite">
        <span className="spinner" aria-hidden="true" />
        <div>
          <p className="working__title">Sending your message to {c.retailer.name}…</p>
          <p className="hint-text">This should only take a moment.</p>
        </div>
      </div>
      {showReset && (
        <div style={{ marginTop: 'var(--s-4)' }}>
          <p className="hint-text">This is taking longer than expected.</p>
          <button
            className="btn--text"
            onClick={() => {
              setError('')
              release({ caseId: c._id }).catch((e) => setError(cleanError(e, 'Please try again in a moment.')))
            }}
          >
            Stop waiting and review again
          </button>
          {error && <p className="error-text">{error}</p>}
        </div>
      )}
    </>
  )
}

// ---- Fitr tracks the case ----

function Tracking({ c }: { c: CaseView }) {
  const sendFollowUp = useMutation(api.cases.sendFollowUp)
  const markResolved = useMutation(api.cases.markResolved)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  // Tick so the follow-up button unlocks by itself when the waiting period ends.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])

  async function run(fn: () => Promise<unknown>) {
    setError('')
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      setError(cleanError(e, 'Something went wrong. Please try again.'))
    } finally {
      setBusy(false)
    }
  }

  const sent = SENT_STATUSES.includes(c.status)
  const replied = c.lastRetailerReplyAt !== null
  const earliest = c.followUp.earliestAt
  const followUpReady = c.followUp.stateAllows && earliest !== null && now >= earliest
  const followUpVisible = sent && !replied && c.followUp.count === 0

  return (
    <>
      <p className="hint-text" style={{ marginBottom: 'var(--s-4)' }}>
        Case <strong>{c.caseRef}</strong> · {c.product.name ?? 'Your item'} · {c.retailer.name}
        {c.retailer.email ? ` (${c.retailer.email})` : ''}
      </p>

      {c.status === 'resolved' ? (
        <p className="tracking__lede">You marked this case as resolved.</p>
      ) : c.status === 'retailer_replied' ? (
        <p className="tracking__lede">
          {c.retailer.name} replied. Read their message below, and mark the case resolved when it’s sorted.
        </p>
      ) : (
        <p className="tracking__lede">
          Your message was sent{c.sentAt ? ` on ${formatDate(c.sentAt)}` : ''}. Replies from the retailer will appear here.
        </p>
      )}

      <div className="thread">
        {c.messages.map((m) => (
          <div key={m._id} className={`msg msg--${m.direction}`}>
            <div className="msg__meta label">
              {m.direction === 'inbound' ? `Reply from ${m.from}` : m.kind === 'follow_up' ? 'Follow-up from Fitr' : 'Sent by Fitr'}
              {' · '}
              {formatDate(m.at)}
            </div>
            <div className="msg__subject">{m.subject}</div>
            <pre className="msg__text">{m.text}</pre>
            {m.direction === 'outbound' && (
              <div className={`msg__delivery msg__delivery--${m.deliveryStatus ?? 'unknown'}`}>
                {m.deliveryStatus === 'delivered'
                  ? 'AgentMail reports: delivered'
                  : m.deliveryStatus === 'bounced'
                    ? 'AgentMail reports: bounced'
                    : 'AgentMail accepted it — no delivery report yet'}
              </div>
            )}
          </div>
        ))}
        {c.messages.length === 0 && <p className="hint-text">No messages yet.</p>}
      </div>

      {followUpVisible && (
        <div className="followup">
          <button
            className="btn btn--secondary"
            onClick={() => void run(() => sendFollowUp({ caseId: c._id }))}
            disabled={busy || !followUpReady || c.followUp.inFlight}
          >
            {c.followUp.inFlight ? 'Sending follow-up…' : 'Send a follow-up'}
          </button>
          <p className="hint-text" style={{ marginTop: 'var(--s-2)' }}>
            {followUpReady
              ? "There's been no reply yet. You can send one polite follow-up; Fitr will never send it on its own."
              : earliest !== null
                ? `Fitr allows one follow-up, and only if there's no reply after 72 hours — available from ${formatDate(earliest)}.`
                : ''}
          </p>
        </div>
      )}
      {sent && !replied && c.followUp.count > 0 && (
        <p className="hint-text">
          You've sent the one follow-up Fitr allows. If there's still no reply, contact the retailer another way or mark this
          resolved.
        </p>
      )}
      {c.errorMessage && c.status !== 'resolved' && !replied && (
        <div className="notice notice--err" role="alert" style={{ marginTop: 'var(--s-4)' }}>
          {c.errorMessage}
        </div>
      )}

      {sent && (
        <div className="btn-row" style={{ marginTop: 'var(--s-4)' }}>
          <button className="btn--text" onClick={() => void run(() => markResolved({ caseId: c._id }))} disabled={busy}>
            Mark as resolved
          </button>
        </div>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </>
  )
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

// Convex wraps thrown messages ("[CONVEX M(cases:x)] Uncaught Error: …"); show only the human part.
function cleanError(e: unknown, fallback: string): string {
  if (!(e instanceof Error)) return fallback
  const m = e.message.match(/Uncaught Error: (.+?)(?:\n|\s+at\s|$)/)
  const text = (m?.[1] ?? e.message).trim()
  if (text === '' || /^\[CONVEX|Server Error|Called by client/i.test(text)) return fallback
  return text
}
