import { useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import Accordion from '../../components/Accordion'
import { cmToUnit } from '../../lib/bodyProfile'
import AlternativesSection from '../alternatives/AlternativesSection'
import FitSummary from './FitSummary'

interface FitSectionProps {
  productId: Id<'products'>
  onCreateProfile: () => void
}

export const FIT_LABEL = {
  fitted: 'Fitted',
  regular: 'Regular',
  relaxed: 'Relaxed',
  oversized: 'Oversized',
} as const

const MEASURE_NAME = { bust: 'Bust', waist: 'Waist', hip: 'Hip' } as const

// Purely presentational: the recommendation is computed server-side in convex/fit.ts and arrives via a reactive
// query, so it refreshes on its own when the profile or product changes.
export default function FitSection({ productId, onCreateProfile }: FitSectionProps) {
  const fit = useQuery(api.fit.getFitRecommendation, { productId })
  const profile = useQuery(api.profiles.getMyProfile)
  const unit = profile?.unitPreference ?? 'cm'

  if (fit === null) return null

  if (fit === undefined) {
    return (
      <div className="fitcard" aria-busy="true">
        <span className="skel" style={{ height: 12, width: 120 }} />
        <span className="skel" style={{ height: 96, width: 80, marginTop: 16 }} />
        <span className="skel" style={{ height: 14, width: '70%', marginTop: 24 }} />
        <span className="skel" style={{ height: 14, width: '55%', marginTop: 10 }} />
      </div>
    )
  }

  if (fit.status === 'no_profile') {
    return (
      <div className="fit-empty">
        <p>Add your body profile and Fitr will recommend a size for this item.</p>
        <button className="btn btn--secondary" onClick={onCreateProfile}>
          Create your profile
        </button>
      </div>
    )
  }

  if (fit.status === 'insufficient_data') {
    return (
      <div className="fit-empty">
        <p>{fit.message}</p>
      </div>
    )
  }

  const u = unit === 'cm' ? 'cm' : 'in'
  const range = (lo: number, hi: number) => `${cmToUnit(lo, unit)}–${cmToUnit(hi, unit)} ${u}`

  return (
    <div className="fitcard">
      <FitSummary
        size={fit.recommendedSize}
        fitLabel={`${FIT_LABEL[fit.likelyFit]} fit`}
        confidence={fit.confidence}
        checks={fit.checks}
      />

      <p className="fitcard__why">{fit.explanation}</p>

      {fit.availability === 'available' && (
        <p className="fitcard__avail">Size {fit.recommendedSize} is listed as available for this item.</p>
      )}
      {fit.availability === 'unavailable' && (
        <>
          <div className="notice notice--warn" style={{ marginTop: 'var(--s-5)' }}>
            <strong>Your size isn’t listed here.</strong> Size {fit.recommendedSize} isn’t listed on this page.
            {fit.closestAvailableSize &&
              ` The closest listed size is ${fit.closestAvailableSize}, which will fit ${
                fit.closestAvailableDirection === 'larger' ? 'roomier' : 'closer'
              }.`}
          </div>
          <AlternativesSection productId={productId} recommendedSize={fit.recommendedSize} />
        </>
      )}

      <div className="fitcard__more">
        <Accordion title="Why this size?">
          {fit.checks.length > 0 && (
            <div className="fitrows">
              {fit.checks.map((c) => (
                <div key={c.measure} className="fitrow">
                  <span>
                    {MEASURE_NAME[c.measure]} · you {cmToUnit(c.yourCm, unit)} {u}
                  </span>
                  <span>
                    size {fit.recommendedSize}: {range(c.lo, c.hi)}
                  </span>
                </div>
              ))}
            </div>
          )}
          <ul className="fitlist">
            {fit.details.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </Accordion>
      </div>

      <p className="disclaimer" style={{ marginTop: 'var(--s-4)' }}>
        A likely fit based on the sizing information available — not a guarantee.
      </p>
    </div>
  )
}
