/**
 * Product Service
 * Avenue M. E-commerce Platform
 * 
 * Handles product catalog operations and filtering
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5
 */

import { supabase, isSupabaseConfigured } from '../supabase.js';

/**
 * Product Service Class
 */
class ProductService {
  constructor() {
    this.cache = new Map();
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Get products with optional filters
   * Requirements: 7.1, 7.2, 7.3, 7.4
   * 
   * @param {Object} filters - Filter options
   * @param {string} filters.category_id - Filter by category
   * @param {string} filters.gender - Filter by type ('frutta', 'verdura', 'altro')
   * @param {number} filters.price_min - Minimum price
   * @param {number} filters.price_max - Maximum price
   * @param {boolean} filters.is_promotion - Only promotional items
   * @param {boolean} filters.is_featured - Only featured items
   * @param {string} filters.sort_by - Sort option ('price_asc', 'price_desc', 'newest', 'popular')
   * @param {number} filters.limit - Number of results
   * @param {number} filters.offset - Pagination offset
   * @returns {Promise<{products: Array, count: number, error: string|null}>}
   */
  async getProducts(filters = {}) {
    if (!isSupabaseConfigured()) {
      return { products: [], count: 0, error: 'Sistema non configurato' };
    }

    try {
      // Load all products (including inactive ones to show as "unavailable")
      let query = supabase
        .from('products')
        .select('*, categories(name, slug)', { count: 'exact' });

      // Apply filters (Requirements 7.1, 7.2, 7.3)
      if (filters.category_id) {
        query = query.eq('category_id', filters.category_id);
      }

      // Type filter (frutta/verdura/altro)
      // Filter products by their type/gender field
      if (filters.gender) {
        query = query.eq('gender', filters.gender);
      }

      if (filters.price_min !== undefined && filters.price_min !== null) {
        query = query.gte('price', filters.price_min);
      }

      if (filters.price_max !== undefined && filters.price_max !== null) {
        query = query.lte('price', filters.price_max);
      }

      if (filters.is_promotion) {
        query = query.not('sale_price', 'is', null);
      }

      if (filters.is_featured) {
        query = query.eq('is_featured', true);
      }

      // Apply sorting
      switch (filters.sort_by) {
        case 'price_asc':
          query = query.order('price', { ascending: true });
          break;
        case 'price_desc':
          query = query.order('price', { ascending: false });
          break;
        case 'newest':
          query = query.order('created_at', { ascending: false });
          break;
        case 'popular':
          query = query.order('is_featured', { ascending: false })
                       .order('created_at', { ascending: false });
          break;
        default:
          query = query.order('created_at', { ascending: false });
      }

      // Apply pagination
      if (filters.limit) {
        query = query.limit(filters.limit);
      }

      if (filters.offset) {
        query = query.range(filters.offset, filters.offset + (filters.limit || 20) - 1);
      }

      const { data, error, count } = await query;

      if (error) {
        console.error('Error fetching products:', error);
        return { products: [], count: 0, error: 'Errore nel caricamento dei prodotti' };
      }

      return { products: data || [], count: count || 0, error: null };
    } catch (err) {
      console.error('Products fetch error:', err);
      return { products: [], count: 0, error: 'Errore nel caricamento dei prodotti' };
    }
  }

  /**
   * Get a single product by ID
   * 
   * @param {string} id - Product ID
   * @returns {Promise<{product: Object|null, error: string|null}>}
   */
  async getProductById(id) {
    if (!isSupabaseConfigured()) {
      return { product: null, error: 'Sistema non configurato' };
    }

    try {
      // Load product even if inactive (to show as "unavailable")
      const { data, error } = await supabase
        .from('products')
        .select('*, categories(name, slug)')
        .eq('id', id)
        .single();

      if (error) {
        return { product: null, error: 'Prodotto non trovato' };
      }

      return { product: data, error: null };
    } catch (err) {
      console.error('Product fetch error:', err);
      return { product: null, error: 'Errore nel caricamento del prodotto' };
    }
  }

  /**
   * Get product by slug
   * 
   * @param {string} slug - Product slug
   * @returns {Promise<{product: Object|null, error: string|null}>}
   */
  async getProductBySlug(slug) {
    if (!isSupabaseConfigured()) {
      return { product: null, error: 'Sistema non configurato' };
    }

    try {
      // Load product even if inactive (to show as "unavailable")
      const { data, error } = await supabase
        .from('products')
        .select('*, categories(name, slug)')
        .eq('slug', slug)
        .single();

      if (error) {
        return { product: null, error: 'Prodotto non trovato' };
      }

      return { product: data, error: null };
    } catch (err) {
      console.error('Product fetch error:', err);
      return { product: null, error: 'Errore nel caricamento del prodotto' };
    }
  }

  /**
   * Get all categories
   * 
   * @returns {Promise<{categories: Array, error: string|null}>}
   */
  async getCategories() {
    if (!isSupabaseConfigured()) {
      return { categories: [], error: 'Sistema non configurato' };
    }

    // Check cache
    const cacheKey = 'categories';
    const cached = this._getFromCache(cacheKey);
    if (cached) {
      return { categories: cached, error: null };
    }

    try {
      const { data, error } = await supabase
        .from('categories')
        .select('*')
        .eq('is_active', true)
        .order('display_order', { ascending: true });

      if (error) {
        return { categories: [], error: 'Errore nel caricamento delle categorie' };
      }

      // Cache results
      this._setCache(cacheKey, data);

      return { categories: data || [], error: null };
    } catch (err) {
      console.error('Categories fetch error:', err);
      return { categories: [], error: 'Errore nel caricamento delle categorie' };
    }
  }

  /**
   * Get category by slug
   * 
   * @param {string} slug - Category slug
   * @returns {Promise<{category: Object|null, error: string|null}>}
   */
  async getCategoryBySlug(slug) {
    if (!isSupabaseConfigured()) {
      return { category: null, error: 'Sistema non configurato' };
    }

    try {
      const { data, error } = await supabase
        .from('categories')
        .select('*')
        .eq('slug', slug)
        .eq('is_active', true)
        .single();

      if (error) {
        return { category: null, error: 'Categoria non trovata' };
      }

      return { category: data, error: null };
    } catch (err) {
      console.error('Category fetch error:', err);
      return { category: null, error: 'Errore nel caricamento della categoria' };
    }
  }

  /**
   * Search products by query
   * 
   * @param {string} query - Search query
   * @param {Object} options - Additional options
   * @returns {Promise<{products: Array, error: string|null}>}
   */
  async searchProducts(query, options = {}) {
    if (!isSupabaseConfigured()) {
      return { products: [], error: 'Sistema non configurato' };
    }

    if (!query || query.trim().length < 2) {
      return { products: [], error: null };
    }

    try {
      const searchTerm = `%${query.trim()}%`;
      
      let dbQuery = supabase
        .from('products')
        .select('*, categories(name, slug)')
        .eq('is_active', true)
        .or(`name.ilike.${searchTerm},description.ilike.${searchTerm}`)
        .limit(options.limit || 20);

      // Type filter (frutta/verdura/altro)
      if (options.gender) {
        dbQuery = dbQuery.eq('gender', options.gender);
      }

      const { data, error } = await dbQuery;

      if (error) {
        return { products: [], error: 'Errore nella ricerca' };
      }

      return { products: data || [], error: null };
    } catch (err) {
      console.error('Search error:', err);
      return { products: [], error: 'Errore nella ricerca' };
    }
  }

  /**
   * Get related products
   * 
   * @param {string} productId - Current product ID
   * @param {number} limit - Number of related products
   * @returns {Promise<{products: Array, error: string|null}>}
   */
  async getRelatedProducts(productId, limit = 4) {
    if (!isSupabaseConfigured()) {
      return { products: [], error: 'Sistema non configurato' };
    }

    try {
      // First get the current product to find its category
      const { product } = await this.getProductById(productId);
      
      if (!product) {
        return { products: [], error: null };
      }

      // Get products from same category
      const { data, error } = await supabase
        .from('products')
        .select('*, categories(name, slug)')
        .eq('is_active', true)
        .eq('category_id', product.category_id)
        .neq('id', productId)
        .limit(limit);

      if (error) {
        return { products: [], error: 'Errore nel caricamento' };
      }

      return { products: data || [], error: null };
    } catch (err) {
      console.error('Related products error:', err);
      return { products: [], error: 'Errore nel caricamento' };
    }
  }

  /**
   * Get all discounted products (products with sale_price)
   * Used for the Promotions page
   * 
   * @returns {Promise<{products: Array, error: string|null}>}
   */
  async getDiscountedProducts() {
    if (!isSupabaseConfigured()) {
      return { products: [], error: 'Sistema non configurato' };
    }

    try {
      const { data, error } = await supabase
        .from('products')
        .select('*, categories(name, slug)')
        .eq('is_active', true)
        .not('sale_price', 'is', null)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching discounted products:', error);
        return { products: [], error: 'Errore nel caricamento dei prodotti scontati' };
      }

      // Filter client-side to ensure sale_price < price
      const discountedProducts = (data || []).filter(p => p.sale_price && p.sale_price < p.price);

      return { products: discountedProducts, error: null };
    } catch (err) {
      console.error('Discounted products fetch error:', err);
      return { products: [], error: 'Errore nel caricamento dei prodotti scontati' };
    }
  }

  /**
   * Get price range for filters
   * 
   * @param {Object} filters - Current filters (excluding price)
   * @returns {Promise<{min: number, max: number, error: string|null}>}
   */
  async getPriceRange(filters = {}) {
    if (!isSupabaseConfigured()) {
      return { min: 0, max: 0, error: 'Sistema non configurato' };
    }

    try {
      let query = supabase
        .from('products')
        .select('price')
        .eq('is_active', true);

      if (filters.category_id) {
        query = query.eq('category_id', filters.category_id);
      }

      // Type filter (frutta/verdura/altro)
      if (filters.gender) {
        query = query.eq('gender', filters.gender);
      }

      const { data, error } = await query;

      if (error || !data || data.length === 0) {
        return { min: 0, max: 100, error: null };
      }

      const prices = data.map(p => p.price);
      return {
        min: Math.floor(Math.min(...prices)),
        max: Math.ceil(Math.max(...prices)),
        error: null
      };
    } catch (err) {
      console.error('Price range error:', err);
      return { min: 0, max: 1000, error: null };
    }
  }

  // ============================================
  // Cache Methods
  // ============================================

  _getFromCache(key) {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }
    return null;
  }

  _setCache(key, data) {
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  clearCache() {
    this.cache.clear();
  }
}

// Export singleton instance
export const productService = new ProductService();
export default productService;
