import { useMutation } from 'convex/react'
import { useMemo, useState } from 'react'
import { api } from '../../../convex/_generated/api'
import Dropzone from '../../components/Dropzone'
import type { Doc, Id } from '../../../convex/_generated/dataModel'
import {
  formatMeasurement,
  MEASUREMENT_FIELDS,
  measurementHint,
  parseMeasurementInput,
  PREFERRED_FIT_OPTIONS,
  roundStoredCm,
  UNIT_LABEL,
  UNIT_NAME,
  UNKNOWN_MEASUREMENT_NOTE,
  unitToCm,
  USUAL_CLOTHING_SIZE_HELP,
  WIZARD_STEPS,
  type MeasurementSection,
  type NumericMeasurementKey,
  type PreferredFit,
  type UnitPreference,
} from '../../lib/bodyProfile'

type ExistingProfile = Doc<'bodyProfiles'> & { photoUrl: string | null }

interface ProfileWizardProps {
  initialProfile: ExistingProfile | null
  onSaved: () => void
  onCancel?: () => void
}

// Values are held in centimeters (the stored unit) so switching the unit converts what's
// already entered, with no drift from repeated toggling. `drafts` is the text actually
// shown in each box, so what a person types is never rewritten under them.
type NumericValues = Partial<Record<NumericMeasurementKey, number>>
type Drafts = Partial<Record<NumericMeasurementKey, string>>

function draftsFor(values: NumericValues, unit: UnitPreference): Drafts {
  const drafts: Drafts = {}
  for (const key of Object.keys(values) as NumericMeasurementKey[]) {
    const cm = values[key]
    if (cm !== undefined) drafts[key] = formatMeasurement(cm, unit)
  }
  return drafts
}

export default function ProfileWizard({ initialProfile, onSaved, onCancel }: ProfileWizardProps) {
  const upsertProfile = useMutation(api.profiles.upsertProfile)
  const generatePhotoUploadUrl = useMutation(api.profiles.generatePhotoUploadUrl)

  const initialUnit: UnitPreference = initialProfile?.unitPreference ?? 'cm'
  const [stepIndex, setStepIndex] = useState(0)
  const [unit, setUnit] = useState<UnitPreference>(initialUnit)
  const [values, setValues] = useState<NumericValues>(() => extractNumericValues(initialProfile))
  const [drafts, setDrafts] = useState<Drafts>(() => draftsFor(extractNumericValues(initialProfile), initialUnit))
  const [focusedKey, setFocusedKey] = useState<NumericMeasurementKey | null>(null)
  const [preferredFit, setPreferredFit] = useState<PreferredFit>(
    initialProfile?.preferredFit ?? 'regular',
  )
  const [usualClothingSize, setUsualClothingSize] = useState(
    initialProfile?.usualClothingSize ?? '',
  )
  const [skinTone, setSkinTone] = useState(initialProfile?.skinTone ?? '')
  const [hairColor, setHairColor] = useState(initialProfile?.hairColor ?? '')
  const [shoeSize, setShoeSize] = useState(initialProfile?.shoeSize ?? '')
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const step = WIZARD_STEPS[stepIndex]
  const isLastStep = stepIndex === WIZARD_STEPS.length - 1

  const missingRequiredForStep = useMemo(
    () => getMissingRequiredFields(step.id, values, usualClothingSize),
    [step.id, values, usualClothingSize],
  )

  function setNumericField(key: NumericMeasurementKey, rawInput: string) {
    setDrafts((prev) => ({ ...prev, [key]: rawInput }))
    const parsed = parseMeasurementInput(rawInput)
    setValues((prev) => {
      const next = { ...prev }
      if (parsed.kind === 'number') next[key] = unitToCm(parsed.value, unit)
      else delete next[key]
      return next
    })
  }

  // Converts every value already entered, then relabels every field — never just the label.
  function changeUnit(next: UnitPreference) {
    if (next === unit) return
    setUnit(next)
    setDrafts(draftsFor(values, next))
  }

  function goNext() {
    if (missingRequiredForStep.length > 0) {
      setError('Please fill in the required fields before continuing.')
      return
    }
    setError('')
    setStepIndex((i) => Math.min(i + 1, WIZARD_STEPS.length - 1))
  }

  function goBack() {
    setError('')
    setStepIndex((i) => Math.max(i - 1, 0))
  }

  async function handleSave() {
    const allMissing = WIZARD_STEPS.flatMap((s) =>
      getMissingRequiredFields(s.id, values, usualClothingSize),
    )
    if (allMissing.length > 0) {
      setError('Some required measurements are missing. Please go back and fill them in.')
      return
    }

    setSubmitting(true)
    setError('')
    try {
      let photoId: Id<'_storage'> | undefined
      if (photoFile) {
        const uploadUrl = await generatePhotoUploadUrl({})
        const res = await fetch(uploadUrl, {
          method: 'POST',
          headers: { 'Content-Type': photoFile.type },
          body: photoFile,
        })
        if (!res.ok) {
          throw new Error('Photo upload failed')
        }
        const json = (await res.json()) as { storageId: Id<'_storage'> }
        photoId = json.storageId
      }

      const cm = (key: NumericMeasurementKey) => (values[key] === undefined ? undefined : roundStoredCm(values[key]))

      await upsertProfile({
        unitPreference: unit,
        heightCm: cm('heightCm')!,
        bustChestCm: cm('bustChestCm')!,
        waistCm: cm('waistCm')!,
        hipCm: cm('hipCm')!,
        usualClothingSize: usualClothingSize.trim(),
        shoulderWidthCm: cm('shoulderWidthCm'),
        torsoLengthCm: cm('torsoLengthCm'),
        inseamCm: cm('inseamCm'),
        upperArmCm: cm('upperArmCm'),
        neckCm: cm('neckCm'),
        sleeveLengthCm: cm('sleeveLengthCm'),
        thighCm: cm('thighCm'),
        riseCm: cm('riseCm'),
        shoeSize: shoeSize.trim() || undefined,
        preferredFit,
        skinTone: skinTone.trim() || undefined,
        hairColor: hairColor.trim() || undefined,
        ...(photoId ? { photoId } : {}),
      })

      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong saving your profile.')
    } finally {
      setSubmitting(false)
    }
  }

  const existingPhotoUrl = initialProfile?.photoUrl ?? null

  // Every measurement field of a section, each carrying its unit beside the label and inside the box.
  const measurementFields = (section: MeasurementSection) =>
    fieldsFor(section).map((f) => {
      const cm = values[f.key]
      return (
        <NumberFieldRow
          key={f.key}
          fieldKey={f.key}
          label={f.label}
          helpText={f.helpText}
          required={f.required}
          unit={unit}
          draft={drafts[f.key] ?? ''}
          hint={cm !== undefined && focusedKey !== f.key ? measurementHint(f.key, cm, unit, f.label) : null}
          onChange={(raw) => setNumericField(f.key, raw)}
          onFocus={() => setFocusedKey(f.key)}
          onBlur={() => setFocusedKey((k) => (k === f.key ? null : k))}
        />
      )
    })

  return (
    <div className="wizard route">
      <div className="progress">
        {WIZARD_STEPS.map((s, i) => (
          <div className="progress__step" key={s.id}>
            <div
              className="progress__step-fill"
              style={{ width: i <= stepIndex ? '100%' : '0%' }}
            />
          </div>
        ))}
      </div>
      <div className="progress__label">
        Step {stepIndex + 1} of {WIZARD_STEPS.length}
      </div>

      <div className="step-header">
        <h2>{step.title}</h2>
        <p>{step.description}</p>
      </div>

      {step.id === 'basic' && (
        <>
          <UnitSelector unit={unit} onChange={changeUnit} />
          <p className="hint-text" style={{ marginBottom: 'var(--s-4)' }}>
            {UNKNOWN_MEASUREMENT_NOTE}
          </p>
          {measurementFields('basic')}
        </>
      )}

      {step.id === 'upper' && (
        <>
          <UnitSelector unit={unit} onChange={changeUnit} />
          <p className="hint-text" style={{ marginBottom: 'var(--s-4)' }}>
            {UNKNOWN_MEASUREMENT_NOTE}
          </p>
          {measurementFields('upper')}
        </>
      )}

      {step.id === 'lower' && (
        <>
          <UnitSelector unit={unit} onChange={changeUnit} />
          <p className="hint-text" style={{ marginBottom: 'var(--s-4)' }}>
            {UNKNOWN_MEASUREMENT_NOTE}
          </p>
          {measurementFields('lower')}
          <div className="field">
            <div className="field-label-row">
              <span className="field-label">Foot / shoe size</span>
              <span className="field-badge">Optional</span>
            </div>
            <p className="field-help">
              Enter it however you know it, e.g. "US 9" or "EU 42".
            </p>
            <input
              type="text"
              value={shoeSize}
              placeholder="e.g. US 9"
              onChange={(e) => setShoeSize(e.target.value)}
            />
          </div>
        </>
      )}

      {step.id === 'appearance' && (
        <>
          <div className="field">
            <div className="field-label-row">
              <span className="field-label">Skin tone</span>
              <span className="field-badge">Optional</span>
            </div>
            <p className="field-help">A short description helps personalize your visualization.</p>
            <input
              type="text"
              value={skinTone}
              placeholder="e.g. deep, warm undertone"
              onChange={(e) => setSkinTone(e.target.value)}
            />
          </div>
          <div className="field">
            <div className="field-label-row">
              <span className="field-label">Hair color</span>
              <span className="field-badge">Optional</span>
            </div>
            <input
              type="text"
              value={hairColor}
              placeholder="e.g. dark brown"
              onChange={(e) => setHairColor(e.target.value)}
            />
          </div>
        </>
      )}

      {step.id === 'fit' && (
        <>
          <div className="field">
            <div className="field-label-row">
              <span className="field-label">Usual clothing size</span>
              <span className="field-badge field-badge--required">Required</span>
            </div>
            <p className="field-help">{USUAL_CLOTHING_SIZE_HELP}</p>
            <input
              type="text"
              value={usualClothingSize}
              placeholder="e.g. M, 8, UK 10"
              onChange={(e) => setUsualClothingSize(e.target.value)}
            />
          </div>
          <div className="fit-options">
            {PREFERRED_FIT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`fit-option ${preferredFit === opt.value ? 'selected' : ''}`}
                onClick={() => setPreferredFit(opt.value)}
              >
                <span className="fit-option__label">{opt.label}</span>
                <span className="fit-option__help">{opt.helpText}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {step.id === 'photo' && (
        <div>
          <p className="hint-text" style={{ marginBottom: 'var(--s-4)' }}>
            A clear, front-facing photo improves how accurately clothing can be visualized on you. This step is optional.
          </p>
          <Dropzone
            file={photoFile}
            existingUrl={existingPhotoUrl}
            onFile={setPhotoFile}
            title="Add a full-length photo"
            hint="Front-facing, good light, a plain background works best. Drag one here, or choose from your device."
            ariaLabel="Reference photo"
            disabled={submitting}
          />
        </div>
      )}

      {error && <p className="error-text">{error}</p>}

      <div className="btn-row">
        <div>
          {stepIndex > 0 ? (
            <button className="btn btn--secondary" onClick={goBack} disabled={submitting}>
              Back
            </button>
          ) : onCancel ? (
            <button className="btn--text" onClick={onCancel} disabled={submitting}>
              Cancel
            </button>
          ) : null}
        </div>
        {isLastStep ? (
          <button className="btn" onClick={() => void handleSave()} disabled={submitting}>
            {submitting ? 'Saving…' : 'Save profile'}
          </button>
        ) : (
          <button className="btn" onClick={goNext} disabled={submitting}>
            Continue
          </button>
        )}
      </div>
    </div>
  )
}

function fieldsFor(section: MeasurementSection) {
  return MEASUREMENT_FIELDS.filter((f) => f.section === section)
}

function getMissingRequiredFields(
  stepId: (typeof WIZARD_STEPS)[number]['id'],
  values: NumericValues,
  usualClothingSize: string,
) {
  if (stepId === 'fit') {
    return usualClothingSize.trim() === '' ? ['usualClothingSize'] : []
  }

  const sectionForStep: Partial<Record<typeof stepId, MeasurementSection>> = {
    basic: 'basic',
    upper: 'upper',
    lower: 'lower',
  }
  const section = sectionForStep[stepId]
  if (!section) return []
  return fieldsFor(section)
    .filter((f) => f.required && values[f.key] === undefined)
    .map((f) => f.key)
}

function extractNumericValues(profile: ExistingProfile | null): NumericValues {
  if (!profile) return {}
  const result: NumericValues = {}
  for (const field of MEASUREMENT_FIELDS) {
    const raw = profile[field.key]
    if (typeof raw === 'number') {
      result[field.key] = raw
    }
  }
  return result
}

// Shown on every measurement step so the unit is never something to infer from a placeholder.
function UnitSelector({
  unit,
  onChange,
}: {
  unit: UnitPreference
  onChange: (u: UnitPreference) => void
}) {
  return (
    <div className="unit-selector">
      <div className="field-label-row">
        <span className="field-label">Measurement units</span>
      </div>
      <div className="segmented" role="group" aria-label="Measurement units">
        <button
          type="button"
          className={unit === 'cm' ? 'active' : ''}
          aria-pressed={unit === 'cm'}
          onClick={() => onChange('cm')}
        >
          Centimeters
        </button>
        <button
          type="button"
          className={unit === 'in' ? 'active' : ''}
          aria-pressed={unit === 'in'}
          onClick={() => onChange('in')}
        >
          Inches
        </button>
      </div>
      <p className="unit-selector__note">
        Enter every measurement in <strong>{UNIT_NAME[unit]} ({UNIT_LABEL[unit]})</strong>. Switching converts anything
        you've already entered.
      </p>
    </div>
  )
}

function NumberFieldRow({
  fieldKey,
  label,
  helpText,
  required,
  unit,
  draft,
  hint,
  onChange,
  onFocus,
  onBlur,
}: {
  fieldKey: NumericMeasurementKey
  label: string
  helpText: string
  required: boolean
  unit: UnitPreference
  draft: string
  hint: string | null
  onChange: (raw: string) => void
  onFocus: () => void
  onBlur: () => void
}) {
  const unitLabel = UNIT_LABEL[unit]
  const inputId = `measurement-${fieldKey}`
  return (
    <div className="field">
      <div className="field-label-row">
        <label className="field-label" htmlFor={inputId}>
          {label}
          <span className="field-unit-tag"> — {unitLabel}</span>
        </label>
        <span className={`field-badge ${required ? 'field-badge--required' : ''}`}>
          {required ? 'Required' : 'Optional'}
        </span>
      </div>
      <p className="field-help">{helpText}</p>
      <div className="unit-input">
        <input
          id={inputId}
          type="number"
          inputMode="decimal"
          step="any"
          min="0"
          value={draft}
          onChange={(e) => onChange(e.target.value)}
          onFocus={onFocus}
          onBlur={onBlur}
        />
        <span className="unit-input__suffix" aria-hidden="true">
          {unitLabel}
        </span>
      </div>
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  )
}
