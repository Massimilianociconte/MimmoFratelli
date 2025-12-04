import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Environment for DOM testing
    environment: 'jsdom',
    
    // Include test files
    include: ['tests/**/*.test.js', 'tests/**/*.property.test.js'],
    
    // Global test timeout
    testTimeout: 30000,
    
    // Property-based testing configuration
    // Minimum 100 iterations as per design requirements
    fuzz: {
      numRuns: 100
    },
    
    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['js/**/*.js'],
      exclude: ['js/**/*.test.js', 'node_modules']
    },
    
    // Setup files
    setupFiles: ['./tests/setup.js'],
    
    // Reporter
    reporters: ['verbose']
  }
});
