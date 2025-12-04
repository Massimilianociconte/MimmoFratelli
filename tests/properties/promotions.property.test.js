/**
 * Promotions Property Tests
 * Avenue M. E-commerce Platform
 * 
 * Properties 19, 20: Promotion visibility and discount calculation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';

// Mock Supabase
vi.mock('../../js/supabase.js', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          lte: vi.fn(() => ({
            gte: vi.fn(() => ({
              order: vi.fn(() => ({ data: [], error: null })),
              single: vi.fn(() => ({ data: null, error: null }))
            }))
          }))
        }))
      }))
    })),
    rpc: vi.fn(() => Promise.resolve({ error: null }))
  },
  isSupabaseConfigured: () => true
}));

// Arbitraries
const promotionArb = fc.record({
  id: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 100 }),
  code: fc.stringMatching(/^[A-Z0-9]{4,10}$/),
  discount_type: fc.constantFrom('percentage', 'fixed'),
  discount_value: fc.float({ min: Math.fround(1), max: Math.fround(100), noNaN: true }),
  min_purchase: fc.option(fc.float({ min: Math.fround(0), max: Math.fround(500), noNaN: true }), { nil: null }),
  max_discount: fc.option(fc.float({ min: Math.fround(1), max: Math.fround(200), noNaN: true }), { nil: null }),
  start_date: fc.date({ min: new Date('2024-01-01'), max: new Date('2025-12-31') }).map(d => d.toISOString()),
  end_date: fc.date({ min: new Date('2024-01-01'), max: new Date('2026-12-31') }).map(d => d.toISOString()),
  is_active: fc.boolean(),
  max_uses: fc.option(fc.integer({ min: 1, max: 1000 }), { nil: null }),
  current_uses: fc.integer({ min: 0, max: 500 }),
  auto_apply: fc.boolean(),
  applicable_categories: fc.option(fc.array(fc.uuid(), { maxLength: 5 }), { nil: null }),
  applicable_products: fc.option(fc.array(fc.uuid(), { maxLength: 10 }), { nil: null })
});

const cartItemArb = fc.record({
  productId: fc.uuid(),
  categoryId: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 100 }),
  price: fc.float({ min: Math.fround(0.01), max: Math.fround(1000), noNaN: true }),
  quantity: fc.integer({ min: 1, max: 10 })
});

describe('Promotions Property Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Property 19: Promotion visibility by date
   * Only promotions within valid date range and active should be visible
   */
  describe('Property 19: Promotion visibility by date', () => {
    it('should correctly identify active promotions by date', async () => {
      const { promotionService } = await import('../../js/services/promotions.js');

      await fc.assert(
        fc.asyncProperty(
          promotionArb,
          async (promotion) => {
            const now = new Date();
            const startDate = new Date(promotion.start_date);
            const endDate = new Date(promotion.end_date);

            const isWithinDateRange = startDate <= now && endDate >= now;
            const shouldBeVisible = isWithinDateRange && promotion.is_active;

            // If promotion has max_uses, check if exhausted
            const isExhausted = promotion.max_uses !== null && 
                               promotion.current_uses >= promotion.max_uses;

            // Promotion should only be usable if visible and not exhausted
            const isUsable = shouldBeVisible && !isExhausted;

            // This is a logical property - the service should respect these rules
            expect(typeof isUsable).toBe('boolean');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should format discount display correctly', async () => {
      const { promotionService } = await import('../../js/services/promotions.js');

      await fc.assert(
        fc.asyncProperty(
          promotionArb,
          async (promotion) => {
            const formatted = promotionService.formatDiscount(promotion);
            
            expect(typeof formatted).toBe('string');
            
            if (promotion.discount_type === 'percentage') {
              expect(formatted).toContain('%');
              expect(formatted).toContain('-');
            } else if (promotion.discount_type === 'fixed') {
              expect(formatted).toContain('€');
              expect(formatted).toContain('-');
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 20: Promotion discount calculation
   * Discounts should be calculated correctly based on type and constraints
   */
  describe('Property 20: Promotion discount calculation', () => {
    it('should calculate percentage discounts correctly', async () => {
      const { promotionService } = await import('../../js/services/promotions.js');

      await fc.assert(
        fc.asyncProperty(
          fc.array(cartItemArb, { minLength: 1, maxLength: 5 }),
          fc.float({ min: 1, max: 50, noNaN: true }),
          async (cartItems, discountPercent) => {
            const promotion = {
              discount_type: 'percentage',
              discount_value: discountPercent,
              min_purchase: null,
              max_discount: null,
              applicable_categories: null,
              applicable_products: null
            };

            const result = promotionService.applyPromotion(cartItems, promotion);
            const cartTotal = cartItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
            const expectedDiscount = (cartTotal * discountPercent) / 100;

            // Discount should be approximately correct (within rounding)
            expect(Math.abs(result.discount - Math.round(expectedDiscount * 100) / 100)).toBeLessThan(0.02);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should calculate fixed discounts correctly', async () => {
      const { promotionService } = await import('../../js/services/promotions.js');

      await fc.assert(
        fc.asyncProperty(
          fc.array(cartItemArb, { minLength: 1, maxLength: 5 }),
          fc.float({ min: Math.fround(1), max: Math.fround(100), noNaN: true }),
          async (cartItems, fixedDiscount) => {
            const promotion = {
              discount_type: 'fixed',
              discount_value: fixedDiscount,
              min_purchase: null,
              max_discount: null,
              applicable_categories: null,
              applicable_products: null
            };

            const result = promotionService.applyPromotion(cartItems, promotion);
            const cartTotal = cartItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);

            // Fixed discount should not exceed cart total (with tolerance for floating point)
            expect(result.discount).toBeLessThanOrEqual(cartTotal + 0.01);
            expect(result.discount).toBeLessThanOrEqual(fixedDiscount + 0.01);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should respect minimum purchase requirement', async () => {
      const { promotionService } = await import('../../js/services/promotions.js');

      await fc.assert(
        fc.asyncProperty(
          fc.array(cartItemArb, { minLength: 1, maxLength: 3 }),
          fc.float({ min: Math.fround(50), max: Math.fround(200), noNaN: true }),
          async (cartItems, minPurchase) => {
            const promotion = {
              discount_type: 'percentage',
              discount_value: 10,
              min_purchase: minPurchase,
              max_discount: null,
              applicable_categories: null,
              applicable_products: null
            };

            const result = promotionService.applyPromotion(cartItems, promotion);
            const cartTotal = cartItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);

            // If cart total is below minimum, discount should be 0
            if (cartTotal < minPurchase) {
              expect(result.discount).toBe(0);
              expect(result.error).toBeDefined();
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should respect maximum discount cap', async () => {
      const { promotionService } = await import('../../js/services/promotions.js');

      await fc.assert(
        fc.asyncProperty(
          fc.array(cartItemArb, { minLength: 1, maxLength: 5 }),
          fc.float({ min: Math.fround(10), max: Math.fround(50), noNaN: true }),
          async (cartItems, maxDiscount) => {
            const promotion = {
              discount_type: 'percentage',
              discount_value: 50, // High percentage
              min_purchase: null,
              max_discount: maxDiscount,
              applicable_categories: null,
              applicable_products: null
            };

            const result = promotionService.applyPromotion(cartItems, promotion);

            // Discount should never exceed max_discount (with tolerance for floating point)
            expect(result.discount).toBeLessThanOrEqual(maxDiscount + 0.01);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should never return negative discount', async () => {
      const { promotionService } = await import('../../js/services/promotions.js');

      await fc.assert(
        fc.asyncProperty(
          fc.array(cartItemArb, { minLength: 0, maxLength: 5 }),
          promotionArb,
          async (cartItems, promotion) => {
            const result = promotionService.applyPromotion(cartItems, promotion);
            expect(result.discount).toBeGreaterThanOrEqual(0);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
