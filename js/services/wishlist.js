/**
 * Wishlist Service
 * Avenue M. E-commerce Platform
 * 
 * Hybrid wishlist system: localStorage for guests, Supabase for authenticated users
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6
 */

import { supabase, isSupabaseConfigured, getCurrentUser } from '../supabase.js';

const LOCAL_STORAGE_KEY = 'avenue_wishlist';

/**
 * Wishlist Service Class
 */
class WishlistService {
  constructor() {
    this.listeners = [];
  }

  // ============================================
  // Guest Operations (localStorage)
  // Requirement: 2.1
  // ============================================

  /**
   * Get wishlist from localStorage (for guests)
   * @returns {string[]} Array of product IDs
   */
  getLocalWishlist() {
    try {
      const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  }

  /**
   * Add product to localStorage wishlist
   * Requirement: 2.1
   * @param {string} productId - Product ID to add
   */
  addToLocalWishlist(productId) {
    const wishlist = this.getLocalWishlist();
    if (!wishlist.includes(productId)) {
      wishlist.push(productId);
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(wishlist));
      this._notifyListeners();
    }
  }

  /**
   * Remove product from localStorage wishlist
   * @param {string} productId - Product ID to remove
   */
  removeFromLocalWishlist(productId) {
    const wishlist = this.getLocalWishlist();
    const index = wishlist.indexOf(productId);
    if (index > -1) {
      wishlist.splice(index, 1);
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(wishlist));
      this._notifyListeners();
    }
  }

  /**
   * Check if product is in localStorage wishlist
   * @param {string} productId - Product ID to check
   * @returns {boolean}
   */
  isInLocalWishlist(productId) {
    return this.getLocalWishlist().includes(productId);
  }

  /**
   * Clear localStorage wishlist
   */
  clearLocalWishlist() {
    localStorage.removeItem(LOCAL_STORAGE_KEY);
    this._notifyListeners();
  }

  // ============================================
  // Authenticated Operations (Supabase)
  // Requirement: 2.2
  // ============================================

  /**
   * Get wishlist from Supabase (for authenticated users)
   * Requirement: 2.2
   * @param {string} userId - User ID
   * @returns {Promise<{items: Array, error: string|null}>}
   */
  async getWishlist(userId) {
    if (!isSupabaseConfigured()) {
      return { items: [], error: 'Sistema non configurato' };
    }

    try {
      const { data, error } = await supabase
        .from('wishlist_items')
        .select('*, products(*)')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (error) {
        return { items: [], error: 'Errore nel caricamento dei preferiti' };
      }

      return { items: data || [], error: null };
    } catch (err) {
      console.error('Get wishlist error:', err);
      return { items: [], error: 'Errore nel caricamento dei preferiti' };
    }
  }

  /**
   * Add product to Supabase wishlist
   * Requirement: 2.2
   * @param {string} userId - User ID
   * @param {string} productId - Product ID
   * @returns {Promise<{success: boolean, error: string|null}>}
   */
  async addToWishlist(userId, productId) {
    if (!isSupabaseConfigured()) {
      return { success: false, error: 'Sistema non configurato' };
    }

    try {
      const { error } = await supabase
        .from('wishlist_items')
        .upsert({ user_id: userId, product_id: productId }, {
          onConflict: 'user_id,product_id'
        });

      if (error) {
        return { success: false, error: 'Errore nell\'aggiunta ai preferiti' };
      }

      this._notifyListeners();
      return { success: true, error: null };
    } catch (err) {
      console.error('Add to wishlist error:', err);
      return { success: false, error: 'Errore nell\'aggiunta ai preferiti' };
    }
  }

  /**
   * Remove product from Supabase wishlist
   * Requirement: 2.5
   * @param {string} userId - User ID
   * @param {string} productId - Product ID
   * @returns {Promise<{success: boolean, error: string|null}>}
   */
  async removeFromWishlist(userId, productId) {
    if (!isSupabaseConfigured()) {
      return { success: false, error: 'Sistema non configurato' };
    }

    try {
      const { error } = await supabase
        .from('wishlist_items')
        .delete()
        .eq('user_id', userId)
        .eq('product_id', productId);

      if (error) {
        return { success: false, error: 'Errore nella rimozione dai preferiti' };
      }

      this._notifyListeners();
      return { success: true, error: null };
    } catch (err) {
      console.error('Remove from wishlist error:', err);
      return { success: false, error: 'Errore nella rimozione dai preferiti' };
    }
  }

  /**
   * Check if product is in Supabase wishlist
   * @param {string} userId - User ID
   * @param {string} productId - Product ID
   * @returns {Promise<boolean>}
   */
  async isInWishlist(userId, productId) {
    if (!isSupabaseConfigured()) {
      return false;
    }

    try {
      const { data, error } = await supabase
        .from('wishlist_items')
        .select('id')
        .eq('user_id', userId)
        .eq('product_id', productId)
        .maybeSingle();

      // maybeSingle returns null if no row found, without error
      return data !== null;
    } catch {
      return false;
    }
  }

  // ============================================
  // Sync Operations
  // Requirements: 2.3, 2.4, 2.6
  // ============================================

  /**
   * Migrate localStorage wishlist to Supabase after registration
   * Requirement: 2.3
   * @param {string} userId - New user ID
   * @returns {Promise<{success: boolean, error: string|null}>}
   */
  async migrateLocalToSupabase(userId) {
    if (!isSupabaseConfigured()) {
      return { success: false, error: 'Sistema non configurato' };
    }

    const localItems = this.getLocalWishlist();
    
    if (localItems.length === 0) {
      return { success: true, error: null };
    }

    try {
      // Insert all local items to Supabase
      const insertData = localItems.map(productId => ({
        user_id: userId,
        product_id: productId
      }));

      const { error } = await supabase
        .from('wishlist_items')
        .upsert(insertData, {
          onConflict: 'user_id,product_id',
          ignoreDuplicates: true
        });

      if (error) {
        console.error('Migration error:', error);
        return { success: false, error: 'Errore nella migrazione dei preferiti' };
      }

      // Clear localStorage after successful migration
      this.clearLocalWishlist();

      return { success: true, error: null };
    } catch (err) {
      console.error('Migrate wishlist error:', err);
      return { success: false, error: 'Errore nella migrazione dei preferiti' };
    }
  }

  /**
   * Merge localStorage wishlist with Supabase wishlist on login
   * Requirements: 2.4, 2.6
   * Performs union of both lists, avoiding duplicates
   * @param {string} userId - User ID
   * @returns {Promise<{success: boolean, mergedCount: number, error: string|null}>}
   */
  async mergeWishlists(userId) {
    if (!isSupabaseConfigured()) {
      return { success: false, mergedCount: 0, error: 'Sistema non configurato' };
    }

    const localItems = this.getLocalWishlist();
    
    if (localItems.length === 0) {
      return { success: true, mergedCount: 0, error: null };
    }

    try {
      // Get existing Supabase wishlist
      const { items: existingItems } = await this.getWishlist(userId);
      const existingProductIds = new Set(existingItems.map(item => item.product_id));

      // Find items to add (union without duplicates - Requirement 2.6)
      const newItems = localItems.filter(productId => !existingProductIds.has(productId));

      if (newItems.length > 0) {
        const insertData = newItems.map(productId => ({
          user_id: userId,
          product_id: productId
        }));

        const { error } = await supabase
          .from('wishlist_items')
          .insert(insertData);

        if (error) {
          console.error('Merge error:', error);
          return { success: false, mergedCount: 0, error: 'Errore nella sincronizzazione dei preferiti' };
        }
      }

      // Clear localStorage after successful merge
      this.clearLocalWishlist();

      this._notifyListeners();
      return { success: true, mergedCount: newItems.length, error: null };
    } catch (err) {
      console.error('Merge wishlists error:', err);
      return { success: false, mergedCount: 0, error: 'Errore nella sincronizzazione dei preferiti' };
    }
  }

  // ============================================
  // Unified API (auto-detects auth state)
  // ============================================

  /**
   * Toggle favorite status (works for both guest and authenticated)
   * @param {string} productId - Product ID
   * @returns {Promise<{isFavorite: boolean, error: string|null}>}
   */
  async toggleFavorite(productId) {
    const user = await getCurrentUser();

    if (user) {
      // Authenticated user - use Supabase
      const isCurrentlyFavorite = await this.isInWishlist(user.id, productId);
      
      if (isCurrentlyFavorite) {
        const { error } = await this.removeFromWishlist(user.id, productId);
        return { isFavorite: false, error };
      } else {
        const { error } = await this.addToWishlist(user.id, productId);
        return { isFavorite: true, error };
      }
    } else {
      // Guest user - use localStorage
      const isCurrentlyFavorite = this.isInLocalWishlist(productId);
      
      if (isCurrentlyFavorite) {
        this.removeFromLocalWishlist(productId);
        return { isFavorite: false, error: null };
      } else {
        this.addToLocalWishlist(productId);
        return { isFavorite: true, error: null };
      }
    }
  }

  /**
   * Check if product is favorite (works for both guest and authenticated)
   * @param {string} productId - Product ID
   * @returns {boolean} - For sync check (localStorage only)
   */
  isFavorite(productId) {
    // Sync check - only localStorage
    // For async check with Supabase, use isFavoriteAsync
    return this.isInLocalWishlist(productId);
  }

  /**
   * Check if product is favorite (async, checks Supabase if authenticated)
   * @param {string} productId - Product ID
   * @returns {Promise<boolean>}
   */
  async isFavoriteAsync(productId) {
    const user = await getCurrentUser();
    
    if (user) {
      return await this.isInWishlist(user.id, productId);
    } else {
      return this.isInLocalWishlist(productId);
    }
  }

  /**
   * Get all favorites (works for both guest and authenticated)
   * @returns {Promise<{items: Array, error: string|null}>}
   */
  async getAllFavorites() {
    const user = await getCurrentUser();
    
    if (user) {
      return await this.getWishlist(user.id);
    } else {
      // Return local items as simple objects
      const productIds = this.getLocalWishlist();
      return {
        items: productIds.map(id => ({ product_id: id })),
        error: null
      };
    }
  }

  // ============================================
  // Event Listeners
  // ============================================

  /**
   * Subscribe to wishlist changes
   * @param {Function} callback - Callback function
   * @returns {Function} Unsubscribe function
   */
  onChange(callback) {
    this.listeners.push(callback);
    return () => {
      const index = this.listeners.indexOf(callback);
      if (index > -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  _notifyListeners() {
    this.listeners.forEach(callback => callback());
  }
}

// Export singleton instance
export const wishlistService = new WishlistService();
export default wishlistService;
