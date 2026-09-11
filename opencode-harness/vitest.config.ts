import { defineConfig } from 'vitest/config'

// tests/mock is the only test tier. It runs entirely in process, so nothing
// here starts a game, reaches a live OpenCode server, or touches the network.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/mock/**/*.test.ts'],
    coverage: {
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts'],
      reporter: ['text', 'lcov', 'html']
    },
    testTimeout: 15000 // Extended timeout for corpus and replay work
  }
})
