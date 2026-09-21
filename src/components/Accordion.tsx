import { useId, useState, type ReactNode } from 'react'

// Expand / collapse with a smooth height. Used for detail that is useful but shouldn't compete with the product.
export default function Accordion({
  title,
  children,
  defaultOpen = false,
}: {
  title: string
  children: ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const id = useId()
  return (
    <div className={`acc ${open ? 'acc--open' : ''}`}>
      <button type="button" className="acc__head" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        <span>{title}</span>
        <span className="acc__icon" aria-hidden="true" />
      </button>
      <div className="acc__body" id={id} role="region" aria-label={title} inert={!open}>
        <div className="acc__inner">
          <div className="acc__content">{children}</div>
        </div>
      </div>
    </div>
  )
}
