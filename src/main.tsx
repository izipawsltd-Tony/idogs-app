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
if (capacitor?.isNativePlatform?.()) {
  document.documentElement.dataset.idogsNativePlatform = capacitor.getPlatform?.() || 'native'
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
