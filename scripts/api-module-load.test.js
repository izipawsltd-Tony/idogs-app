import { readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

// Every shared server module must load under real Node ESM: a missing named
// export only fails at runtime (500 on every call). Vitest's own transform
// does not check named exports, so load them in a plain Node process.
const dir = fileURLToPath(new URL('../api/_lib/', import.meta.url))
const libs = readdirSync(dir).filter(f => f.endsWith('.js'))

it('every api/_lib module loads under Node ESM', () => {
  const script = `const fails=[];for (const f of ${JSON.stringify(libs)}) { try { await import(${JSON.stringify(dir)}+f) } catch (e) { fails.push(f+': '+e.message) } } console.log(JSON.stringify(fails))`
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', env: { ...process.env, STRIPE_SECRET_KEY: 'sk_test_dummy' } })
  expect(JSON.parse(out.trim().split('\n').pop())).toEqual([])
}, 60_000)
