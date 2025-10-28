const { FlatCompat } = require('@eslint/eslintrc');

// Minimal flat config compatible with ESLint v8+/v9+ flat config system
const compat = new FlatCompat({ baseDirectory: __dirname });

module.exports = [
  ...compat.config({
    extends: ['plugin:react/recommended', 'plugin:react-hooks/recommended'],
  }),
  {
    files: ['front/src/**/*.{js,jsx,ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { window: 'readonly', document: 'readonly' },
    },
    rules: {
      // Runtime-critical rules
      'no-undef': 'error',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
];
