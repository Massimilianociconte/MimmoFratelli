/**
 * Payment Gateway Service
 * Avenue M. E-commerce Platform
 * 
 * Handles Stripe, PayPal, and Klarna payment integrations
 */

import { supabase, isSupabaseConfigured, getCurrentUser } from '../supabase.js';

const config = window.AVENUE_CONFIG || {};

class PaymentService {
  constructor() {
    this.stripePromise = null;
  }

  /**
   * Get the correct URL for a page, handling both localhost and GitHub Pages
   * @param {string} page - The page filename (e.g., 'checkout-success.html')
   * @returns {string} The full URL to the page
   */
  _getPageUrl(page) {
    const { origin, pathname } = window.location;
    
    // Check if we're on GitHub Pages (pathname contains repo name)
    // GitHub Pages URLs look like: https://username.github.io/RepoName/page.html
    // Local URLs look like: http://localhost:5500/page.html
    
    // Get the base path by finding the directory of the current page
    const pathParts = pathname.split('/').filter(Boolean);
    
    // If on GitHub Pages, the first part is usually the repo name
    // We need to preserve it in the URL
    if (origin.includes('github.io') && pathParts.length > 0) {
      // Keep the repo name (first path segment)
      const repoName = pathParts[0];
      return `${origin}/${repoName}/${page}`;
    }
    
    // For local development or custom domains, just use origin
    return `${origin}/${page}`;
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
          cancelUrl: this._getPageUrl('checkout.html'),
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
   * Create PayPal order
   */
  async createPayPalOrder(cartItems, options = {}) {
    const user = await getCurrentUser();
    if (!user) {
      return { error: 'Devi effettuare il login per procedere al pagamento' };
    }

    if (!isSupabaseConfigured()) {
      return { error: 'Sistema non configurato' };
    }

    try {
      const { data, error } = await supabase.functions.invoke('create-paypal-order', {
        body: {
          items: cartItems,
          giftCardCode: options.giftCardCode,
          promotionCode: options.promotionCode
        }
      });

      if (error) {
        return { error: 'Errore nella creazione dell\'ordine PayPal' };
      }

      return { orderId: data.orderId, approvalUrl: data.approvalUrl };
    } catch (err) {
      console.error('Create PayPal order error:', err);
      return { error: 'Errore nella creazione dell\'ordine PayPal' };
    }
  }

  /**
   * Capture PayPal order after approval
   */
  async capturePayPalOrder(orderId) {
    try {
      const { data, error } = await supabase.functions.invoke('capture-paypal-order', {
        body: { orderId }
      });

      if (error) {
        return { error: 'Errore nella conferma del pagamento PayPal' };
      }

      return { success: true, order: data.order };
    } catch (err) {
      console.error('Capture PayPal order error:', err);
      return { error: 'Errore nella conferma del pagamento PayPal' };
    }
  }

  /**
   * Create Klarna session for installment payments
   */
  async createKlarnaSession(cartItems, options = {}) {
    const user = await getCurrentUser();
    if (!user) {
      return { error: 'Devi effettuare il login per procedere al pagamento' };
    }

    if (!isSupabaseConfigured()) {
      return { error: 'Sistema non configurato' };
    }

    try {
      const { data, error } = await supabase.functions.invoke('create-klarna-session', {
        body: {
          items: cartItems,
          locale: config.LOCALE || 'it-IT',
          giftCardCode: options.giftCardCode,
          promotionCode: options.promotionCode
        }
      });

      if (error) {
        return { error: 'Errore nella creazione della sessione Klarna' };
      }

      return { 
        sessionId: data.sessionId, 
        clientToken: data.clientToken,
        paymentMethods: data.paymentMethods 
      };
    } catch (err) {
      console.error('Create Klarna session error:', err);
      return { error: 'Errore nella creazione della sessione Klarna' };
    }
  }

  /**
   * Calculate order total with discounts
   */
  calculateTotal(cartItems, discount = 0, giftCardBalance = 0) {
    const subtotal = cartItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const shipping = subtotal >= (config.FREE_SHIPPING_THRESHOLD || 150) ? 0 : (config.STANDARD_SHIPPING_COST || 9.90);
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

  /**
   * Verify payment status
   */
  async verifyPayment(sessionId, provider = 'stripe') {
    try {
      const { data, error } = await supabase.functions.invoke('verify-payment', {
        body: { sessionId, provider }
      });

      if (error) {
        return { verified: false, error: 'Errore nella verifica del pagamento' };
      }

      return { verified: data.verified, order: data.order };
    } catch (err) {
      console.error('Verify payment error:', err);
      return { verified: false, error: 'Errore nella verifica del pagamento' };
    }
  }
}

export const paymentService = new PaymentService();
export default paymentService;
