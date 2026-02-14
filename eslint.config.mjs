/**
 * @file eslint.config.mjs
 * @description Defines module behavior for the Adytum workspace.
 */

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-plugin-prettier/recommended';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/adytum.config.yaml',
      '**/litellm_config.yaml',
      '**/pnpm-lock.yaml',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier, // Embeds eslint-config-prettier and eslint-plugin-prettier
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.browser,
        ...globals.es2021,
      },
      parserOptions: {
        project: ['./tsconfig.base.json', './packages/*/tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Clean Code / Best Practices
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }], // Warn on log, allow warn/error/info
      'no-debugger': 'error',
      'no-duplicate-imports': 'error',
      'no-unused-vars': 'off', // specific TS rule covers this
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/explicit-function-return-type': 'off', // Too verbose for rapid dev
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'warn', // Prefer unknown or specific types, but warn only for now
      '@typescript-eslint/no-floating-promises': 'error', // Critical for async/await bugs
      '@typescript-eslint/await-thenable': 'error',

      // React / Next.js specific (will be overridden in dashboard if needed, but good defaults)
      'react/react-in-jsx-scope': 'off', // Next.js doesn't need this
    },
  },
  {
    // Specific overrides for CLI/Script files where console.log is expected
    files: ['**/cli/**/*.ts', '**/cli/**/*.js', '**/scripts/**/*.ts', '**/bin/**/*.js'],
    rules: {
      'no-console': 'off',
    },
  },
);
