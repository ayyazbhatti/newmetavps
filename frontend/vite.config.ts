import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    // Cloudflare quick tunnels send Host: <random>.trycloudflare.com. Vite blocks unknown hosts by default.
    // `['.trycloudflare.com']` matches all subdomains (Vite docs). Use `true` only if you still see "Blocked request"
    // after restarting `npm run dev` (some setups ignore the leading-dot rule).
    allowedHosts: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3001', changeOrigin: true },
      // WebSocket upgrades (same-origin in dev so /ws/symbol-ticks and /ws/positions work)
      '/ws': { target: 'http://127.0.0.1:3001', changeOrigin: true, ws: true },
    },
  },
})
