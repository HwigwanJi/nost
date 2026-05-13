/// <reference types="vitest" />
import { defineConfig } from 'vite';
import path from 'node:path';

// Vitest config — pure-logic unit tests only for now (no DOM tests
// in this round). happy-dom is installed for future component tests
// but unused until we wire React Testing Library.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      reporter: ['text', 'html'],
      include: ['src/lib/**', 'src/tutorial/**'],
    },
  },
});
