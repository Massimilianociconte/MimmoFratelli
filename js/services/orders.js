/**
 * Order Service
 * Avenue M. E-commerce Platform
 * 
 * Handles order creation, history, and tracking
 */

import { supabase, isSupabaseConfigured, getCurrentUser } from '../supabase.js';

class OrderService {
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
      confirmed: 'Confermato',
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
    const tn = encodeURIComponent(trackingNumber || '');
    const urls = {
      brt: `https://vas.brt.it/vas/sped_det_show.hsm?referer=sped_numspe_par.htm&Nspediz=${tn}`,
      dhl: `https://www.dhl.com/it-it/home/tracking.html?tracking-id=${tn}`,
      gls: `https://gls-group.com/IT/it/servizi-online/ricerca-spedizioni/?match=${tn}`,
      ups: `https://www.ups.com/track?tracknum=${tn}`,
      sda: `https://www.sda.it/wps/portal/Servizi_online/ricerca_spedizioni?locale=it&tracing.letteraVettura=${tn}`
    };
    return urls[courier?.toLowerCase()] || null;
  }
}

export const orderService = new OrderService();
export default orderService;
