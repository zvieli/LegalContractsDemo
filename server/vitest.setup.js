// Vitest setup file to configure environment for tests
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
process.env.ALLOW_DEV_CLEANUP = 'true';
// Ensure server uses a non-conflicting port when tests run
process.env.SERVER_PORT = process.env.SERVER_PORT || String(40010 + Math.floor(Math.random() * 1000));
