import { useRef, useState } from 'react'

// Before / after: drag (or use the arrow keys) to wipe between the look on you and the original product photo.
// `overSrc` shows on the left of the divider, `underSrc` on the right.
export default function CompareSlider({
  overSrc,
  underSrc,
  overLabel,
  underLabel,
  overAlt,
  underAlt,
  ratio = '3 / 4',
  initial = 100,
}: {
  overSrc: string
  underSrc: string
  overLabel: string
  underLabel: string
  overAlt: string
  underAlt: string
  ratio?: string
  initial?: number
}) {
  const [pos, setPos] = useState(initial)
  const [dragging, setDragging] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  function fromPointer(clientX: number) {
    const rect = box.current?.getBoundingClientRect()
    if (!rect) return
    setPos(Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100)))
  }

  return (
    <div>
      <div
        ref={box}
        className={`compare ${dragging ? 'compare--drag' : ''}`}
        data-edge={pos >= 97 ? 'right' : pos <= 3 ? 'left' : undefined}
        style={{ aspectRatio: ratio, ['--pos' as string]: `${pos}%` }}
        onPointerDown={(e) => {
          setDragging(true)
          e.currentTarget.setPointerCapture(e.pointerId)
          fromPointer(e.clientX)
        }}
        onPointerMove={(e) => dragging && fromPointer(e.clientX)}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
      >
        <div className="compare__under">
          <img src={underSrc} alt={underAlt} referrerPolicy="no-referrer" draggable={false} />
        </div>
        <div className="compare__over">
          <img src={overSrc} alt={overAlt} draggable={false} />
        </div>
        <span className="compare__tag compare__tag--l" style={{ opacity: pos > 14 ? 1 : 0 }}>
          {overLabel}
        </span>
        <span className="compare__tag compare__tag--r" style={{ opacity: pos < 86 ? 1 : 0 }}>
          {underLabel}
        </span>
        <div className="compare__bar" aria-hidden="true">
          <span className="compare__knob">⟷</span>
        </div>
        <input
          className="compare__range"
          type="range"
          min={0}
          max={100}
          step={1}
          value={Math.round(pos)}
          aria-label={`Compare ${overLabel} with ${underLabel}`}
          onChange={(e) => setPos(Number(e.target.value))}
          tabIndex={0}
          style={{ pointerEvents: 'none' }}
        />
      </div>
      <div className="compare__actions">
        <button type="button" className="btn--text" onClick={() => setPos((p) => (p > 60 ? 50 : 100))}>
          {pos > 60 ? `Compare with ${underLabel.toLowerCase()}` : `Show ${overLabel.toLowerCase()} in full`}
        </button>
      </div>
    </div>
  )
}
