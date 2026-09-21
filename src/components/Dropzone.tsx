import { useEffect, useId, useRef, useState } from 'react'

// Drag a photo in, or tap to choose one (on a phone this opens the camera roll). The chosen file is shown as a small
// preview with a clear way to swap it. Validation of the image itself stays with the caller.
export default function Dropzone({
  file,
  existingUrl,
  onFile,
  title = 'Add a photo',
  hint = 'Drag one here, or choose from your device.',
  ariaLabel,
  disabled = false,
}: {
  file: File | null
  existingUrl?: string | null
  onFile: (file: File | null) => void
  title?: string
  hint?: string
  ariaLabel: string
  disabled?: boolean
}) {
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)

  useEffect(() => {
    if (!file) {
      setPreview(null)
      return
    }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const shown = preview ?? existingUrl ?? null

  function take(list: FileList | null) {
    const first = list?.[0]
    if (first) onFile(first)
  }

  return (
    <div
      className={`dropzone ${over ? 'dropzone--over' : ''} ${shown ? 'dropzone--filled' : ''}`}
      onDragOver={(e) => {
        if (disabled) return
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        if (!disabled) take(e.dataTransfer.files)
      }}
    >
      {shown ? (
        <>
          <img className="dropzone__thumb" src={shown} alt="Your chosen photo" />
          <div>
            <p className="dropzone__title" style={{ fontSize: '1.25rem' }}>
              {file ? file.name.length > 28 ? `${file.name.slice(0, 26)}…` : file.name : 'Your current photo'}
            </p>
            <button type="button" className="btn--text" onClick={() => inputRef.current?.click()} disabled={disabled}>
              Choose a different photo
            </button>
          </div>
          <input
            ref={inputRef}
            id={inputId}
            className="sr-only"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            aria-label={ariaLabel}
            disabled={disabled}
            onChange={(e) => take(e.target.files)}
          />
        </>
      ) : (
        <>
          <p className="dropzone__title">{title}</p>
          <p className="hint-text">{hint}</p>
          <input
            ref={inputRef}
            id={inputId}
            className="dropzone__input"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            aria-label={ariaLabel}
            disabled={disabled}
            onChange={(e) => take(e.target.files)}
          />
        </>
      )}
    </div>
  )
}
