// Runs every tests/*.test.ts in its own Node process; exits non-zero if any fail.
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))
const files = readdirSync(dir).filter((f) => f.endsWith('.test.ts')).sort()
const only = process.argv[2]
let failed = 0

for (const file of files) {
  if (only && !file.includes(only)) continue
  console.log(`\n=== ${file} ===`)
  const result = spawnSync(
    process.execPath,
    ['--disable-warning=ExperimentalWarning', '--import', pathToFileURL(join(dir, 'register.mjs')).href, join(dir, file)],
    { stdio: 'inherit' },
  )
  if (result.status !== 0) failed++
}

console.log(failed === 0 ? '\nAll test files passed.' : `\n${failed} test file(s) FAILED.`)
process.exit(failed === 0 ? 0 : 1)
