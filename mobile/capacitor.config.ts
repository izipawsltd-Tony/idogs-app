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
    SystemBars: {
      insetsHandling: 'css',
      style: 'DARK',
      hidden: false,
    },
  },
}

export default config
