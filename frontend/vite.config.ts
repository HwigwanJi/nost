import path from "path"
import { readFileSync } from "node:fs"
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Bake the app version into the renderer bundle as a compile-time
// constant (Sentry release tagging, version display). Reads from the
// repo root package.json — single source of truth, no manual sync.
const rootPkg = JSON.parse(readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'))

// Multi-entry build: main launcher window (index.html) + floating orb window
// (floating.html) share the same dependency tree but load independent React
// roots so the always-on-top orb stays lightweight and isolated from the main app.
export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(rootPkg.version),
  },
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
        main:        path.resolve(__dirname, 'index.html'),
        floating:    path.resolve(__dirname, 'floating.html'),
        badges:      path.resolve(__dirname, 'badges.html'),
        dialogPopup: path.resolve(__dirname, 'dialog-popup.html'),
        itemDialog:  path.resolve(__dirname, 'item-dialog.html'),
        itemWizard:  path.resolve(__dirname, 'item-wizard.html'),
      },
    },
  },
})
