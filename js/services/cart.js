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
      i.color === item.color
    );

    if (existingIndex > -1) {
      cart[existingIndex].quantity = Math.min(10, cart[existingIndex].quantity + (item.quantity || 1));
    } else {
      cart.push({
        productId: item.productId,
        name: item.name,
        price: item.price,
        image: item.image,
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
      const { error } = await supabase
        .from('cart_items')
        .upsert({
          user_id: userId,
          product_id: item.productId,
          size: item.size,
          color: item.color,
          quantity: item.quantity || 1
        }, {
          onConflict: 'user_id,product_id,size,color'
        });

      if (error) {
        return { success: false, error: 'Errore nell\'aggiunta al carrello' };
      }

      this._notifyListeners();
      return { success: true, error: null };
    } catch (err) {
      console.error('Add to cart error:', err);
      return { success: false, error: 'Errore nell\'aggiunta al carrello' };
    }
  }

  async removeFromCart(userId, productId, size, color) {
    if (!isSupabaseConfigured()) {
      return { success: false, error: 'Sistema non configurato' };
    }

    try {
      const { error } = await supabase
        .from('cart_items')
        .delete()
        .eq('user_id', userId)
        .eq('product_id', productId)
        .eq('size', size)
        .eq('color', color);

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

  async addItem(item) {
    const user = await getCurrentUser();
    if (user) {
      return await this.addToCart(user.id, item);
    } else {
      return this.addToLocalCart(item);
    }
  }

  async removeItem(productId, size, color) {
    const user = await getCurrentUser();
    if (user) {
      return await this.removeFromCart(user.id, productId, size, color);
    } else {
      return this.removeFromLocalCart(productId, size, color);
    }
  }

  async updateQuantity(productId, size, color, quantity) {
    const user = await getCurrentUser();
    if (user) {
      if (quantity <= 0) {
        return await this.removeFromCart(user.id, productId, size, color);
      }
      return await this.addToCart(user.id, { productId, size, color, quantity });
    } else {
      return this.updateLocalCartItem(productId, size, color, quantity);
    }
  }

  async getAllItems() {
    const user = await getCurrentUser();
    if (user) {
      const { items } = await this.getCart(user.id);
      return items.map(item => ({
        productId: item.product_id,
        name: item.products?.name || 'Prodotto',
        price: item.products?.price || 0,
        image: item.products?.images?.[0] || '',
        size: item.size,
        color: item.color,
        quantity: item.quantity
      }));
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
