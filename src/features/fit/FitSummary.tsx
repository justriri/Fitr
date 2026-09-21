// The recommendation, presentational only: size, fit, confidence, and per-measurement checks.
// Shared by the real Your Fit chapter and the sample on the landing page, so they look exactly alike.

export type Confidence = 'high' | 'medium' | 'low'
export type CheckState = 'fits' | 'roomy' | 'snug'

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence',
}

const MEASURE_NAME = { bust: 'Bust', waist: 'Waist', hip: 'Hip' } as const

export function checkLabel(measure: keyof typeof MEASURE_NAME, state: CheckState): string {
  const name = MEASURE_NAME[measure]
  if (state === 'fits') return `${name} fits`
  if (state === 'roomy') return `${name}: room to spare`
  return `${name}: a little snug`
}

export function ConfidenceMeter({ level }: { level: Confidence }) {
  const filled = level === 'high' ? 3 : level === 'medium' ? 2 : 1
  return (
    <span className="conf" role="img" aria-label={CONFIDENCE_LABEL[level]}>
      <span className="conf__bars" aria-hidden="true">
        {[1, 2, 3].map((n) => (
          <i key={n} className={n <= filled ? 'on' : ''} />
        ))}
      </span>
      <span className="conf__text">{CONFIDENCE_LABEL[level]}</span>
    </span>
  )
}

function CheckIcon({ state }: { state: CheckState }) {
  if (state === 'fits') {
    return (
      <svg className="check__icon check__icon--fits" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <path d="M3 8.5l3.2 3.2L13 4.6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  return (
    <svg className={`check__icon check__icon--${state}`} viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <circle cx="8" cy="8" r="4.25" fill={state === 'snug' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

export default function FitSummary({
  size,
  fitLabel,
  confidence,
  checks,
}: {
  size: string
  fitLabel: string
  confidence: Confidence
  checks: Array<{ measure: keyof typeof MEASURE_NAME; state: CheckState }>
}) {
  return (
    <div className="fitsum">
      <div className="fitsum__top">
        <div>
          <div className="label">Your recommended size</div>
          <div className="fitsum__size">{size}</div>
        </div>
        <div className="fitsum__side">
          <div className="label">Fit</div>
          <div className="fitsum__fit">{fitLabel}</div>
        </div>
      </div>
      {checks.length > 0 && (
        <ul className="checks">
          {checks.map((c) => (
            <li key={c.measure} className={`check check--${c.state}`}>
              <CheckIcon state={c.state} />
              <span>{checkLabel(c.measure, c.state)}</span>
            </li>
          ))}
        </ul>
      )}
      <ConfidenceMeter level={confidence} />
    </div>
  )
}
