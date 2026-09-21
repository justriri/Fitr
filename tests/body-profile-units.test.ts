import assert from 'node:assert/strict'
import {
  cmToUnit,
  formatMeasurement,
  measurementHint,
  parseMeasurementInput,
  roundStoredCm,
  UNIT_LABEL,
  UNIT_NAME,
  unitToCm,
} from '../src/lib/bodyProfile'

let passed = 0
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log('  ok  ', name) } catch (e) { console.log('  FAIL', name, '\n      ', (e as Error).message); process.exitCode = 1 }
}

console.log('conversion actually converts numbers (not just labels)')
test('35 in = 88.9 cm, and back', () => {
  assert.equal(unitToCm(35, 'in'), 88.9)
  assert.equal(cmToUnit(88.9, 'in'), 35)
})
test('height: 167 cm = 65.7 in; 66 in = 167.6 cm', () => {
  assert.equal(formatMeasurement(167, 'in'), '65.7')
  assert.equal(roundStoredCm(unitToCm(66, 'in')), 167.6)
})
test('the typical entries from the real profile convert cleanly', () => {
  const cases: Array<[number, string]> = [[35, '88.9'], [27, '68.6'], [38, '96.5'], [16, '40.6'], [12, '30.5'], [25, '63.5'], [28, '71.1']]
  for (const [inches, cm] of cases) assert.equal(formatMeasurement(unitToCm(inches, 'in'), 'cm'), cm, `${inches} in`)
})
test('display is clean: no trailing ".0", at most one decimal', () => {
  assert.equal(formatMeasurement(88.9, 'in'), '35')
  assert.equal(formatMeasurement(68.58, 'cm'), '68.6')
  assert.equal(formatMeasurement(167, 'cm'), '167')
  for (const cm of [55.123, 91.44, 100.05, 167.64]) assert.ok(!/\.\d{2,}/.test(formatMeasurement(cm, 'in')) && !/\.\d{2,}/.test(formatMeasurement(cm, 'cm')))
})
test('round trip: a value typed in inches shows the same number after converting to cm and back', () => {
  for (let x = 20; x <= 70; x += 0.5) {
    const cm = unitToCm(x, 'in')
    assert.equal(formatMeasurement(cm, 'in'), String(x), `${x} in`)
  }
})
test('no drift: toggling the unit many times never changes the underlying value', () => {
  const cm = unitToCm(27, 'in') // canonical value the form keeps
  let shownIn = ''
  for (let i = 0; i < 20; i++) shownIn = formatMeasurement(cm, i % 2 === 0 ? 'in' : 'cm')
  assert.equal(formatMeasurement(cm, 'in'), '27')
  assert.equal(shownIn, '68.6')
  assert.equal(cm, unitToCm(27, 'in'))
})

console.log('\nsaved values')
test('stored precision is 0.1 cm and matches what the cm view shows', () => {
  assert.equal(roundStoredCm(68.58), 68.6)
  assert.equal(roundStoredCm(96.52), 96.5)
  assert.equal(roundStoredCm(167.64), 167.6)
  assert.equal(formatMeasurement(roundStoredCm(unitToCm(27, 'in')), 'cm'), '68.6')
})
test('a stored value re-opened in its saved unit shows the number the person entered', () => {
  assert.equal(formatMeasurement(roundStoredCm(unitToCm(35, 'in')), 'in'), '35')
  assert.equal(formatMeasurement(roundStoredCm(unitToCm(27.5, 'in')), 'in'), '27.5')
  assert.equal(formatMeasurement(167, 'cm'), '167')
})

console.log('\ntyped text')
test('typed text is parsed without being rewritten (decimals allowed)', () => {
  assert.deepEqual(parseMeasurementInput('27.55'), { kind: 'number', value: 27.55 })
  assert.deepEqual(parseMeasurementInput('35'), { kind: 'number', value: 35 })
})
test('empty / blank is "cleared"; zero, negative and junk are not values', () => {
  assert.deepEqual(parseMeasurementInput(''), { kind: 'empty' })
  assert.deepEqual(parseMeasurementInput('   '), { kind: 'empty' })
  for (const bad of ['0', '-5', 'abc', 'NaN', 'Infinity']) assert.deepEqual(parseMeasurementInput(bad), { kind: 'invalid' }, bad)
})

console.log('\nlabels')
test('every unit has a short label and a spelled-out name', () => {
  assert.deepEqual(UNIT_LABEL, { cm: 'cm', in: 'in' })
  assert.deepEqual(UNIT_NAME, { cm: 'centimeters', in: 'inches' })
})

console.log('\nwrong-unit hint (non-blocking)')
test('35 in a cm field for bust => suggests inches', () => {
  const h = measurementHint('bustChestCm', 35, 'cm', 'Bust / chest')!
  assert.match(h, /35 cm looks unusual for bust \/ chest/)
  assert.match(h, /If you measured in inches, switch to inches above and re-enter it/)
})
test('89 in an inches field for bust (cm typed as inches) => suggests centimeters', () => {
  const h = measurementHint('bustChestCm', unitToCm(89, 'in'), 'in', 'Bust / chest')!
  assert.match(h, /89 in looks unusual/)
  assert.match(h, /If you measured in centimeters, switch to centimeters above/)
})
test('an implausible number in either unit just says to double-check', () => {
  assert.match(measurementHint('waistCm', 5, 'cm', 'Waist')!, /Please double-check the number/)
})
test('sensible values get no hint, in either unit', () => {
  assert.equal(measurementHint('bustChestCm', 90, 'cm', 'Bust / chest'), null)
  assert.equal(measurementHint('bustChestCm', unitToCm(35, 'in'), 'in', 'Bust / chest'), null)
  assert.equal(measurementHint('heightCm', 167, 'cm', 'Height'), null)
  assert.equal(measurementHint('heightCm', unitToCm(66, 'in'), 'in', 'Height'), null)
  assert.equal(measurementHint('neckCm', unitToCm(12, 'in'), 'in', 'Neck'), null)
})
console.log(`\n${passed} passed`)
