import { useQuery } from 'convex/react'
import { useEffect, useState } from 'react'
import { api } from '../../../convex/_generated/api'
import type { Doc, Id } from '../../../convex/_generated/dataModel'
import Accordion from '../../components/Accordion'
import { displayImage, formatPrice } from '../../lib/images'
import { hrefFor, navigate } from '../../lib/router'
import FitSection from '../fit/FitSection'
import ProtectionSection from '../protection/ProtectionSection'
import TryOnSection from '../tryon/TryOnSection'

const STEPS = [
  { id: 'item', no: '01', label: 'The Item' },
  { id: 'fit', no: '02', label: 'Your Fit' },
  { id: 'tryon', no: '03', label: 'See It on Me' },
] as const

type StepId = (typeof STEPS)[number]['id']

export default function ProductPage({ productId }: { productId: Id<'products'> }) {
  const product = useQuery(api.products.getProduct, { productId })

  if (product === undefined) return <ProductSkeleton title="Opening…" />
  if (product === null) {
    return (
      <div className="page--narrow">
        <p className="label">Not found</p>
        <h1 style={{ fontSize: 'var(--fs-h2)', margin: 'var(--s-3) 0 var(--s-4)' }}>We couldn’t find that item.</h1>
        <p className="muted">The link may be old, or the item may belong to a different account.</p>
        <div className="btn-row">
          <a className="btn" href={hrefFor({ name: 'discover' })}>
            Back to Discover
          </a>
        </div>
      </div>
    )
  }
  if (product.status === 'pending') return <ProductSkeleton title="Reading the page…" url={product.sourceUrl} />
  if (product.status === 'failed') {
    return (
      <div className="page--narrow">
        <p className="label">Couldn’t read that page</p>
        <h1 style={{ fontSize: 'var(--fs-h2)', margin: 'var(--s-3) 0 var(--s-4)' }}>That link didn’t work.</h1>
        <div className="notice notice--err" role="alert">
          {product.errorMessage ?? 'Something went wrong while reading that page.'}
        </div>
        <div className="btn-row">
          <a className="btn" href={hrefFor({ name: 'discover' })}>
            Try another link
          </a>
        </div>
      </div>
    )
  }

  return <ProductDetail product={product} />
}

// While Firecrawl reads the page: the shape of the page, quietly shimmering, so nothing jumps when it arrives.
function ProductSkeleton({ title, url }: { title: string; url?: string }) {
  return (
    <div className="pdp" aria-busy="true">
      <div className="pdp__top">
        <span className="skel pdp__skelimg" />
        <div className="pdp__info">
          <div role="status" aria-live="polite">
            <p className="label">{title}</p>
            <div className="progress-line" style={{ margin: 'var(--s-4) 0' }} />
            <p className="hint-text">
              Fitr is reading the size chart, sizes and photos from the retailer’s page. This can take up to 30 seconds.
            </p>
            {url && (
              <p className="hint-text" style={{ wordBreak: 'break-all', marginTop: 'var(--s-2)' }}>
                {url}
              </p>
            )}
          </div>
          <span className="skel" style={{ height: 14, width: '30%', marginTop: 'var(--s-6)' }} />
          <span className="skel" style={{ height: 44, width: '85%', marginTop: 'var(--s-3)' }} />
          <span className="skel" style={{ height: 18, width: '25%', marginTop: 'var(--s-3)' }} />
          <span className="skel" style={{ height: 180, marginTop: 'var(--s-7)' }} />
        </div>
      </div>
    </div>
  )
}

function ProductDetail({ product }: { product: Doc<'products'> }) {
  const active = useActiveStep()
  const retailer = product.retailer ?? safeHostname(product.sourceUrl) ?? 'Retailer'
  const price = formatPrice(product.price, product.currency)
  const images = (product.images ?? []).filter((u) => /^https?:\/\//.test(u)).slice(0, 8)

  const facts = [
    { label: 'Category', value: product.category },
    { label: 'Colour', value: product.color },
    { label: 'Material', value: product.material },
    { label: 'Cut', value: product.fit },
  ].filter((f) => f.value)

  return (
    <div className="pdp">
      <a className="backlink" href={hrefFor({ name: 'discover' })}>
        ← Discover
      </a>

      <nav className="stepnav" aria-label="Steps">
        {STEPS.map((s) => (
          <button
            key={s.id}
            type="button"
            className="stepnav__item"
            aria-current={active === s.id ? 'step' : undefined}
            onClick={() => document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          >
            <span className="stepnav__no">{s.no}</span>
            <span className="stepnav__label">{s.label}</span>
          </button>
        ))}
      </nav>

      <div className="pdp__top">
        <Gallery images={images} alt={product.name ?? 'Product photo'} />

        <div className="pdp__info">
          <header className="pdp__title">
            <p className="label">{retailer}</p>
            <h1>{product.name ?? 'Untitled item'}</h1>
            <p className="pdp__price">{price ?? 'Price not listed'}</p>
          </header>

          <section id="item" className="chapter" aria-labelledby="item-h">
            <ChapterHead no="01" title="The Item" id="item-h" />
            {facts.length > 0 && (
              <dl className="facts">
                {facts.map((f) => (
                  <div key={f.label} className="facts__row">
                    <dt>{f.label}</dt>
                    <dd>{f.value}</dd>
                  </div>
                ))}
              </dl>
            )}

            <p className="label" style={{ marginTop: 'var(--s-6)' }}>
              Listed sizes
            </p>
            {product.availableSizes && product.availableSizes.length > 0 ? (
              <div className="chips" style={{ marginTop: 'var(--s-3)' }}>
                {product.availableSizes.map((size) => (
                  <span key={size} className="chip">
                    {size}
                  </span>
                ))}
              </div>
            ) : (
              <p className="hint-text" style={{ marginTop: 'var(--s-2)' }}>
                This page doesn’t list sizes.
              </p>
            )}

            <div style={{ marginTop: 'var(--s-6)' }}>
              {product.description && (
                <Accordion title="Description">
                  <p>{product.description}</p>
                </Accordion>
              )}
              <Accordion title="Size chart">
                {product.sizeChart ? (
                  <pre className="chart">{product.sizeChart}</pre>
                ) : (
                  <p>The retailer didn’t provide a size chart Fitr could read.</p>
                )}
              </Accordion>
            </div>

            <p style={{ marginTop: 'var(--s-5)' }}>
              <a className="link-arrow" href={product.sourceUrl} target="_blank" rel="noopener noreferrer">
                View on {retailer} <span className="arrow">↗</span>
              </a>
            </p>
          </section>

          <section id="fit" className="chapter" aria-labelledby="fit-h">
            <ChapterHead no="02" title="Your Fit" id="fit-h" />
            <FitSection productId={product._id} onCreateProfile={() => navigate({ name: 'profile' })} />
          </section>
        </div>
      </div>

      <section id="tryon" className="stage" aria-labelledby="tryon-h">
        <ChapterHead no="03" title="See It on Me" id="tryon-h" />
        <TryOnSection
          productId={product._id}
          productName={product.name}
          productImage={images[0]}
          onGoToProfile={() => navigate({ name: 'profile' })}
        />
      </section>

      <section id="after" className="after">
        <ProtectionSection productId={product._id} />
      </section>
    </div>
  )
}

function ChapterHead({ no, title, id }: { no: string; title: string; id: string }) {
  return (
    <header className="chapter__head">
      <span className="chapter__no">{no}</span>
      <h2 id={id}>{title}</h2>
    </header>
  )
}

// Which chapter is on screen, for the step bar.
function useActiveStep(): StepId {
  const [active, setActive] = useState<StepId>('item')
  useEffect(() => {
    const nodes = STEPS.map((s) => document.getElementById(s.id)).filter((n): n is HTMLElement => n !== null)
    if (typeof IntersectionObserver === 'undefined' || nodes.length === 0) return
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0]) setActive(visible[0].target.id as StepId)
      },
      { rootMargin: '-25% 0px -55% 0px' },
    )
    nodes.forEach((n) => io.observe(n))
    return () => io.disconnect()
  }, [])
  return active
}

// Product photography leads. Switching photos cross-fades; the CDN's tiny lazy-load sizes are upgraded, and a photo the
// retailer's CDN refuses falls back to the original URL.
function Gallery({ images, alt }: { images: string[]; alt: string }) {
  const [index, setIndex] = useState(0)
  const [raw, setRaw] = useState<Record<number, boolean>>({})

  if (images.length === 0) {
    return (
      <div className="gallery">
        <div className="gallery__frame gallery__frame--empty">No product photo was found on this page.</div>
      </div>
    )
  }
  const src = raw[index] ? images[index] : displayImage(images[index])

  return (
    <div className="gallery">
      <div className="gallery__frame">
        <img
          key={src}
          className="gallery__main"
          src={src}
          alt={alt}
          referrerPolicy="no-referrer"
          onError={() => !raw[index] && setRaw((r) => ({ ...r, [index]: true }))}
        />
      </div>
      {images.length > 1 && (
        <div className="gallery__thumbs" role="tablist" aria-label="Product photos">
          {images.map((u, i) => (
            <button
              key={u}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={`Photo ${i + 1}`}
              className="gallery__thumb"
              onClick={() => setIndex(i)}
            >
              <img src={displayImage(u)} alt="" loading="lazy" referrerPolicy="no-referrer" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function safeHostname(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}
