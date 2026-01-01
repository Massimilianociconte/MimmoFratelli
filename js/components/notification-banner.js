/**
 * Notification Banner Component
 * Mimmo Fratelli E-commerce Platform
 * 
 * Beautiful reminder banner for enabling push notifications
 */

import { notificationService } from '../services/notifications.js';

class NotificationBanner {
  constructor() {
    this.banner = null;
    this.isVisible = false;
  }

  /**
   * Initialize and show banner if needed
   */
  async init() {
    await notificationService.init();
    
    // Delay showing banner for better UX
    setTimeout(() => {
      if (notificationService.shouldShowReminder()) {
        this.show();
      }
    }, 3000);
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
      notificationService.dismissReminder();
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
      enableBtn.innerHTML = '<i class="bi bi-hourglass-split"></i> Attivazione...';
    }

    const result = await notificationService.subscribe();
    
    if (result.success) {
      // Show success notification
      await notificationService.showLocalNotification('🎉 Notifiche Attivate!', {
        body: 'Ti avviseremo quando arrivano nuovi prodotti di stagione.',
        tag: 'welcome'
      });
      this.hide(true);
    } else {
      if (enableBtn) {
        enableBtn.disabled = false;
        enableBtn.innerHTML = '<i class="bi bi-bell-fill"></i> Attiva Notifiche';
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
          <i class="bi bi-bell-fill"></i>
          <span class="notification-banner-badge">🍅</span>
        </div>
        <div class="notification-banner-text">
          <h4>Non perderti le novità!</h4>
          <p>Ricevi notifiche quando arrivano prodotti freschi di stagione 🍋🥕🍇</p>
        </div>
        <div class="notification-banner-actions">
          <button class="notification-banner-enable">
            <i class="bi bi-bell-fill"></i> Attiva Notifiche
          </button>
          <button class="notification-banner-close" aria-label="Chiudi">
            <i class="bi bi-x-lg"></i>
          </button>
        </div>
      </div>
      <div class="notification-banner-error" style="display: none;"></div>
    `;

    // Bind events
    banner.querySelector('.notification-banner-enable').addEventListener('click', () => {
      this.enable();
    });

    banner.querySelector('.notification-banner-close').addEventListener('click', () => {
      this.hide(true);
    });

    return banner;
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

.notification-banner-icon i {
  font-size: 24px;
  color: #fff;
}

.notification-banner-badge {
  position: absolute;
  top: -2px;
  right: -2px;
  font-size: 16px;
  animation: bounce 1s infinite;
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

  .notification-banner-icon i {
    font-size: 20px;
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
    flex: 1;
    justify-content: center;
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
