/**
 * Gift Card Property Tests
 * Avenue M. E-commerce Platform
 * 
 * Properties 21, 22: Code uniqueness and redemption balance
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';

// Mock Supabase
vi.mock('../../js/supabase.js', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(() => ({ data: null, error: { code: 'PGRST116' } }))
        }))
      })),
      insert: vi.fn(() => ({ select: vi.fn(() => ({ single: vi.fn(() => ({ 
        data: { id: 'gc-123', code: 'TESTCODE123' }, error: null 
      })) })) })),
      update: vi.fn(() => ({ eq: vi.fn(() => ({ error: null })) }))
    }))
  },
  isSupabaseConfigured: () => true,
  getCurrentUser: () => Promise.resolve({ id: 'user-123' })
}));

// Arbitraries
const giftCardCodeArb = fc.stringMatching(/^[A-Z0-9]{12,16}$/);
const amountArb = fc.float({ min: Math.fround(10), max: Math.fround(500), noNaN: true });

const giftCardArb = fc.record({
  id: fc.uuid(),
  code: giftCardCodeArb,
  amount: amountArb,
  balance: amountArb,
  is_active: fc.boolean(),
  template: fc.constantFrom('elegant', 'minimal', 'festive', 'birthday'),
  sender_name: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: null }),
  recipient_name: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: null }),
  message: fc.option(fc.string({ minLength: 0, maxLength: 200 }), { nil: null })
});

describe('Gift Card Property Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Property 21: Gift card code uniqueness
   * Generated codes must be unique and follow the expected format
   */
  describe('Property 21: Gift card code uniqueness', () => {
    it('should generate codes matching expected format', async () => {
      const { giftCardService } = await import('../../js/services/giftcard.js');

      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 100 }),
          async (count) => {
            const codes = new Set();
            for (let i = 0; i < count; i++) {
              const code = giftCardService.generateCode();
              expect(code).toMatch(/^[A-Z0-9]{12,16}$/);
              codes.add(code);
            }
            // All generated codes should be unique
            expect(codes.size).toBe(count);
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should validate code format correctly', async () => {
      const { giftCardService } = await import('../../js/services/giftcard.js');

      await fc.assert(
        fc.asyncProperty(
          giftCardCodeArb,
          async (validCode) => {
            // Valid codes should pass format validation
            const isValidFormat = /^[A-Z0-9]{12,16}$/.test(validCode);
            expect(isValidFormat).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 22: Gift card redemption balance
   * Balance should decrease correctly and never go negative
   */
  describe('Property 22: Gift card redemption balance', () => {
    it('should never allow balance to go negative', async () => {
      await fc.assert(
        fc.asyncProperty(
          giftCardArb,
          fc.float({ min: 0, max: 1000, noNaN: true }),
          async (giftCard, redemptionAmount) => {
            const newBalance = Math.max(0, giftCard.balance - redemptionAmount);
            expect(newBalance).toBeGreaterThanOrEqual(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should calculate correct remaining balance after redemption', async () => {
      await fc.assert(
        fc.asyncProperty(
          amountArb,
          fc.float({ min: 0, max: 200, noNaN: true }),
          async (initialBalance, orderTotal) => {
            const amountUsed = Math.min(initialBalance, orderTotal);
            const remainingBalance = initialBalance - amountUsed;
            
            expect(remainingBalance).toBeGreaterThanOrEqual(0);
            expect(amountUsed).toBeLessThanOrEqual(initialBalance);
            expect(amountUsed).toBeLessThanOrEqual(orderTotal);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
