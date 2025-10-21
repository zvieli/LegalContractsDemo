// Shim that imports the real server index so tests can import '../index.js' from inside tests
import '../index.js';

// Export a harmless default to satisfy dynamic imports
export default {};
