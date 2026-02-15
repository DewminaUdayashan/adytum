/**
 * @file packages/shared/vitest.config.ts
 * @description Defines module behavior for the Adytum workspace.
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
  },
});
