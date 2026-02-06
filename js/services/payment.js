/**
 * Payment Gateway Service
 * Avenue M. E-commerce Platform
 * 
 * Handles Stripe payment integration (Klarna available via Stripe Checkout)
 */

import { supabase, isSupabaseConfigured, getCurrentUser } from '../supabase.js';

const config = window.AVENUE_CONFIG || {};

class PaymentService {
  constructor() {
    this.stripePromise = null;
  }

  /**
   * Get the correct URL for a page
   * @param {string} page - The page filename (e.g., 'checkout-success.html')
   * @returns {string} The full URL to the page
   */
  _getPageUrl(page) {
    // Use the official domain for production
    const baseUrl = 'https://www.mimmofratelli.com';
    
    // If running locally, use origin
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      return `${window.location.origin}/${page}`;
    }
    
    return `${baseUrl}/${page}`;
  }

  /**
   * Load Stripe.js dynamically
   */
  async loadStripe() {
    if (this.stripePromise) return this.stripePromise;
    
    if (!config.STRIPE_PUBLISHABLE_KEY) {
      throw new Error('Stripe non configurato');
    }

    return new Promise((resolve, reject) => {
      if (window.Stripe) {
        this.stripePromise = window.Stripe(config.STRIPE_PUBLISHABLE_KEY);
        resolve(this.stripePromise);
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://js.stripe.com/v3/';
      script.onload = () => {
        this.stripePromise = window.Stripe(config.STRIPE_PUBLISHABLE_KEY);
        resolve(this.stripePromise);
      };
      script.onerror = () => reject(new Error('Impossibile caricare Stripe'));
      document.head.appendChild(script);
    });
  }

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
          successUrl: this._getPageUrl('checkout-success.html'),
          cancelUrl: this._getPageUrl('checkout-cancel.html'),
          customerEmail: user.email,
          promotionCode: options.promotionCode,
          shippingAddress: options.shippingAddress,
          userCredit: options.creditToUse || 0
        }
      });

      if (error) {
        console.error('Stripe session error:', error);
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

      const stripe = await this.loadStripe();
      const { error: redirectError } = await stripe.redirectToCheckout({ sessionId });
      
      if (redirectError) {
        return { error: redirectError.message };
      }

      return { success: true };
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
    const giftCardAmount = Math.min(giftCardBalance, subtotal - discountAmount + shipping);
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
