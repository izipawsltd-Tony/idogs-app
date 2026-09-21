import React, { useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, useLocation } from 'react-router-dom'
import { AuthProvider } from './hooks/useAuth'
import App from './components/App'
import './index.css'
import './mobile.css'
import './mobile-dog-detail-route.css'

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

  // Native builds now start at /login in capacitor.config.ts via server.startPath.
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
