import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const mobileRoot = resolve(here, '..')
const repoRoot = resolve(mobileRoot, '..')
const resourcesDir = resolve(mobileRoot, 'resources')

await mkdir(resourcesDir, { recursive: true })
await copyFile(
  resolve(repoRoot, 'public/02_idogs_icon_transparent.png'),
  resolve(resourcesDir, 'icon-source.png'),
)
await copyFile(
  resolve(repoRoot, 'public/01_idogs_primary_horizontal_transparent.png'),
  resolve(resourcesDir, 'brand-horizontal-source.png'),
)

console.log('Prepared iDogs mobile branding resources from canonical web assets.')
