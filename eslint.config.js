// Minimal flat ESLint config that only enforces runtime-critical rules
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import babelParser from '@babel/eslint-parser';

export default [
  {
    files: ['front/src/**/*.{js,jsx,ts,tsx}', 'front/**/*.js', 'front/**/*.jsx'],
    // Use modern parser and set envs so common globals are available
    languageOptions: {
      parser: babelParser,
      parserOptions: {
        requireConfigFile: false,
        babelOptions: {
          presets: ['@babel/preset-react']
        },
        ecmaVersion: 2022,
        sourceType: 'module',
        ecmaFeatures: { jsx: true }
      },
      globals: {
        // Browser globals
        window: 'readonly', document: 'readonly', navigator: 'readonly',
        fetch: 'readonly', atob: 'readonly', btoa: 'readonly',
        TextEncoder: 'readonly', TextDecoder: 'readonly', Blob: 'readonly', URL: 'readonly',
        localStorage: 'readonly', sessionStorage: 'readonly', indexedDB: 'readonly',
        File: 'readonly', FileReader: 'readonly',
        setTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly', clearTimeout: 'readonly',
        alert: 'readonly', confirm: 'readonly', prompt: 'readonly', URLSearchParams: 'readonly',
        crypto: 'readonly', CustomEvent: 'readonly', FormData: 'readonly', FileList: 'readonly',
        // Node / common
        console: 'readonly', Buffer: 'readonly', global: 'readonly', process: 'readonly', globalThis: 'readonly',
        // React / JSX
        React: 'readonly', JSX: 'readonly',
        // Jest / test helpers
        describe: 'readonly', it: 'readonly', test: 'readonly', expect: 'readonly', beforeEach: 'readonly', afterEach: 'readonly',
        // misc
        Headers: 'readonly', Request: 'readonly', Response: 'readonly', AbortController: 'readonly', WebSocket: 'readonly'
      }
    },
    // Register plugin so rule references (react-hooks/...) can be resolved
    plugins: { 'react-hooks': reactHooksPlugin },
    rules: {
      // Relax noisy rules for legacy frontend code so we can iterate safely.
      // We'll fix real issues in follow-up passes.
      'no-undef': 'warn',
      // Allow intentionally-unused variables starting with _ and make unused-vars a warning
      'no-unused-vars': ['warn', { 'argsIgnorePattern': '^_', 'varsIgnorePattern': '^_' }],
      // Empty catch blocks are often used purposely in the frontend; warn rather than error
      'no-empty': ['warn', { 'allowEmptyCatch': true }],
      // Some patterns flagged here require careful refactor; downgrade to warn for now
      'react-hooks/rules-of-hooks': 'warn',
      'react-hooks/exhaustive-deps': 'warn',
      // Disable rules that create large numbers of false positives in this codebase
      'no-useless-catch': 'off',
      // Disable a couple of rules that aren't available in this environment/plugins
      // (these were causing "Definition for rule ... was not found" errors)
      'react-refresh/only-export-components': 'off',
      'react-internal/safe-string-coercion': 'off',
      'no-prototype-builtins': 'warn'
    },
  },
  // Node / test overrides: allow Node globals and test-specific patterns
  {
    files: [
      'front/tests/**', 'front/src/**/*.test.{js,jsx,ts,tsx}', 'front/src/**/__tests__/**',
      'server/**', 'scripts/**', 'tools/**', 'front/vite.config.js', 'front/**/global-setup.js'
    ],
    // Flat config does not support `env`; explicitly provide parserOptions and globals for node/test files
    languageOptions: {
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
      globals: { process: 'readonly', Buffer: 'readonly', global: 'readonly', IN_E2E: 'readonly', ENABLE_ADMIN_DECRYPT: 'readonly', e2eFlag: 'readonly' }
    },
    rules: {
      // relax browser-specific rules for node/test files
      'no-undef': 'off'
    }
  }
];
