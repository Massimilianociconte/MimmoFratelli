/**
 * Firebase Cloud Messaging (FCM) Notification Service
 * Mimmo Fratelli E-commerce Platform
 * 
 * Handles push notifications via Firebase for seasonal products
 */

import { supabase, isSupabaseConfigured, getCurrentUser } from '../supabase.js';

// Firebase configuration - will be loaded from config.js
const getFirebaseConfig = () => window.AVENUE_CONFIG?.FIREBASE || null;

// Auto-reload quando un nuovo service worker prende il controllo (nuovo deploy).
// Insieme allo skipWaiting()+clients.claim() del SW, questo fa sì che dopo un
// aggiornamento la pagina si ricarichi una volta e mostri subito gli asset nuovi.
// Guardia: nessun reload al primissimo install (nessun controller precedente).
if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  const __hadController = !!navigator.serviceWorker.controller;
  let __swRefreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (__swRefreshing || !__hadController) return;
    __swRefreshing = true;
    window.location.reload();
  });
}

/**
 * Escape HTML per prevenire XSS quando si inserisce contenuto dinamico via innerHTML.
 */
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

/**
 * Restituisce un URL sicuro same-origin (solo path) oppure null se esterno/non valido.
 * Previene open-redirect da payload FCM controllati da un attaccante.
 */
function safeNotificationUrl(url) {
  if (!url || typeof url !== 'string') return null;
  try {
    const parsed = new URL(url, window.location.origin);
    if (parsed.origin !== window.location.origin) return null;
    return parsed.pathname + parsed.search + parsed.hash;
  } catch {
    return null;
  }
}

class FirebaseNotificationService {
  constructor() {
    this.messaging = null;
    this.isInitialized = false;
    this.currentToken = null;
  }

  /**
   * Get the base path for the site
   */
  _getBasePath() {
    // For local development and production (www.mimmofratelli.com), return empty path
    return '';
  }

  /**
   * Initialize Firebase and FCM
   */
  async init() {
    if (this.isInitialized && this.messaging) {
      return true;
    }

    const config = getFirebaseConfig();
    
    if (!config || !config.apiKey) {
      console.log('[FCM] Firebase not configured');
      return false;
    }

    try {
      // Dynamically load Firebase SDK
      if (!window.firebase) {
        await this.loadFirebaseSDK();
      }

      // Initialize Firebase app if not already done
      if (!firebase.apps.length) {
        firebase.initializeApp(config);
      }

      // Get messaging instance
      this.messaging = firebase.messaging();
      this.isInitialized = true;
      
      console.log('[FCM] Firebase initialized successfully');
      
      // Handle foreground messages
      this.messaging.onMessage((payload) => {
        console.log('[FCM] Foreground message received:', payload);
        this.showForegroundNotification(payload);
      });

      // NOTE: legacy `onTokenRefresh` was removed from Firebase v9+ (the old
      // property assignment here was a silent no-op). Token rotation is handled
      // by getToken() below: every subscription flow compares the fresh token
      // with the stored one and replaces it when it differs.

      return true;
    } catch (error) {
      console.error('[FCM] Initialization error:', error);
      return false;
    }
  }

  /**
   * Load Firebase SDK dynamically
   */
  async loadFirebaseSDK() {
    return new Promise((resolve, reject) => {
      // Load Firebase App
      const appScript = document.createElement('script');
      appScript.src = 'https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js';
      appScript.onload = () => {
        // Load Firebase Messaging
        const msgScript = document.createElement('script');
        msgScript.src = 'https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js';
        msgScript.onload = async () => {
          // Register Firebase messaging service worker
          try {
            const basePath = this._getBasePath();
            await navigator.serviceWorker.register(`${basePath}/firebase-messaging-sw.js`, { scope: `${basePath}/` });
            // Wait for it to be ready
            await navigator.serviceWorker.ready;
            resolve();
          } catch (err) {
            console.warn('[FCM] SW registration warning:', err);
            resolve(); // Continue anyway
          }
        };
        msgScript.onerror = reject;
        document.head.appendChild(msgScript);
      };
      appScript.onerror = reject;
      document.head.appendChild(appScript);
    });
  }

  /**
   * Check if already has a valid token (notifications enabled)
   */
  async checkExistingToken() {
    if (!this.isInitialized) {
      await this.init();
    }
    
    if (!this.messaging) return false;
    
    try {
      // Check if permission already granted
      if (Notification.permission !== 'granted') {
        return false;
      }
      
      // Ensure service worker is registered
      const basePath = this._getBasePath();
      let swRegistration = await navigator.serviceWorker.getRegistration(`${basePath}/`);
      if (!swRegistration || !swRegistration.active?.scriptURL.includes('firebase-messaging-sw.js')) {
        swRegistration = await navigator.serviceWorker.register(`${basePath}/firebase-messaging-sw.js`, {
          scope: `${basePath}/`,
          updateViaCache: 'none'
        });
        await navigator.serviceWorker.ready;
        console.log('[FCM] Service Worker re-registered');
      }
      
      // Try to get existing token
      const config = getFirebaseConfig();
      const token = await this.messaging.getToken({
        vapidKey: config.vapidKey,
        serviceWorkerRegistration: swRegistration
      });
      
      if (token) {
        this.currentToken = token;
        console.log('[FCM] Existing token found');
        // Ensure it's saved to database
        await this.saveTokenToDatabase(token);
        return true;
      }
    } catch (err) {
      console.log('[FCM] No existing token:', err);
    }
    
    return false;
  }

  /**
   * Request notification permission and get FCM token
   */
  async requestPermission() {
    if (!this.isInitialized) {
      const initialized = await this.init();
      if (!initialized) {
        return { success: false, error: 'Firebase non configurato' };
      }
    }

    try {
      // Check if already have permission and token
      if (Notification.permission === 'granted' && this.currentToken) {
        return { success: true, token: this.currentToken };
      }

      // Request browser notification permission
      const permission = await Notification.requestPermission();
      
      if (permission !== 'granted') {
        return { success: false, error: 'Permesso negato' };
      }

      // Unregister any existing service workers first to ensure clean state
      const existingRegistrations = await navigator.serviceWorker.getRegistrations();
      for (const reg of existingRegistrations) {
        if (reg.active?.scriptURL.includes('firebase-messaging-sw.js')) {
          await reg.unregister();
          console.log('[FCM] Unregistered old SW');
        }
      }

      // Register service worker explicitly for background notifications
      const basePath = this._getBasePath();
      const swRegistration = await navigator.serviceWorker.register(`${basePath}/firebase-messaging-sw.js`, {
        scope: `${basePath}/`,
        updateViaCache: 'none'
      });
      
      // Wait for the service worker to be ready
      await navigator.serviceWorker.ready;
      
      // Wait a bit for SW to fully activate
      await new Promise(resolve => setTimeout(resolve, 500));
      
      console.log('[FCM] Service Worker registered and ready for push');

      // Get FCM token with the service worker registration
      const config = getFirebaseConfig();
      const token = await this.messaging.getToken({
        vapidKey: config.vapidKey,
        serviceWorkerRegistration: swRegistration
      });

      if (!token) {
        return { success: false, error: 'Impossibile ottenere il token' };
      }

      this.currentToken = token;
      console.log('[FCM] Token obtained:', token.substring(0, 20) + '...');

      // Save token to database
      await this.saveTokenToDatabase(token);

      // Update user profile
      await this.updateProfilePreference(true);

      return { success: true, token };
    } catch (error) {
      console.error('[FCM] Permission error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Save FCM token to Supabase
   */
  async saveTokenToDatabase(token) {
    if (!isSupabaseConfigured()) return;

    const user = await getCurrentUser();

    try {
      const { error } = await supabase
        .from('fcm_tokens')
        .upsert({
          token: token,
          user_id: user?.id || null,
          platform: this.detectPlatform(),
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'token'
        });

      if (error) {
        console.error('[FCM] Error saving token:', error);
      }
    } catch (err) {
      console.error('[FCM] Save token error:', err);
    }
  }

  /**
   * Remove FCM token from database
   */
  async removeTokenFromDatabase() {
    if (!isSupabaseConfigured() || !this.currentToken) return;

    try {
      await supabase
        .from('fcm_tokens')
        .delete()
        .eq('token', this.currentToken);
    } catch (err) {
      console.error('[FCM] Remove token error:', err);
    }
  }

  /**
   * Update user profile notification preference
   */
  async updateProfilePreference(enabled) {
    if (!isSupabaseConfigured()) return;

    const user = await getCurrentUser();
    if (!user) return;

    try {
      await supabase
        .from('profiles')
        .update({
          seasonal_notifications: enabled,
          updated_at: new Date().toISOString()
        })
        .eq('id', user.id);
    } catch (err) {
      console.error('[FCM] Update profile error:', err);
    }
  }

  /**
   * Unsubscribe from notifications
   */
  async unsubscribe() {
    try {
      if (this.messaging && this.currentToken) {
        await this.messaging.deleteToken();
        await this.removeTokenFromDatabase();
        await this.updateProfilePreference(false);
        this.currentToken = null;
      }
      return { success: true };
    } catch (error) {
      console.error('[FCM] Unsubscribe error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Check if notifications are enabled
   */
  isEnabled() {
    return Notification.permission === 'granted' && this.currentToken !== null;
  }

  /**
   * Check if notifications are blocked
   */
  isBlocked() {
    return Notification.permission === 'denied';
  }

  /**
   * Check if FCM is supported
   */
  isSupported() {
    return 'Notification' in window && 
           'serviceWorker' in navigator && 
           'PushManager' in window;
  }

  /**
   * Show notification when app is in foreground
   * Only shows in-app toast to avoid duplicate browser notifications
   */
  showForegroundNotification(payload) {
    // Handle both notification and data-only messages
    const notification = payload.notification || {};
    const data = payload.data || {};
    
    const title = notification.title || data.title || 'Mimmo Fratelli';
    const body = notification.body || data.body || '';
    const image = notification.image || data.image;

    // Show in-app toast for foreground messages
    this.showInAppToast({ notification: { title, body, image }, data });
    
    // Also add to notification center for persistence
    this.addToNotificationCenter({ title, body, image, data });
  }
  
  /**
   * Add notification to the notification center
   */
  addToNotificationCenter({ title, body, image, data }) {
    // Try to add to notification center if available
    if (window.notificationCenter && typeof window.notificationCenter.addNotification === 'function') {
      const type = data?.type || 'new_product';
      window.notificationCenter.addNotification({
        type: type,
        title: title,
        message: body,
        productId: data?.product_id || data?.productId,
        productSlug: data?.product_slug || data?.productSlug,
        image: image
      });
    }
  }

  /**
   * Show in-app toast notification
   */
  showInAppToast(payload) {
    const { title, body, image } = payload.notification || {};
    const data = payload.data || {};

    // Create toast element
    const toast = document.createElement('div');
    toast.className = 'fcm-toast';
    toast.innerHTML = `
      ${image ? `<img src="${escapeHtml(image)}" alt="" class="fcm-toast-image">` : ''}
      <div class="fcm-toast-content">
        <strong class="fcm-toast-title">${escapeHtml(title || 'Notifica')}</strong>
        <p class="fcm-toast-body">${escapeHtml(body || '')}</p>
      </div>
      <button class="fcm-toast-close">×</button>
    `;

    // Add styles if not present
    this.ensureToastStyles();

    // Add to DOM
    document.body.appendChild(toast);

    // Click handlers
    toast.addEventListener('click', (e) => {
      if (!e.target.classList.contains('fcm-toast-close')) {
        const safeUrl = safeNotificationUrl(data.url);
        if (safeUrl) window.location.href = safeUrl;
      }
      toast.remove();
    });

    // Auto remove after 8 seconds
    setTimeout(() => toast.remove(), 8000);
  }

  /**
   * Ensure toast styles are in the document
   */
  ensureToastStyles() {
    if (document.getElementById('fcm-toast-styles')) return;

    const style = document.createElement('style');
    style.id = 'fcm-toast-styles';
    style.textContent = `
      .fcm-toast {
        position: fixed;
        top: 20px;
        right: 20px;
        background: white;
        border-radius: 12px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.15);
        padding: 16px;
        display: flex;
        align-items: center;
        gap: 12px;
        max-width: 360px;
        z-index: 10000;
        animation: fcmSlideIn 0.3s ease;
        cursor: pointer;
      }
      @keyframes fcmSlideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
      .fcm-toast-image {
        width: 50px;
        height: 50px;
        border-radius: 8px;
        object-fit: cover;
      }
      .fcm-toast-content { flex: 1; }
      .fcm-toast-title {
        display: block;
        font-size: 14px;
        margin-bottom: 4px;
      }
      .fcm-toast-body {
        font-size: 13px;
        color: #666;
        margin: 0;
      }
      .fcm-toast-close {
        background: none;
        border: none;
        font-size: 20px;
        color: #999;
        cursor: pointer;
        padding: 0 4px;
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Detect user platform
   */
  detectPlatform() {
    const ua = navigator.userAgent;
    if (/Android/i.test(ua)) return 'android';
    if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
    if (/Windows/i.test(ua)) return 'windows';
    if (/Mac/i.test(ua)) return 'macos';
    return 'web';
  }
}

// Export singleton
export const fcmNotifications = new FirebaseNotificationService();
export default fcmNotifications;
