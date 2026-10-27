// Public website acquisition only. No account fields or dog records are sent.
export const META_PIXEL_ID = '2647777915638218'
export const META_CONSENT_KEY = 'idogs-meta-consent-v1'
type Pixel = ((...args: unknown[]) => void) & { queue?: unknown[][]; push?: Pixel; loaded?: boolean; version?: string; callMethod?: (...args: unknown[]) => void }
type PixelWindow = Window & { fbq?: Pixel; _fbq?: Pixel; Capacitor?: { isNativePlatform?: () => boolean } }
let lastPage = ''

export function isMarketingWebsitePage() {
  const w = window as PixelWindow
  return !import.meta.env.VITE_IDOGS_NATIVE_PLATFORM && !w.Capacitor?.isNativePlatform?.()
    && ['/', '/signup'].includes(location.pathname)
}

export function canMeasureMarketingPage() {
  return isMarketingWebsitePage()
    && ['idogs.com.au', 'www.idogs.com.au'].includes(location.hostname)
    && Array.from(new URLSearchParams(location.search).keys()).every(key => ['fbclid', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'next'].includes(key))
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

function pixel() {
  if (!canMeasureMarketingPage() || readMetaConsent() !== 'granted') return
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

export function trackCompletedRegistration() {
  try { pixel()?.('trackSingle', META_PIXEL_ID, 'CompleteRegistration', { status: true }) } catch { /* non-blocking */ }
}

export function suspendMetaTracking() {
  if (!canMeasureMarketingPage()) {
    revokePixel()
    lastPage = ''
  }
}
