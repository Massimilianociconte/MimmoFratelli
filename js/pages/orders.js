/**
 * Orders Page
 * Avenue M. E-commerce Platform
 */

import { isAuthenticated } from '../supabase.js';
import { orderService } from '../services/orders.js';

class OrdersPage {
  constructor() {
    this.init();
  }

  async init() {
    const authenticated = await isAuthenticated();
    
    document.getElementById('loadingOrders').style.display = 'none';

    if (!authenticated) {
      document.getElementById('loginRequired').style.display = 'block';
      document.getElementById('ordersContent').style.display = 'none';
      return;
    }

    document.getElementById('loginRequired').style.display = 'none';
    document.getElementById('ordersContent').style.display = 'block';

    await this.loadOrders();
  }

  async loadOrders() {
    const { orders, error } = await orderService.getOrderHistory();

    if (error) {
      document.getElementById('ordersList').innerHTML = `<p class="error">${error}</p>`;
      return;
    }

    if (orders.length === 0) {
      document.getElementById('noOrders').style.display = 'block';
      return;
    }

    this.renderOrders(orders);
  }

  renderOrders(orders) {
    const container = document.getElementById('ordersList');
    container.innerHTML = orders.map(order => this.renderOrder(order)).join('');
  }

  renderOrder(order) {
    const statusLabel = orderService.getStatusLabel(order.status);
    const statusClass = `status-${order.status}`;
    const date = new Date(order.created_at).toLocaleDateString('it-IT', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });

    const trackingHtml = order.tracking_number && order.courier
      ? `<a href="${orderService.getTrackingUrl(order.courier, order.tracking_number)}" target="_blank" class="tracking-link">Traccia Spedizione</a>`
      : '';

    const itemsHtml = order.order_items?.map(item => `
      <div class="order-item">
        <img src="${item.products?.images?.[0] || 'Images/placeholder.jpg'}" alt="${item.products?.name}" class="order-item-img">
        <div class="order-item-details">
          <span class="order-item-name">${item.products?.name || 'Prodotto'}</span>
          <span class="order-item-variant">Taglia: ${item.size} | Colore: ${item.color}</span>
          <span class="order-item-qty">Quantità: ${item.quantity}</span>
        </div>
        <span class="order-item-price">€${(item.unit_price * item.quantity).toFixed(2)}</span>
      </div>
    `).join('') || '';

    return `
      <div class="order-card">
        <div class="order-header">
          <div class="order-info">
            <span class="order-number">Ordine #${order.id.slice(0, 8)}</span>
            <span class="order-date">${date}</span>
          </div>
          <span class="order-status ${statusClass}">${statusLabel}</span>
        </div>
        <div class="order-items">${itemsHtml}</div>
        <div class="order-footer">
          <div class="order-total">
            <span>Totale:</span>
            <span class="total-amount">€${order.total_amount?.toFixed(2)}</span>
          </div>
          ${trackingHtml}
        </div>
      </div>
    `;
  }
}

window.openAuthModal = function() {
  const event = new CustomEvent('openAuthModal');
  document.dispatchEvent(event);
};

new OrdersPage();
