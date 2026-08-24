/**
 * Payment Gateway Service
 * Avenue M. E-commerce Platform
 * 
 * Handles Stripe payment integration (Klarna available via Stripe Checkout)
 */

import { supabase, isSupabaseConfigured, getCurrentUser } from '../supabase.js';

const config = window.AVENUE_CONFIG || {};

class PaymentService {
  /**
   * Create Stripe Checkout session
   */
  async createStripeSession(cartItems, options = {}) {
    const user = await getCurrentUser();
    if (!user) {
      return { error: 'Devi effettuare il login per procedere al pagamento' };
    }

    if (!isSupabaseConfigured()) {
      return { error: 'Sistema non configurato' };
    }

    try {
      const { data, error } = await supabase.functions.invoke('create-checkout-session', {
        body: {
          items: cartItems.map(item => ({
            productId: item.productId,
            name: item.name,
            price: item.price,
            unitPrice: item.unitPrice || item.price, // Price per unit (kg/pz)
            quantity: item.quantity,
            size: item.size,
            color: item.color,
            image: item.image,
            weight_grams: item.weight_grams || null
          })),
          promotionCode: options.promotionCode,
          shippingAddress: options.shippingAddress,
          userCredit: options.creditToUse || 0
        }
      });

      if (error) {
        console.error('Stripe session error:', error);
        // 401/JWT expired: the session died between page load and payment.
        // Signal it so the UI can prompt a re-login instead of a dead-end alert
        if (error.status === 401 || error.message?.includes('JWT')) {
          return { error: 'Sessione scaduta. Accedi di nuovo per completare il pagamento.', authRequired: true };
        }
        return { error: error.message || 'Errore nella creazione della sessione di pagamento' };
      }

      if (!data) {
        return { error: 'Nessuna risposta dal server' };
      }

      return { sessionId: data.sessionId, url: data.url };
    } catch (err) {
      console.error('Create Stripe session error:', err);
      return { error: 'Errore nella creazione della sessione di pagamento' };
    }
  }

  /**
   * Redirect to Stripe Checkout
   */
  async redirectToStripeCheckout(cartItems, options = {}) {
    try {
      const { sessionId, url, error } = await this.createStripeSession(cartItems, options);
      
      if (error) return { error };

      if (url) {
        window.location.href = url;
        return { success: true };
      }

      return {
        error: sessionId
          ? 'URL del pagamento non disponibile'
          : 'Sessione di pagamento non disponibile'
      };
    } catch (err) {
      console.error('Redirect to checkout error:', err);
      return { error: 'Errore nel reindirizzamento al pagamento' };
    }
  }

  /**
   * Calculate order total with discounts
   */
  calculateTotal(cartItems, discount = 0, giftCardBalance = 0) {
    const subtotal = cartItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const shipping = subtotal >= (config.FREE_SHIPPING_THRESHOLD || 50) ? 0 : (config.STANDARD_SHIPPING_COST || 2.90);
    const discountAmount = typeof discount === 'number' ? discount : 0;
    const giftCardAmount = Math.min(
      giftCardBalance,
      Math.max(0, subtotal - discountAmount)
    );
    const total = Math.max(0, subtotal - discountAmount + shipping - giftCardAmount);

    return {
      subtotal,
      shipping,
      discount: discountAmount,
      giftCardApplied: giftCardAmount,
      total
    };
  }

}

export const paymentService = new PaymentService();
export default paymentService;
