import { readdirSync } from 'node:fs'
import { expect, it } from 'vitest'

// Every shared server module must load: a missing named export only fails
// at runtime (500 on every call), which unit tests of other modules miss.
const libs = readdirSync(new URL('../api/_lib/', import.meta.url)).filter(f => f.endsWith('.js'))

it.each(libs)('api/_lib/%s loads', async file => {
  await expect(import(`../api/_lib/${file}`)).resolves.toBeTruthy()
})
