import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173 },
  test: {
    // The engine is pure TypeScript with no DOM (CLAUDE.md, D23).
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Timing tests run alone (npm run test:perf): in the parallel suite they time the other workers.
    // The multi-seed balance runs take minutes (npm run test:balance).
    exclude: ['src/**/*.perf.test.ts', 'src/**/*.balance.test.ts', 'node_modules/**'],
  },
})
