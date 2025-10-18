// Minimal flat ESLint config that only enforces runtime-critical rules
export default [
  {
    files: ['front/src/**/*.{js,jsx,ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { window: 'readonly', document: 'readonly' },
    },
    rules: {
      // Runtime-critical rules only
      'no-undef': 'error',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
];
