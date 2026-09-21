import { useMutation, useQuery } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import { useState } from 'react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'

interface AlternativesSectionProps {
  productId: Id<'products'>
  recommendedSize: string
}

type SearchRow = NonNullable<FunctionReturnType<typeof api.alternatives.getSearch>>
type Result = NonNullable<SearchRow['results']>[number]

// Shown inside the fit panel only when the recommended size is not listed on
// the current page. The search itself runs on the server; this just renders
// the reactive state (none / searching / failed / completed).
export default function AlternativesSection({ productId, recommendedSize }: AlternativesSectionProps) {
  const search = useQuery(api.alternatives.getSearch, { productId })
  const startSearch = useMutation(api.alternatives.startSearch)
  const [error, setError] = useState('')
  const [starting, setStarting] = useState(false)

  async function handleSearch() {
    setError('')
    setStarting(true)
    try {
      await startSearch({ productId })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong starting the search.')
    } finally {
      setStarting(false)
    }
  }

  if (search === undefined) return null

  // A search made for a different recommended size is stale — treat it as no search.
  const current = search !== null && search.recommendedSize === recommendedSize ? search : null

  const sizeChip = (
    <span className="alt-size-chip">
      Your recommended size: <strong>{recommendedSize}</strong>
    </span>
  )

  if (current === null) {
    return (
      <div className="alt-section">
        <button className="btn btn--secondary btn--block" onClick={() => void handleSearch()} disabled={starting}>
          {starting ? 'Starting…' : 'Find this item elsewhere'}
        </button>
        <p className="hint-text" style={{ marginTop: 'var(--s-3)' }}>
          We'll look for this exact item at other retailers and check whether size {recommendedSize} is listed.
        </p>
        {error && <p className="error-text">{error}</p>}
      </div>
    )
  }

  if (current.status === 'searching') {
    return (
      <div className="alt-section">
        <div className="working" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          <div>
            <p className="working__title">Looking for this item at other retailers…</p>
            <p className="hint-text">
              Checking other stores for the same item and whether size {recommendedSize} is listed. This can take up to a
              minute.
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (current.status === 'failed') {
    return (
      <div className="alt-section">
        <p className="error-text" style={{ marginTop: 0, marginBottom: 'var(--s-3)' }}>
          {current.errorMessage ?? 'Something went wrong searching other retailers.'}
        </p>
        <button className="btn btn--block" onClick={() => void handleSearch()} disabled={starting}>
          {starting ? 'Starting…' : 'Try again'}
        </button>
        {error && <p className="error-text">{error}</p>}
      </div>
    )
  }

  const results = current.results ?? []
  const exact = results.filter((r) => r.matchType === 'exact')
  const possible = results.filter((r) => r.matchType === 'possible')

  return (
    <div className="alt-section">
      {exact.length > 0 && (
        <>
          <div className="alt-heading">
            <h3>Found this item elsewhere</h3>
            {sizeChip}
          </div>
          {exact.map((r) => (
            <ResultCard key={r.url} result={r} recommendedSize={recommendedSize} />
          ))}
        </>
      )}

      {exact.length === 0 && (
        <div className="alt-empty">
          <h3>We couldn't find this exact item at another retailer</h3>
          <p className="hint-text">
            We checked {current.pagesChecked ?? 0} other page{current.pagesChecked === 1 ? '' : 's'} and none was
            confirmed to be the same item.
            {possible.length > 0 ? ' Here are some possible alternatives, but they may not be the same item.' : ''}
          </p>
          <div style={{ marginTop: 'var(--s-2)' }}>{sizeChip}</div>
        </div>
      )}

      {possible.length > 0 && (
        <>
          <div className="alt-subheading">Possible alternatives — not confirmed to be the same item</div>
          {possible.map((r) => (
            <ResultCard key={r.url} result={r} recommendedSize={recommendedSize} />
          ))}
        </>
      )}

      <p className="hint-text" style={{ marginTop: 'var(--s-4)' }}>
        We can only see whether a size is <em>listed</em> on a retailer's page — not whether it's in stock.
      </p>
      <button className="btn--text" onClick={() => void handleSearch()} disabled={starting}>
        {starting ? 'Starting…' : 'Search again'}
      </button>
      {error && <p className="error-text">{error}</p>}
    </div>
  )
}

function ResultCard({ result, recommendedSize }: { result: Result; recommendedSize: string }) {
  // A retailer's image URL can be blocked or expired; show no thumbnail rather than an empty box.
  const [imageFailed, setImageFailed] = useState(false)
  const price =
    result.price !== undefined ? (result.currency ? `${result.currency} ${result.price}` : String(result.price)) : null
  const meta = [price, result.color].filter(Boolean).join(' · ')

  const size =
    result.sizeStatus === 'listed'
      ? { text: `Size ${recommendedSize} is listed`, className: 'alt-card__size alt-card__size--listed' }
      : result.sizeStatus === 'not_listed'
        ? { text: `Size ${recommendedSize} isn't listed here either`, className: 'alt-card__size alt-card__size--not-listed' }
        : { text: "Sizes couldn't be read from this page", className: 'alt-card__size' }

  return (
    <div className={`alt-card ${result.matchType === 'possible' ? 'alt-card--possible' : ''}`}>
      {result.imageUrl && !imageFailed && (
        <img
          className="alt-card__thumb"
          src={result.imageUrl}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setImageFailed(true)}
        />
      )}
      <div className="alt-card__body">
        <div className="alt-card__retailer">{result.retailer}</div>
        <div className="alt-card__name">{result.productName}</div>
        {meta && <div className="hint-text">{meta}</div>}
        <div className={size.className}>{size.text}</div>
        {result.matchType === 'possible' && result.matchNotes.length > 0 && (
          <div className="hint-text">{result.matchNotes.join(' · ')}</div>
        )}
        <a className="alt-card__link" href={result.url} target="_blank" rel="noopener noreferrer">
          View item ↗
        </a>
      </div>
    </div>
  )
}
