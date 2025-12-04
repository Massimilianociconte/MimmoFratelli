/**
 * Notification Prompt Component
 * Mimmo Fratelli E-commerce Platform
 * 
 * Shows a prompt to enable push notifications
 */

import { fcmNotifications } from '../services/firebase-notifications.js';
import { getCurrentUser } from '../supabase.js';

const STORAGE_KEY = 'mimmo_notification_prompt_dismissed';
const SHOW_DELAY = 5000; // Show after 5 seconds
const REMIND_AFTER_DAYS = 7;

class NotificationPrompt {
  constructor() {
    this.element = null;
    this.isShowing = false;
  }

  /**
   * Initialize and potentially show the prompt
   */
  async init() {
    // Don't show if not supported
    if (!fcmNotifications.isSupported()) {
      return;
    }

    // Don't show if blocked
    if (fcmNotifications.isBlocked()) {
      return;
    }

    // Check if already has permission granted
    if (Notification.permission === 'granted') {
      // Already enabled, check for existing token
      await fcmNotifications.checkExistingToken();
      return;
    }

    // Don't show if recently dismissed
    if (this.wasRecentlyDismissed()) {
      return;
    }

    // Show after delay
    setTimeout(() => this.show(), SHOW_DELAY);
  }

  /**
   * Check if prompt was recently dismissed
   */
  wasRecentlyDismissed() {
    const dismissed = localStorage.getItem(STORAGE_KEY);
    if (!dismissed) return false;

    const dismissedDate = new Date(parseInt(dismissed));
    const daysSince = (Date.now() - dismissedDate.getTime()) / (1000 * 60 * 60 * 24);
    return daysSince < REMIND_AFTER_DAYS;
  }

  /**
   * Show the notification prompt
   */
  show() {
    if (this.isShowing) return;
    this.isShowing = true;

    // Create element
    this.element = document.createElement('div');
    this.element.className = 'notification-prompt';
    this.element.innerHTML = `
      <div class="notification-prompt-content">
        <div class="notification-prompt-icon">🔔</div>
        <div class="notification-prompt-text">
          <h4>Resta aggiornato!</h4>
          <p>Ricevi notifiche sui nuovi prodotti di stagione e offerte speciali</p>
        </div>
        <div class="notification-prompt-actions">
          <button class="notification-prompt-btn primary" id="enableNotifications">
            Attiva
          </button>
          <button class="notification-prompt-btn secondary" id="dismissNotifications">
            Non ora
          </button>
        </div>
      </div>
    `;

    // Add styles
    this.addStyles();

    // Add to DOM
    document.body.appendChild(this.element);

    // Animate in
    requestAnimationFrame(() => {
      this.element.classList.add('visible');
    });

    // Event listeners
    document.getElementById('enableNotifications').addEventListener('click', () => {
      this.handleEnable();
    });

    document.getElementById('dismissNotifications').addEventListener('click', () => {
      this.handleDismiss();
    });
  }

  /**
   * Handle enable button click
   */
  async handleEnable() {
    const btn = document.getElementById('enableNotifications');
    btn.textContent = 'Attivazione...';
    btn.disabled = true;

    const result = await fcmNotifications.requestPermission();

    if (result.success) {
      this.showSuccess();
    } else {
      this.showError(result.error);
    }
  }

  /**
   * Handle dismiss button click
   */
  handleDismiss() {
    localStorage.setItem(STORAGE_KEY, Date.now().toString());
    this.hide();
  }

  /**
   * Show success message
   */
  showSuccess() {
    if (!this.element) return;

    this.element.querySelector('.notification-prompt-content').innerHTML = `
      <div class="notification-prompt-icon">✅</div>
      <div class="notification-prompt-text">
        <h4>Notifiche attivate!</h4>
        <p>Riceverai aggiornamenti sui prodotti di stagione</p>
      </div>
    `;

    setTimeout(() => this.hide(), 3000);
  }

  /**
   * Show error message
   */
  showError(error) {
    if (!this.element) return;

    const btn = document.getElementById('enableNotifications');
    if (btn) {
      btn.textContent = 'Riprova';
      btn.disabled = false;
    }

    // Show toast error
    console.error('Notification error:', error);
  }

  /**
   * Hide the prompt
   */
  hide() {
    if (!this.element) return;

    this.element.classList.remove('visible');
    setTimeout(() => {
      this.element.remove();
      this.element = null;
      this.isShowing = false;
    }, 300);
  }

  /**
   * Add component styles
   */
  addStyles() {
    if (document.getElementById('notification-prompt-styles')) return;

    const style = document.createElement('style');
    style.id = 'notification-prompt-styles';
    style.textContent = `
      .notification-prompt {
        position: fixed;
        bottom: 20px;
        left: 20px;
        right: 20px;
        max-width: 420px;
        background: white;
        border-radius: 16px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.15);
        z-index: 9998;
        opacity: 0;
        transform: translateY(20px);
        transition: opacity 0.3s, transform 0.3s;
      }

      .notification-prompt.visible {
        opacity: 1;
        transform: translateY(0);
      }

      .notification-prompt-content {
        padding: 20px;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 16px;
      }

      .notification-prompt-icon {
        font-size: 32px;
        flex-shrink: 0;
      }

      .notification-prompt-text {
        flex: 1;
        min-width: 200px;
      }

      .notification-prompt-text h4 {
        margin: 0 0 4px 0;
        font-size: 16px;
        font-weight: 600;
        color: #1a1a1a;
      }

      .notification-prompt-text p {
        margin: 0;
        font-size: 14px;
        color: #666;
        line-height: 1.4;
      }

      .notification-prompt-actions {
        display: flex;
        gap: 8px;
        width: 100%;
      }

      .notification-prompt-btn {
        flex: 1;
        padding: 12px 20px;
        border: none;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: background 0.2s, transform 0.1s;
      }

      .notification-prompt-btn:active {
        transform: scale(0.98);
      }

      .notification-prompt-btn.primary {
        background: linear-gradient(135deg, #4c8c4a, #6ab04c);
        color: white;
      }

      .notification-prompt-btn.primary:hover {
        background: linear-gradient(135deg, #3d7a3b, #5a9f3c);
      }

      .notification-prompt-btn.secondary {
        background: #f5f5f5;
        color: #666;
      }

      .notification-prompt-btn.secondary:hover {
        background: #eee;
      }

      @media (max-width: 480px) {
        .notification-prompt {
          left: 10px;
          right: 10px;
          bottom: 10px;
        }

        .notification-prompt-content {
          padding: 16px;
        }
      }
    `;
    document.head.appendChild(style);
  }
}

export const notificationPrompt = new NotificationPrompt();
export default notificationPrompt;
