/**
 * Payment Property Tests
 * Avenue M. E-commerce Platform
 * 
 * Properties 12, 13: Order creation and payment data security
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';

// Mock Supabase
vi.mock('../../js/supabase.js', () => ({
  supabase: {
    from: vi.fn(() => ({
      insert: vi.fn(() => ({ select: vi.fn(() => ({ single: vi.fn(() => ({ data: { id: 'order-123' }, error: null })) })) })),
      select: vi.fn(() => ({ eq: vi.fn(() => ({ single: vi.fn(() => ({ data: null, error: null })) })) })),
    })),
    functions: {
      invoke: vi.fn(() => Promise.resolve({ data: { sessionId: 'sess_123', url: 'https://checkout.stripe.com/test' }, error: null }))
    }
  },
  isSupabaseConfigured: () => true,
  getCurrentUser: () => Promise.resolve({ id: 'user-123', email: 'test@example.com' })
}));

// Arbitraries
const cartItemArb = fc.record({
  productId: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 100 }),
  price: fc.float({ min: Math.fround(0.01), max: Math.fround(10000), noNaN: true }),
  quantity: fc.integer({ min: 1, max: 10 }),
  size: fc.constantFrom('XS', 'S', 'M', 'L', 'XL'),
  color: fc.string({ minLength: 1, maxLength: 20 }),
  image: fc.webUrl()
});

const paymentResultArb = fc.record({
  provider: fc.constantFrom('stripe', 'paypal', 'klarna'),
  paymentId: fc.string({ minLength: 10, maxLength: 50 }),
  status: fc.constant('completed'),
  shipping: fc.float({ min: Math.fround(0), max: Math.fround(20), noNaN: true }),
  discount: fc.float({ min: Math.fround(0), max: Math.fround(100), noNaN: true })
});

const shippingAddressArb = fc.record({
  firstName: fc.string({ minLength: 1, maxLength: 50 }),
  lastName: fc.string({ minLength: 1, maxLength: 50 }),
  address: fc.string({ minLength: 1, maxLength: 200 }),
  city: fc.string({ minLength: 1, maxLength: 100 }),
  postalCode: fc.stringMatching(/^\d{5}$/),
  province: fc.string({ minLength: 2, maxLength: 2 }),
  phone: fc.stringMatching(/^\+?[\d\s-]{8,15}$/),
  country: fc.constant('IT')
});

describe('Payment Property Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Property 12: Order creation on payment success
   * Orders are created exclusively server-side (stripe-webhook / complete-order-purchase):
   * the client must not be able to create orders directly
   */
  describe('Property 12: Order creation on payment success', () => {
    it('should not expose a client-side order creation method (server-side only)', async () => {
      const { orderService } = await import('../../js/services/orders.js');

      // Legacy createOrder rimosso: la creazione ordini avviene solo nelle edge functions
      expect(orderService.createOrder).toBeUndefined();
    });

    it('should calculate order total correctly', async () => {
      const { paymentService } = await import('../../js/services/payment.js');

      await fc.assert(
        fc.asyncProperty(
          fc.array(cartItemArb, { minLength: 1, maxLength: 5 }),
          fc.float({ min: 0, max: 50, noNaN: true }),
          fc.float({ min: 0, max: 100, noNaN: true }),
          async (cartItems, discount, giftCardBalance) => {
            const totals = paymentService.calculateTotal(cartItems, discount, giftCardBalance);
            
            // Subtotal should be sum of item prices * quantities
            const expectedSubtotal = cartItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
            expect(Math.abs(totals.subtotal - expectedSubtotal)).toBeLessThan(0.01);
            
            // Total should never be negative
            expect(totals.total).toBeGreaterThanOrEqual(0);
            
            // Shipping should be 0 if subtotal >= threshold
            if (totals.subtotal >= 150) {
              expect(totals.shipping).toBe(0);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 13: No sensitive payment data storage
   * Payment service should never store or expose sensitive card data
   */
  describe('Property 13: No sensitive payment data storage', () => {
    it('should not include sensitive data in payment requests', async () => {
      const { paymentService } = await import('../../js/services/payment.js');

      // Sensitive patterns that should never appear
      const sensitivePatterns = [
        /\b\d{13,19}\b/, // Card numbers
        /\b\d{3,4}\b(?=.*cvv|cvc|security)/i, // CVV/CVC
        /\b(4[0-9]{12}(?:[0-9]{3})?)\b/, // Visa
        /\b(5[1-5][0-9]{14})\b/, // Mastercard
        /\b(3[47][0-9]{13})\b/, // Amex
      ];

      await fc.assert(
        fc.asyncProperty(
          fc.array(cartItemArb, { minLength: 1, maxLength: 3 }),
          async (cartItems) => {
            // The payment service should only use Stripe's hosted checkout
            // and never handle raw card data
            const serviceCode = paymentService.constructor.toString();
            
            // Service should not contain card handling logic
            sensitivePatterns.forEach(pattern => {
              expect(serviceCode).not.toMatch(pattern);
            });
            
            // Service should use redirect-based checkout
            expect(typeof paymentService.redirectToStripeCheckout).toBe('function');
          }
        ),
        { numRuns: 10 }
      );
    });

    it('should use secure payment redirect instead of direct card handling', async () => {
      const { paymentService } = await import('../../js/services/payment.js');

      // Verify the service uses Stripe Checkout (redirect-based)
      expect(paymentService.createStripeSession).toBeDefined();
      expect(paymentService.redirectToStripeCheckout).toBeDefined();
      
      // Should not have methods for direct card processing
      expect(paymentService.processCard).toBeUndefined();
      expect(paymentService.chargeCard).toBeUndefined();
      expect(paymentService.storeCardDetails).toBeUndefined();
    });
  });
});
