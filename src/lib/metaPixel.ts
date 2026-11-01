// Public website acquisition only. No account fields or dog records are sent.
export const META_PIXEL_ID = '2647777915638218'
export const META_CONSENT_KEY = 'idogs-meta-consent-v1'
type Pixel = ((...args: unknown[]) => void) & { queue?: unknown[][]; push?: Pixel; loaded?: boolean; version?: string; callMethod?: (...args: unknown[]) => void }
type PixelWindow = Window & { fbq?: Pixel; _fbq?: Pixel; Capacitor?: { isNativePlatform?: () => boolean } }
let lastPage = ''

// Standard Meta Ads URL parameters (UTM incl. utm_id, Meta dynamic URL
// parameters). Values are ad metadata only — never account or form data.
// Any other key (e.g. ?email=…) still disables measurement for that visit.
export const META_QUERY_KEYS = [
  'fbclid', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'utm_id', 'utm_placement',
  'campaign_id', 'adset_id', 'ad_id', 'campaign_name', 'adset_name', 'ad_name', 'placement', 'site_source_name', 'next',
]
const MARKETING_PATHS = ['/', '/signup']
// CompleteRegistration only: a brand-new account may also be created by the
// mobile-number form on /login. No PageView is ever sent for /login.
const REGISTRATION_PATHS = ['/', '/signup', '/login']

function isWebsite() {
  const w = window as PixelWindow
  return !import.meta.env.VITE_IDOGS_NATIVE_PLATFORM && !w.Capacitor?.isNativePlatform?.()
}

export function isMarketingWebsitePage() {
  return isWebsite() && MARKETING_PATHS.includes(location.pathname)
}

function canMeasurePath(paths: string[]) {
  const query = new URLSearchParams(location.search)
  return isWebsite() && paths.includes(location.pathname)
    && ['idogs.com.au', 'www.idogs.com.au'].includes(location.hostname)
    && Array.from(query.keys()).every(key => META_QUERY_KEYS.includes(key))
    && (!query.has('next') || ['/app/dashboard', '/app/billing'].includes(query.get('next')!))
}

export function canMeasureMarketingPage() {
  return canMeasurePath(MARKETING_PATHS)
}

export function readMetaConsent(): 'granted' | 'denied' | null {
  try {
    const value = localStorage.getItem(META_CONSENT_KEY)
    return value === 'granted' || value === 'denied' ? value : null
  } catch { return null }
}

function revokePixel() {
  const fbq = (window as PixelWindow).fbq
  // Keep initialization but discard events that have not yet been dispatched.
  // Otherwise a slow SDK could read a private URL after a route transition.
  if (fbq && !fbq.callMethod) fbq.queue = fbq.queue?.filter(args => args[0] === 'init' || args[0] === 'set') ?? []
  fbq?.('consent', 'revoke')
}

function pixel(paths = MARKETING_PATHS) {
  if (!canMeasurePath(paths) || readMetaConsent() !== 'granted') return
  const w = window as PixelWindow
  if (!w.fbq) {
    const queue: Pixel = (...args) => { queue.callMethod ? queue.callMethod(...args) : queue.queue!.push(args) }
    queue.queue = []
    queue.push = queue
    queue.loaded = true
    queue.version = '2.0'
    w.fbq = queue
    w._fbq = queue
    queue('set', 'autoConfig', false, META_PIXEL_ID)
    queue('init', META_PIXEL_ID)
    const script = document.createElement('script')
    script.async = true
    script.src = 'https://connect.facebook.net/en_US/fbevents.js'
    document.head.appendChild(script)
  }
  w.fbq('consent', 'grant')
  return w.fbq
}

export function setMetaConsent(value: 'granted' | 'denied') {
  try { localStorage.setItem(META_CONSENT_KEY, value) } catch { return }
  if (value === 'denied') {
    revokePixel()
    lastPage = ''
    // Remove browser-side Meta cookies we can access after withdrawal.
    for (const name of ['_fbp', '_fbc']) {
      for (const domain of ['', '; domain=idogs.com.au', '; domain=.idogs.com.au']) {
        document.cookie = `${name}=; Max-Age=0; path=/${domain}; SameSite=Lax; Secure`
      }
    }
  }
}

export function trackMarketingPage() {
  try {
    const fbq = pixel()
    if (!fbq || lastPage === location.pathname) return
    lastPage = location.pathname
    fbq('trackSingle', META_PIXEL_ID, 'PageView')
  } catch { /* Advertising must never interrupt the app. */ }
}

// Resolves once the event can no longer be lost. Callers navigate into the
// private app right after signup, and suspendMetaTracking() then discards
// events still queued for an SDK that has not loaded yet (so it can never
// read a private URL). Wait — bounded, consented visitors only — for the SDK
// to take the event first. Never rejects; never blocks for non-consented
// visitors, preview hosts or the native app.
export function trackCompletedRegistration(timeoutMs = 1500): Promise<void> {
  try {
    const fbq = pixel(REGISTRATION_PATHS)
    if (!fbq) return Promise.resolve()
    fbq('trackSingle', META_PIXEL_ID, 'CompleteRegistration', { status: true })
    const ready = () => !!(window as PixelWindow).fbq?.callMethod
    if (ready()) return Promise.resolve()
    return new Promise(resolve => {
      const started = Date.now()
      const timer = setInterval(() => {
        if (ready() || Date.now() - started >= timeoutMs) { clearInterval(timer); resolve() }
      }, 50)
    })
  } catch { return Promise.resolve() }
}

export function suspendMetaTracking() {
  if (!canMeasureMarketingPage()) {
    revokePixel()
    lastPage = ''
  }
}
