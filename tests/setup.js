/**
 * Vitest Setup File
 * Configures the test environment before running tests
 */

// Mock localStorage for tests
const localStorageMock = {
  store: {},
  getItem(key) {
    return this.store[key] || null;
  },
  setItem(key, value) {
    this.store[key] = String(value);
  },
  removeItem(key) {
    delete this.store[key];
  },
  clear() {
    this.store = {};
  }
};

// Set up global mocks
if (typeof globalThis.localStorage === 'undefined') {
  globalThis.localStorage = localStorageMock;
}

// Note: beforeEach for localStorage reset should be in individual test files
// The setup file runs once before all tests

// Configure fast-check default parameters
import fc from 'fast-check';

// Set minimum 100 iterations for property tests as per design requirements
fc.configureGlobal({
  numRuns: 100,
  verbose: false
});

// Export for use in tests
export { localStorageMock };
