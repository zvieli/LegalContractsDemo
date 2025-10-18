module.exports = {
  env: {
    browser: true,
    es2021: true,
    node: true
  },
  globals: {
    Buffer: 'readonly',
    process: 'readonly',
    globalThis: 'readonly'
  },
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module'
  },
  plugins: ['react', 'react-hooks'],
  extends: ['eslint:recommended', 'plugin:react/recommended'],
  rules: {
    // keep project defaults but allow some leniency for this migration
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn'
  }
};
