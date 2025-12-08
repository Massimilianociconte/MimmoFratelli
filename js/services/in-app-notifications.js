/**
 * In-App Notifications Service
 * Mimmo Fratelli E-commerce Platform
 * 
 * Shows compact, stacked notification banners for seasonal products and promotions
 */

import { supabase, isSupabaseConfigured, getCurrentUser } from '../supabase.js';

const STORAGE_KEY = 'mimmo_seen_notifications';
const CHECK_INTERVAL = 30000; // Check every 30 seconds
const MAX_VISIBLE_NOTIFICATIONS = 3; // Max notifications before grouping

class InAppNotificationService {
  constructor() {
    this.container = null;
    this.checkInterval = null;
    this.notifications = []; // Track active notifications
    this.groupedContainer = null;
  }

  /**
   * Initialize the notification service
   */
  async init() {
    this.createContainer();
    await this.checkForNotifications();
    
    // Periodically check for new notifications
    this.checkInterval = setInterval(() => {
      this.checkForNotifications();
    }, CHECK_INTERVAL);
  }

  /**
   * Create the notification container
   */
  createContainer() {
    if (this.container) return;
    
    this.container = document.createElement('div');
    this.container.id = 'inAppNotifications';
    this.container.className = 'in-app-notifications';
    document.body.appendChild(this.container);
    
    // Add styles
    if (!document.getElementById('inAppNotificationStyles')) {
      const style = document.createElement('style');
      style.id = 'inAppNotificationStyles';
      style.textContent = `
        .in-app-notifications {
          position: fixed;
          top: 80px;
          right: 16px;
          z-index: 9999;
          display: flex;
          flex-direction: column;
          gap: 6px;
          max-width: 320px;
          width: calc(100% - 32px);
        }
        
        @media (max-width: 480px) {
          .in-app-notifications {
            top: 70px;
            right: 12px;
            left: 12px;
            max-width: none;
            width: auto;
          }
        }
        
        /* Compact single notification */
        .in-app-notification {
          position: relative;
          background: white;
          border-radius: 10px;
          box-shadow: 0 4px 16px rgba(0,0,0,0.12);
          padding: 10px 12px;
          display: flex;
          gap: 10px;
          align-items: center;
          animation: slideInNotification 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
          cursor: pointer;
          transition: transform 0.2s, box-shadow 0.2s, opacity 0.2s;
          border-left: 3px solid #4c8c4a;
        }
        
        .in-app-notification:hover {
          transform: translateX(-3px);
          box-shadow: 0 6px 20px rgba(0,0,0,0.15);
        }
        
        .in-app-notification.hiding {
          animation: slideOutNotification 0.25s ease-in forwards;
        }
        
        @keyframes slideInNotification {
          from {
            opacity: 0;
            transform: translateX(60px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
        
        @keyframes slideOutNotification {
          to {
            opacity: 0;
            transform: translateX(60px);
          }
        }
        
        .notification-image {
          width: 36px;
          height: 36px;
          border-radius: 8px;
          object-fit: cover;
          flex-shrink: 0;
          background: #f5f5f5;
        }
        
        .notification-content {
          flex: 1;
          min-width: 0;
        }
        
        .notification-title {
          font-weight: 600;
          font-size: 12px;
          color: #1a1a1a;
          margin: 0;
          display: flex;
          align-items: center;
          gap: 5px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        
        .notification-badge {
          background: linear-gradient(135deg, #4c8c4a, #6ab04c);
          color: white;
          font-size: 9px;
          padding: 2px 6px;
          border-radius: 8px;
          font-weight: 500;
          flex-shrink: 0;
        }
        
        .notification-body {
          font-size: 11px;
          color: #666;
          margin: 2px 0 0 0;
          line-height: 1.3;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        
        .notification-close {
          position: absolute;
          top: 50%;
          right: 8px;
          transform: translateY(-50%);
          width: 20px;
          height: 20px;
          border: none;
          background: rgba(0,0,0,0.05);
          border-radius: 50%;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          color: #999;
          transition: background 0.2s, color 0.2s;
          opacity: 0;
        }
        
        .in-app-notification:hover .notification-close {
          opacity: 1;
        }
        
        .notification-close:hover {
          background: rgba(0,0,0,0.1);
          color: #333;
        }
        
        /* Grouped notifications stack */
        .notifications-group {
          position: relative;
          background: white;
          border-radius: 10px;
          box-shadow: 0 4px 16px rgba(0,0,0,0.12);
          padding: 10px 12px;
          cursor: pointer;
          border-left: 3px solid #4c8c4a;
          animation: slideInNotification 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        
        .notifications-group:hover {
          box-shadow: 0 6px 20px rgba(0,0,0,0.15);
        }
        
        .notifications-group-header {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        
        .notifications-group-icon {
          width: 36px;
          height: 36px;
          border-radius: 8px;
          background: linear-gradient(135deg, #4c8c4a, #6ab04c);
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-size: 16px;
          flex-shrink: 0;
        }
        
        .notifications-group-info {
          flex: 1;
          min-width: 0;
        }
        
        .notifications-group-title {
          font-weight: 600;
          font-size: 12px;
          color: #1a1a1a;
          margin: 0;
        }
        
        .notifications-group-count {
          font-size: 11px;
          color: #666;
          margin: 2px 0 0 0;
        }
        
        .notifications-group-badge {
          background: #4c8c4a;
          color: white;
          font-size: 11px;
          font-weight: 600;
          min-width: 22px;
          height: 22px;
          border-radius: 11px;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0 6px;
        }
        
        .notifications-group-close {
          position: absolute;
          top: 8px;
          right: 8px;
          width: 20px;
          height: 20px;
          border: none;
          background: rgba(0,0,0,0.05);
          border-radius: 50%;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          color: #999;
          transition: background 0.2s, color 0.2s;
          opacity: 0;
        }
        
        .notifications-group:hover .notifications-group-close {
          opacity: 1;
        }
        
        .notifications-group-close:hover {
          background: rgba(0,0,0,0.1);
          color: #333;
        }
        
        /* Expanded group list */
        .notifications-group-list {
          max-height: 0;
          overflow: hidden;
          transition: max-height 0.3s ease, margin-top 0.3s ease;
        }
        
        .notifications-group.expanded .notifications-group-list {
          max-height: 300px;
          margin-top: 10px;
          overflow-y: auto;
        }
        
        .notifications-group-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px;
          border-radius: 6px;
          transition: background 0.2s;
          border-bottom: 1px solid #f0f0f0;
        }
        
        .notifications-group-item:last-child {
          border-bottom: none;
        }
        
        .notifications-group-item:hover {
          background: #f8f9fa;
        }
        
        .notifications-group-item-image {
          width: 28px;
          height: 28px;
          border-radius: 6px;
          object-fit: cover;
          flex-shrink: 0;
          background: #f5f5f5;
        }
        
        .notifications-group-item-text {
          flex: 1;
          font-size: 11px;
          color: #333;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        
        .notifications-group-item-dismiss {
          width: 18px;
          height: 18px;
          border: none;
          background: transparent;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 10px;
          color: #999;
          opacity: 0;
          transition: opacity 0.2s;
        }
        
        .notifications-group-item:hover .notifications-group-item-dismiss {
          opacity: 1;
        }
        
        .notifications-group-item-dismiss:hover {
          color: #e74c3c;
        }
        
        /* Stacked visual effect when collapsed */
        .notifications-group::before,
        .notifications-group::after {
          content: '';
          position: absolute;
          left: 4px;
          right: 4px;
          height: 4px;
          background: white;
          border-radius: 0 0 6px 6px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.08);
          transition: opacity 0.3s;
        }
        
        .notifications-group::before {
          bottom: -4px;
          opacity: 0.7;
        }
        
        .notifications-group::after {
          bottom: -7px;
          left: 8px;
          right: 8px;
          opacity: 0.4;
        }
        
        .notifications-group.expanded::before,
        .notifications-group.expanded::after {
          opacity: 0;
        }
      `;
      document.head.appendChild(style);
    }
  }

  /**
   * Check for new notifications
   */
  async checkForNotifications() {
    if (!isSupabaseConfigured()) return;
    
    try {
      // Check if user has seasonal notifications enabled
      const user = await getCurrentUser();
      if (user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('seasonal_notifications')
          .eq('id', user.id)
          .single();
        
        if (profile && !profile.seasonal_notifications) {
          return; // User disabled notifications
        }
      }
      
      // Get recent seasonal products (last 24 hours)
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      
      const { data: products, error } = await supabase
        .from('products')
        .select('id, name, images, price, sale_price')
        .eq('is_seasonal', true)
        .eq('is_active', true)
        .gte('updated_at', oneDayAgo)
        .order('updated_at', { ascending: false })
        .limit(3);
      
      if (error || !products) return;
      
      // Get seen notifications
      const seen = this.getSeenNotifications();
      
      // Show notifications for unseen products
      for (const product of products) {
        const notificationId = `seasonal-${product.id}`;
        if (!seen.includes(notificationId)) {
          this.showNotification({
            id: notificationId,
            title: '🍅 Nuovo di Stagione!',
            body: `${product.name} è ora disponibile`,
            image: product.images?.[0],
            url: `/product.html?id=${product.id}`,
            badge: 'Stagionale'
          });
        }
      }
      
      // Also check notification_logs for recent notifications
      const { data: logs } = await supabase
        .from('notification_logs')
        .select('*')
        .gte('created_at', oneDayAgo)
        .order('created_at', { ascending: false })
        .limit(3);
      
      if (logs) {
        for (const log of logs) {
          const notificationId = `log-${log.id}`;
          if (!seen.includes(notificationId)) {
            this.showNotification({
              id: notificationId,
              title: log.title,
              body: log.body,
              url: log.product_id ? `/product.html?id=${log.product_id}` : '/',
              badge: 'Novità'
            });
          }
        }
      }
      
    } catch (err) {
      console.error('Check notifications error:', err);
    }
  }

  /**
   * Show a notification
   */
  showNotification({ id, title, body, image, url, badge }) {
    if (!this.container) return;
    
    // Don't show duplicates
    if (this.notifications.find(n => n.id === id)) return;
    
    // Add to notifications array
    this.notifications.push({ id, title, body, image, url, badge });
    
    // Re-render notifications
    this.renderNotifications();
    
    // Auto-hide after 12 seconds
    setTimeout(() => {
      this.dismissNotification(id);
    }, 12000);
  }

  /**
   * Render notifications - either individually or grouped
   */
  renderNotifications() {
    if (!this.container) return;
    
    // Clear container
    this.container.innerHTML = '';
    
    const count = this.notifications.length;
    
    if (count === 0) return;
    
    if (count <= MAX_VISIBLE_NOTIFICATIONS) {
      // Show individual compact notifications
      this.notifications.forEach(notif => {
        this.renderSingleNotification(notif);
      });
    } else {
      // Show grouped notification
      this.renderGroupedNotifications();
    }
  }

  /**
   * Render a single compact notification
   */
  renderSingleNotification({ id, title, body, image, url, badge }) {
    const notification = document.createElement('div');
    notification.className = 'in-app-notification';
    notification.dataset.notificationId = id;
    
    notification.innerHTML = `
      ${image ? `<img src="${image}" alt="" class="notification-image" onerror="this.style.display='none'">` : '<div class="notification-image" style="background:linear-gradient(135deg,#4c8c4a,#6ab04c);display:flex;align-items:center;justify-content:center;color:white;font-size:14px;">🍅</div>'}
      <div class="notification-content">
        <p class="notification-title">
          ${title}
          ${badge ? `<span class="notification-badge">${badge}</span>` : ''}
        </p>
        <p class="notification-body">${body}</p>
      </div>
      <button class="notification-close" aria-label="Chiudi">✕</button>
    `;
    
    // Click to navigate
    notification.addEventListener('click', (e) => {
      if (!e.target.closest('.notification-close')) {
        this.dismissNotification(id);
        if (url) window.location.href = url;
      }
    });
    
    // Close button
    notification.querySelector('.notification-close').addEventListener('click', (e) => {
      e.stopPropagation();
      this.dismissNotification(id);
    });
    
    this.container.appendChild(notification);
  }

  /**
   * Render grouped notifications
   */
  renderGroupedNotifications() {
    const count = this.notifications.length;
    
    const group = document.createElement('div');
    group.className = 'notifications-group';
    
    group.innerHTML = `
      <div class="notifications-group-header">
        <div class="notifications-group-icon">🔔</div>
        <div class="notifications-group-info">
          <p class="notifications-group-title">Novità di Stagione</p>
          <p class="notifications-group-count">Tocca per vedere tutto</p>
        </div>
        <span class="notifications-group-badge">${count}</span>
      </div>
      <button class="notifications-group-close" aria-label="Chiudi tutto">✕</button>
      <div class="notifications-group-list">
        ${this.notifications.map(n => `
          <div class="notifications-group-item" data-id="${n.id}" data-url="${n.url || ''}">
            ${n.image ? `<img src="${n.image}" alt="" class="notifications-group-item-image" onerror="this.style.display='none'">` : '<div class="notifications-group-item-image" style="background:linear-gradient(135deg,#4c8c4a,#6ab04c);display:flex;align-items:center;justify-content:center;color:white;font-size:10px;">🍅</div>'}
            <span class="notifications-group-item-text">${n.body}</span>
            <button class="notifications-group-item-dismiss" aria-label="Rimuovi">✕</button>
          </div>
        `).join('')}
      </div>
    `;
    
    // Toggle expand/collapse
    group.querySelector('.notifications-group-header').addEventListener('click', () => {
      group.classList.toggle('expanded');
    });
    
    // Close all button
    group.querySelector('.notifications-group-close').addEventListener('click', (e) => {
      e.stopPropagation();
      this.dismissAllNotifications();
    });
    
    // Individual item clicks
    group.querySelectorAll('.notifications-group-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (!e.target.closest('.notifications-group-item-dismiss')) {
          const id = item.dataset.id;
          const url = item.dataset.url;
          this.dismissNotification(id);
          if (url) window.location.href = url;
        }
      });
      
      // Dismiss single item
      item.querySelector('.notifications-group-item-dismiss').addEventListener('click', (e) => {
        e.stopPropagation();
        this.dismissNotification(item.dataset.id);
      });
    });
    
    this.container.appendChild(group);
  }

  /**
   * Dismiss a single notification
   */
  dismissNotification(id) {
    this.markAsSeen(id);
    this.notifications = this.notifications.filter(n => n.id !== id);
    this.renderNotifications();
  }

  /**
   * Dismiss all notifications
   */
  dismissAllNotifications() {
    this.notifications.forEach(n => this.markAsSeen(n.id));
    this.notifications = [];
    this.renderNotifications();
  }

  /**
   * Hide a notification with animation (legacy support)
   */
  hideNotification(element, id) {
    element.classList.add('hiding');
    this.markAsSeen(id);
    setTimeout(() => {
      element.remove();
    }, 300);
  }

  /**
   * Get seen notification IDs
   */
  getSeenNotifications() {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      if (data) {
        const parsed = JSON.parse(data);
        // Clean old entries (older than 7 days)
        const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        return parsed.filter(item => item.timestamp > weekAgo).map(item => item.id);
      }
    } catch (e) {}
    return [];
  }

  /**
   * Mark notification as seen
   */
  markAsSeen(id) {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      let seen = [];
      if (data) {
        seen = JSON.parse(data);
      }
      
      // Add new entry
      if (!seen.find(item => item.id === id)) {
        seen.push({ id, timestamp: Date.now() });
      }
      
      // Keep only last 50 entries
      if (seen.length > 50) {
        seen = seen.slice(-50);
      }
      
      localStorage.setItem(STORAGE_KEY, JSON.stringify(seen));
    } catch (e) {}
  }

  /**
   * Manually trigger a notification (for testing)
   */
  test() {
    this.showNotification({
      id: `test-${Date.now()}`,
      title: '🍅 Nuovo di Stagione!',
      body: 'Pomodori San Marzano freschi',
      badge: 'Stagionale',
      url: '/'
    });
  }

  /**
   * Test multiple notifications to see grouping
   */
  testMultiple(count = 5) {
    const products = [
      { name: 'Pomodori San Marzano', emoji: '🍅' },
      { name: 'Zucchine Romanesche', emoji: '🥒' },
      { name: 'Melanzane Viola', emoji: '🍆' },
      { name: 'Peperoni Dolci', emoji: '🫑' },
      { name: 'Basilico Fresco', emoji: '🌿' },
      { name: 'Limoni di Sorrento', emoji: '🍋' },
      { name: 'Arance Siciliane', emoji: '🍊' }
    ];
    
    for (let i = 0; i < count; i++) {
      const product = products[i % products.length];
      setTimeout(() => {
        this.showNotification({
          id: `test-${Date.now()}-${i}`,
          title: `${product.emoji} Nuovo di Stagione!`,
          body: `${product.name} ora disponibile`,
          badge: 'Stagionale',
          url: '/'
        });
      }, i * 300);
    }
  }

  /**
   * Clear all seen notifications (for testing)
   */
  clearSeen() {
    localStorage.removeItem(STORAGE_KEY);
    console.log('Seen notifications cleared');
  }

  /**
   * Clear current visible notifications
   */
  clearAll() {
    this.notifications = [];
    this.renderNotifications();
  }
}

export const inAppNotifications = new InAppNotificationService();
export default inAppNotifications;
