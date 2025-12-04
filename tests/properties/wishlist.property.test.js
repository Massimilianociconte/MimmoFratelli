/**
 * Wishlist Property Tests
 * Avenue M. E-commerce Platform
 * 
 * Property-based tests for hybrid wishlist system
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.6
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

// Mock Supabase wishlist storage
const mockSupabaseWishlist = new Map();

// Mock Wishlist Service for testing
class MockWishlistService {
  constructor() {
    this.localStorage = mockLocalStorage;
    this.supabaseWishlist = mockSupabaseWishlist;
  }

  reset() {
    this.localStorage.clear();
    this.supabaseWishlist.clear();
  }

  // Guest operations (localStorage) - Requirement 2.1
  getLocalWishlist() {
    try {
      const stored = this.localStorage.getItem('avenue_wishlist');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  }

  addToLocalWishlist(productId) {
    const wishlist = this.getLocalWishlist();
    if (!wishlist.includes(productId)) {
      wishlist.push(productId);
      this.localStorage.setItem('avenue_wishlist', JSON.stringify(wishlist));
    }
  }

  removeFromLocalWishlist(productId) {
    const wishlist = this.getLocalWishlist();
    const index = wishlist.indexOf(productId);
    if (index > -1) {
      wishlist.splice(index, 1);
      this.localStorage.setItem('avenue_wishlist', JSON.stringify(wishlist));
    }
  }

  isInLocalWishlist(productId) {
    return this.getLocalWishlist().includes(productId);
  }

  clearLocalWishlist() {
    this.localStorage.removeItem('avenue_wishlist');
  }

  // Authenticated operations (Supabase) - Requirement 2.2
  getSupabaseWishlist(userId) {
    return this.supabaseWishlist.get(userId) || [];
  }

  addToSupabaseWishlist(userId, productId) {
    const wishlist = this.getSupabaseWishlist(userId);
    if (!wishlist.includes(productId)) {
      wishlist.push(productId);
      this.supabaseWishlist.set(userId, wishlist);
    }
  }

  removeFromSupabaseWishlist(userId, productId) {
    const wishlist = this.getSupabaseWishlist(userId);
    const index = wishlist.indexOf(productId);
    if (index > -1) {
      wishlist.splice(index, 1);
      this.supabaseWishlist.set(userId, wishlist);
    }
  }

  isInSupabaseWishlist(userId, productId) {
    return this.getSupabaseWishlist(userId).includes(productId);
  }

  // Migration - Requirement 2.3
  migrateLocalToSupabase(userId) {
    const localItems = this.getLocalWishlist();
    
    localItems.forEach(productId => {
      this.addToSupabaseWishlist(userId, productId);
    });
    
    this.clearLocalWishlist();
    
    return { migratedCount: localItems.length };
  }

  // Merge - Requirements 2.4, 2.6
  mergeWishlists(userId) {
    const localItems = this.getLocalWishlist();
    const supabaseItems = this.getSupabaseWishlist(userId);
    
    // Union without duplicates (Requirement 2.6)
    const merged = [...new Set([...supabaseItems, ...localItems])];
    
    this.supabaseWishlist.set(userId, merged);
    this.clearLocalWishlist();
    
    return { mergedItems: merged };
  }
}

// Generators
const productIdGenerator = fc.uuid();
const userIdGenerator = fc.uuid();

describe('Wishlist Property Tests', () => {
  let wishlistService;

  beforeEach(() => {
    wishlistService = new MockWishlistService();
    wishlistService.reset();
  });

  describe('Property 5: Guest wishlist localStorage persistence', () => {
    /**
     * **Feature: avenue-ecommerce-platform, Property 5: Guest wishlist localStorage persistence**
     * **Validates: Requirements 2.1**
     * 
     * For any product ID added to wishlist by a guest user,
     * the product ID SHALL be retrievable from localStorage.
     */
    it('added products are retrievable from localStorage', () => {
      fc.assert(
        fc.property(
          fc.array(productIdGenerator, { minLength: 1, maxLength: 20 }),
          (productIds) => {
            wishlistService.reset();
            
            // Add all products
            productIds.forEach(id => wishlistService.addToLocalWishlist(id));
            
            // All products should be retrievable
            const stored = wishlistService.getLocalWishlist();
            const uniqueIds = [...new Set(productIds)];
            
            uniqueIds.forEach(id => {
              expect(stored).toContain(id);
            });
            
            expect(stored.length).toBe(uniqueIds.length);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('removed products are no longer in localStorage', () => {
      fc.assert(
        fc.property(
          fc.array(productIdGenerator, { minLength: 2, maxLength: 10 }),
          fc.integer({ min: 0, max: 9 }),
          (productIds, removeIndex) => {
            wishlistService.reset();
            const uniqueIds = [...new Set(productIds)];
            fc.pre(uniqueIds.length >= 2);
            
            // Add all products
            uniqueIds.forEach(id => wishlistService.addToLocalWishlist(id));
            
            // Remove one product
            const indexToRemove = removeIndex % uniqueIds.length;
            const removedId = uniqueIds[indexToRemove];
            wishlistService.removeFromLocalWishlist(removedId);
            
            // Removed product should not be in wishlist
            expect(wishlistService.isInLocalWishlist(removedId)).toBe(false);
            
            // Other products should still be there
            uniqueIds.forEach((id, i) => {
              if (i !== indexToRemove) {
                expect(wishlistService.isInLocalWishlist(id)).toBe(true);
              }
            });
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 6: Authenticated wishlist Supabase persistence', () => {
    /**
     * **Feature: avenue-ecommerce-platform, Property 6: Authenticated wishlist Supabase persistence**
     * **Validates: Requirements 2.2**
     * 
     * For any product ID added to wishlist by an authenticated user,
     * the product ID SHALL be retrievable from the Supabase wishlist_items table.
     */
    it('added products are retrievable from Supabase', () => {
      fc.assert(
        fc.property(
          userIdGenerator,
          fc.array(productIdGenerator, { minLength: 1, maxLength: 20 }),
          (userId, productIds) => {
            wishlistService.reset();
            
            // Add all products for user
            productIds.forEach(id => wishlistService.addToSupabaseWishlist(userId, id));
            
            // All products should be retrievable
            const stored = wishlistService.getSupabaseWishlist(userId);
            const uniqueIds = [...new Set(productIds)];
            
            uniqueIds.forEach(id => {
              expect(stored).toContain(id);
            });
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 7: Wishlist migration completeness', () => {
    /**
     * **Feature: avenue-ecommerce-platform, Property 7: Wishlist migration completeness**
     * **Validates: Requirements 2.3**
     * 
     * For any set of product IDs in localStorage, after user registration
     * all product IDs SHALL exist in the user's Supabase wishlist.
     */
    it('all localStorage items migrate to Supabase', () => {
      fc.assert(
        fc.property(
          userIdGenerator,
          fc.array(productIdGenerator, { minLength: 1, maxLength: 20 }),
          (userId, productIds) => {
            wishlistService.reset();
            const uniqueIds = [...new Set(productIds)];
            
            // Add products to localStorage (as guest)
            uniqueIds.forEach(id => wishlistService.addToLocalWishlist(id));
            
            // Verify localStorage has items
            expect(wishlistService.getLocalWishlist().length).toBe(uniqueIds.length);
            
            // Migrate to Supabase (user registers)
            const { migratedCount } = wishlistService.migrateLocalToSupabase(userId);
            
            // All items should be migrated
            expect(migratedCount).toBe(uniqueIds.length);
            
            // Supabase should have all items
            const supabaseItems = wishlistService.getSupabaseWishlist(userId);
            uniqueIds.forEach(id => {
              expect(supabaseItems).toContain(id);
            });
            
            // localStorage should be cleared
            expect(wishlistService.getLocalWishlist().length).toBe(0);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 8: Wishlist merge deduplication', () => {
    /**
     * **Feature: avenue-ecommerce-platform, Property 8: Wishlist merge deduplication**
     * **Validates: Requirements 2.4, 2.6**
     * 
     * For any set A of product IDs in localStorage and set B of product IDs in Supabase,
     * after merge the resulting wishlist SHALL equal the union of A and B with no duplicate entries.
     */
    it('merge produces union without duplicates', () => {
      fc.assert(
        fc.property(
          userIdGenerator,
          fc.array(productIdGenerator, { minLength: 0, maxLength: 10 }),
          fc.array(productIdGenerator, { minLength: 0, maxLength: 10 }),
          (userId, localIds, supabaseIds) => {
            wishlistService.reset();
            
            // Add to localStorage
            localIds.forEach(id => wishlistService.addToLocalWishlist(id));
            
            // Add to Supabase (existing user data)
            supabaseIds.forEach(id => wishlistService.addToSupabaseWishlist(userId, id));
            
            // Merge
            const { mergedItems } = wishlistService.mergeWishlists(userId);
            
            // Calculate expected union
            const expectedUnion = [...new Set([...localIds, ...supabaseIds])];
            
            // Merged should equal union
            expect(mergedItems.sort()).toEqual(expectedUnion.sort());
            
            // No duplicates
            expect(mergedItems.length).toBe(new Set(mergedItems).size);
            
            // localStorage should be cleared
            expect(wishlistService.getLocalWishlist().length).toBe(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('merge handles overlapping items correctly', () => {
      fc.assert(
        fc.property(
          userIdGenerator,
          fc.array(productIdGenerator, { minLength: 1, maxLength: 5 }),
          (userId, sharedIds) => {
            wishlistService.reset();
            
            // Add same items to both localStorage and Supabase
            sharedIds.forEach(id => {
              wishlistService.addToLocalWishlist(id);
              wishlistService.addToSupabaseWishlist(userId, id);
            });
            
            // Merge
            const { mergedItems } = wishlistService.mergeWishlists(userId);
            
            // Should have no duplicates - same count as unique items
            const uniqueShared = [...new Set(sharedIds)];
            expect(mergedItems.length).toBe(uniqueShared.length);
            
            // All items should be present
            uniqueShared.forEach(id => {
              expect(mergedItems).toContain(id);
            });
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
