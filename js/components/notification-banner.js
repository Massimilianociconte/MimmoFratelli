/**
 * Notification Banner Component
 * Mimmo Fratelli E-commerce Platform
 * 
 * Reminder banner for enabling Firebase push notifications
 */

import { fcmNotifications } from '../services/firebase-notifications.js';

const DISMISS_STORAGE_KEY = 'mimmo_notifications_dismissed';
// Legacy key usata dal vecchio notification-prompt (componente fuso in questo banner)
const LEGACY_PROMPT_DISMISS_KEY = 'mimmo_notification_prompt_dismissed';
const REMINDER_INTERVAL_DAYS = 7;
const SHOW_DELAY = 3000;
const BANNER_ICON = '/Images/notification-fresh-bell.png';

class NotificationBanner {
  constructor() {
    this.banner = null;
    this.isVisible = false;
    this.isInitialized = false;
  }

  /**
   * Initialize and show banner if needed
   */
  async init() {
    if (this.isInitialized) return;
    this.isInitialized = true;

    if (!fcmNotifications.isSupported() || fcmNotifications.isBlocked()) {
      return;
    }

    const initialized = await fcmNotifications.init();
    if (!initialized) {
      return;
    }

    setTimeout(async () => {
      if (await this.shouldShowReminder()) {
        this.show();
      }
    }, SHOW_DELAY);
  }

  /**
   * Check if the central banner should be shown.
   */
  async shouldShowReminder() {
    if (!fcmNotifications.isSupported()) return false;
    if (fcmNotifications.isBlocked()) return false;
    if (this.wasRecentlyDismissed()) return false;

    if (Notification.permission === 'granted') {
      const hasToken = await fcmNotifications.checkExistingToken();
      return !hasToken;
    }

    return true;
  }

  /**
   * Check if the reminder was snoozed recently.
   * Rispetta anche la chiave legacy del vecchio prompt, così chi lo aveva
   * chiuso non viene ridisturbato prima dell'intervallo.
   */
  wasRecentlyDismissed() {
    const dismissed = localStorage.getItem(DISMISS_STORAGE_KEY);
    const legacyDismissed = localStorage.getItem(LEGACY_PROMPT_DISMISS_KEY);

    // Migra la chiave legacy sulla chiave corrente, poi rimuovila
    if (legacyDismissed) {
      const current = parseInt(dismissed || '0', 10);
      const legacy = parseInt(legacyDismissed, 10);
      if (legacy > current) {
        localStorage.setItem(DISMISS_STORAGE_KEY, legacyDismissed);
      }
      localStorage.removeItem(LEGACY_PROMPT_DISMISS_KEY);
    }

    const effective = localStorage.getItem(DISMISS_STORAGE_KEY);
    if (!effective) return false;

    const dismissedDate = new Date(parseInt(effective, 10));
    const daysSince = (Date.now() - dismissedDate.getTime()) / (1000 * 60 * 60 * 24);
    return daysSince < REMINDER_INTERVAL_DAYS;
  }

  /**
   * Snooze the reminder.
   */
  dismissReminder() {
    localStorage.setItem(DISMISS_STORAGE_KEY, Date.now().toString());
  }

  /**
   * Create and show the banner
   */
  show() {
    if (this.isVisible) return;

    this.banner = this._createBanner();
    document.body.appendChild(this.banner);

    // Trigger animation
    requestAnimationFrame(() => {
      this.banner.classList.add('visible');
    });

    this.isVisible = true;
  }

  /**
   * Hide and remove the banner
   */
  hide(remember = false) {
    if (!this.banner || !this.isVisible) return;

    if (remember) {
      this.dismissReminder();
    }

    this.banner.classList.remove('visible');
    
    setTimeout(() => {
      this.banner.remove();
      this.banner = null;
      this.isVisible = false;
    }, 300);
  }

  /**
   * Enable notifications and hide banner
   */
  async enable() {
    const enableBtn = this.banner?.querySelector('.notification-banner-enable');
    if (enableBtn) {
      enableBtn.disabled = true;
      enableBtn.textContent = 'Attivazione...';
    }

    const result = await fcmNotifications.requestPermission();
    
    if (result.success) {
      this.showSuccess();
    } else {
      if (enableBtn) {
        enableBtn.disabled = false;
        enableBtn.textContent = 'Attiva Notifiche';
      }
      
      // Show error message
      this._showError(result.error || 'Errore durante l\'attivazione');
    }
  }

  /**
   * Create the banner DOM element
   * @private
   */
  _createBanner() {
    const banner = document.createElement('div');
    banner.className = 'notification-banner';
    banner.innerHTML = `
      <div class="notification-banner-content">
        <div class="notification-banner-icon">
          <img src="${BANNER_ICON}" alt="" class="notification-banner-image">
          <span class="notification-banner-badge">🍅</span>
        </div>
        <div class="notification-banner-text">
          <h4>Non perderti le novità!</h4>
          <p>Ricevi notifiche su prodotti freschi di stagione e offerte speciali 🍋🥕🍇</p>
        </div>
        <div class="notification-banner-actions">
          <button class="notification-banner-enable">
            Attiva Notifiche
          </button>
          <button class="notification-banner-later">
            Non ora
          </button>
          <button class="notification-banner-close" aria-label="Chiudi">
            <span aria-hidden="true">×</span>
          </button>
        </div>
      </div>
      <div class="notification-banner-error" style="display: none;"></div>
    `;

    // Bind events
    banner.querySelector('.notification-banner-enable').addEventListener('click', () => {
      this.enable();
    });

    // Fallback: se il PNG non carica, mostra la campanella emoji al suo posto
    banner.querySelector('.notification-banner-image').addEventListener('error', (e) => {
      e.target.remove();
      banner.querySelector('.notification-banner-icon')?.classList.add('image-failed');
    });

    banner.querySelector('.notification-banner-later').addEventListener('click', () => {
      this.hide(true);
    });

    banner.querySelector('.notification-banner-close').addEventListener('click', () => {
      this.hide(true);
    });

    return banner;
  }

  /**
   * Show success state before hiding the banner.
   */
  showSuccess() {
    if (!this.banner) return;

    const content = this.banner.querySelector('.notification-banner-content');
    if (!content) return;

    content.innerHTML = `
      <div class="notification-banner-icon success">
        <img src="${BANNER_ICON}" alt="" class="notification-banner-image">
        <span class="notification-banner-badge">✓</span>
      </div>
      <div class="notification-banner-text">
        <h4>Notifiche attivate!</h4>
        <p>Ti avviseremo quando arrivano nuovi prodotti di stagione.</p>
      </div>
    `;

    setTimeout(() => this.hide(true), 2200);
  }

  /**
   * Show error message in banner
   * @private
   */
  _showError(message) {
    const errorEl = this.banner?.querySelector('.notification-banner-error');
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.style.display = 'block';
      
      setTimeout(() => {
        errorEl.style.display = 'none';
      }, 5000);
    }
  }
}

// CSS Styles (will be injected)
const styles = `
.notification-banner {
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%) translateY(120%);
  max-width: 600px;
  width: calc(100% - 40px);
  background: linear-gradient(135deg, #2d5016 0%, #4a7c23 100%);
  border-radius: 16px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(255, 255, 255, 0.1);
  z-index: 9999;
  transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
  overflow: hidden;
}

.notification-banner.visible {
  transform: translateX(-50%) translateY(0);
}

.notification-banner-content {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px 20px;
}

.notification-banner-icon {
  position: relative;
  width: 56px;
  height: 56px;
  background: rgba(255, 255, 255, 0.15);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  animation: bell-ring 2s infinite;
}

.notification-banner-icon.success {
  animation: none;
}

/* Fallback emoji se l'immagine PNG non è disponibile */
.notification-banner-icon.image-failed::before {
  content: '🔔';
  font-size: 28px;
  line-height: 1;
}

.notification-banner-image {
  width: 82%;
  height: 82%;
  display: block;
  object-fit: contain;
  filter: drop-shadow(0 3px 5px rgba(0, 0, 0, 0.22));
}

.notification-banner-badge {
  position: absolute;
  top: -2px;
  right: -2px;
  font-size: 16px;
  animation: bounce 1s infinite;
}

.notification-banner-icon.success .notification-banner-badge {
  top: -3px;
  right: -3px;
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: #fff;
  color: #2d5016;
  font-size: 13px;
  font-weight: 800;
}

@keyframes bell-ring {
  0%, 100% { transform: rotate(0); }
  10% { transform: rotate(15deg); }
  20% { transform: rotate(-15deg); }
  30% { transform: rotate(10deg); }
  40% { transform: rotate(-10deg); }
  50% { transform: rotate(5deg); }
  60% { transform: rotate(-5deg); }
  70% { transform: rotate(0); }
}

@keyframes bounce {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-3px); }
}

.notification-banner-text {
  flex: 1;
  min-width: 0;
}

.notification-banner-text h4 {
  margin: 0 0 4px 0;
  font-size: 16px;
  font-weight: 600;
  color: #fff;
}

.notification-banner-text p {
  margin: 0;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.85);
  line-height: 1.4;
}

.notification-banner-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.notification-banner-enable {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 18px;
  background: #fff;
  color: #2d5016;
  border: none;
  border-radius: 25px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}

.notification-banner-enable:hover {
  background: #f0f7e6;
  transform: scale(1.02);
}

.notification-banner-enable:active {
  transform: scale(0.98);
}

.notification-banner-enable:disabled {
  opacity: 0.7;
  cursor: wait;
}

.notification-banner-later {
  padding: 10px 14px;
  background: rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 25px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}

.notification-banner-later:hover {
  background: rgba(255, 255, 255, 0.22);
  color: #fff;
}

.notification-banner-close {
  width: 36px;
  height: 36px;
  background: rgba(255, 255, 255, 0.15);
  border: none;
  border-radius: 50%;
  color: #fff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  font-size: 24px;
  line-height: 1;
}

.notification-banner-close:hover {
  background: rgba(255, 255, 255, 0.25);
}

.notification-banner-error {
  background: rgba(220, 53, 69, 0.9);
  color: #fff;
  padding: 10px 20px;
  font-size: 13px;
  text-align: center;
}

/* Mobile Responsive */
@media (max-width: 576px) {
  .notification-banner {
    bottom: 10px;
    width: calc(100% - 20px);
    border-radius: 12px;
  }

  .notification-banner-content {
    flex-wrap: wrap;
    padding: 14px 16px;
  }

  .notification-banner-icon {
    width: 44px;
    height: 44px;
  }

  .notification-banner-image {
    width: 84%;
    height: 84%;
  }

  .notification-banner-text {
    flex: 1 1 calc(100% - 100px);
  }

  .notification-banner-text h4 {
    font-size: 14px;
  }

  .notification-banner-text p {
    font-size: 12px;
  }

  .notification-banner-actions {
    flex: 1 1 100%;
    justify-content: center;
    margin-top: 10px;
  }

  .notification-banner-enable {
    flex: 1.4;
    justify-content: center;
  }

  .notification-banner-later {
    flex: 1;
    text-align: center;
  }

  .notification-banner-close {
    display: flex !important;
    position: absolute;
    top: 8px;
    right: 8px;
    width: 32px;
    height: 32px;
    background: rgba(0, 0, 0, 0.3);
  }

  .notification-banner-content {
    position: relative;
    padding-right: 44px;
  }
}

/* Dark mode support */
@media (prefers-color-scheme: dark) {
  .notification-banner {
    background: linear-gradient(135deg, #1a3009 0%, #2d5016 100%);
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05);
  }
}
`;

// Inject styles
function injectStyles() {
  if (document.getElementById('notification-banner-styles')) return;
  
  const styleEl = document.createElement('style');
  styleEl.id = 'notification-banner-styles';
  styleEl.textContent = styles;
  document.head.appendChild(styleEl);
}

// Auto-inject styles when module loads
injectStyles();

// Export singleton
export const notificationBanner = new NotificationBanner();
export default notificationBanner;
