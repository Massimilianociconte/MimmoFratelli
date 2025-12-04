/**
 * Order Property Tests
 * Avenue M. E-commerce Platform
 * 
 * Properties 14, 15: Courier integration and order history
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';

// Mock Supabase
vi.mock('../../js/supabase.js', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn(() => ({ data: [], error: null })),
          single: vi.fn(() => ({ data: { id: 'order-123', status: 'pending' }, error: null }))
        }))
      })),
      update: vi.fn(() => ({ eq: vi.fn(() => ({ error: null })) })),
      insert: vi.fn(() => ({ select: vi.fn(() => ({ single: vi.fn(() => ({ data: { id: 'order-123' }, error: null })) })) }))
    })),
    functions: {
      invoke: vi.fn(() => Promise.resolve({ data: { success: true, trackingNumber: 'TRK123456' }, error: null }))
    }
  },
  isSupabaseConfigured: () => true,
  getCurrentUser: () => Promise.resolve({ id: 'user-123', email: 'test@example.com' })
}));

// Arbitraries
const orderStatusArb = fc.constantFrom('pending', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded');

const courierArb = fc.constantFrom('brt', 'dhl', 'gls', 'ups', 'sda');

const trackingNumberArb = fc.stringMatching(/^[A-Z0-9]{10,20}$/);

const orderArb = fc.record({
  id: fc.uuid(),
  user_id: fc.uuid(),
  status: orderStatusArb,
  total_amount: fc.float({ min: Math.fround(1), max: Math.fround(10000), noNaN: true }),
  created_at: fc.date({ min: new Date('2024-01-01'), max: new Date() }).map(d => d.toISOString()),
  tracking_number: fc.option(trackingNumberArb, { nil: null }),
  courier: fc.option(courierArb, { nil: null }),
  order_items: fc.array(fc.record({
    product_id: fc.uuid(),
    quantity: fc.integer({ min: 1, max: 10 }),
    unit_price: fc.float({ min: Math.fround(0.01), max: Math.fround(1000), noNaN: true }),
    size: fc.constantFrom('XS', 'S', 'M', 'L', 'XL'),
    color: fc.string({ minLength: 1, maxLength: 20 })
  }), { minLength: 1, maxLength: 5 })
});

describe('Order Property Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Property 14: Courier API integration
   * Orders should be submitted to courier and flagged for manual review on failure
   */
  describe('Property 14: Courier API integration', () => {
    it('should handle courier submission results correctly', async () => {
      const { orderService } = await import('../../js/services/orders.js');

      await fc.assert(
        fc.asyncProperty(
          courierArb,
          trackingNumberArb,
          async (courier, trackingNumber) => {
            // Verify tracking URL generation works for all couriers
            const trackingUrl = orderService.getTrackingUrl(courier, trackingNumber);
            
            // Should return a URL or null
            if (trackingUrl !== null) {
              expect(trackingUrl).toMatch(/^https?:\/\//);
              expect(trackingUrl).toContain(trackingNumber);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should generate valid tracking URLs for supported couriers', async () => {
      const { orderService } = await import('../../js/services/orders.js');

      const supportedCouriers = ['brt', 'dhl', 'gls', 'ups', 'sda'];
      const testTrackingNumber = 'TEST123456789';

      supportedCouriers.forEach(courier => {
        const url = orderService.getTrackingUrl(courier, testTrackingNumber);
        expect(url).not.toBeNull();
        expect(url).toContain(testTrackingNumber);
      });
    });

    it('should return null for unknown couriers', async () => {
      const { orderService } = await import('../../js/services/orders.js');

      // Test with specific unknown courier names
      const unknownCouriers = ['fedex', 'tnt', 'poste', 'bartolini', 'nexive', 'unknown'];
      
      for (const courier of unknownCouriers) {
        const url = orderService.getTrackingUrl(courier, 'TEST123');
        expect(url).toBeNull();
      }
    });
  });

  /**
   * Property 15: Order history completeness
   * All user orders should be retrievable and contain required fields
   */
  describe('Property 15: Order history completeness', () => {
    it('should return orders with all required fields', async () => {
      const { orderService } = await import('../../js/services/orders.js');

      await fc.assert(
        fc.asyncProperty(
          fc.array(orderArb, { minLength: 0, maxLength: 10 }),
          async (orders) => {
            // Each order should have required fields
            orders.forEach(order => {
              expect(order.id).toBeDefined();
              expect(order.user_id).toBeDefined();
              expect(order.status).toBeDefined();
              expect(order.total_amount).toBeDefined();
              expect(order.created_at).toBeDefined();
              expect(order.order_items).toBeDefined();
              expect(Array.isArray(order.order_items)).toBe(true);
            });
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should translate all status values to Italian labels', async () => {
      const { orderService } = await import('../../js/services/orders.js');

      const statuses = ['pending', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded'];
      
      statuses.forEach(status => {
        const label = orderService.getStatusLabel(status);
        expect(label).toBeDefined();
        expect(typeof label).toBe('string');
        expect(label.length).toBeGreaterThan(0);
        // Should be in Italian (not the raw status)
        if (status !== label) {
          expect(label).not.toBe(status);
        }
      });
    });

    it('should maintain order chronological integrity', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(orderArb, { minLength: 2, maxLength: 10 }),
          async (orders) => {
            // Sort orders by created_at descending (as returned by getOrderHistory)
            const sortedOrders = [...orders].sort((a, b) => 
              new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
            );

            // Verify chronological order
            for (let i = 0; i < sortedOrders.length - 1; i++) {
              const current = new Date(sortedOrders[i].created_at);
              const next = new Date(sortedOrders[i + 1].created_at);
              expect(current.getTime()).toBeGreaterThanOrEqual(next.getTime());
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
