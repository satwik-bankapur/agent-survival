import { defineConfig } from 'vitest/config'

// The engine's timing tests, alone: in the parallel suite they'd time the other workers too.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.perf.test.ts'],
    fileParallelism: false,
  },
})
