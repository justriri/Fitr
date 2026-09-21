import { useQuery } from 'convex/react'
import { useState } from 'react'
import { api } from '../../../convex/_generated/api'
import { navigate } from '../../lib/router'
import ProfileSummary from './ProfileSummary'
import ProfileWizard from './ProfileWizard'

interface ProfilePageProps {
  onSignOut: () => void
}

export default function ProfilePage({ onSignOut }: ProfilePageProps) {
  const profile = useQuery(api.profiles.getMyProfile)
  const [editing, setEditing] = useState(false)

  if (profile === undefined) {
    return (
      <div className="profile" aria-busy="true">
        <span className="skel" style={{ height: 14, width: 80 }} />
        <span className="skel" style={{ height: 56, width: 'min(420px, 80%)', marginTop: 16 }} />
        <span className="skel" style={{ height: 320, marginTop: 40 }} />
      </div>
    )
  }

  if (profile === null || editing) {
    return (
      <ProfileWizard
        initialProfile={profile}
        onSaved={() => {
          setEditing(false)
          // Saving a first profile completes onboarding: carry on to Discover.
          if (profile === null) navigate({ name: 'discover' })
        }}
        onCancel={profile ? () => setEditing(false) : undefined}
      />
    )
  }

  return (
    <ProfileSummary
      profile={profile}
      onEdit={() => setEditing(true)}
      onTryOn={() => navigate({ name: 'discover' })}
      onSignOut={onSignOut}
    />
  )
}
