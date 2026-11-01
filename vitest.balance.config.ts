import { defineConfig } from 'vitest/config'

// The multi-seed balance targets, the director's statistics and the deadlock flood: minutes, not seconds.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.balance.test.ts'],
  },
})
