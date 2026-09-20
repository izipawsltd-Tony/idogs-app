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

  // A launcher cold-start must behave like a native app rather than resume a
  // stale internal SPA route from the previous WebView session. Route every
  // normal app launch through /login: LoginPage keeps a signed-out user on the
  // form and immediately redirects an existing authenticated session to
  // /app/dashboard. Preserve public passport/showcase links so explicit public
  // links still open their intended content.
  const pathname = window.location.pathname
  const isPublicDeepLink = /^\/(p|s)\//.test(pathname)
  if (!isPublicDeepLink && pathname !== '/login') {
    window.history.replaceState(window.history.state, '', '/login')
  }
}

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
