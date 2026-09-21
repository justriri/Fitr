import { useMutation, useQuery } from 'convex/react'
import { useState } from 'react'
import { api } from '../../../convex/_generated/api'
import { displayImage, formatPrice } from '../../lib/images'
import { hrefFor, navigate } from '../../lib/router'
import { normalizeProductUrl } from '../../lib/url'

// Where a session starts: paste a link, and — below it — the items you've already checked, so returning to
// one (and to any complaint case on it) is one click.
export default function Discover({ hasProfile }: { hasProfile: boolean | undefined }) {
  const startCrawl = useMutation(api.products.startCrawl)
  const recent = useQuery(api.products.listMine)
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit() {
    if (url.trim() === '') {
      setError('Paste a product link to continue.')
      return
    }
    if (normalizeProductUrl(url) === null) {
      setError("That doesn't look like a valid link. Make sure it starts with https://")
      return
    }
    setError('')
    setSubmitting(true)
    try {
      const productId = await startCrawl({ url })
      navigate({ name: 'item', id: productId })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.')
      setSubmitting(false)
    }
  }

  return (
    <div className="discover">
      <header className="discover__head">
        <p className="label">Discover</p>
        <h1>
          Find something.
          <br />
          <em>Know it fits.</em>
        </h1>
        <p className="discover__lede">Paste a link to any item from any retailer. Fitr finds your size and shows it on you.</p>
      </header>

      <form
        className="discover__form"
        onSubmit={(e) => {
          e.preventDefault()
          void handleSubmit()
        }}
      >
        <label className="sr-only" htmlFor="product-url">
          Product link
        </label>
        <input
          id="product-url"
          type="text"
          inputMode="url"
          autoComplete="off"
          value={url}
          placeholder="Paste a product link — https://…"
          onChange={(e) => setUrl(e.target.value)}
          disabled={submitting}
        />
        <button type="submit" className="btn" disabled={submitting}>
          {submitting ? 'Opening…' : 'Check my fit'} <span className="arrow">→</span>
        </button>
      </form>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}

      {hasProfile === false && (
        <div className="notice discover__notice">
          <strong>One thing first.</strong> Add your body profile so Fitr can recommend a size and show items on you.{' '}
          <a href={hrefFor({ name: 'profile' })}>Create your profile</a>
        </div>
      )}

      <section className="recent" aria-label="Recently checked">
        {recent === undefined ? (
          <>
            <h2 className="recent__title">Recently checked</h2>
            <div className="tiles">
              {[0, 1, 2, 3].map((n) => (
                <div key={n}>
                  <span className="skel" style={{ aspectRatio: '3 / 4' }} />
                  <span className="skel" style={{ height: 12, width: '50%', marginTop: 12 }} />
                  <span className="skel" style={{ height: 14, width: '80%', marginTop: 8 }} />
                </div>
              ))}
            </div>
          </>
        ) : recent.length > 0 ? (
          <>
            <h2 className="recent__title">Recently checked</h2>
            <div className="tiles">
              {recent.map((item) => (
                <a key={item._id} className="tile" href={hrefFor({ name: 'item', id: item._id })}>
                  <span className="tile__img">
                    {item.image ? (
                      <img src={displayImage(item.image)} alt="" loading="lazy" referrerPolicy="no-referrer" />
                    ) : (
                      <span className="tile__blank">{item.status === 'pending' ? 'Reading the page…' : 'No photo'}</span>
                    )}
                  </span>
                  <span className="label">{item.retailer ?? 'Item'}</span>
                  <span className="tile__name">{item.name ?? (item.status === 'pending' ? 'Reading the page…' : 'Untitled item')}</span>
                  <span className="tile__price">{formatPrice(item.price, item.currency) ?? ' '}</span>
                </a>
              ))}
            </div>
          </>
        ) : null}
      </section>
    </div>
  )
}
