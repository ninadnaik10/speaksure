import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 6173,
    // Fail instead of silently picking another port -- the backend's
    // CORS_ORIGINS is pinned to 6173.
    strictPort: true,
  },
})
