import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const buildId = process.env.COMMIT_REF || process.env.VITE_BUILD_ID || new Date().toISOString()

export default defineConfig({
  define: {
    __APP_BUILD_ID__: JSON.stringify(buildId),
  },
  plugins: [
    react(),
    {
      name: 'emit-app-version',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'version.json',
          source: JSON.stringify({ buildId }),
        })
      },
    },
  ],
})
