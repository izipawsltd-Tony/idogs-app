import React, { useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, useLocation } from 'react-router-dom'
import { AuthProvider } from './hooks/useAuth'
import App from './components/App'
import { installNativeQaApiRouting } from './lib/nativeApiRouting'
import { installNativeProductionApiRouting } from './lib/nativeProductionApiRouting'
import './index.css'
import './mobile.css'
import './mobile-dog-detail-route.css'
import './mobile-native-qa-polish.css'

type CapacitorWindow = Window & {
  Capacitor?: {
    getPlatform?: () => string
    isNativePlatform?: () => boolean
  }
}

const capacitor = (window as CapacitorWindow).Capacitor
const buildNativePlatform = import.meta.env.VITE_IDOGS_NATIVE_PLATFORM?.trim()
const runtimeNativePlatform = capacitor?.isNativePlatform?.()
  ? (capacitor.getPlatform?.() || 'native')
  : ''
const nativePlatform = buildNativePlatform || runtimeNativePlatform

if (nativePlatform) {
  document.documentElement.dataset.idogsNativePlatform = nativePlatform

  // Native builds start at /login in capacitor.config.ts via server.startPath.
  // Keep only a narrow JS fallback for an unexpected root load; do not rewrite
  // internal app routes or public deep links here.
  if (window.location.pathname === '/') {
    window.history.replaceState(window.history.state, '', '/login')
  }
}

// Keep an explicit route marker for WebView-safe, route-scoped mobile CSS.
function RouteMarker() {
  const location = useLocation()

  useEffect(() => {
    const dogDetailMatch = location.pathname.match(/^\/app\/dogs\/([^/]+)$/)
    const isDogDetail = !!dogDetailMatch && dogDetailMatch[1] !== 'new'

    if (isDogDetail) {
      document.documentElement.dataset.idogsRoute = 'dog-detail'
    } else {
      delete document.documentElement.dataset.idogsRoute
    }
  }, [location.pathname])

  return null
}

function renderApp() {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <BrowserRouter>
        <RouteMarker />
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </React.StrictMode>
  )
}

function renderNativeApiBlocked() {
  const root = document.getElementById('root')
  if (!root) return
  root.innerHTML = `
    <main style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;font-family:system-ui,sans-serif;background:#f7f8f5;color:#1a3a2a">
      <section style="max-width:420px;background:#fff;border:1px solid #d8ded8;border-radius:16px;padding:24px;box-shadow:0 8px 24px rgba(0,0,0,.06)">
        <h1 style="font-size:20px;margin:0 0 12px">iDogs connection blocked</h1>
        <p style="margin:0;line-height:1.5;color:#4b5563">This build could not verify its API environment. No server API requests were enabled.</p>
      </section>
    </main>`
}

async function bootstrap() {
  if (nativePlatform) {
    try {
      // Installs staging-only /api routing before Auth/App can make requests.
      // The routing layer also blocks payment, outbound-message and super-admin
      // side-effect APIs in QA even if a UI path accidentally exposes them.
      if (import.meta.env.VITE_IDOGS_NATIVE_CHANNEL === 'production') {
        installNativeProductionApiRouting(import.meta.env.VITE_FIREBASE_PROJECT_ID)
      } else if (import.meta.env.VITE_IDOGS_NATIVE_CHANNEL === 'qa' || !import.meta.env.VITE_IDOGS_NATIVE_CHANNEL) {
        await installNativeQaApiRouting(import.meta.env.VITE_FIREBASE_PROJECT_ID)
      } else {
        throw new Error('NATIVE_CHANNEL_UNKNOWN')
      }
    } catch {
      renderNativeApiBlocked()
      return
    }
  }

  renderApp()
}

void bootstrap()
