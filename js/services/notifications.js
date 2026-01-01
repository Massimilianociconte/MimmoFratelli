/**
 * Notification Service
 * Mimmo Fratelli E-commerce Platform
 * 
 * Handles browser push notifications subscription and management
 */

import { supabase, isSupabaseConfigured, getCurrentUser } from '../supabase.js';

// VAPID Public Key - Generate with: npx web-push generate-vapid-keys
// This needs to be configured in js/config.js
const VAPID_PUBLIC_KEY = window.AVENUE_CONFIG?.VAPID_PUBLIC_KEY || '';

const LOCAL_STORAGE_KEY = 'mimmo_notifications_dismissed';
const REMINDER_INTERVAL_DAYS = 7;

/**
 * Notification Service Class
 */
class NotificationService {
  constructor() {
    this.swRegistration = null;
    this.isSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }

  /**
   * Get the base path for the site
   */
  _getBasePath() {
    // For local development and production (www.mimmofratelli.com), return empty path
    return '';
  }

  /**
   * Initialize the notification service
   * Registers service worker and checks subscription status
   */
  async init() {
    if (!this.isSupported) {
      console.warn('[Notifications] Push notifications not supported in this browser');
      return false;
    }

    try {
      const basePath = this._getBasePath();
      // Register service worker
      this.swRegistration = await navigator.serviceWorker.register(`${basePath}/sw.js`, {
        scope: `${basePath}/`
      });
      console.log('[Notifications] Service Worker registered:', this.swRegistration);

      // Wait for SW to be ready
      await navigator.serviceWorker.ready;
      console.log('[Notifications] Service Worker ready');

      return true;
    } catch (error) {
      console.error('[Notifications] Service Worker registration failed:', error);
      return false;
    }
  }

  /**
   * Check if notifications are enabled
   */
  isEnabled() {
    return Notification.permission === 'granted';
  }

  /**
   * Check if notifications are blocked
   */
  isBlocked() {
    return Notification.permission === 'denied';
  }

  /**
   * Check if user has an active subscription
   */
  async hasSubscription() {
    if (!this.swRegistration) return false;
    
    const subscription = await this.swRegistration.pushManager.getSubscription();
    return subscription !== null;
  }

  /**
   * Check if VAPID key is configured
   */
  isConfigured() {
    return !!VAPID_PUBLIC_KEY;
  }

  /**
   * Request notification permission and subscribe
   * @returns {Promise<{success: boolean, error: string|null}>}
   */
  async subscribe() {
    if (!this.isSupported) {
      return { success: false, error: 'Notifiche non supportate' };
    }

    if (!VAPID_PUBLIC_KEY) {
      // Don't log warning - this is expected when VAPID is not set up
      return { success: false, error: 'Notifiche push non ancora configurate', notConfigured: true };
    }

    try {
      // Request permission
      const permission = await Notification.requestPermission();
      
      if (permission !== 'granted') {
        return { success: false, error: 'Permesso negato' };
      }

      // Wait for service worker to be ready
      const registration = await navigator.serviceWorker.ready;
      
      // Subscribe to push
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: this._urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      });

      console.log('[Notifications] Push subscription:', subscription);

      // Save subscription to database
      await this._saveSubscription(subscription);

      // Update user profile if logged in
      await this._updateProfileNotificationPreference(true);

      return { success: true, error: null };
    } catch (error) {
      console.error('[Notifications] Subscribe error:', error);
      return { success: false, error: 'Errore durante l\'attivazione' };
    }
  }

  /**
   * Unsubscribe from push notifications
   * @returns {Promise<{success: boolean, error: string|null}>}
   */
  async unsubscribe() {
    if (!this.swRegistration) {
      return { success: false, error: 'Service worker non disponibile' };
    }

    try {
      const subscription = await this.swRegistration.pushManager.getSubscription();
      
      if (subscription) {
        // Remove from database
        await this._removeSubscription(subscription);
        
        // Unsubscribe from push
        await subscription.unsubscribe();
      }

      // Update user profile
      await this._updateProfileNotificationPreference(false);

      return { success: true, error: null };
    } catch (error) {
      console.error('[Notifications] Unsubscribe error:', error);
      return { success: false, error: 'Errore durante la disattivazione' };
    }
  }

  /**
   * Show a local notification (for testing or immediate feedback)
   */
  async showLocalNotification(title, options = {}) {
    if (!this.isEnabled()) {
      console.warn('[Notifications] Notifications not enabled');
      return;
    }

    const registration = await navigator.serviceWorker.ready;
    
    await registration.showNotification(title, {
      body: options.body || '',
      icon: options.icon || '/Images/icons/icon-192.png',
      badge: '/Images/icons/badge-72.png',
      image: options.image,
      tag: options.tag || 'local',
      renotify: true,
      requireInteraction: options.requireInteraction || false,
      data: {
        url: options.url || '/',
        ...options.data
      }
    });
  }

  /**
   * Check if should show reminder banner
   * Shows reminder if:
   * - User hasn't subscribed yet
   * - User hasn't dismissed recently
   * - Notifications aren't blocked
   */
  shouldShowReminder() {
    if (!this.isSupported) return false;
    if (this.isBlocked()) return false;
    if (this.isEnabled()) return false;

    const dismissed = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (dismissed) {
      const dismissedDate = new Date(parseInt(dismissed));
      const daysSince = (Date.now() - dismissedDate.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince < REMINDER_INTERVAL_DAYS) {
        return false;
      }
    }

    return true;
  }

  /**
   * Dismiss the reminder banner
   */
  dismissReminder() {
    localStorage.setItem(LOCAL_STORAGE_KEY, Date.now().toString());
  }

  /**
   * Clear reminder dismissal (show again)
   */
  clearReminderDismissal() {
    localStorage.removeItem(LOCAL_STORAGE_KEY);
  }

  // ============================================
  // Private Methods
  // ============================================

  /**
   * Save subscription to Supabase
   * @private
   */
  async _saveSubscription(subscription) {
    if (!isSupabaseConfigured()) return;

    const user = await getCurrentUser();
    const json = subscription.toJSON();

    try {
      const { error } = await supabase
        .from('push_subscriptions')
        .upsert({
          user_id: user?.id || null,
          endpoint: json.endpoint,
          p256dh: json.keys.p256dh,
          auth: json.keys.auth,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'endpoint'
        });

      if (error) {
        console.error('[Notifications] Error saving subscription:', error);
      }
    } catch (err) {
      console.error('[Notifications] Save subscription error:', err);
    }
  }

  /**
   * Remove subscription from Supabase
   * @private
   */
  async _removeSubscription(subscription) {
    if (!isSupabaseConfigured()) return;

    const json = subscription.toJSON();

    try {
      const { error } = await supabase
        .from('push_subscriptions')
        .delete()
        .eq('endpoint', json.endpoint);

      if (error) {
        console.error('[Notifications] Error removing subscription:', error);
      }
    } catch (err) {
      console.error('[Notifications] Remove subscription error:', err);
    }
  }

  /**
   * Update user profile notification preference
   * @private
   */
  async _updateProfileNotificationPreference(enabled) {
    if (!isSupabaseConfigured()) return;

    const user = await getCurrentUser();
    if (!user) return;

    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          seasonal_notifications: enabled,
          updated_at: new Date().toISOString()
        })
        .eq('id', user.id);

      if (error) {
        console.error('[Notifications] Error updating profile:', error);
      }
    } catch (err) {
      console.error('[Notifications] Update profile error:', err);
    }
  }

  /**
   * Convert VAPID key from base64 to Uint8Array
   * @private
   */
  _urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
      .replace(/-/g, '+')
      .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }
}

// Export singleton instance
export const notificationService = new NotificationService();
export default notificationService;
