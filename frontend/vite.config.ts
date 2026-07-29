import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Pinned so AdaptiveHire always serves from 5174, leaving 5173 for the
  // separate KhetPilot project. strictPort makes a clash fail loudly instead
  // of silently drifting to another port and breaking the backend CORS match.
  server: { port: 5174, strictPort: true },
})
