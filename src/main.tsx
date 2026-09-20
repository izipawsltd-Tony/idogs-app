import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './hooks/useAuth'
import App from './components/App'
import './index.css'
import './mobile.css'

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

  // Native app entry should behave like an app, not like the marketing site.
  // Only rewrite the root URL so deep links and explicit routes still work.
  // LoginPage already redirects an authenticated user to /app/dashboard,
  // while a signed-out user remains on the login form.
  if (window.location.pathname === '/') {
    window.history.replaceState(window.history.state, '', '/login')
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
)
