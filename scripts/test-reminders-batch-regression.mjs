// Exercise actual db.ts loaders with mocked I/O rather than mirroring the
// superseded tenantId + claimed-dog merge algorithm.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const vitest = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url))
const result = spawnSync(process.execPath, [vitest, 'run', 'src/lib/transferPrivacy.test.ts'], { stdio: 'inherit' })
process.exit(result.status ?? 1)
