/**
 * Order Service
 * Avenue M. E-commerce Platform
 * 
 * Handles order creation, history, and tracking
 */

import { supabase, isSupabaseConfigured, getCurrentUser } from '../supabase.js';

class OrderService {
  /**
   * Create order from payment result
   */
  async createOrder(paymentResult, cartItems, shippingAddress) {
    const user = await getCurrentUser();
    if (!user) {
      return { error: 'Utente non autenticato' };
    }

    if (!isSupabaseConfigured()) {
      return { error: 'Sistema non configurato' };
    }

    try {
      const subtotal = cartItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
      const shipping = paymentResult.shipping || 0;
      const discount = paymentResult.discount || 0;
      const total = subtotal + shipping - discount;

      const { data: order, error: orderError } = await supabase
        .from('orders')
        .insert({
          user_id: user.id,
          status: 'pending',
          total_amount: total,
          shipping_address: shippingAddress,
          payment_method: paymentResult.provider,
          payment_id: paymentResult.paymentId,
          discount_amount: discount,
          shipping_cost: shipping
        })
        .select()
        .single();

      if (orderError) {
        console.error('Create order error:', orderError);
        return { error: 'Errore nella creazione dell\'ordine' };
      }

      // Create order items
      const orderItems = cartItems.map(item => ({
        order_id: order.id,
        product_id: item.productId,
        quantity: item.quantity,
        unit_price: item.price,
        size: item.size,
        color: item.color
      }));

      const { error: itemsError } = await supabase
        .from('order_items')
        .insert(orderItems);

      if (itemsError) {
        console.error('Create order items error:', itemsError);
      }

      return { order, error: null };
    } catch (err) {
      console.error('Create order error:', err);
      return { error: 'Errore nella creazione dell\'ordine' };
    }
  }

  /**
   * Get order history for current user
   */
  async getOrderHistory() {
    const user = await getCurrentUser();
    if (!user) {
      return { orders: [], error: 'Utente non autenticato' };
    }

    if (!isSupabaseConfigured()) {
      return { orders: [], error: 'Sistema non configurato' };
    }

    try {
      const { data, error } = await supabase
        .from('orders')
        .select(`
          *,
          order_items (
            *,
            products (name, images)
          )
        `)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) {
        return { orders: [], error: 'Errore nel caricamento degli ordini' };
      }

      return { orders: data || [], error: null };
    } catch (err) {
      console.error('Get order history error:', err);
      return { orders: [], error: 'Errore nel caricamento degli ordini' };
    }
  }

  /**
   * Get single order by ID
   */
  async getOrderById(orderId) {
    const user = await getCurrentUser();
    if (!user) {
      return { order: null, error: 'Utente non autenticato' };
    }

    if (!isSupabaseConfigured()) {
      return { order: null, error: 'Sistema non configurato' };
    }

    try {
      const { data, error } = await supabase
        .from('orders')
        .select(`
          *,
          order_items (
            *,
            products (name, images, description)
          )
        `)
        .eq('id', orderId)
        .eq('user_id', user.id)
        .single();

      if (error) {
        return { order: null, error: 'Ordine non trovato' };
      }

      return { order: data, error: null };
    } catch (err) {
      console.error('Get order by ID error:', err);
      return { order: null, error: 'Errore nel caricamento dell\'ordine' };
    }
  }

  /**
   * Update order status
   */
  async updateOrderStatus(orderId, status, trackingInfo = null) {
    if (!isSupabaseConfigured()) {
      return { error: 'Sistema non configurato' };
    }

    try {
      const updateData = { status };
      if (trackingInfo) {
        updateData.tracking_number = trackingInfo.trackingNumber;
        updateData.courier = trackingInfo.courier;
      }

      const { error } = await supabase
        .from('orders')
        .update(updateData)
        .eq('id', orderId);

      if (error) {
        return { error: 'Errore nell\'aggiornamento dell\'ordine' };
      }

      return { success: true };
    } catch (err) {
      console.error('Update order status error:', err);
      return { error: 'Errore nell\'aggiornamento dell\'ordine' };
    }
  }

  /**
   * Get order status label in Italian
   */
  getStatusLabel(status) {
    const labels = {
      pending: 'In attesa',
      processing: 'In elaborazione',
      shipped: 'Spedito',
      delivered: 'Consegnato',
      cancelled: 'Annullato',
      refunded: 'Rimborsato'
    };
    return labels[status] || status;
  }

  /**
   * Get tracking URL for courier
   */
  getTrackingUrl(courier, trackingNumber) {
    const urls = {
      brt: `https://www.brt.it/it/tracking?spession=${trackingNumber}`,
      dhl: `https://www.dhl.com/it-it/home/tracking.html?tracking-id=${trackingNumber}`,
      gls: `https://www.gls-italy.com/it/servizi/tracking?match=${trackingNumber}`,
      ups: `https://www.ups.com/track?tracknum=${trackingNumber}`,
      sda: `https://www.sda.it/wps/portal/Servizi_online/dettaglio-spedizione?locale=it&tression=${trackingNumber}`
    };
    return urls[courier?.toLowerCase()] || null;
  }
}

export const orderService = new OrderService();
export default orderService;
