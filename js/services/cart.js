/**
 * Cart Service
 * Avenue M. E-commerce Platform
 * 
 * Hybrid cart system: localStorage for guests, Supabase for authenticated users
 */

import { supabase, isSupabaseConfigured, getCurrentUser } from '../supabase.js';

const LOCAL_STORAGE_KEY = 'avenue_cart';

class CartService {
  constructor() {
    this.listeners = [];
  }

  // ============================================
  // Guest Operations (localStorage)
  // ============================================

  getLocalCart() {
    try {
      const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  }

  _saveLocalCart(cart) {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(cart));
    this._notifyListeners();
  }

  addToLocalCart(item) {
    const cart = this.getLocalCart();
    const existingIndex = cart.findIndex(i => 
      i.productId === item.productId && 
      i.size === item.size && 
      i.color === item.color &&
      i.weight_grams === item.weight_grams
    );

    if (existingIndex > -1) {
      cart[existingIndex].quantity = Math.min(10, cart[existingIndex].quantity + (item.quantity || 1));
    } else {
      cart.push({
        productId: item.productId,
        name: item.name,
        price: item.price,
        unitPrice: item.unitPrice || item.price, // Price per unit (kg/pz)
        image: item.image,
        size: item.size,
        color: item.color,
        quantity: item.quantity || 1,
        weight_grams: item.weight_grams || null
      });
    }

    this._saveLocalCart(cart);
    return { success: true };
  }

  updateLocalCartItem(productId, size, color, quantity, weight_grams = null) {
    const cart = this.getLocalCart();
    const index = cart.findIndex(i => 
      i.productId === productId && 
      i.size === size && 
      i.color === color &&
      i.weight_grams === weight_grams
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

  removeFromLocalCart(productId, size, color, weight_grams = null) {
    const cart = this.getLocalCart();
    const filtered = cart.filter(i => 
      !(i.productId === productId && 
        i.size === size && 
        i.color === color &&
        i.weight_grams === weight_grams)
    );
    this._saveLocalCart(filtered);
    return { success: true };
  }

  clearLocalCart() {
    localStorage.removeItem(LOCAL_STORAGE_KEY);
    this._notifyListeners();
  }

  getLocalCartCount() {
    return this.getLocalCart().reduce((sum, item) => sum + item.quantity, 0);
  }

  getLocalCartTotal() {
    return this.getLocalCart().reduce((sum, item) => sum + (item.price * item.quantity), 0);
  }

  // ============================================
  // Authenticated Operations (Supabase)
  // ============================================

  async getCart(userId) {
    if (!isSupabaseConfigured()) {
      return { items: [], error: 'Sistema non configurato' };
    }

    try {
      const { data, error } = await supabase
        .from('cart_items')
        .select('*, products(*)')
        .eq('user_id', userId);

      if (error) {
        return { items: [], error: 'Errore nel caricamento del carrello' };
      }

      return { items: data || [], error: null };
    } catch (err) {
      console.error('Get cart error:', err);
      return { items: [], error: 'Errore nel caricamento del carrello' };
    }
  }

  async addToCart(userId, item) {
    if (!isSupabaseConfigured()) {
      return { success: false, error: 'Sistema non configurato' };
    }

    try {
      // Upsert atomico lato DB (elimina la race select+insert/update)
      const { data, error } = await supabase.rpc('add_to_cart_item', {
        p_product_id: item.productId,
        p_size: item.size || '',
        p_color: item.color || 'Fresco',
        p_quantity: Math.min(10, item.quantity || 1),
        p_weight_grams: item.weight_grams || null
      });

      if (error) {
        console.error('Add to cart DB error:', error);
        return { success: false, error: 'Errore nell\'aggiunta al carrello' };
      }

      if (data && data.success === false) {
        return { success: false, error: data.error || 'Errore nell\'aggiunta al carrello' };
      }

      this._notifyListeners();
      return { success: true, error: null };
    } catch (err) {
      console.error('Add to cart error:', err);
      return { success: false, error: 'Errore nell\'aggiunta al carrello' };
    }
  }

  async removeFromCart(userId, productId, size, color, weight_grams = null) {
    if (!isSupabaseConfigured()) {
      return { success: false, error: 'Sistema non configurato' };
    }

    try {
      let query = supabase
        .from('cart_items')
        .delete()
        .eq('user_id', userId)
        .eq('product_id', productId)
        .eq('size', size)
        .eq('color', color);
      
      if (weight_grams !== null) {
        query = query.eq('weight_grams', weight_grams);
      } else {
        query = query.is('weight_grams', null);
      }

      const { error } = await query;

      if (error) {
        return { success: false, error: 'Errore nella rimozione dal carrello' };
      }

      this._notifyListeners();
      return { success: true, error: null };
    } catch (err) {
      console.error('Remove from cart error:', err);
      return { success: false, error: 'Errore nella rimozione dal carrello' };
    }
  }

  // ============================================
  // Unified API
  // ============================================

  /**
   * Verifica la disponibilità a magazzino di un item.
   * Ritorna { available: true } se lo stock non è tracciato per il prodotto.
   */
  async checkStock(item) {
    if (!isSupabaseConfigured()) return { available: true };

    try {
      const requestedQty = item.quantity || 1;

      if (item.weight_grams) {
        // Prodotto a peso: controlla weight_inventory
        const { data } = await supabase
          .from('weight_inventory')
          .select('quantity')
          .eq('product_id', item.productId)
          .eq('weight_grams', item.weight_grams)
          .maybeSingle();

        if (data && data.quantity < requestedQty) {
          return {
            available: false,
            error: data.quantity <= 0
              ? 'Prodotto esaurito per questo peso'
              : `Disponibilità limitata: solo ${data.quantity} pezzi rimasti`
          };
        }
      } else {
        // Prodotto a pezzi: controlla num_items (se tracciato)
        const { data } = await supabase
          .from('products')
          .select('num_items, is_active')
          .eq('id', item.productId)
          .maybeSingle();

        if (data && data.is_active === false) {
          return { available: false, error: 'Prodotto non più disponibile' };
        }
        if (data && data.num_items !== null && data.num_items < requestedQty) {
          return {
            available: false,
            error: data.num_items <= 0
              ? 'Prodotto esaurito'
              : `Disponibilità limitata: solo ${data.num_items} pezzi rimasti`
          };
        }
      }

      return { available: true };
    } catch (err) {
      // In caso di errore di rete non bloccare l'aggiunta: il server ricontrolla al checkout
      console.warn('Stock check failed, allowing add:', err);
      return { available: true };
    }
  }

  async addItem(item) {
    const stock = await this.checkStock(item);
    if (!stock.available) {
      return { success: false, error: stock.error };
    }

    const user = await getCurrentUser();
    if (user) {
      return await this.addToCart(user.id, item);
    } else {
      return this.addToLocalCart(item);
    }
  }

  async removeItem(productId, size, color, weight_grams = null) {
    const user = await getCurrentUser();
    if (user) {
      return await this.removeFromCart(user.id, productId, size, color, weight_grams);
    } else {
      return this.removeFromLocalCart(productId, size, color, weight_grams);
    }
  }

  async updateQuantity(productId, size, color, quantity, weight_grams = null) {
    const user = await getCurrentUser();
    if (user) {
      if (quantity <= 0) {
        return await this.removeFromCart(user.id, productId, size, color, weight_grams);
      }
      return await this.setCartItemQuantity(user.id, productId, size, color, quantity, weight_grams);
    } else {
      return this.updateLocalCartItem(productId, size, color, quantity, weight_grams);
    }
  }
  
  async setCartItemQuantity(userId, productId, size, color, quantity, weight_grams = null) {
    if (!isSupabaseConfigured()) {
      return { success: false, error: 'Sistema non configurato' };
    }

    try {
      // Build query to find existing item
      let query = supabase
        .from('cart_items')
        .select('id')
        .eq('user_id', userId)
        .eq('product_id', productId)
        .eq('size', size)
        .eq('color', color);
      
      // Handle NULL weight_grams properly
      if (weight_grams === null) {
        query = query.is('weight_grams', null);
      } else {
        query = query.eq('weight_grams', weight_grams);
      }
      
      const { data: existing } = await query.maybeSingle();
      
      if (existing) {
        const { error } = await supabase
          .from('cart_items')
          .update({ quantity })
          .eq('id', existing.id);
        
        if (error) {
          console.error('Update cart quantity error:', error);
          return { success: false, error: 'Errore nell\'aggiornamento' };
        }
      }

      this._notifyListeners();
      return { success: true, error: null };
    } catch (err) {
      console.error('Set cart quantity error:', err);
      return { success: false, error: 'Errore nell\'aggiornamento' };
    }
  }

  async getAllItems() {
    const user = await getCurrentUser();
    if (user) {
      const { items } = await this.getCart(user.id);
      return items
        .filter(item => item.products?.is_active !== false)
        .map(item => {
        // Calculate price based on weight if applicable
        const basePrice = item.products?.sale_price || item.products?.price || 0;
        const weightGrams = item.weight_grams;
        const price = weightGrams ? (basePrice * weightGrams) / 1000 : basePrice;
        
        return {
          productId: item.product_id,
          name: item.products?.name || 'Prodotto',
          price: price,
          unitPrice: basePrice,
          image: item.products?.images?.[0] || '',
          size: item.size,
          color: item.color,
          quantity: item.quantity,
          weight_grams: weightGrams
        };
      });
    } else {
      return this.getLocalCart();
    }
  }

  async getCount() {
    const items = await this.getAllItems();
    return items.reduce((sum, item) => sum + item.quantity, 0);
  }

  async getTotal() {
    const items = await this.getAllItems();
    return items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  }

  async clearCart() {
    const user = await getCurrentUser();
    if (user) {
      await supabase.from('cart_items').delete().eq('user_id', user.id);
    }
    this.clearLocalCart();
  }

  async mergeCartsOnLogin(userId) {
    const localItems = this.getLocalCart();
    if (localItems.length === 0) return;

    for (const item of localItems) {
      await this.addToCart(userId, item);
    }
    this.clearLocalCart();
    this._notifyListeners();
  }

  // ============================================
  // Event Listeners
  // ============================================

  onChange(callback) {
    this.listeners.push(callback);
    return () => {
      const index = this.listeners.indexOf(callback);
      if (index > -1) this.listeners.splice(index, 1);
    };
  }

  _notifyListeners() {
    this.listeners.forEach(callback => callback());
  }
}

export const cartService = new CartService();
export default cartService;
