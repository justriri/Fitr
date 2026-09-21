import { useEffect, useState } from 'react'
import Reveal from '../../components/Reveal'
import FitSummary from '../fit/FitSummary'

const JOURNEY = [
  { title: 'Find something', text: 'Paste a link from any retailer.' },
  { title: 'Check your fit', text: 'A size chosen from your measurements.' },
  { title: 'See it on you', text: 'The real garment, on your photo.' },
  { title: 'Buy with confidence', text: 'Decide knowing how it fits and looks.' },
  { title: 'Get help if it doesn’t match', text: 'Compare what arrived. You approve any message.' },
]

// The public front door. Image-led, calm, and it explains the product by showing it: a fit result, a look, a review.
export default function Landing({ onStart }: { onStart: (mode: 'signUp' | 'signIn') => void }) {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8)
    on()
    window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [])

  return (
    <div className="landing">
      <header className={`topbar ${scrolled ? 'topbar--scrolled' : ''}`}>
        <div className="container topbar__in">
          <a className="wordmark" href="#/" aria-label="Fitr">
            Fitr
          </a>
          <div className="landnav__actions">
            <button className="btn--text landnav__signin" onClick={() => onStart('signIn')}>
              Sign in
            </button>
            <button className="btn btn--sm" onClick={() => onStart('signUp')}>
              Try Fitr
            </button>
          </div>
        </div>
      </header>

      {/* ---------- Hero ---------- */}
      <section className="hero">
        <div className="container hero__grid">
          <div className="hero__copy route">
            <p className="label">Fit, for every retailer</p>
            <h1>
              <span>See it on you.</span>
              <span>Know your fit.</span>
              <span>
                <em>Find it in your size.</em>
              </span>
            </h1>
            <p className="hero__lede">
              Stop guessing how clothes will fit. Paste any item from any retailer — Fitr finds the size to buy and shows
              it on you.
            </p>
            <div className="hero__cta">
              <button className="btn" onClick={() => onStart('signUp')}>
                Try Fitr <span className="arrow">→</span>
              </button>
              <a className="link-arrow" href="#how">
                How it works
              </a>
            </div>
          </div>
          <div className="hero__media route">
            <img className="hero__img" src="/images/hero.jpg" alt="A model in a white tailored suit against a grey studio wall" />
            <div className="samplecard" aria-label="Sample fit result">
              <span className="samplecard__tag">Sample</span>
              <FitSummary
                size="M"
                fitLabel="Regular fit"
                confidence="high"
                checks={[
                  { measure: 'bust', state: 'fits' },
                  { measure: 'waist', state: 'fits' },
                  { measure: 'hip', state: 'fits' },
                ]}
              />
            </div>
          </div>
        </div>
      </section>

      {/* ---------- The journey ---------- */}
      <section className="journey" id="how" aria-label="How Fitr works">
        <div className="container">
          <ol className="journey__list">
            {JOURNEY.map((step, i) => (
              <Reveal as="li" key={step.title} delay={i * 70} className="journey__item">
                <span className="journey__no">{String(i + 1).padStart(2, '0')}</span>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </Reveal>
            ))}
          </ol>
        </div>
      </section>

      {/* ---------- Know your fit ---------- */}
      <section className="feature">
        <div className="container feature__grid">
          <Reveal className="feature__media">
            <img src="/images/fit.jpg" alt="A person in a long dark trench coat, seen from behind, against a pale wall" loading="lazy" />
            <div className="samplecard samplecard--measure" aria-label="Sample measurement check">
              <span className="samplecard__tag">Sample</span>
              <div className="measure">
                <span className="label">Your bust</span>
                <span className="measure__v">90 cm</span>
              </div>
              <div className="measure">
                <span className="label">Size M on the chart</span>
                <span className="measure__v">86–92 cm</span>
              </div>
              <p className="measure__ok">✓ Bust fits</p>
            </div>
          </Reveal>
          <Reveal className="feature__copy" delay={120}>
            <p className="label">01 — Know your fit</p>
            <h2>
              The size that suits <em>your</em> body.
            </h2>
            <p>
              Fitr reads the retailer’s own size chart and compares it with your body profile and how you like clothes to
              fit. You get one clear size, the reason for it, and how confident we are.
            </p>
            <ul className="feature__list">
              <li>Your measurements against the garment’s real chart</li>
              <li>Your preferred fit, from fitted to oversized</li>
              <li>Whether that size is actually listed — with alternatives if it isn’t</li>
            </ul>
          </Reveal>
        </div>
      </section>

      {/* ---------- See it on you ---------- */}
      <section className="feature feature--dark">
        <div className="container feature__grid feature__grid--flip">
          <Reveal className="feature__media">
            <img src="/images/tryon.jpg" alt="A model in a satin slip dress in soft studio light" loading="lazy" />
          </Reveal>
          <Reveal className="feature__copy" delay={120}>
            <p className="label">02 — See it on you</p>
            <h2>
              Yourself, in the garment <em>before</em> you buy.
            </h2>
            <p>
              Add a reference photo once. Fitr shows the actual product on you, using your measurements — so you can judge
              the length, the colour and the way it sits.
            </p>
            <div className="trio" aria-label="How a look is made">
              <span>Your photo</span>
              <i aria-hidden="true">+</i>
              <span>The garment</span>
              <i aria-hidden="true">=</i>
              <span>You, wearing it</span>
            </div>
            <p className="feature__note">An estimate of how it may look — never a guarantee of fit.</p>
          </Reveal>
        </div>
      </section>

      {/* ---------- Protection ---------- */}
      <section className="feature">
        <div className="container feature__grid">
          <Reveal className="feature__media">
            <img src="/images/protect.jpg" alt="Black trousers and heeled sandals beside a pale abstract backdrop" loading="lazy" />
            <div className="samplecard samplecard--review" aria-label="Sample review screen">
              <span className="samplecard__tag">Sample</span>
              <p className="review__title">Possible mismatch</p>
              <p className="review__text">We found something that may differ from the original listing.</p>
              <p className="review__control">Fitr suggests. You decide whether to send.</p>
            </div>
          </Reveal>
          <Reveal className="feature__copy" delay={120}>
            <p className="label">03 — Protection after purchase</p>
            <h2>If it arrives different, we help you say so.</h2>
            <p>
              Upload a photo of what you received. Fitr compares it with the original listing and, if something looks off,
              drafts a short, polite message to the retailer. You read it first. You decide.
            </p>
            <ul className="feature__list">
              <li>Nothing is ever sent without your approval</li>
              <li>No invented order numbers, dates or claims</li>
              <li>Replies land right inside Fitr</li>
            </ul>
          </Reveal>
        </div>
      </section>

      {/* ---------- Closing ---------- */}
      <section className="closing">
        <img className="closing__img" src="/images/closing.jpg" alt="" loading="lazy" />
        <div className="closing__veil" />
        <Reveal className="closing__copy">
          <h2>Stop guessing.</h2>
          <p>Your measurements, every retailer, one clear answer.</p>
          <button className="btn btn--light" onClick={() => onStart('signUp')}>
            Try Fitr <span className="arrow">→</span>
          </button>
        </Reveal>
      </section>

      <footer className="footer">
        <div className="container footer__in">
          <span className="wordmark">Fitr</span>
          <span>Photography via Unsplash and Pexels. Fit results are estimates, not guarantees.</span>
        </div>
      </footer>
    </div>
  )
}
