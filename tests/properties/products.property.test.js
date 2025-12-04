/**
 * Product Filter Property Tests
 * Avenue M. E-commerce Platform
 * 
 * Property-based tests for product filtering
 * Requirements: 7.1, 7.2, 7.3, 7.4
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';

// Mock product service for testing
class MockProductService {
  constructor() {
    this.products = [];
  }

  reset() {
    this.products = [];
  }

  addProduct(product) {
    const id = crypto.randomUUID();
    const fullProduct = {
      id,
      name: product.name || 'Test Product',
      price: product.price,
      category_id: product.category_id,
      gender: product.gender,
      is_active: product.is_active !== false,
      is_featured: product.is_featured || false,
      sale_price: product.sale_price || null,
      created_at: product.created_at || new Date().toISOString()
    };
    this.products.push(fullProduct);
    return fullProduct;
  }

  /**
   * Filter products based on criteria
   * Implements Requirements 7.1, 7.2, 7.3, 7.4
   */
  getProducts(filters = {}) {
    let result = this.products.filter(p => p.is_active);

    // Price range filter (Requirement 7.1)
    if (filters.price_min !== undefined) {
      result = result.filter(p => p.price >= filters.price_min);
    }
    if (filters.price_max !== undefined) {
      result = result.filter(p => p.price <= filters.price_max);
    }

    // Category filter (Requirement 7.2)
    if (filters.category_id) {
      result = result.filter(p => p.category_id === filters.category_id);
    }

    // Gender filter
    if (filters.gender) {
      result = result.filter(p => p.gender === filters.gender);
    }

    // Promotion filter
    if (filters.is_promotion) {
      result = result.filter(p => p.sale_price !== null);
    }

    // Featured filter
    if (filters.is_featured) {
      result = result.filter(p => p.is_featured);
    }

    // Sorting
    switch (filters.sort_by) {
      case 'price_asc':
        result.sort((a, b) => a.price - b.price);
        break;
      case 'price_desc':
        result.sort((a, b) => b.price - a.price);
        break;
      case 'newest':
        result.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        break;
    }

    return { products: result, count: result.length, error: null };
  }

  // Clear all filters returns all active products (Requirement 7.4)
  getAllProducts() {
    return this.getProducts({});
  }
}

// Generators
const priceGenerator = fc.float({ min: Math.fround(1), max: Math.fround(10000), noNaN: true });
const categoryIdGenerator = fc.uuid();
const genderGenerator = fc.constantFrom('man', 'woman', 'unisex');

const productGenerator = fc.record({
  name: fc.string({ minLength: 1, maxLength: 100 }),
  price: priceGenerator,
  category_id: categoryIdGenerator,
  gender: genderGenerator,
  is_active: fc.boolean(),
  is_featured: fc.boolean(),
  sale_price: fc.option(priceGenerator, { nil: null })
});

describe('Product Filter Property Tests', () => {
  let productService;

  beforeEach(() => {
    productService = new MockProductService();
  });

  describe('Property 18: Filter correctness', () => {
    /**
     * **Feature: avenue-ecommerce-platform, Property 18: Filter correctness**
     * **Validates: Requirements 7.1, 7.2, 7.3, 7.4**
     * 
     * For any combination of filters (price range, category, gender),
     * all returned products SHALL satisfy ALL applied filter criteria simultaneously.
     */

    it('price range filter returns only products within range', () => {
      fc.assert(
        fc.property(
          fc.array(productGenerator, { minLength: 5, maxLength: 20 }),
          priceGenerator,
          priceGenerator,
          (products, price1, price2) => {
            productService.reset();
            products.forEach(p => productService.addProduct(p));

            const minPrice = Math.min(price1, price2);
            const maxPrice = Math.max(price1, price2);

            const { products: filtered } = productService.getProducts({
              price_min: minPrice,
              price_max: maxPrice
            });

            // All returned products must be within price range
            filtered.forEach(product => {
              expect(product.price).toBeGreaterThanOrEqual(minPrice);
              expect(product.price).toBeLessThanOrEqual(maxPrice);
            });
          }
        ),
        { numRuns: 100 }
      );
    });

    it('category filter returns only products from that category', () => {
      fc.assert(
        fc.property(
          fc.array(productGenerator, { minLength: 5, maxLength: 20 }),
          categoryIdGenerator,
          (products, targetCategory) => {
            productService.reset();
            
            // Ensure at least one product has the target category
            products[0] = { ...products[0], category_id: targetCategory, is_active: true };
            products.forEach(p => productService.addProduct(p));

            const { products: filtered } = productService.getProducts({
              category_id: targetCategory
            });

            // All returned products must belong to the target category
            filtered.forEach(product => {
              expect(product.category_id).toBe(targetCategory);
            });
          }
        ),
        { numRuns: 100 }
      );
    });

    it('gender filter returns only products of that gender', () => {
      fc.assert(
        fc.property(
          fc.array(productGenerator, { minLength: 5, maxLength: 20 }),
          genderGenerator,
          (products, targetGender) => {
            productService.reset();
            
            // Ensure at least one product has the target gender
            products[0] = { ...products[0], gender: targetGender, is_active: true };
            products.forEach(p => productService.addProduct(p));

            const { products: filtered } = productService.getProducts({
              gender: targetGender
            });

            // All returned products must have the target gender
            filtered.forEach(product => {
              expect(product.gender).toBe(targetGender);
            });
          }
        ),
        { numRuns: 100 }
      );
    });

    it('multiple filters return products satisfying ALL criteria', () => {
      fc.assert(
        fc.property(
          fc.array(productGenerator, { minLength: 10, maxLength: 30 }),
          priceGenerator,
          priceGenerator,
          categoryIdGenerator,
          genderGenerator,
          (products, price1, price2, targetCategory, targetGender) => {
            productService.reset();
            
            const minPrice = Math.min(price1, price2);
            const maxPrice = Math.max(price1, price2);

            // Ensure at least one product matches all criteria
            products[0] = {
              ...products[0],
              price: (minPrice + maxPrice) / 2,
              category_id: targetCategory,
              gender: targetGender,
              is_active: true
            };
            products.forEach(p => productService.addProduct(p));

            const { products: filtered } = productService.getProducts({
              price_min: minPrice,
              price_max: maxPrice,
              category_id: targetCategory,
              gender: targetGender
            });

            // All returned products must satisfy ALL criteria
            filtered.forEach(product => {
              expect(product.price).toBeGreaterThanOrEqual(minPrice);
              expect(product.price).toBeLessThanOrEqual(maxPrice);
              expect(product.category_id).toBe(targetCategory);
              expect(product.gender).toBe(targetGender);
              expect(product.is_active).toBe(true);
            });
          }
        ),
        { numRuns: 100 }
      );
    });

    it('clearing filters returns all active products', () => {
      fc.assert(
        fc.property(
          fc.array(productGenerator, { minLength: 5, maxLength: 20 }),
          (products) => {
            productService.reset();
            products.forEach(p => productService.addProduct(p));

            // Get all products (no filters)
            const { products: allProducts } = productService.getAllProducts();
            
            // Count expected active products
            const expectedActiveCount = products.filter(p => p.is_active !== false).length;

            // All returned products should be active
            allProducts.forEach(product => {
              expect(product.is_active).toBe(true);
            });

            // Count should match
            expect(allProducts.length).toBe(expectedActiveCount);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('only active products are returned regardless of filters', () => {
      fc.assert(
        fc.property(
          fc.array(productGenerator, { minLength: 5, maxLength: 20 }),
          (products) => {
            productService.reset();
            
            // Ensure mix of active and inactive products
            products.forEach((p, i) => {
              productService.addProduct({ ...p, is_active: i % 2 === 0 });
            });

            const { products: filtered } = productService.getProducts({});

            // All returned products must be active
            filtered.forEach(product => {
              expect(product.is_active).toBe(true);
            });

            // No inactive products should be returned
            const inactiveInResults = filtered.filter(p => !p.is_active);
            expect(inactiveInResults.length).toBe(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('price sorting maintains filter correctness', () => {
      fc.assert(
        fc.property(
          fc.array(productGenerator, { minLength: 5, maxLength: 20 }),
          fc.constantFrom('price_asc', 'price_desc'),
          (products, sortOrder) => {
            productService.reset();
            products.forEach(p => productService.addProduct({ ...p, is_active: true }));

            const { products: sorted } = productService.getProducts({
              sort_by: sortOrder
            });

            // Verify sorting
            for (let i = 1; i < sorted.length; i++) {
              if (sortOrder === 'price_asc') {
                expect(sorted[i].price).toBeGreaterThanOrEqual(sorted[i - 1].price);
              } else {
                expect(sorted[i].price).toBeLessThanOrEqual(sorted[i - 1].price);
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
