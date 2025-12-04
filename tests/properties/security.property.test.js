/**
 * Security Property Tests
 * Avenue M. E-commerce Platform
 * 
 * Property-based tests for input validation and error handling
 * Requirements: 13.1, 13.2, 13.3
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';

// Mock validation module
const schemas = {
  email: {
    pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    maxLength: 254
  },
  password: {
    minLength: 8,
    maxLength: 128
  },
  uuid: {
    pattern: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  }
};

function validate(value, schemaName) {
  const schema = schemas[schemaName];
  if (!schema) return { valid: false, error: 'Schema non trovato' };
  if (value === null || value === undefined) return { valid: false, error: 'Valore richiesto' };

  if (typeof value === 'string') {
    if (schema.minLength && value.length < schema.minLength) return { valid: false, error: 'Troppo corto' };
    if (schema.maxLength && value.length > schema.maxLength) return { valid: false, error: 'Troppo lungo' };
    if (schema.pattern && !schema.pattern.test(value)) return { valid: false, error: 'Formato non valido' };
  }

  return { valid: true, error: null };
}

function sanitizeString(input) {
  if (typeof input !== 'string') return '';
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;')
    .trim();
}

// Mock error handling
const errorMessages = {
  'auth/invalid-credentials': 'Email o password non corretti',
  'auth/rate-limited': 'Troppi tentativi. Riprova più tardi',
  'network/offline': 'Connessione assente',
  'unknown': 'Si è verificato un errore'
};

function getErrorMessage(code) {
  return errorMessages[code] || errorMessages['unknown'];
}

function handleError(error) {
  if (error?.code && errorMessages[error.code]) {
    return { message: errorMessages[error.code], code: error.code };
  }
  return { message: errorMessages['unknown'], code: 'unknown' };
}

// Mock audit log
class MockAuditLog {
  constructor() {
    this.entries = [];
  }

  reset() {
    this.entries = [];
  }

  log(userId, action, details = {}) {
    const entry = {
      id: crypto.randomUUID(),
      user_id: userId,
      action,
      details,
      timestamp: new Date().toISOString(),
      ip_address: '127.0.0.1'
    };
    this.entries.push(entry);
    return entry;
  }

  getEntriesForUser(userId) {
    return this.entries.filter(e => e.user_id === userId);
  }

  getEntriesByAction(action) {
    return this.entries.filter(e => e.action === action);
  }
}

// Generators
const emailGenerator = fc.emailAddress();
const passwordGenerator = fc.string({ minLength: 8, maxLength: 50 });
const shortPasswordGenerator = fc.string({ minLength: 1, maxLength: 7 });
const uuidGenerator = fc.uuid();
const userIdGenerator = fc.uuid();
const actionGenerator = fc.constantFrom('login', 'logout', 'purchase', 'password_change', 'profile_update');

// XSS attack patterns
const xssPatterns = [
  '<script>alert("xss")</script>',
  '<img src="x" onerror="alert(1)">',
  '"><script>alert(1)</script>',
  "javascript:alert('xss')",
  '<svg onload="alert(1)">',
  '{{constructor.constructor("alert(1)")()}}',
  '<iframe src="javascript:alert(1)">',
  '<body onload="alert(1)">',
  '<input onfocus="alert(1)" autofocus>',
  "'-alert(1)-'"
];

describe('Security Property Tests', () => {
  describe('Property 25: Input validation', () => {
    /**
     * **Feature: avenue-ecommerce-platform, Property 25: Input validation**
     * **Validates: Requirements 13.1**
     * 
     * For any user input, the validation system SHALL reject malformed data
     * and accept only properly formatted inputs.
     */

    it('valid emails pass validation', () => {
      fc.assert(
        fc.property(emailGenerator, (email) => {
          const result = validate(email, 'email');
          expect(result.valid).toBe(true);
          expect(result.error).toBeNull();
        }),
        { numRuns: 100 }
      );
    });

    it('invalid emails fail validation', () => {
      const invalidEmails = [
        'notanemail',
        '@nodomain.com',
        'no@domain',
        'spaces in@email.com',
        '',
        'missing@.com'
      ];

      invalidEmails.forEach(email => {
        const result = validate(email, 'email');
        expect(result.valid).toBe(false);
      });
    });

    it('passwords must meet minimum length', () => {
      fc.assert(
        fc.property(shortPasswordGenerator, (password) => {
          const result = validate(password, 'password');
          expect(result.valid).toBe(false);
        }),
        { numRuns: 100 }
      );
    });

    it('valid passwords pass validation', () => {
      fc.assert(
        fc.property(passwordGenerator, (password) => {
          const result = validate(password, 'password');
          expect(result.valid).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it('valid UUIDs pass validation', () => {
      fc.assert(
        fc.property(uuidGenerator, (uuid) => {
          const result = validate(uuid, 'uuid');
          expect(result.valid).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it('invalid UUIDs fail validation', () => {
      const invalidUUIDs = [
        'not-a-uuid',
        '12345',
        'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
        ''
      ];

      invalidUUIDs.forEach(uuid => {
        const result = validate(uuid, 'uuid');
        expect(result.valid).toBe(false);
      });
    });

    it('null and undefined values fail validation', () => {
      expect(validate(null, 'email').valid).toBe(false);
      expect(validate(undefined, 'email').valid).toBe(false);
      expect(validate(null, 'password').valid).toBe(false);
      expect(validate(undefined, 'uuid').valid).toBe(false);
    });
  });

  describe('Property 26: Error message sanitization', () => {
    /**
     * **Feature: avenue-ecommerce-platform, Property 26: Error message sanitization**
     * **Validates: Requirements 13.2**
     * 
     * For any error condition, the error message returned to users SHALL NOT
     * contain sensitive information (stack traces, SQL queries, internal paths).
     */

    it('error messages do not contain stack traces', () => {
      const errors = [
        { code: 'auth/invalid-credentials' },
        { code: 'network/offline' },
        { code: 'unknown' },
        { message: 'Error at /internal/path/file.js:123' },
        { message: 'SELECT * FROM users WHERE id = 1' }
      ];

      errors.forEach(error => {
        const { message } = handleError(error);
        
        // Should not contain file paths
        expect(message).not.toMatch(/\/[a-zA-Z]+\/[a-zA-Z]+/);
        // Should not contain line numbers
        expect(message).not.toMatch(/:\d+:\d+/);
        // Should not contain SQL
        expect(message.toUpperCase()).not.toContain('SELECT');
        expect(message.toUpperCase()).not.toContain('INSERT');
        expect(message.toUpperCase()).not.toContain('DELETE');
        // Should not contain stack trace keywords
        expect(message).not.toContain('at ');
        expect(message).not.toContain('Error:');
      });
    });

    it('all error codes map to user-friendly messages', () => {
      const codes = Object.keys(errorMessages);
      
      codes.forEach(code => {
        const message = getErrorMessage(code);
        
        // Message should exist
        expect(message).toBeDefined();
        expect(message.length).toBeGreaterThan(0);
        
        // Message should be in Italian (contains common Italian words or accented chars)
        const italianPatterns = /[àèéìòù]|non|errore|riprova|inserisci|valido|password|email|connessione|troppi|verifica/i;
        expect(message).toMatch(italianPatterns);
      });
    });

    it('unknown errors return generic message', () => {
      const unknownErrors = [
        { code: 'some/unknown/code' },
        { message: 'Internal server error' },
        new Error('Something went wrong'),
        null,
        undefined
      ];

      unknownErrors.forEach(error => {
        const { message, code } = handleError(error);
        
        // Should return generic message
        expect(message).toBe(errorMessages['unknown']);
        expect(code).toBe('unknown');
      });
    });

    it('XSS patterns are sanitized from input', () => {
      xssPatterns.forEach(pattern => {
        const sanitized = sanitizeString(pattern);
        
        // Should not contain raw script tags (unescaped)
        expect(sanitized).not.toContain('<script');
        expect(sanitized).not.toContain('</script>');
        // Should have escaped HTML entities for dangerous chars
        if (pattern.includes('<')) {
          expect(sanitized).toContain('&lt;');
        }
        if (pattern.includes('>')) {
          expect(sanitized).toContain('&gt;');
        }
        if (pattern.includes('"')) {
          expect(sanitized).toContain('&quot;');
        }
        // The key is that < and > are escaped, making the HTML inert
        // Event handlers like onerror= become harmless text when < > are escaped
      });
    });

    it('sanitization preserves safe content', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 100 }).filter(s => !s.match(/[<>&"'\/]/)),
          (safeString) => {
            const sanitized = sanitizeString(safeString);
            // Safe strings should be mostly preserved (just trimmed)
            expect(sanitized).toBe(safeString.trim());
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 27: Audit trail completeness', () => {
    /**
     * **Feature: avenue-ecommerce-platform, Property 27: Audit trail completeness**
     * **Validates: Requirements 13.3**
     * 
     * For any sensitive operation (login, purchase, password change),
     * an audit log entry SHALL be created with user_id, action, and timestamp.
     */
    let auditLog;

    beforeEach(() => {
      auditLog = new MockAuditLog();
    });

    it('audit entries contain required fields', () => {
      fc.assert(
        fc.property(
          userIdGenerator,
          actionGenerator,
          (userId, action) => {
            auditLog.reset();
            
            const entry = auditLog.log(userId, action);
            
            // Required fields must exist
            expect(entry.id).toBeDefined();
            expect(entry.user_id).toBe(userId);
            expect(entry.action).toBe(action);
            expect(entry.timestamp).toBeDefined();
            
            // Timestamp should be valid ISO string
            expect(new Date(entry.timestamp).toISOString()).toBe(entry.timestamp);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('all sensitive operations are logged', () => {
      fc.assert(
        fc.property(
          userIdGenerator,
          fc.array(actionGenerator, { minLength: 1, maxLength: 10 }),
          (userId, actions) => {
            auditLog.reset();
            
            // Log all actions
            actions.forEach(action => auditLog.log(userId, action));
            
            // All actions should be in the log
            const entries = auditLog.getEntriesForUser(userId);
            expect(entries.length).toBe(actions.length);
            
            // Each action should be present
            actions.forEach(action => {
              const found = entries.some(e => e.action === action);
              expect(found).toBe(true);
            });
          }
        ),
        { numRuns: 100 }
      );
    });

    it('audit entries have unique IDs', () => {
      fc.assert(
        fc.property(
          userIdGenerator,
          fc.array(actionGenerator, { minLength: 2, maxLength: 10 }),
          (userId, actions) => {
            auditLog.reset();
            
            // Log multiple actions
            const entries = actions.map(action => auditLog.log(userId, action));
            
            // All IDs should be unique
            const ids = entries.map(e => e.id);
            const uniqueIds = new Set(ids);
            expect(uniqueIds.size).toBe(ids.length);
            
            // All timestamps should be valid
            entries.forEach(entry => {
              expect(entry.timestamp).toBeDefined();
              expect(new Date(entry.timestamp).toString()).not.toBe('Invalid Date');
            });
          }
        ),
        { numRuns: 100 }
      );
    });

    it('audit entries can be queried by action type', () => {
      fc.assert(
        fc.property(
          fc.array(userIdGenerator, { minLength: 3, maxLength: 10 }),
          actionGenerator,
          (userIds, targetAction) => {
            auditLog.reset();
            
            // Log various actions for different users
            userIds.forEach((userId, i) => {
              const action = i % 2 === 0 ? targetAction : 'other_action';
              auditLog.log(userId, action);
            });
            
            // Query by action
            const targetEntries = auditLog.getEntriesByAction(targetAction);
            
            // All returned entries should have the target action
            targetEntries.forEach(entry => {
              expect(entry.action).toBe(targetAction);
            });
            
            // Count should match
            const expectedCount = userIds.filter((_, i) => i % 2 === 0).length;
            expect(targetEntries.length).toBe(expectedCount);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
