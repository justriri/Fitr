// Shared types + field metadata for the body profile wizard/summary.
// Kept separate from the components so the measurement list (labels, help
// text, which section they belong to) can grow without touching UI code.

import { assessMeasurements } from '../../convex/lib/tryOnPrompt'

export type UnitPreference = 'cm' | 'in'
export type PreferredFit = 'fitted' | 'regular' | 'relaxed' | 'oversized'

export type NumericMeasurementKey =
  | 'heightCm'
  | 'shoulderWidthCm'
  | 'torsoLengthCm'
  | 'bustChestCm'
  | 'waistCm'
  | 'hipCm'
  | 'inseamCm'
  | 'upperArmCm'
  | 'neckCm'
  | 'sleeveLengthCm'
  | 'thighCm'
  | 'riseCm'

export type MeasurementSection = 'basic' | 'upper' | 'lower'

export interface MeasurementField {
  key: NumericMeasurementKey
  section: MeasurementSection
  label: string
  helpText: string
  required: boolean
}

// One centimeter in inches, used to convert between the two units a person
// can enter measurements in. Values are always stored in cm (see
// convex/schema.ts) — the unit only affects what's shown in the form.
const CM_PER_INCH = 2.54

export function cmToUnit(cm: number, unit: UnitPreference): number {
  const value = unit === 'cm' ? cm : cm / CM_PER_INCH
  return Math.round(value * 10) / 10
}

export function unitToCm(value: number, unit: UnitPreference): number {
  return unit === 'cm' ? value : value * CM_PER_INCH
}

// The short label shown beside every measurement field, and the spelled-out name used in sentences.
export const UNIT_LABEL: Record<UnitPreference, string> = { cm: 'cm', in: 'in' }
export const UNIT_NAME: Record<UnitPreference, string> = { cm: 'centimeters', in: 'inches' }

// What a person sees in a box: at most one decimal, no trailing ".0" (35, not 35.0).
export function formatMeasurement(cm: number, unit: UnitPreference): string {
  return String(cmToUnit(cm, unit))
}

// Stored values are kept to 0.1 cm — the same precision the form ever displays — so what is
// saved matches what the person saw in centimeters.
export function roundStoredCm(cm: number): number {
  return Math.round(cm * 10) / 10
}

export type ParsedMeasurement = { kind: 'empty' } | { kind: 'number'; value: number } | { kind: 'invalid' }

// Reads what was typed into a measurement box. Anything that isn't a positive number is not a value.
export function parseMeasurementInput(raw: string): ParsedMeasurement {
  if (raw.trim() === '') return { kind: 'empty' }
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? { kind: 'number', value } : { kind: 'invalid' }
}

// A non-blocking nudge when a number is implausible in the selected unit — typically inches typed
// into a cm field, or the reverse. Uses the same plausibility ranges as the try-on and fit logic.
export function measurementHint(
  key: NumericMeasurementKey,
  cm: number,
  unit: UnitPreference,
  label: string,
): string | null {
  if (assessMeasurements({ [key]: cm }).rejected.length === 0) return null
  const shown = formatMeasurement(cm, unit)
  const other: UnitPreference = unit === 'cm' ? 'in' : 'cm'
  const plausibleInOther = assessMeasurements({ [key]: unitToCm(Number(shown), other) }).rejected.length === 0
  const lead = `${shown} ${UNIT_LABEL[unit]} looks unusual for ${label.toLowerCase()}.`
  return plausibleInOther
    ? `${lead} If you measured in ${UNIT_NAME[other]}, switch to ${UNIT_NAME[other]} above and re-enter it.`
    : `${lead} Please double-check the number.`
}

export const MEASUREMENT_FIELDS: MeasurementField[] = [
  {
    key: 'heightCm',
    section: 'basic',
    label: 'Height',
    required: true,
    helpText: 'Your height, from head to toe.',
  },
  {
    key: 'shoulderWidthCm',
    section: 'basic',
    label: 'Shoulder width',
    required: false,
    helpText: 'Straight across your shoulders, from edge to edge.',
  },
  {
    key: 'torsoLengthCm',
    section: 'basic',
    label: 'Torso length',
    required: false,
    helpText: 'From the base of your neck down to your waist.',
  },
  {
    key: 'bustChestCm',
    section: 'upper',
    label: 'Bust / chest',
    required: true,
    helpText: 'Around the fullest part of your chest.',
  },
  {
    key: 'upperArmCm',
    section: 'upper',
    label: 'Upper arm',
    required: false,
    helpText: 'Around the fullest part of your upper arm.',
  },
  {
    key: 'neckCm',
    section: 'upper',
    label: 'Neck',
    required: false,
    helpText: 'Around the base of your neck, where a collar would sit.',
  },
  {
    key: 'sleeveLengthCm',
    section: 'upper',
    label: 'Sleeve length',
    required: false,
    helpText: 'From your shoulder, down the outside of your arm, to your wrist.',
  },
  {
    key: 'waistCm',
    section: 'lower',
    label: 'Waist',
    required: true,
    helpText: 'Around your natural waistline — the narrowest part of your torso.',
  },
  {
    key: 'hipCm',
    section: 'lower',
    label: 'Hips',
    required: true,
    helpText: 'Around the fullest part of your hips.',
  },
  {
    key: 'inseamCm',
    section: 'lower',
    label: 'Inseam / leg length',
    required: false,
    helpText: 'From your inner thigh down to your ankle.',
  },
  {
    key: 'thighCm',
    section: 'lower',
    label: 'Thigh',
    required: false,
    helpText: 'Around the fullest part of your thigh.',
  },
  {
    key: 'riseCm',
    section: 'lower',
    label: 'Rise',
    required: false,
    helpText: 'From your waistband to your crotch seam, front to back.',
  },
]

// Shown once per step (not per field) wherever a step contains optional
// measurements, so the onboarding never feels like it's blocking on things
// most people don't know off-hand.
export const UNKNOWN_MEASUREMENT_NOTE = "Don't know your exact measurement? You can add it later."

export const USUAL_CLOTHING_SIZE_HELP =
  'The size you usually buy off the rack, e.g. "M", "8", or "UK 10". This helps us recommend a size right away.'

export const PREFERRED_FIT_OPTIONS: { value: PreferredFit; label: string; helpText: string }[] = [
  { value: 'fitted', label: 'Fitted', helpText: 'Close to the body, minimal extra room.' },
  { value: 'regular', label: 'Regular', helpText: 'True to size, the standard amount of ease.' },
  { value: 'oversized', label: 'Oversized', helpText: 'Deliberately large and roomy.' },
]

export interface WizardStepDef {
  id: 'basic' | 'upper' | 'lower' | 'appearance' | 'fit' | 'photo'
  title: string
  description: string
}

export const WIZARD_STEPS: WizardStepDef[] = [
  {
    id: 'basic',
    title: 'Basic measurements',
    description: 'Just your height — everything else here is optional.',
  },
  {
    id: 'upper',
    title: 'Upper body',
    description: 'Bust/chest is required — the rest is optional.',
  },
  {
    id: 'lower',
    title: 'Lower body',
    description: 'Waist and hips are required — the rest is optional.',
  },
  {
    id: 'appearance',
    title: 'Appearance',
    description: 'Helps personalize how clothing is visualized on you. Optional.',
  },
  {
    id: 'fit',
    title: 'Size & fit',
    description: 'Your usual size and how you like clothes to fit.',
  },
  {
    id: 'photo',
    title: 'Reference photo',
    description: 'Optional, but improves the accuracy of your visualizations.',
  },
]
