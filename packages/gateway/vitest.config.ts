/**
 * @file packages/gateway/vitest.config.ts
 * @description Defines module behavior for the Adytum workspace.
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true, // simplified usage of describe/it
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
});
