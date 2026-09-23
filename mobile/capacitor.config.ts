import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: process.env.IDOGS_MOBILE_APP_ID || 'au.com.idogs.app',
  appName: process.env.IDOGS_MOBILE_APP_NAME || 'iDogs',
  webDir: '../dist',
  server: {
    // Native launcher entry: start at /login at the Capacitor bridge level.
    // LoginPage keeps signed-out users here and redirects an existing session
    // to /app/dashboard. Web idogs.com.au is unaffected because this config is
    // used only by the native Capacitor shell.
    startPath: '/login',
  },
  plugins: {
    // Native QA calls a remote Vercel Preview backend. Let Capacitor patch
    // fetch/XMLHttpRequest to native transport so these calls are not subject
    // to WebView CORS. src/lib/nativeApiRouting.ts still fail-closes the
    // destination to the staging Preview backend before enabling /api/*.
    CapacitorHttp: {
      enabled: true,
    },
    SystemBars: {
      insetsHandling: 'css',
      style: 'DARK',
      hidden: false,
    },
  },
}

export default config
