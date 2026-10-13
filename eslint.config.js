import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.output/**',
      '**/.wxt/**',
      '**/node_modules/**',
      '**/storybook-static/**',
      'tools/fake-meet/audion-harness.js',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  { files: ['tools/fake-meet/*.js'], languageOptions: { globals: globals.browser } },
  { files: ['tools/eval/src/cli.ts'], rules: { 'no-console': 'off' } }, // a CLI prints its report
  {
    files: ['**/*.mjs'],
    languageOptions: { globals: globals.node },
    rules: { 'no-console': 'off' },
  },
);
