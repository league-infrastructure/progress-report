/// <reference types="vitest" />
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { defineConfig } from 'vitest/config'

const apiTarget = process.env.VITE_API_URL || 'http://localhost:3000'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    fs: {
      allow: [path.resolve(__dirname, '..')],
    },
    proxy: {
      '/api': apiTarget,
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    include: ['../tests/client/**/*.test.{ts,tsx}'],
  },
})
