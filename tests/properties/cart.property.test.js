/**
 * Cart Property Tests
 * Avenue M. E-commerce Platform
 * 
 * Property-based tests for shopping cart system
 * Requirements: 3.1, 3.2, 3.3, 3.4
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';

// Mock localStorage
const mockLocalStorage = {
  store: {},
  getItem(key) { return this.store[key] || null; },
  setItem(key, value) { this.store[key] = String(value); },
  removeItem(key) { delete this.store[key]; },
  clear() { this.store = {}; }
};

// Mock Supabase cart storage
const mockSupabaseCart = new Map();

// Mock Cart Service for testing
class MockCartService {
  constructor() {
    this.localStorage = mockLocalStorage;
    this.supabaseCart = mockSupabaseCart;
  }

  reset() {
    this.localStorage.clear();
    this.supabaseCart.clear();
  }

  // ============================================
  // Guest Operations (localStorage)
  // Requirement: 3.1
  // ============================================

  getLocalCart() {
    try {
      const stored = this.localStorage.getItem('avenue_cart');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  }

  _saveLocalCart(cart) {
    this.localStorage.setItem('avenue_cart', JSON.stringify(cart));
  }

  addToLocalCart(item) {
    const cart = this.getLocalCart();
    const existingIndex = cart.findIndex(i => 
      i.productId === item.productId && 
      i.size === item.size && 
      i.color === item.color
    );

    if (existingIndex > -1) {
      cart[existingIndex].quantity = Math.min(10, cart[existingIndex].quantity + (item.quantity || 1));
    } else {
      cart.push({
        productId: item.productId,
        name: item.name,
        price: item.price,
        size: item.size,
        color: item.color,
        quantity: item.quantity || 1
      });
    }

    this._saveLocalCart(cart);
    return { success: true };
  }

  updateLocalCartItem(productId, size, color, quantity) {
    const cart = this.getLocalCart();
    const index = cart.findIndex(i => 
      i.productId === productId && i.size === size && i.color === color
    );

    if (index > -1) {
      if (quantity <= 0) {
        cart.splice(index, 1);
      } else {
        cart[index].quantity = Math.min(10, quantity);
      }
      this._saveLocalCart(cart);
    }
    return { success: true };
  }

  removeFromLocalCart(productId, size, color) {
    const cart = this.getLocalCart();
    const filtered = cart.filter(i => 
      !(i.productId === productId && i.size === size && i.color === color)
    );
    this._saveLocalCart(filtered);
    return { success: true };
  }

  clearLocalCart() {
    this.localStorage.removeItem('avenue_cart');
  }

  getLocalCartTotal() {
    return this.getLocalCart().reduce((sum, item) => sum + (item.price * item.quantity), 0);
  }

  // ============================================
  // Authenticated Operations (Supabase)
  // Requirement: 3.4
  // ============================================

  getSupabaseCart(userId) {
    return this.supabaseCart.get(userId) || [];
  }

  addToSupabaseCart(userId, item) {
    const cart = this.getSupabaseCart(userId);
    const existingIndex = cart.findIndex(i => 
      i.productId === item.productId && 
      i.size === item.size && 
      i.color === item.color
    );

    if (existingIndex > -1) {
      cart[existingIndex].quantity = Math.min(10, cart[existingIndex].quantity + (item.quantity || 1));
    } else {
      cart.push({
        productId: item.productId,
        name: item.name,
        price: item.price,
        size: item.size,
        color: item.color,
        quantity: item.quantity || 1
      });
    }

    this.supabaseCart.set(userId, cart);
    return { success: true };
  }

  removeFromSupabaseCart(userId, productId, size, color) {
    const cart = this.getSupabaseCart(userId);
    const filtered = cart.filter(i => 
      !(i.productId === productId && i.size === size && i.color === color)
    );
    this.supabaseCart.set(userId, filtered);
    return { success: true };
  }

  getSupabaseCartTotal(userId) {
    return this.getSupabaseCart(userId).reduce((sum, item) => sum + (item.price * item.quantity), 0);
  }

  // ============================================
  // Sync Operations
  // Requirement: 3.4
  // ============================================

  mergeCartsOnLogin(userId) {
    const localItems = this.getLocalCart();
    
    if (localItems.length === 0) {
      return { mergedCount: 0 };
    }

    // Merge local items into Supabase cart
    for (const item of localItems) {
      this.addToSupabaseCart(userId, item);
    }

    this.clearLocalCart();
    return { mergedCount: localItems.length };
  }
}

// Generators
const productIdGenerator = fc.uuid();
const userIdGenerator = fc.uuid();
const sizeGenerator = fc.constantFrom('XS', 'S', 'M', 'L', 'XL');
const colorGenerator = fc.constantFrom('Nero', 'Bianco', 'Blu', 'Rosso', 'Verde');
const priceGenerator = fc.float({ min: Math.fround(10), max: Math.fround(1000), noNaN: true });
const quantityGenerator = fc.integer({ min: 1, max: 10 });

const cartItemGenerator = fc.record({
  productId: productIdGenerator,
  name: fc.string({ minLength: 1, maxLength: 50 }),
  price: priceGenerator,
  size: sizeGenerator,
  color: colorGenerator,
  quantity: quantityGenerator
});

describe('Cart Property Tests', () => {
  let cartService;

  beforeEach(() => {
    cartService = new MockCartService();
    cartService.reset();
  });

  describe('Property 9: Cart item storage integrity', () => {
    /**
     * **Feature: avenue-ecommerce-platform, Property 9: Cart item storage integrity**
     * **Validates: Requirements 3.1**
     * 
     * For any cart item added with specific product ID, size, color, and quantity,
     * the item SHALL be retrievable with all attributes intact.
     */
    it('added items are retrievable with all attributes', () => {
      fc.assert(
        fc.property(
          fc.array(cartItemGenerator, { minLength: 1, maxLength: 10 }),
          (items) => {
            cartService.reset();
            
            // Add all items
            items.forEach(item => cartService.addToLocalCart(item));
            
            // Retrieve cart
            const cart = cartService.getLocalCart();
            
            // Each unique item should be in cart
            const uniqueItems = new Map();
            items.forEach(item => {
              const key = `${item.productId}-${item.size}-${item.color}`;
              if (!uniqueItems.has(key)) {
                uniqueItems.set(key, { ...item });
              } else {
                // Accumulate quantity for duplicates
                const existing = uniqueItems.get(key);
                existing.quantity = Math.min(10, existing.quantity + item.quantity);
              }
            });

            // Verify all unique items are in cart
            uniqueItems.forEach((expectedItem, key) => {
              const found = cart.find(i => 
                i.productId === expectedItem.productId &&
                i.size === expectedItem.size &&
                i.color === expectedItem.color
              );
              
              expect(found).toBeDefined();
              expect(found.name).toBe(expectedItem.name);
              expect(found.price).toBe(expectedItem.price);
              expect(found.quantity).toBe(expectedItem.quantity);
            });
          }
        ),
        { numRuns: 100 }
      );
    });

    it('removed items are no longer in cart', () => {
      fc.assert(
        fc.property(
          fc.array(cartItemGenerator, { minLength: 2, maxLength: 5 }),
          fc.integer({ min: 0, max: 4 }),
          (items, removeIndex) => {
            cartService.reset();
            
            // Make items unique by modifying productId
            const uniqueItems = items.map((item, i) => ({
              ...item,
              productId: `${item.productId}-${i}`
            }));
            
            // Add all items
            uniqueItems.forEach(item => cartService.addToLocalCart(item));
            
            // Remove one item
            const indexToRemove = removeIndex % uniqueItems.length;
            const removedItem = uniqueItems[indexToRemove];
            cartService.removeFromLocalCart(removedItem.productId, removedItem.size, removedItem.color);
            
            // Verify removed item is not in cart
            const cart = cartService.getLocalCart();
            const found = cart.find(i => 
              i.productId === removedItem.productId &&
              i.size === removedItem.size &&
              i.color === removedItem.color
            );
            
            expect(found).toBeUndefined();
            
            // Other items should still be there
            uniqueItems.forEach((item, i) => {
              if (i !== indexToRemove) {
                const stillThere = cart.find(c => 
                  c.productId === item.productId &&
                  c.size === item.size &&
                  c.color === item.color
                );
                expect(stillThere).toBeDefined();
              }
            });
          }
        ),
        { numRuns: 100 }
      );
    });

    it('quantity updates are persisted correctly', () => {
      fc.assert(
        fc.property(
          cartItemGenerator,
          quantityGenerator,
          (item, newQuantity) => {
            cartService.reset();
            
            // Add item
            cartService.addToLocalCart(item);
            
            // Update quantity
            cartService.updateLocalCartItem(item.productId, item.size, item.color, newQuantity);
            
            // Verify quantity
            const cart = cartService.getLocalCart();
            const found = cart.find(i => 
              i.productId === item.productId &&
              i.size === item.size &&
              i.color === item.color
            );
            
            if (newQuantity <= 0) {
              expect(found).toBeUndefined();
            } else {
              expect(found).toBeDefined();
              expect(found.quantity).toBe(Math.min(10, newQuantity));
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 10: Cart total invariant', () => {
    /**
     * **Feature: avenue-ecommerce-platform, Property 10: Cart total invariant**
     * **Validates: Requirements 3.2, 3.3**
     * 
     * For any set of cart items, the cart total SHALL equal
     * the sum of (price × quantity) for all items.
     */
    it('cart total equals sum of item prices times quantities', () => {
      fc.assert(
        fc.property(
          fc.array(cartItemGenerator, { minLength: 1, maxLength: 10 }),
          (items) => {
            cartService.reset();
            
            // Make items unique
            const uniqueItems = items.map((item, i) => ({
              ...item,
              productId: `${item.productId}-${i}`
            }));
            
            // Add all items
            uniqueItems.forEach(item => cartService.addToLocalCart(item));
            
            // Calculate expected total
            const expectedTotal = uniqueItems.reduce((sum, item) => {
              return sum + (item.price * Math.min(10, item.quantity));
            }, 0);
            
            // Get actual total
            const actualTotal = cartService.getLocalCartTotal();
            
            // Compare with tolerance for floating point
            expect(Math.abs(actualTotal - expectedTotal)).toBeLessThan(0.01);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('empty cart has zero total', () => {
      cartService.reset();
      expect(cartService.getLocalCartTotal()).toBe(0);
    });

    it('total updates correctly after item removal', () => {
      fc.assert(
        fc.property(
          fc.array(cartItemGenerator, { minLength: 2, maxLength: 5 }),
          fc.integer({ min: 0, max: 4 }),
          (items, removeIndex) => {
            cartService.reset();
            
            // Make items unique
            const uniqueItems = items.map((item, i) => ({
              ...item,
              productId: `${item.productId}-${i}`
            }));
            
            // Add all items
            uniqueItems.forEach(item => cartService.addToLocalCart(item));
            
            // Remove one item
            const indexToRemove = removeIndex % uniqueItems.length;
            const removedItem = uniqueItems[indexToRemove];
            cartService.removeFromLocalCart(removedItem.productId, removedItem.size, removedItem.color);
            
            // Calculate expected total (without removed item)
            const expectedTotal = uniqueItems.reduce((sum, item, i) => {
              if (i === indexToRemove) return sum;
              return sum + (item.price * Math.min(10, item.quantity));
            }, 0);
            
            // Get actual total
            const actualTotal = cartService.getLocalCartTotal();
            
            expect(Math.abs(actualTotal - expectedTotal)).toBeLessThan(0.01);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 11: Cart cross-device synchronization', () => {
    /**
     * **Feature: avenue-ecommerce-platform, Property 11: Cart cross-device synchronization**
     * **Validates: Requirements 3.4**
     * 
     * For any authenticated user, cart items added on one device
     * SHALL be available on all devices after synchronization.
     */
    it('local cart merges to Supabase on login', () => {
      fc.assert(
        fc.property(
          userIdGenerator,
          fc.array(cartItemGenerator, { minLength: 1, maxLength: 5 }),
          (userId, items) => {
            cartService.reset();
            
            // Make items unique
            const uniqueItems = items.map((item, i) => ({
              ...item,
              productId: `${item.productId}-${i}`
            }));
            
            // Add items to local cart (as guest)
            uniqueItems.forEach(item => cartService.addToLocalCart(item));
            
            // Verify local cart has items
            expect(cartService.getLocalCart().length).toBe(uniqueItems.length);
            
            // Merge on login
            const { mergedCount } = cartService.mergeCartsOnLogin(userId);
            
            // Verify merge count
            expect(mergedCount).toBe(uniqueItems.length);
            
            // Verify Supabase cart has all items
            const supabaseCart = cartService.getSupabaseCart(userId);
            uniqueItems.forEach(item => {
              const found = supabaseCart.find(i => 
                i.productId === item.productId &&
                i.size === item.size &&
                i.color === item.color
              );
              expect(found).toBeDefined();
            });
            
            // Verify local cart is cleared
            expect(cartService.getLocalCart().length).toBe(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('Supabase cart persists across sessions', () => {
      fc.assert(
        fc.property(
          userIdGenerator,
          fc.array(cartItemGenerator, { minLength: 1, maxLength: 5 }),
          (userId, items) => {
            cartService.reset();
            
            // Make items unique
            const uniqueItems = items.map((item, i) => ({
              ...item,
              productId: `${item.productId}-${i}`
            }));
            
            // Add items directly to Supabase (simulating previous session)
            uniqueItems.forEach(item => cartService.addToSupabaseCart(userId, item));
            
            // Simulate "new session" - local cart is empty
            cartService.clearLocalCart();
            
            // Verify Supabase cart still has items
            const supabaseCart = cartService.getSupabaseCart(userId);
            expect(supabaseCart.length).toBe(uniqueItems.length);
            
            // Verify all items are present
            uniqueItems.forEach(item => {
              const found = supabaseCart.find(i => 
                i.productId === item.productId &&
                i.size === item.size &&
                i.color === item.color
              );
              expect(found).toBeDefined();
            });
          }
        ),
        { numRuns: 100 }
      );
    });

    it('cart total is consistent between local and Supabase', () => {
      fc.assert(
        fc.property(
          userIdGenerator,
          fc.array(cartItemGenerator, { minLength: 1, maxLength: 5 }),
          (userId, items) => {
            cartService.reset();
            
            // Make items unique
            const uniqueItems = items.map((item, i) => ({
              ...item,
              productId: `${item.productId}-${i}`
            }));
            
            // Add to local cart
            uniqueItems.forEach(item => cartService.addToLocalCart(item));
            const localTotal = cartService.getLocalCartTotal();
            
            // Merge to Supabase
            cartService.mergeCartsOnLogin(userId);
            const supabaseTotal = cartService.getSupabaseCartTotal(userId);
            
            // Totals should match
            expect(Math.abs(localTotal - supabaseTotal)).toBeLessThan(0.01);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
