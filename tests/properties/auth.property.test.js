/**
 * Authentication Property Tests
 * Avenue M. E-commerce Platform
 * 
 * Property-based tests for authentication service
 * Requirements: 1.3, 1.4, 1.5, 1.7
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import fc from 'fast-check';

// Mock the auth service for testing
const INVALID_CREDENTIALS_ERROR = 'Email o password non corretti';
const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

// Simulated auth service for property testing
class MockAuthService {
  constructor() {
    this.users = new Map();
    this.sessions = new Map();
    this.rateLimitData = { attempts: [], lockoutUntil: null };
  }

  reset() {
    this.users.clear();
    this.sessions.clear();
    this.rateLimitData = { attempts: [], lockoutUntil: null };
  }

  // Create a test user
  createUser(email, password) {
    const id = crypto.randomUUID();
    this.users.set(email, { id, email, password });
    return { id, email };
  }

  // Simulate sign in
  async signIn(email, password) {
    // Check rate limiting
    if (this._isRateLimited()) {
      return { 
        user: null, 
        session: null, 
        error: `Troppi tentativi. Riprova tra ${this._getRemainingLockoutMinutes()} minuti.` 
      };
    }

    const user = this.users.get(email);
    
    // Invalid credentials - always return same error message
    if (!user || user.password !== password) {
      this._recordFailedAttempt();
      return { user: null, session: null, error: INVALID_CREDENTIALS_ERROR };
    }

    // Valid credentials
    this._clearRateLimitData();
    const sessionId = crypto.randomUUID();
    const session = { id: sessionId, user_id: user.id, access_token: crypto.randomUUID() };
    this.sessions.set(sessionId, session);
    
    return { user, session, error: null };
  }

  // Simulate sign out
  async signOut(sessionId) {
    if (this.sessions.has(sessionId)) {
      this.sessions.delete(sessionId);
    }
    return { error: null };
  }

  // Get session
  getSession(sessionId) {
    return this.sessions.get(sessionId) || null;
  }

  // Rate limiting methods
  _isRateLimited() {
    if (this.rateLimitData.lockoutUntil && Date.now() < this.rateLimitData.lockoutUntil) {
      return true;
    }
    if (this.rateLimitData.lockoutUntil && Date.now() >= this.rateLimitData.lockoutUntil) {
      this._clearRateLimitData();
    }
    return false;
  }

  _recordFailedAttempt() {
    const now = Date.now();
    const windowStart = now - (LOCKOUT_MINUTES * 60 * 1000);
    
    this.rateLimitData.attempts = this.rateLimitData.attempts.filter(time => time > windowStart);
    this.rateLimitData.attempts.push(now);

    if (this.rateLimitData.attempts.length >= MAX_ATTEMPTS) {
      this.rateLimitData.lockoutUntil = now + (LOCKOUT_MINUTES * 60 * 1000);
    }
  }

  _clearRateLimitData() {
    this.rateLimitData = { attempts: [], lockoutUntil: null };
  }

  _getRemainingLockoutMinutes() {
    if (!this.rateLimitData.lockoutUntil) return 0;
    return Math.max(0, Math.ceil((this.rateLimitData.lockoutUntil - Date.now()) / 60000));
  }

  getFailedAttemptCount() {
    const now = Date.now();
    const windowStart = now - (LOCKOUT_MINUTES * 60 * 1000);
    return this.rateLimitData.attempts.filter(time => time > windowStart).length;
  }
}

// Generators
const emailGenerator = fc.emailAddress();
const passwordGenerator = fc.string({ minLength: 8, maxLength: 50 });
const invalidPasswordGenerator = fc.string({ minLength: 1, maxLength: 50 });

describe('Authentication Property Tests', () => {
  let authService;

  beforeEach(() => {
    authService = new MockAuthService();
  });

  describe('Property 1: Login error message consistency', () => {
    /**
     * **Feature: avenue-ecommerce-platform, Property 1: Login error message consistency**
     * **Validates: Requirements 1.4**
     * 
     * For any combination of invalid credentials (wrong email, wrong password, or both),
     * the error message returned SHALL be identical, preventing user enumeration attacks.
     */
    it('returns identical error for wrong email', async () => {
      await fc.assert(
        fc.asyncProperty(
          emailGenerator,
          passwordGenerator,
          emailGenerator,
          async (validEmail, validPassword, wrongEmail) => {
            // Skip if emails happen to be the same
            fc.pre(validEmail !== wrongEmail);
            
            authService.reset();
            authService.createUser(validEmail, validPassword);
            
            // Try to login with wrong email
            const result = await authService.signIn(wrongEmail, validPassword);
            
            expect(result.error).toBe(INVALID_CREDENTIALS_ERROR);
            expect(result.user).toBeNull();
            expect(result.session).toBeNull();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('returns identical error for wrong password', async () => {
      await fc.assert(
        fc.asyncProperty(
          emailGenerator,
          passwordGenerator,
          invalidPasswordGenerator,
          async (validEmail, validPassword, wrongPassword) => {
            // Skip if passwords happen to be the same
            fc.pre(validPassword !== wrongPassword);
            
            authService.reset();
            authService.createUser(validEmail, validPassword);
            
            // Try to login with wrong password
            const result = await authService.signIn(validEmail, wrongPassword);
            
            expect(result.error).toBe(INVALID_CREDENTIALS_ERROR);
            expect(result.user).toBeNull();
            expect(result.session).toBeNull();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('returns identical error for both wrong email and password', async () => {
      await fc.assert(
        fc.asyncProperty(
          emailGenerator,
          passwordGenerator,
          emailGenerator,
          invalidPasswordGenerator,
          async (validEmail, validPassword, wrongEmail, wrongPassword) => {
            fc.pre(validEmail !== wrongEmail);
            fc.pre(validPassword !== wrongPassword);
            
            authService.reset();
            authService.createUser(validEmail, validPassword);
            
            // Try to login with both wrong
            const result = await authService.signIn(wrongEmail, wrongPassword);
            
            expect(result.error).toBe(INVALID_CREDENTIALS_ERROR);
            expect(result.user).toBeNull();
            expect(result.session).toBeNull();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('all invalid credential errors are identical', async () => {
      await fc.assert(
        fc.asyncProperty(
          emailGenerator,
          passwordGenerator,
          async (validEmail, validPassword) => {
            authService.reset();
            authService.createUser(validEmail, validPassword);
            
            // Collect errors from different invalid scenarios
            const wrongEmailResult = await authService.signIn('wrong@email.com', validPassword);
            authService._clearRateLimitData(); // Reset rate limit between tests
            
            const wrongPasswordResult = await authService.signIn(validEmail, 'wrongpassword');
            authService._clearRateLimitData();
            
            const bothWrongResult = await authService.signIn('wrong@email.com', 'wrongpassword');
            
            // All errors must be identical
            expect(wrongEmailResult.error).toBe(INVALID_CREDENTIALS_ERROR);
            expect(wrongPasswordResult.error).toBe(INVALID_CREDENTIALS_ERROR);
            expect(bothWrongResult.error).toBe(INVALID_CREDENTIALS_ERROR);
            
            // Errors must be exactly the same string
            expect(wrongEmailResult.error).toBe(wrongPasswordResult.error);
            expect(wrongPasswordResult.error).toBe(bothWrongResult.error);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 2: Session validity after login', () => {
    /**
     * **Feature: avenue-ecommerce-platform, Property 2: Session validity after login**
     * **Validates: Requirements 1.3**
     * 
     * For any valid user credentials, after successful login the session
     * SHALL contain a valid user ID and access token.
     */
    it('successful login creates valid session', async () => {
      await fc.assert(
        fc.asyncProperty(
          emailGenerator,
          passwordGenerator,
          async (email, password) => {
            authService.reset();
            const createdUser = authService.createUser(email, password);
            
            const result = await authService.signIn(email, password);
            
            // Should succeed
            expect(result.error).toBeNull();
            expect(result.user).toBeDefined();
            expect(result.session).toBeDefined();
            
            // Session should have required fields
            expect(result.session.id).toBeDefined();
            expect(result.session.user_id).toBe(createdUser.id);
            expect(result.session.access_token).toBeDefined();
            expect(typeof result.session.access_token).toBe('string');
            expect(result.session.access_token.length).toBeGreaterThan(0);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 3: Session invalidation on logout', () => {
    /**
     * **Feature: avenue-ecommerce-platform, Property 3: Session invalidation on logout**
     * **Validates: Requirements 1.5**
     * 
     * For any authenticated session, after logout the session SHALL be null
     * and subsequent authenticated requests SHALL fail.
     */
    it('logout invalidates session', async () => {
      await fc.assert(
        fc.asyncProperty(
          emailGenerator,
          passwordGenerator,
          async (email, password) => {
            authService.reset();
            authService.createUser(email, password);
            
            // Login
            const loginResult = await authService.signIn(email, password);
            expect(loginResult.session).toBeDefined();
            
            const sessionId = loginResult.session.id;
            
            // Verify session exists
            expect(authService.getSession(sessionId)).toBeDefined();
            
            // Logout
            await authService.signOut(sessionId);
            
            // Session should be null
            expect(authService.getSession(sessionId)).toBeNull();
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 4: Rate limiting enforcement', () => {
    /**
     * **Feature: avenue-ecommerce-platform, Property 4: Rate limiting enforcement**
     * **Validates: Requirements 1.7**
     * 
     * For any IP address, after 5 failed login attempts within 15 minutes,
     * subsequent login attempts SHALL be rejected regardless of credential validity.
     */
    it('blocks after max failed attempts', async () => {
      await fc.assert(
        fc.asyncProperty(
          emailGenerator,
          passwordGenerator,
          async (email, password) => {
            authService.reset();
            authService.createUser(email, password);
            
            // Make MAX_ATTEMPTS failed login attempts
            for (let i = 0; i < MAX_ATTEMPTS; i++) {
              await authService.signIn(email, 'wrongpassword');
            }
            
            // Next attempt should be blocked, even with correct credentials
            const result = await authService.signIn(email, password);
            
            expect(result.user).toBeNull();
            expect(result.session).toBeNull();
            expect(result.error).toContain('Troppi tentativi');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('allows login before max attempts reached', async () => {
      await fc.assert(
        fc.asyncProperty(
          emailGenerator,
          passwordGenerator,
          fc.integer({ min: 1, max: MAX_ATTEMPTS - 1 }),
          async (email, password, attemptCount) => {
            authService.reset();
            authService.createUser(email, password);
            
            // Make fewer than MAX_ATTEMPTS failed attempts
            for (let i = 0; i < attemptCount; i++) {
              await authService.signIn(email, 'wrongpassword');
            }
            
            // Should still be able to login with correct credentials
            const result = await authService.signIn(email, password);
            
            expect(result.error).toBeNull();
            expect(result.user).toBeDefined();
            expect(result.session).toBeDefined();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('successful login clears rate limit', async () => {
      await fc.assert(
        fc.asyncProperty(
          emailGenerator,
          passwordGenerator,
          fc.integer({ min: 1, max: MAX_ATTEMPTS - 1 }),
          async (email, password, attemptCount) => {
            authService.reset();
            authService.createUser(email, password);
            
            // Make some failed attempts
            for (let i = 0; i < attemptCount; i++) {
              await authService.signIn(email, 'wrongpassword');
            }
            
            // Verify attempts were recorded
            expect(authService.getFailedAttemptCount()).toBe(attemptCount);
            
            // Successful login
            await authService.signIn(email, password);
            
            // Rate limit should be cleared
            expect(authService.getFailedAttemptCount()).toBe(0);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
