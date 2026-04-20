import path from "path"
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Multi-entry build: main launcher window (index.html) + floating orb window
// (floating.html) share the same dependency tree but load independent React
// roots so the always-on-top orb stays lightweight and isolated from the main app.
export default defineConfig({
  base: './',
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      input: {
        main:     path.resolve(__dirname, 'index.html'),
        floating: path.resolve(__dirname, 'floating.html'),
        badges:   path.resolve(__dirname, 'badges.html'),
      },
    },
  },
})
