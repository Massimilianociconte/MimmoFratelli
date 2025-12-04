/**
 * Promotions Service
 * Avenue M. E-commerce Platform
 * 
 * Handles promotional campaigns and discount calculations
 */

import { supabase, isSupabaseConfigured } from '../supabase.js';

class PromotionService {
  /**
   * Get all active promotions
   */
  async getActivePromotions() {
    if (!isSupabaseConfigured()) {
      return { promotions: [], error: 'Sistema non configurato' };
    }

    try {
      const now = new Date().toISOString();
      
      const { data, error } = await supabase
        .from('promotions')
        .select('*')
        .eq('is_active', true)
        .lte('starts_at', now)
        .gte('ends_at', now)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Promotions query error:', error);
        return { promotions: [], error: 'Errore nel caricamento delle promozioni' };
      }

      return { promotions: data || [], error: null };
    } catch (err) {
      console.error('Get active promotions error:', err);
      return { promotions: [], error: 'Errore nel caricamento delle promozioni' };
    }
  }

  /**
   * Get promotion by code
   */
  async getPromotionByCode(code) {
    if (!isSupabaseConfigured()) {
      return { promotion: null, error: 'Sistema non configurato' };
    }

    if (!code || typeof code !== 'string') {
      return { promotion: null, error: 'Codice non valido' };
    }

    try {
      const now = new Date().toISOString();
      
      const { data, error } = await supabase
        .from('promotions')
        .select('*')
        .eq('code', code.toUpperCase().trim())
        .eq('is_active', true)
        .lte('starts_at', now)
        .gte('ends_at', now)
        .single();

      if (error || !data) {
        return { promotion: null, error: 'Codice promozionale non valido o scaduto' };
      }

      // Check usage limit
      if (data.usage_limit && data.usage_count >= data.usage_limit) {
        return { promotion: null, error: 'Codice promozionale esaurito' };
      }

      return { promotion: data, error: null };
    } catch (err) {
      console.error('Get promotion by code error:', err);
      return { promotion: null, error: 'Errore nella verifica del codice' };
    }
  }

  /**
   * Apply promotion to cart items
   */
  applyPromotion(cartItems, promotion) {
    if (!promotion || !cartItems?.length) {
      return { items: cartItems, discount: 0 };
    }

    let discount = 0;
    const applicableItems = this._getApplicableItems(cartItems, promotion);
    const applicableTotal = applicableItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);

    if (promotion.discount_type === 'percentage') {
      discount = (applicableTotal * promotion.discount_value) / 100;
    } else if (promotion.discount_type === 'fixed') {
      discount = Math.min(promotion.discount_value, applicableTotal);
    }

    // Apply minimum purchase requirement
    if (promotion.min_purchase && applicableTotal < promotion.min_purchase) {
      return { 
        items: cartItems, 
        discount: 0, 
        error: `Acquisto minimo di €${promotion.min_purchase.toFixed(2)} richiesto` 
      };
    }

    // Apply maximum discount cap
    if (promotion.max_discount && discount > promotion.max_discount) {
      discount = promotion.max_discount;
    }

    return { 
      items: cartItems, 
      discount: Math.round(discount * 100) / 100,
      promotion 
    };
  }

  /**
   * Calculate discount for cart
   */
  calculateDiscount(cartItems, promotion) {
    const { discount } = this.applyPromotion(cartItems, promotion);
    return discount;
  }

  /**
   * Get items applicable to promotion
   */
  _getApplicableItems(cartItems, promotion) {
    if (!promotion.applicable_categories?.length && !promotion.applicable_products?.length) {
      return cartItems; // Applies to all items
    }

    return cartItems.filter(item => {
      if (promotion.applicable_products?.includes(item.productId)) {
        return true;
      }
      if (promotion.applicable_categories?.includes(item.categoryId)) {
        return true;
      }
      return false;
    });
  }

  /**
   * Auto-apply best promotion to cart
   */
  async autoApplyBestPromotion(cartItems) {
    const { promotions } = await this.getActivePromotions();
    
    if (!promotions.length) {
      return { items: cartItems, discount: 0, promotion: null };
    }

    // Find promotion with highest discount
    let bestResult = { items: cartItems, discount: 0, promotion: null };

    for (const promo of promotions) {
      if (promo.auto_apply) {
        const result = this.applyPromotion(cartItems, promo);
        if (result.discount > bestResult.discount) {
          bestResult = result;
        }
      }
    }

    return bestResult;
  }

  /**
   * Increment promotion usage count
   */
  async incrementUsage(promotionId) {
    if (!isSupabaseConfigured()) return;

    try {
      await supabase.rpc('increment_promotion_usage', { promo_id: promotionId });
    } catch (err) {
      console.error('Increment promotion usage error:', err);
    }
  }

  /**
   * Format discount display
   */
  formatDiscount(promotion) {
    if (!promotion) return '';
    
    if (promotion.discount_type === 'percentage') {
      return `-${promotion.discount_value}%`;
    }
    return `-€${promotion.discount_value.toFixed(2)}`;
  }

  // ============================================
  // First Order Code Methods
  // Requirements: 1.3, 1.4, 1.5
  // ============================================

  /**
   * Get user's first-order discount code
   * Requirements: 1.3
   * @param {string} userId - User ID
   * @returns {Promise<{code: string, discount: number, expiresAt: Date} | null>}
   */
  async getFirstOrderCode(userId) {
    if (!isSupabaseConfigured() || !userId) {
      return null;
    }

    try {
      const now = new Date().toISOString();
      
      const { data, error } = await supabase
        .from('promotions')
        .select('*')
        .eq('user_id', userId)
        .eq('is_first_order_code', true)
        .eq('is_active', true)
        .lte('starts_at', now)
        .gte('ends_at', now)
        .eq('usage_count', 0)
        .maybeSingle();

      if (error || !data) {
        return null;
      }

      return {
        code: data.code,
        discount: data.discount_value,
        discountType: data.discount_type,
        expiresAt: new Date(data.ends_at),
        isReferralBonus: data.referral_bonus || false,
        promotionId: data.id
      };
    } catch (err) {
      console.error('Get first order code error:', err);
      return null;
    }
  }

  /**
   * Check if user has completed any orders
   * Requirements: 1.4
   * @param {string} userId - User ID
   * @returns {Promise<boolean>}
   */
  async hasCompletedOrder(userId) {
    if (!isSupabaseConfigured() || !userId) {
      return false;
    }

    try {
      const { count, error } = await supabase
        .from('orders')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('payment_status', 'completed');

      if (error) {
        console.error('Has completed order check error:', error);
        return false;
      }

      return (count || 0) > 0;
    } catch (err) {
      console.error('Has completed order error:', err);
      return false;
    }
  }

  /**
   * Validate first-order code for a user
   * Requirements: 1.4
   * @param {string} userId - User ID
   * @param {string} code - Promo code
   * @returns {Promise<{valid: boolean, error?: string, promotion?: Object}>}
   */
  async isFirstOrderCodeValid(userId, code) {
    if (!isSupabaseConfigured()) {
      return { valid: false, error: 'Sistema non configurato' };
    }

    if (!userId || !code) {
      return { valid: false, error: 'Parametri mancanti' };
    }

    try {
      // Get the promotion
      const { promotion, error: promoError } = await this.getPromotionByCode(code);
      
      if (promoError || !promotion) {
        return { valid: false, error: promoError || 'Codice non valido' };
      }

      // Check if it's a first-order code
      if (!promotion.is_first_order_code) {
        // It's a regular promo code, validate normally
        return { valid: true, promotion };
      }

      // Check if code belongs to this user
      if (promotion.user_id && promotion.user_id !== userId) {
        return { valid: false, error: 'Questo codice non è associato al tuo account' };
      }

      // Check if user has already completed an order
      const hasOrdered = await this.hasCompletedOrder(userId);
      if (hasOrdered) {
        return { valid: false, error: 'Codice valido solo per il primo ordine' };
      }

      // Check if already used
      if (promotion.usage_count >= (promotion.usage_limit || 1)) {
        return { valid: false, error: 'Codice già utilizzato' };
      }

      return { valid: true, promotion };
    } catch (err) {
      console.error('First order code validation error:', err);
      return { valid: false, error: 'Errore nella validazione del codice' };
    }
  }

  /**
   * Calculate discount excluding shipping
   * Requirements: 1.5
   * @param {Array} cartItems - Cart items
   * @param {number} discountPercent - Discount percentage
   * @param {number} shippingCost - Shipping cost (excluded from discount)
   * @returns {Object} Calculation result
   */
  calculateFirstOrderDiscount(cartItems, discountPercent, shippingCost = 0) {
    const subtotal = cartItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    
    // Discount applies ONLY to subtotal, not shipping
    const discount = Math.round((subtotal * discountPercent / 100) * 100) / 100;
    
    return {
      subtotal,
      discount,
      shipping: shippingCost,
      total: Math.round((subtotal - discount + shippingCost) * 100) / 100
    };
  }
}

export const promotionService = new PromotionService();
export default promotionService;
