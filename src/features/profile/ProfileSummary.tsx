import type { Doc } from '../../../convex/_generated/dataModel'
import {
  cmToUnit,
  MEASUREMENT_FIELDS,
  PREFERRED_FIT_OPTIONS,
  type MeasurementSection,
} from '../../lib/bodyProfile'

type ProfileWithPhoto = Doc<'bodyProfiles'> & { photoUrl: string | null }

interface ProfileSummaryProps {
  profile: ProfileWithPhoto
  onEdit: () => void
  onTryOn: () => void
  onSignOut: () => void
}

// Your fit profile, laid out like a made-to-measure card: a portrait, and the numbers everything else is built on.
export default function ProfileSummary({ profile, onEdit, onTryOn, onSignOut }: ProfileSummaryProps) {
  const unit = profile.unitPreference
  const unitLabel = unit === 'cm' ? 'cm' : 'in'
  const fitOption = PREFERRED_FIT_OPTIONS.find((o) => o.value === profile.preferredFit)

  return (
    <div className="profile">
      <header className="page-head">
        <p className="label">Profile</p>
        <h1>Your fit profile.</h1>
        <p>Your measurements and photo. Every size recommendation and try-on is built from them.</p>
      </header>

      <div className="profile__grid">
        <div className="profile__photo">
          {profile.photoUrl ? (
            <img src={profile.photoUrl} alt="Your reference photo" />
          ) : (
            <div className="profile__nophoto">
              <p className="dropzone__title">No photo yet</p>
              <p className="hint-text">Add a reference photo to see items on you.</p>
              <button className="btn btn--secondary" onClick={onEdit} style={{ marginTop: 'var(--s-4)' }}>
                Add a photo
              </button>
            </div>
          )}
        </div>

        <div className="profile__spec">
          <div className="spec__group">
            <p className="label">Size &amp; fit</p>
            {profile.usualClothingSize && <SpecRow label="Usual clothing size" value={profile.usualClothingSize} />}
            <SpecRow label="Preferred fit" value={fitOption?.label ?? profile.preferredFit} />
            {profile.shoeSize && <SpecRow label="Shoe size" value={profile.shoeSize} />}
          </div>

          <MeasurementGroup title="Basics" section="basic" profile={profile} unit={unit} unitLabel={unitLabel} />
          <MeasurementGroup title="Upper body" section="upper" profile={profile} unit={unit} unitLabel={unitLabel} />
          <MeasurementGroup title="Lower body" section="lower" profile={profile} unit={unit} unitLabel={unitLabel} />

          {(profile.skinTone || profile.hairColor) && (
            <div className="spec__group">
              <p className="label">Appearance</p>
              {profile.skinTone && <SpecRow label="Skin tone" value={profile.skinTone} />}
              {profile.hairColor && <SpecRow label="Hair colour" value={profile.hairColor} />}
            </div>
          )}

          <p className="disclaimer">
            These measurements power an estimated visualization and size recommendation — not a guarantee of physical fit.
          </p>

          <div className="btn-row">
            <button className="btn" onClick={onTryOn}>
              Find something to try on <span className="arrow">→</span>
            </button>
            <button className="btn btn--secondary" onClick={onEdit}>
              Edit profile
            </button>
          </div>
          <p style={{ marginTop: 'var(--s-6)' }}>
            <button className="btn--text" onClick={onSignOut}>
              Sign out
            </button>
          </p>
        </div>
      </div>
    </div>
  )
}

function SpecRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="spec__row">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  )
}

function MeasurementGroup({
  title,
  section,
  profile,
  unit,
  unitLabel,
}: {
  title: string
  section: MeasurementSection
  profile: Doc<'bodyProfiles'>
  unit: 'cm' | 'in'
  unitLabel: string
}) {
  const fields = MEASUREMENT_FIELDS.filter((f) => f.section === section)
  const visible = fields.filter((f) => f.required || profile[f.key] !== undefined)
  if (visible.length === 0) return null

  return (
    <div className="spec__group">
      <p className="label">{title}</p>
      {visible.map((f) => {
        const raw = profile[f.key]
        return <SpecRow key={f.key} label={f.label} value={typeof raw === 'number' ? `${cmToUnit(raw, unit)} ${unitLabel}` : '—'} />
      })}
    </div>
  )
}
