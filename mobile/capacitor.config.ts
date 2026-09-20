import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: process.env.IDOGS_MOBILE_APP_ID || 'au.com.idogs.app',
  appName: process.env.IDOGS_MOBILE_APP_NAME || 'iDogs',
  webDir: '../dist',
}

export default config
