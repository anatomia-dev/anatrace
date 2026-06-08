import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import jsdoc from 'eslint-plugin-jsdoc';

export default [
  {
    files: ['**/*.ts'],
    languageOptions: { parser: tsparser },
    plugins: { '@typescript-eslint': tseslint, jsdoc },
    rules: {},
  },
  {
    // Readable purity layer for core (fast editor feedback; the `types: []`
    // compiler wall in packages/core/tsconfig.json is the real guard).
    files: ['packages/core/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: ['node:*', 'fs', 'path', 'os', 'child_process', 'http', 'https'],
      }],
      'no-restricted-globals': ['error', 'fetch', 'process', 'Buffer', '__dirname', '__filename'],
    },
  },
];
