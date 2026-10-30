import { spawnSync } from 'node:child_process'
import { assertRecoveryQaRuntime } from '../api/_lib/account-recovery-qa.js'
assertRecoveryQaRuntime()
for (const path of ['scripts/test-account-mobile-emulator.mjs', 'scripts/test-account-recovery-emulator.mjs']) {
  const result = spawnSync(process.execPath, ['--test', path], { stdio: 'inherit', env: process.env, shell: false })
  if (result.status !== 0) process.exit(result.status || 1)
}
