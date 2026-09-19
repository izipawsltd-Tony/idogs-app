import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const here = dirname(fileURLToPath(import.meta.url))
const mobileRoot = resolve(here, '..')
const repoRoot = resolve(mobileRoot, '..')
const resourcesDir = resolve(mobileRoot, 'resources')

const ICON_SOURCE = resolve(repoRoot, 'public/02_idogs_icon_transparent.png')
const WORDMARK_SOURCE = resolve(repoRoot, 'public/01_idogs_primary_horizontal_transparent.png')
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 }
const TRANSPARENT = { r: 255, g: 255, b: 255, alpha: 0 }

await mkdir(resourcesDir, { recursive: true })

async function resizedBuffer(input, width, height) {
  return sharp(input)
    .trim()
    .resize({ width, height, fit: 'inside', withoutEnlargement: false, kernel: sharp.kernel.lanczos3 })
    .png()
    .toBuffer()
}

async function canvas(output, width, height, background, imageBuffer) {
  const base = sharp({ create: { width, height, channels: 4, background } })
  if (imageBuffer) base.composite([{ input: imageBuffer, gravity: 'centre' }])
  await base.png().toFile(output)
}

// iOS App Store icons must not contain alpha. Keep the canonical paw mark
// untouched and centre it on an opaque white 1024x1024 master canvas.
const iconOnly = await resizedBuffer(ICON_SOURCE, 760, 760)
await canvas(resolve(resourcesDir, 'icon-only.png'), 1024, 1024, WHITE, iconOnly)

// Android adaptive icon: a slightly smaller foreground keeps the paw safely
// inside launcher masks; the background remains the clean iDogs white.
const iconForeground = await resizedBuffer(ICON_SOURCE, 650, 650)
await canvas(resolve(resourcesDir, 'icon-foreground.png'), 1024, 1024, TRANSPARENT, iconForeground)
await canvas(resolve(resourcesDir, 'icon-background.png'), 1024, 1024, WHITE)

// Native launch splash: horizontal iDogs wordmark, centred on white.
const splashWordmark = await resizedBuffer(WORDMARK_SOURCE, 1500, 650)
await canvas(resolve(resourcesDir, 'splash.png'), 2732, 2732, WHITE, splashWordmark)

const manifest = {
  brand: 'iDogs',
  appId: 'au.com.idogs.app',
  iconMaster: 'icon-only.png',
  iconMasterSize: [1024, 1024],
  adaptiveForeground: 'icon-foreground.png',
  adaptiveBackground: 'icon-background.png',
  splashMaster: 'splash.png',
  splashMasterSize: [2732, 2732],
  sourceIcon: 'public/02_idogs_icon_transparent.png',
  sourceWordmark: 'public/01_idogs_primary_horizontal_transparent.png',
}

await writeFile(resolve(resourcesDir, 'branding-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
console.log('Prepared native iDogs icon and splash masters from canonical web assets.')
