import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { writeEmailPreviews } from './scripts/lib/promotion-email-preview.js'

export default defineConfig({
  plugins: [react(), {
    name: 'promotion-email-review-artifacts',
    apply: 'build',
    async closeBundle() {
      await writeEmailPreviews('dist', process.env.VERCEL_ENV)
    },
  }],
  resolve: {
    alias: { '@': '/src' }
  }
})
