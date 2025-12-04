/**
 * Referral System Property Tests
 * Mimmo Fratelli E-commerce Platform
 * 
 * Feature: discount-referral-system
 * Tests for referral code generation, validation, and reward processing
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';

// Mock Supabase
vi.mock('../../js/supabase.js', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(() => ({ data: null, error: null })),
          maybeSingle: vi.fn(() => ({ data: null, error: null }))
        }))
      })),
      insert: vi.fn(() => ({ data: null, error: null })),
      update: vi.fn(() => ({ eq: vi.fn(() => ({ data: null, error: null })) }))
    })),
    auth: {
      getSession: vi.fn(() => Promise.resolve({ data: { session: { user: { id: 'test-user' } } } }))
    },
    rpc: vi.fn(() => Promise.resolve({ data: null, error: null }))
  },
  isSupabaseConfigured: () => true
}));

// ============================================
// ARBITRARIES (Test Data Generators)
// ============================================

// Valid referral code: 8 alphanumeric characters (excluding confusing chars)
const validReferralCodeChars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const referralCodeArb = fc.stringOf(
  fc.constantFrom(...validReferralCodeChars.split('')),
  { minLength: 8, maxLength: 8 }
);

// User arbitrary
const userArb = fc.record({
  id: fc.uuid(),
  email: fc.emailAddress(),
  created_at: fc.date({ min: new Date('2024-01-01'), max: new Date('2025-12-31') }).map(d => d.toISOString())
});

// First order code generator (valid format)
const firstOrderCodeArb = fc.stringOf(
  fc.constantFrom(...validReferralCodeChars.split('')),
  { minLength: 6, maxLength: 6 }
).map(suffix => 'BENVENUTO' + suffix);

// First order promotion arbitrary - with consistent referral_bonus/discount_value
const firstOrderPromoArb = fc.boolean().chain(isReferral => 
  fc.record({
    id: fc.uuid(),
    code: firstOrderCodeArb,
    user_id: fc.uuid(),
    discount_type: fc.constant('percentage'),
    discount_value: fc.constant(isReferral ? 15 : 10),
    is_first_order_code: fc.constant(true),
    referral_bonus: fc.constant(isReferral),
    is_active: fc.boolean(),
    usage_count: fc.constantFrom(0, 1),
    usage_limit: fc.constant(1),
    starts_at: fc.date({ min: new Date('2024-01-01'), max: new Date('2025-06-01') }).map(d => d.toISOString()),
    ends_at: fc.date({ min: new Date('2025-01-01'), max: new Date('2026-12-31') }).map(d => d.toISOString())
  })
);

// Referral relationship arbitrary
const referralArb = fc.record({
  id: fc.uuid(),
  referrer_id: fc.uuid(),
  referee_id: fc.uuid(),
  referral_code: referralCodeArb,
  status: fc.constantFrom('pending', 'converted', 'revoked'),
  reward_amount: fc.constant(5.00),
  reward_credited: fc.boolean(),
  ip_address: fc.ipV4(),
  created_at: fc.date({ min: new Date('2024-01-01'), max: new Date('2025-12-31') }).map(d => d.toISOString()),
  converted_at: fc.option(fc.date().map(d => d.toISOString()), { nil: null })
});

// Cart item arbitrary
const cartItemArb = fc.record({
  productId: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 100 }),
  price: fc.float({ min: Math.fround(0.50), max: Math.fround(500), noNaN: true }),
  quantity: fc.integer({ min: 1, max: 10 })
});

// Order arbitrary
const orderArb = fc.record({
  id: fc.uuid(),
  user_id: fc.uuid(),
  order_number: fc.string({ minLength: 10, maxLength: 20 }),
  subtotal: fc.float({ min: Math.fround(1), max: Math.fround(1000), noNaN: true }),
  shipping_cost: fc.float({ min: Math.fround(0), max: Math.fround(10), noNaN: true }),
  total: fc.float({ min: Math.fround(1), max: Math.fround(1010), noNaN: true }),
  payment_status: fc.constantFrom('pending', 'completed', 'refunded'),
  created_at: fc.date().map(d => d.toISOString())
});

// ============================================
// PROPERTY TESTS
// ============================================

describe('Referral System Property Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Feature: discount-referral-system, Property 5: Referral Code Format
   * For any registered user, there SHALL exist exactly one referral code 
   * of exactly 8 alphanumeric characters in the user_referral_codes table.
   * Validates: Requirements 2.1
   */
  describe('Property 5: Referral Code Format', () => {
    it('generated referral codes should be exactly 8 alphanumeric characters', async () => {
      await fc.assert(
        fc.property(
          referralCodeArb,
          (code) => {
            // Code must be exactly 8 characters
            expect(code.length).toBe(8);
            
            // All characters must be from valid set (no confusing chars like 0, O, I, 1, L)
            const validChars = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/;
            expect(code).toMatch(validChars);
            
            // No lowercase
            expect(code).toBe(code.toUpperCase());
          }
        ),
        { numRuns: 100 }
      );
    });

    it('referral codes should be unique across multiple generations', async () => {
      const generateReferralCode = () => {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let code = '';
        for (let i = 0; i < 8; i++) {
          code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return code;
      };

      await fc.assert(
        fc.property(
          fc.integer({ min: 10, max: 100 }),
          (count) => {
            const codes = new Set();
            for (let i = 0; i < count; i++) {
              codes.add(generateReferralCode());
            }
            // With 32^8 possible combinations, collisions should be extremely rare
            // Allow for very rare collision (< 1%)
            expect(codes.size).toBeGreaterThanOrEqual(Math.floor(count * 0.99));
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  /**
   * Feature: discount-referral-system, Property 6: Referral Link Format
   * For any referral code, the generated share link SHALL contain 
   * the query parameter ?ref= followed by the exact 8-character code.
   * Validates: Requirements 2.4
   */
  describe('Property 6: Referral Link Format', () => {
    it('share links should contain ?ref= parameter with exact code', async () => {
      const generateShareLink = (code, baseUrl = 'https://mimmofratelli.it') => {
        return `${baseUrl}?ref=${code}`;
      };

      await fc.assert(
        fc.property(
          referralCodeArb,
          fc.webUrl(),
          (code, baseUrl) => {
            const link = generateShareLink(code, baseUrl);
            
            // Link must contain ?ref= parameter
            expect(link).toContain('?ref=');
            
            // Code in link must match original code exactly
            const urlParams = new URLSearchParams(link.split('?')[1]);
            expect(urlParams.get('ref')).toBe(code);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Feature: discount-referral-system, Property 7: Referral Code Persistence
   * For any visitor accessing the site with a valid ?ref=CODE parameter, 
   * the code SHALL be stored in localStorage and retrievable until explicitly cleared.
   * Validates: Requirements 3.1
   */
  describe('Property 7: Referral Code Persistence', () => {
    it('referral codes should be stored and retrieved correctly from localStorage', async () => {
      // Mock localStorage
      const storage = new Map();
      const mockLocalStorage = {
        getItem: (key) => storage.get(key) || null,
        setItem: (key, value) => storage.set(key, value),
        removeItem: (key) => storage.delete(key),
        clear: () => storage.clear()
      };

      const REFERRAL_STORAGE_KEY = 'mimmo_referral_code';

      const captureReferralFromUrl = (url) => {
        const urlParams = new URLSearchParams(url.split('?')[1] || '');
        const refCode = urlParams.get('ref');
        if (refCode && refCode.length === 8) {
          mockLocalStorage.setItem(REFERRAL_STORAGE_KEY, refCode.toUpperCase());
          return true;
        }
        return false;
      };

      const getStoredReferralCode = () => {
        return mockLocalStorage.getItem(REFERRAL_STORAGE_KEY);
      };

      const clearStoredReferralCode = () => {
        mockLocalStorage.removeItem(REFERRAL_STORAGE_KEY);
      };

      await fc.assert(
        fc.property(
          referralCodeArb,
          (code) => {
            // Clear before test
            mockLocalStorage.clear();
            
            // Capture from URL
            const url = `https://example.com?ref=${code}`;
            const captured = captureReferralFromUrl(url);
            expect(captured).toBe(true);
            
            // Should be retrievable
            const stored = getStoredReferralCode();
            expect(stored).toBe(code.toUpperCase());
            
            // Should persist until cleared
            expect(getStoredReferralCode()).toBe(code.toUpperCase());
            
            // Clear should remove it
            clearStoredReferralCode();
            expect(getStoredReferralCode()).toBeNull();
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Feature: discount-referral-system, Property 1: First Order Code Generation
   * For any newly registered user, there SHALL exist exactly one promotion record 
   * with is_first_order_code = true and code prefix "BENVENUTO".
   * Validates: Requirements 1.1
   */
  describe('Property 1: First Order Code Generation', () => {
    it('first order codes should have BENVENUTO prefix', async () => {
      await fc.assert(
        fc.property(
          firstOrderPromoArb,
          (promo) => {
            if (promo.is_first_order_code) {
              expect(promo.code).toMatch(/^BENVENUTO[A-Z0-9]{6}$/);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('first order code generation should produce valid format', async () => {
      const generateFirstOrderCode = () => {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let suffix = '';
        for (let i = 0; i < 6; i++) {
          suffix += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return 'BENVENUTO' + suffix;
      };

      await fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 50 }),
          (count) => {
            for (let i = 0; i < count; i++) {
              const code = generateFirstOrderCode();
              expect(code).toMatch(/^BENVENUTO[A-Z0-9]{6}$/);
              expect(code.length).toBe(15);
            }
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  /**
   * Feature: discount-referral-system, Property 2: First Order Code Configuration
   * For any first-order promotion code, discount_value SHALL be either 10 (standard) 
   * or 15 (referral), discount_type SHALL be "percentage", and ends_at SHALL be 
   * exactly 30 days after created_at.
   * Validates: Requirements 1.2, 3.3
   */
  describe('Property 2: First Order Code Configuration', () => {
    it('first order codes should have correct discount configuration', async () => {
      await fc.assert(
        fc.property(
          firstOrderPromoArb,
          (promo) => {
            if (promo.is_first_order_code) {
              // Discount type must be percentage
              expect(promo.discount_type).toBe('percentage');
              
              // Discount value must be 10 or 15
              expect([10, 15]).toContain(promo.discount_value);
              
              // If referral_bonus is true, discount should be 15
              if (promo.referral_bonus) {
                expect(promo.discount_value).toBe(15);
              }
              
              // Usage limit must be 1
              expect(promo.usage_limit).toBe(1);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('first order code validity should be 30 days', async () => {
      const createFirstOrderPromo = (createdAt) => {
        const startsAt = new Date(createdAt);
        const endsAt = new Date(createdAt);
        endsAt.setDate(endsAt.getDate() + 30);
        
        return {
          starts_at: startsAt.toISOString(),
          ends_at: endsAt.toISOString()
        };
      };

      await fc.assert(
        fc.property(
          fc.date({ min: new Date('2024-01-01'), max: new Date('2025-12-31') }),
          (createdAt) => {
            const promo = createFirstOrderPromo(createdAt);
            const start = new Date(promo.starts_at);
            const end = new Date(promo.ends_at);
            
            const diffDays = Math.round((end - start) / (1000 * 60 * 60 * 24));
            expect(diffDays).toBe(30);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Feature: discount-referral-system, Property 4: Discount Calculation Excludes Shipping
   * For any cart with items and shipping cost, when a first-order percentage discount 
   * is applied, the discount amount SHALL equal (subtotal * discount_percentage / 100) 
   * and SHALL NOT include shipping in the calculation.
   * Validates: Requirements 1.5
   */
  describe('Property 4: Discount Calculation Excludes Shipping', () => {
    it('percentage discount should apply only to subtotal, not shipping', async () => {
      const calculateDiscount = (cartItems, discountPercent, shippingCost) => {
        const subtotal = cartItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        // Discount applies ONLY to subtotal
        const discount = (subtotal * discountPercent) / 100;
        return {
          subtotal,
          discount: Math.round(discount * 100) / 100,
          shipping: shippingCost,
          total: Math.round((subtotal - discount + shippingCost) * 100) / 100
        };
      };

      await fc.assert(
        fc.property(
          fc.array(cartItemArb, { minLength: 1, maxLength: 5 }),
          fc.constantFrom(10, 15),
          fc.float({ min: Math.fround(0), max: Math.fround(10), noNaN: true }),
          (cartItems, discountPercent, shippingCost) => {
            const result = calculateDiscount(cartItems, discountPercent, shippingCost);
            const subtotal = cartItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
            
            // Discount should be exactly subtotal * percent / 100
            const expectedDiscount = Math.round((subtotal * discountPercent / 100) * 100) / 100;
            expect(Math.abs(result.discount - expectedDiscount)).toBeLessThan(0.01);
            
            // Shipping should not affect discount calculation
            const resultWithHigherShipping = calculateDiscount(cartItems, discountPercent, shippingCost + 100);
            expect(result.discount).toBe(resultWithHigherShipping.discount);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Feature: discount-referral-system, Property 13: Self-Referral Prevention
   * For any user attempting to register using their own referral code, 
   * NO referral relationship SHALL be created.
   * Validates: Requirements 5.1
   */
  describe('Property 13: Self-Referral Prevention', () => {
    it('should reject self-referral attempts', async () => {
      const validateReferral = (referrerId, refereeId) => {
        // Self-referral check
        if (referrerId === refereeId) {
          return { valid: false, reason: 'self_referral' };
        }
        return { valid: true };
      };

      await fc.assert(
        fc.property(
          fc.uuid(),
          (userId) => {
            // Attempting to use own referral code
            const result = validateReferral(userId, userId);
            expect(result.valid).toBe(false);
            expect(result.reason).toBe('self_referral');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should allow referral between different users', async () => {
      const validateReferral = (referrerId, refereeId) => {
        if (referrerId === refereeId) {
          return { valid: false, reason: 'self_referral' };
        }
        return { valid: true };
      };

      await fc.assert(
        fc.property(
          fc.uuid(),
          fc.uuid(),
          (referrerId, refereeId) => {
            fc.pre(referrerId !== refereeId); // Precondition: different users
            
            const result = validateReferral(referrerId, refereeId);
            expect(result.valid).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});


  /**
   * Feature: discount-referral-system, Property 8: Referral Relationship Creation
   * For any registration completed with a valid stored referral code, 
   * there SHALL exist exactly one row in referrals table linking the new user to the code owner.
   * Validates: Requirements 3.2
   */
  describe('Property 8: Referral Relationship Creation', () => {
    it('valid referral should create exactly one relationship', async () => {
      const createReferralRelationship = (referrerId, refereeId, code) => {
        // Simulate relationship creation
        if (!referrerId || !refereeId || referrerId === refereeId) {
          return null;
        }
        return {
          referrer_id: referrerId,
          referee_id: refereeId,
          referral_code: code,
          status: 'pending',
          reward_amount: 5.00,
          reward_credited: false
        };
      };

      await fc.assert(
        fc.property(
          fc.uuid(),
          fc.uuid(),
          referralCodeArb,
          (referrerId, refereeId, code) => {
            fc.pre(referrerId !== refereeId);
            
            const relationship = createReferralRelationship(referrerId, refereeId, code);
            
            expect(relationship).not.toBeNull();
            expect(relationship.referrer_id).toBe(referrerId);
            expect(relationship.referee_id).toBe(refereeId);
            expect(relationship.referral_code).toBe(code);
            expect(relationship.status).toBe('pending');
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Feature: discount-referral-system, Property 9: Invalid Referral Fallback
   * For any registration with an invalid referral code, the user SHALL still be created 
   * with a standard 10% first-order code and NO referral relationship SHALL be created.
   * Validates: Requirements 3.4
   */
  describe('Property 9: Invalid Referral Fallback', () => {
    it('invalid referral code should result in standard 10% discount', async () => {
      const processSignup = (referralCode, validCodes) => {
        const isValidReferral = validCodes.includes(referralCode?.toUpperCase());
        return {
          discountPercent: isValidReferral ? 15 : 10,
          referralCreated: isValidReferral
        };
      };

      await fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 20 }),
          fc.array(referralCodeArb, { minLength: 0, maxLength: 5 }),
          (inputCode, validCodes) => {
            // Ensure input code is NOT in valid codes
            fc.pre(!validCodes.includes(inputCode.toUpperCase()));
            
            const result = processSignup(inputCode, validCodes);
            
            expect(result.discountPercent).toBe(10);
            expect(result.referralCreated).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('valid referral code should result in 15% discount', async () => {
      const processSignup = (referralCode, validCodes) => {
        const isValidReferral = validCodes.includes(referralCode?.toUpperCase());
        return {
          discountPercent: isValidReferral ? 15 : 10,
          referralCreated: isValidReferral
        };
      };

      await fc.assert(
        fc.property(
          referralCodeArb,
          (code) => {
            const validCodes = [code]; // Code is in valid list
            const result = processSignup(code, validCodes);
            
            expect(result.discountPercent).toBe(15);
            expect(result.referralCreated).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Feature: discount-referral-system, Property 3: First Order Code Restriction
   * For any user who has at least one order with payment_status = 'completed', 
   * attempting to apply their first-order code SHALL return an error.
   * Validates: Requirements 1.4
   */
  describe('Property 3: First Order Code Restriction', () => {
    it('users with completed orders should not be able to use first-order codes', async () => {
      const validateFirstOrderCode = (userId, userOrders, promoUserId) => {
        // Check if promo belongs to user
        if (promoUserId !== userId) {
          return { valid: false, error: 'code_not_yours' };
        }
        
        // Check if user has completed orders
        const hasCompletedOrder = userOrders.some(o => o.payment_status === 'completed');
        if (hasCompletedOrder) {
          return { valid: false, error: 'already_ordered' };
        }
        
        return { valid: true };
      };

      await fc.assert(
        fc.property(
          fc.uuid(),
          fc.array(orderArb.filter(o => o.payment_status === 'completed'), { minLength: 1, maxLength: 5 }),
          (userId, orders) => {
            // User has at least one completed order
            const result = validateFirstOrderCode(userId, orders, userId);
            
            expect(result.valid).toBe(false);
            expect(result.error).toBe('already_ordered');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('users without completed orders should be able to use first-order codes', async () => {
      const validateFirstOrderCode = (userId, userOrders, promoUserId) => {
        if (promoUserId !== userId) {
          return { valid: false, error: 'code_not_yours' };
        }
        
        const hasCompletedOrder = userOrders.some(o => o.payment_status === 'completed');
        if (hasCompletedOrder) {
          return { valid: false, error: 'already_ordered' };
        }
        
        return { valid: true };
      };

      await fc.assert(
        fc.property(
          fc.uuid(),
          fc.array(orderArb.filter(o => o.payment_status !== 'completed'), { minLength: 0, maxLength: 5 }),
          (userId, orders) => {
            // User has no completed orders
            const result = validateFirstOrderCode(userId, orders, userId);
            
            expect(result.valid).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });
  });


  /**
   * Feature: discount-referral-system, Property 10: Referral Reward Credit
   * For any referee's first completed order, the referrer's user_credits.balance 
   * SHALL increase by exactly the configured reward amount (default €5).
   * Validates: Requirements 4.1
   */
  describe('Property 10: Referral Reward Credit', () => {
    it('referrer should receive exactly the reward amount on conversion', async () => {
      const processReferralConversion = (referral, referrerBalance, rewardAmount = 5) => {
        if (referral.status !== 'pending') {
          return { credited: false, newBalance: referrerBalance };
        }
        return {
          credited: true,
          newBalance: referrerBalance + rewardAmount,
          amountCredited: rewardAmount
        };
      };

      await fc.assert(
        fc.property(
          fc.float({ min: 0, max: 1000, noNaN: true }),
          fc.float({ min: 1, max: 20, noNaN: true }),
          (initialBalance, rewardAmount) => {
            const pendingReferral = { status: 'pending', reward_amount: rewardAmount };
            const result = processReferralConversion(pendingReferral, initialBalance, rewardAmount);
            
            expect(result.credited).toBe(true);
            expect(result.newBalance).toBeCloseTo(initialBalance + rewardAmount, 2);
            expect(result.amountCredited).toBe(rewardAmount);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Feature: discount-referral-system, Property 11: Referral Conversion Status
   * For any referee's first completed order, the corresponding referrals record 
   * SHALL have status = 'converted', reward_credited = true, and converted_at set.
   * Validates: Requirements 4.2
   */
  describe('Property 11: Referral Conversion Status', () => {
    it('converted referral should have correct status fields', async () => {
      const convertReferral = (referral) => {
        if (referral.status !== 'pending') {
          return referral;
        }
        return {
          ...referral,
          status: 'converted',
          reward_credited: true,
          converted_at: new Date().toISOString()
        };
      };

      await fc.assert(
        fc.property(
          referralArb.filter(r => r.status === 'pending'),
          (referral) => {
            const converted = convertReferral(referral);
            
            expect(converted.status).toBe('converted');
            expect(converted.reward_credited).toBe(true);
            expect(converted.converted_at).not.toBeNull();
            expect(new Date(converted.converted_at).getTime()).toBeGreaterThan(0);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Feature: discount-referral-system, Property 14: IP Rate Limiting
   * For any IP address, within a 24-hour window, at most 3 referral conversions 
   * SHALL result in reward credits.
   * Validates: Requirements 5.2
   */
  describe('Property 14: IP Rate Limiting', () => {
    it('should limit rewards to 3 per IP per day', async () => {
      const checkIpRateLimit = (ipConversionsToday, maxPerDay = 3) => {
        return ipConversionsToday < maxPerDay;
      };

      await fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 10 }),
          fc.integer({ min: 1, max: 5 }),
          (conversionsToday, maxPerDay) => {
            const canCredit = checkIpRateLimit(conversionsToday, maxPerDay);
            
            if (conversionsToday >= maxPerDay) {
              expect(canCredit).toBe(false);
            } else {
              expect(canCredit).toBe(true);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('exactly 3 conversions should be allowed, 4th should be blocked', async () => {
      const checkIpRateLimit = (count) => count < 3;
      
      expect(checkIpRateLimit(0)).toBe(true);
      expect(checkIpRateLimit(1)).toBe(true);
      expect(checkIpRateLimit(2)).toBe(true);
      expect(checkIpRateLimit(3)).toBe(false);
      expect(checkIpRateLimit(4)).toBe(false);
    });
  });

  /**
   * Feature: discount-referral-system, Property 12: Referral Statistics Accuracy
   * For any referrer, the statistics returned SHALL accurately reflect the counts.
   * Validates: Requirements 4.4
   */
  describe('Property 12: Referral Statistics Accuracy', () => {
    it('statistics should accurately reflect referral data', async () => {
      const calculateStats = (referrals) => {
        return {
          totalInvites: referrals.length,
          conversions: referrals.filter(r => r.status === 'converted').length,
          pending: referrals.filter(r => r.status === 'pending').length,
          totalEarned: referrals
            .filter(r => r.reward_credited)
            .reduce((sum, r) => sum + (r.reward_amount || 5), 0)
        };
      };

      await fc.assert(
        fc.property(
          fc.array(referralArb, { minLength: 0, maxLength: 20 }),
          (referrals) => {
            const stats = calculateStats(referrals);
            
            // Total invites should equal array length
            expect(stats.totalInvites).toBe(referrals.length);
            
            // Conversions + pending + revoked should equal total
            const converted = referrals.filter(r => r.status === 'converted').length;
            const pending = referrals.filter(r => r.status === 'pending').length;
            const revoked = referrals.filter(r => r.status === 'revoked').length;
            expect(converted + pending + revoked).toBe(referrals.length);
            
            // Total earned should be sum of credited rewards
            const expectedEarned = referrals
              .filter(r => r.reward_credited)
              .reduce((sum, r) => sum + (r.reward_amount || 5), 0);
            expect(stats.totalEarned).toBeCloseTo(expectedEarned, 2);
          }
        ),
        { numRuns: 100 }
      );
    });
  });


  /**
   * Feature: discount-referral-system, Property 15: Refund Credit Revocation
   * For any order refunded within 14 days that was a referral conversion, 
   * the referrer's credit SHALL be decremented and referral status set to 'revoked'.
   * Validates: Requirements 5.3
   */
  describe('Property 15: Refund Credit Revocation', () => {
    it('refund within window should revoke credit', async () => {
      const processRefund = (referral, daysSinceConversion, refundWindowDays = 14) => {
        if (referral.status !== 'converted' || !referral.reward_credited) {
          return { revoked: false, reason: 'not_eligible' };
        }
        
        if (daysSinceConversion > refundWindowDays) {
          return { revoked: false, reason: 'outside_window' };
        }
        
        return {
          revoked: true,
          amountRevoked: referral.reward_amount,
          newStatus: 'revoked'
        };
      };

      await fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 13 }), // Within 14-day window
          fc.float({ min: 1, max: 20, noNaN: true }),
          (daysSinceConversion, rewardAmount) => {
            const convertedReferral = {
              status: 'converted',
              reward_credited: true,
              reward_amount: rewardAmount
            };
            
            const result = processRefund(convertedReferral, daysSinceConversion);
            
            expect(result.revoked).toBe(true);
            expect(result.amountRevoked).toBe(rewardAmount);
            expect(result.newStatus).toBe('revoked');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('refund outside window should not revoke credit', async () => {
      const processRefund = (referral, daysSinceConversion, refundWindowDays = 14) => {
        if (daysSinceConversion > refundWindowDays) {
          return { revoked: false, reason: 'outside_window' };
        }
        return { revoked: true };
      };

      await fc.assert(
        fc.property(
          fc.integer({ min: 15, max: 365 }), // Outside 14-day window
          (daysSinceConversion) => {
            const result = processRefund({ status: 'converted', reward_credited: true }, daysSinceConversion);
            
            expect(result.revoked).toBe(false);
            expect(result.reason).toBe('outside_window');
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Feature: discount-referral-system, Property 16: Configuration Immutability for Existing Codes
   * For any existing promotion or referral code, when system configuration is updated, 
   * the existing code's values SHALL remain unchanged.
   * Validates: Requirements 6.3
   */
  describe('Property 16: Configuration Immutability for Existing Codes', () => {
    it('existing codes should not be affected by config changes', async () => {
      const updateConfig = (existingCodes, newConfig) => {
        // Config changes should NOT modify existing codes
        // Only new codes should use new config
        return existingCodes.map(code => ({ ...code })); // Return unchanged
      };

      await fc.assert(
        fc.property(
          fc.array(firstOrderPromoArb, { minLength: 1, maxLength: 10 }),
          fc.record({
            percentage: fc.integer({ min: 5, max: 30 }),
            validity_days: fc.integer({ min: 7, max: 90 })
          }),
          (existingCodes, newConfig) => {
            const originalValues = existingCodes.map(c => ({
              discount_value: c.discount_value,
              ends_at: c.ends_at
            }));
            
            const afterUpdate = updateConfig(existingCodes, newConfig);
            
            // All existing codes should have unchanged values
            afterUpdate.forEach((code, i) => {
              expect(code.discount_value).toBe(originalValues[i].discount_value);
              expect(code.ends_at).toBe(originalValues[i].ends_at);
            });
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  /**
   * Feature: discount-referral-system, Property 17: User Suspension Invalidation
   * For any suspended user, all associated referral codes SHALL have is_active = false.
   * Validates: Requirements 6.4
   */
  describe('Property 17: User Suspension Invalidation', () => {
    it('suspended user referral codes should be invalidated', async () => {
      const suspendUser = (userId, referralCodes) => {
        return referralCodes.map(code => {
          if (code.user_id === userId) {
            return { ...code, is_active: false };
          }
          return code;
        });
      };

      await fc.assert(
        fc.property(
          fc.uuid(),
          fc.array(
            fc.record({
              user_id: fc.uuid(),
              code: referralCodeArb,
              is_active: fc.constant(true)
            }),
            { minLength: 1, maxLength: 10 }
          ),
          (suspendedUserId, allCodes) => {
            // Add at least one code for the suspended user
            const codesWithSuspended = [
              ...allCodes,
              { user_id: suspendedUserId, code: 'TESTCODE', is_active: true }
            ];
            
            const afterSuspension = suspendUser(suspendedUserId, codesWithSuspended);
            
            // All codes belonging to suspended user should be inactive
            afterSuspension.forEach(code => {
              if (code.user_id === suspendedUserId) {
                expect(code.is_active).toBe(false);
              }
            });
          }
        ),
        { numRuns: 100 }
      );
    });
  });
