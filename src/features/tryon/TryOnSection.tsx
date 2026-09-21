import { useMutation, useQuery } from 'convex/react'
import { useEffect, useState } from 'react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import CompareSlider from '../../components/CompareSlider'
import { displayImage } from '../../lib/images'
import { FIT_LABEL } from '../fit/FitSection'

interface TryOnSectionProps {
  productId: Id<'products'>
  productName?: string
  productImage?: string
  onGoToProfile: () => void
}

// A generation "stuck" past this (server treats <5 min as in-flight) can be retried.
const STUCK_AFTER_MS = 5.5 * 60 * 1000

const BLOCKERS = {
  no_profile: {
    title: 'Create your body profile first',
    body: 'Fitr uses your measurements to fit this item to you.',
    action: 'Create your profile',
  },
  no_photo: {
    title: 'Add a reference photo',
    body: 'A clear, front-facing photo lets Fitr show this item on you. You can add one in your profile.',
    action: 'Add a photo',
  },
  photo_unsupported: {
    title: 'Your reference photo can’t be used',
    body: 'It’s in a format Fitr can’t read. Re-upload it as a JPG, PNG or WebP in your profile.',
    action: 'Update your photo',
  },
  no_product_image: {
    title: 'No usable photo of this item',
    body: 'This page didn’t include a product photo Fitr can use, so it can’t show you wearing it. Try another item.',
    action: null,
  },
} as const

// What the generation is really doing, in the order it does it (the prompt uses the measurements, your photo and the
// garment photo). Shown as calm stages — never as a fake percentage.
const STAGES = ['Reading your measurements', 'Fitting the garment to your photo', 'Finishing the look'] as const

// True once `afterMs` has passed since `startMs` — one timer, not polling.
function usePassed(startMs: number | null, afterMs: number): boolean {
  const [passed, setPassed] = useState(false)
  useEffect(() => {
    if (startMs === null) {
      setPassed(false)
      return
    }
    const remaining = startMs + afterMs - Date.now()
    if (remaining <= 0) {
      setPassed(true)
      return
    }
    setPassed(false)
    const id = setTimeout(() => setPassed(true), remaining)
    return () => clearTimeout(id)
  }, [startMs, afterMs])
  return passed
}

// Which stage to highlight, from how long this generation has been running.
function useStage(startMs: number | null): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (startMs === null) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [startMs])
  if (startMs === null) return 0
  return Math.min(STAGES.length - 1, Math.floor(Math.max(0, now - startMs) / 14000))
}

// Renders the try-on for one specific product. The latest tryOnResults row is the source of truth
// (generating / completed / failed / none) so a generation started from another tab or reload still shows
// correctly, and readiness comes from a reactive server query so problems are explained before any click.
export default function TryOnSection({ productId, productName, productImage, onGoToProfile }: TryOnSectionProps) {
  const readiness = useQuery(api.tryOn.getTryOnReadiness, { productId })
  const latestTryOn = useQuery(api.tryOn.getLatestTryOn, { productId })
  const fit = useQuery(api.fit.getFitRecommendation, { productId })
  const profile = useQuery(api.profiles.getMyProfile)
  const startTryOn = useMutation(api.tryOn.startTryOn)
  const [error, setError] = useState('')
  const [starting, setStarting] = useState(false)

  const generatingSince = latestTryOn?.status === 'generating' ? latestTryOn._creationTime : null
  const stuck = usePassed(generatingSince, STUCK_AFTER_MS)
  const stage = useStage(generatingSince)

  async function handleGenerate() {
    setError('')
    setStarting(true)
    try {
      await startTryOn({ productId })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong starting the visualization.')
    } finally {
      setStarting(false)
    }
  }

  if (readiness === undefined || latestTryOn === undefined) {
    return (
      <div className="tryon" aria-busy="true">
        <span className="skel tryon__skel" />
        <div>
          <span className="skel" style={{ height: 22, width: '60%' }} />
          <span className="skel" style={{ height: 14, width: '80%', marginTop: 16 }} />
          <span className="skel" style={{ height: 48, width: 200, marginTop: 32 }} />
        </div>
      </div>
    )
  }
  if (readiness === null) return null

  const blocker = readiness.blocker !== null ? BLOCKERS[readiness.blocker] : null
  const productSrc = productImage ? displayImage(productImage) : null
  const photoUrl = profile?.photoUrl ?? null
  const name = productName ?? 'This item'
  const hasPhoto = readiness.blocker !== 'no_photo' && readiness.blocker !== 'no_profile' && readiness.blocker !== 'photo_unsupported'

  const warning = readiness.measurementWarning && (
    <div className="notice notice--warn" style={{ marginBottom: 'var(--s-5)' }}>
      <p>{readiness.measurementWarning}</p>
      <button className="btn--text" onClick={onGoToProfile} style={{ marginTop: 'var(--s-2)' }}>
        Review your profile
      </button>
    </div>
  )

  const blockerView = blocker && (
    <div className="notice">
      <p style={{ fontWeight: 600, marginBottom: 'var(--s-1)' }}>{blocker.title}</p>
      <p>{blocker.body}</p>
      {blocker.action && (
        <button className="btn btn--secondary" onClick={onGoToProfile} style={{ marginTop: 'var(--s-4)' }}>
          {blocker.action}
        </button>
      )}
    </div>
  )

  // Retry/generate control, or the reason it isn't available right now.
  const generateControl = (label: string, primary: boolean) =>
    blockerView ?? (
      <>
        <button className={primary ? 'btn' : 'btn btn--secondary'} onClick={() => void handleGenerate()} disabled={starting}>
          {starting ? 'Starting…' : label}
        </button>
        {error && <p className="error-text">{error}</p>}
      </>
    )

  const flow = (state: 'ready' | 'working' | 'done') => (
    <ol className="flow" aria-label="How it works">
      <li className="flow__item" data-state={hasPhoto ? 'done' : 'todo'}>
        <span className="flow__dot" />
        <span>Upload your photo</span>
      </li>
      <li className="flow__item" data-state={state === 'working' ? 'active' : state === 'done' ? 'done' : 'todo'}>
        <span className="flow__dot" />
        <span>Fitr prepares the look</span>
      </li>
      <li className="flow__item" data-state={state === 'done' ? 'done' : 'todo'}>
        <span className="flow__dot" />
        <span>See yourself wearing it</span>
      </li>
    </ol>
  )

  // ---- Generating ----
  if (latestTryOn?.status === 'generating') {
    return (
      <div className="tryon">
        <div className="looming" role="status" aria-live="polite">
          {productSrc && <img className="looming__img" src={productSrc} alt="" referrerPolicy="no-referrer" />}
          <div className="looming__copy">
            <p className="looming__stage" key={stage}>
              {STAGES[stage]}…
            </p>
            <div className="progress-line" />
          </div>
        </div>
        <div className="tryon__side">
          <p className="tryon__lede">Preparing your look.</p>
          {flow('working')}
          <ol className="stages">
            {STAGES.map((s, i) => (
              <li key={s} data-state={i < stage ? 'done' : i === stage ? 'active' : 'todo'}>
                {s}
              </li>
            ))}
          </ol>
          <p className="hint-text">
            This usually takes 30–60 seconds. You can leave this page — your look will be here when you come back.
          </p>
          {stuck && (
            <div style={{ marginTop: 'var(--s-5)' }}>
              <p className="error-text" style={{ marginTop: 0, marginBottom: 'var(--s-3)' }}>
                This is taking longer than expected.
              </p>
              {generateControl('Try again', true)}
            </div>
          )}
        </div>
      </div>
    )
  }

  // ---- Result: the destination ----
  if (latestTryOn?.status === 'completed' && latestTryOn.resultImageUrl) {
    return (
      <div className="tryon tryon--done">
        <div className="tryon__visual">
          {productSrc ? (
            <CompareSlider
              overSrc={latestTryOn.resultImageUrl}
              underSrc={productSrc}
              overLabel="On you"
              underLabel="Original"
              overAlt={`${name} visualized on you`}
              underAlt={`${name}, original product photo`}
            />
          ) : (
            <img className="tryon__result" src={latestTryOn.resultImageUrl} alt={`${name} visualized on you`} />
          )}
        </div>
        <div className="tryon__side">
          <p className="label">Your look</p>
          <h3 className="tryon__name">{name}</h3>
          {fit?.status === 'ok' && (
            <p className="tryon__meta">
              Your size {fit.recommendedSize} · {FIT_LABEL[fit.likelyFit]} fit
            </p>
          )}
          {flow('done')}
          {warning}
          <div>{generateControl('Generate again', false)}</div>
          <p className="disclaimer" style={{ marginTop: 'var(--s-5)' }}>
            An AI-generated estimate of how this item may look on you, not a guarantee of physical fit. Your recommended size
            comes from your measurements, not from this image.
          </p>
        </div>
      </div>
    )
  }

  // ---- Failed (or a "completed" row whose image can't load: kept retryable) ----
  if (latestTryOn?.status === 'failed' || latestTryOn?.status === 'completed') {
    return (
      <div className="tryon">
        <Pair photoUrl={photoUrl} productSrc={productSrc} name={name} />
        <div className="tryon__side">
          <div className="notice notice--err" role="alert" style={{ marginBottom: 'var(--s-5)' }}>
            {latestTryOn.errorMessage ?? 'Something went wrong generating this visualization.'}
          </div>
          {generateControl('Try again', true)}
        </div>
      </div>
    )
  }

  // ---- Ready to start ----
  return (
    <div className="tryon">
      <Pair photoUrl={photoUrl} productSrc={productSrc} name={name} />
      <div className="tryon__side">
        <p className="tryon__lede">Your photo. This garment. Your measurements.</p>
        {flow('ready')}
        {warning}
        {generateControl('See it on me', true)}
        {!blockerView && (
          <p className="hint-text" style={{ marginTop: 'var(--s-3)' }}>
            Uses your body profile and reference photo. Takes about a minute.
          </p>
        )}
      </div>
    </div>
  )
}

// Two portraits side by side: who it's for, and what it's for.
function Pair({ photoUrl, productSrc, name }: { photoUrl: string | null; productSrc: string | null; name: string }) {
  return (
    <div className="pair">
      <figure className="pair__cell">
        {photoUrl ? (
          <img src={photoUrl} alt="Your reference photo" />
        ) : (
          <span className="pair__empty">Your photo</span>
        )}
        <figcaption className="label">You</figcaption>
      </figure>
      <span className="pair__plus" aria-hidden="true">
        +
      </span>
      <figure className="pair__cell">
        {productSrc ? (
          <img src={productSrc} alt={name} referrerPolicy="no-referrer" />
        ) : (
          <span className="pair__empty">The item</span>
        )}
        <figcaption className="label">The item</figcaption>
      </figure>
    </div>
  )
}
