/**
 * Authentication Modal Component
 * Avenue M. E-commerce Platform
 * 
 * Provides login and registration UI
 * Requirements: 1.1, 1.4
 */

import { authService } from '../services/auth.js';
import '../services/presence.js'; // Track user presence for analytics

/**
 * Authentication Modal Class
 */
class AuthModal {
  constructor() {
    this.modal = null;
    this.mode = 'login'; // 'login' or 'register'
    this.onSuccess = null;
    this.redirectUrl = null;
  }

  /**
   * Initialize the modal
   */
  init() {
    this._createModal();
    this._attachEventListeners();
  }

  /**
   * Show the modal
   * @param {string} mode - 'login' or 'register'
   * @param {Object} options - { onSuccess, redirectUrl, referralCode }
   */
  show(mode = 'login', options = {}) {
    this.mode = mode;
    this.onSuccess = options.onSuccess || null;
    this.redirectUrl = options.redirectUrl || null;
    this.referralCode = options.referralCode || null;
    
    this._updateModalContent();
    this.modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    
    // Focus first input
    setTimeout(() => {
      const firstInput = this.modal.querySelector('input');
      if (firstInput) firstInput.focus();
    }, 100);
  }

  /**
   * Hide the modal
   */
  hide() {
    this.modal.classList.remove('active');
    document.body.style.overflow = '';
    this._clearForm();
    this._clearErrors();
  }

  /**
   * Create modal HTML structure
   * @private
   */
  _createModal() {
    // Check if modal already exists
    if (document.getElementById('authModal')) {
      this.modal = document.getElementById('authModal');
      return;
    }

    const modalHTML = `
      <div class="auth-modal-overlay" id="authModal">
        <div class="auth-modal-content">
          <button class="auth-modal-close" aria-label="Chiudi">&times;</button>
          
          <div class="auth-modal-header">
            <h2 class="auth-modal-title" id="authModalTitle">Accedi</h2>
            <p class="auth-modal-subtitle" id="authModalSubtitle">
              Accedi al tuo account Avenue M.
            </p>
          </div>

          <div class="auth-modal-error" id="authModalError" style="display: none;"></div>

          <!-- Login Form -->
          <form class="auth-form" id="loginForm">
            <div class="auth-form-fields" id="loginFields">
              <div class="form-field">
                <label for="authEmail">Email</label>
                <input type="email" id="authEmail" name="email" required 
                       placeholder="La tua email" autocomplete="email">
              </div>
              <div class="form-field">
                <label for="authPassword">Password</label>
                <input type="password" id="authPassword" name="password" required 
                       placeholder="La tua password" autocomplete="current-password">
              </div>
            </div>

            <button type="submit" class="auth-submit-btn" id="loginSubmitBtn">
              <span class="btn-text">Accedi</span>
              <span class="btn-loading" style="display: none;">
                <span class="spinner"></span>
              </span>
            </button>
          </form>

          <!-- Register Form (hidden by default) -->
          <form class="auth-form" id="registerForm" style="display: none;">
            <div class="auth-form-fields" id="registerFields">
              <div class="form-row">
                <div class="form-field">
                  <label for="authFirstName">Nome</label>
                  <input type="text" id="authFirstName" name="first_name" required
                         placeholder="Il tuo nome">
                </div>
                <div class="form-field">
                  <label for="authLastName">Cognome</label>
                  <input type="text" id="authLastName" name="last_name" required
                         placeholder="Il tuo cognome">
                </div>
              </div>
              <div class="form-field">
                <label for="authRegEmail">Email</label>
                <input type="email" id="authRegEmail" name="email" required
                       placeholder="La tua email" autocomplete="email">
              </div>
              <div class="form-field">
                <label for="authRegPassword">Password</label>
                <input type="password" id="authRegPassword" name="password" required
                       placeholder="Crea una password" autocomplete="new-password">
                <small class="form-hint">Minimo 8 caratteri</small>
              </div>
              <div class="form-field">
                <label for="authConfirmPassword">Conferma Password</label>
                <input type="password" id="authConfirmPassword" name="confirm_password" required
                       placeholder="Conferma la password" autocomplete="new-password">
              </div>
            </div>

            <button type="submit" class="auth-submit-btn" id="registerSubmitBtn">
              <span class="btn-text">Registrati</span>
              <span class="btn-loading" style="display: none;">
                <span class="spinner"></span>
              </span>
            </button>
          </form>

          <div class="auth-modal-footer">
            <p class="auth-switch" id="authSwitch">
              Non hai un account? 
              <a href="#" id="authSwitchLink">Registrati</a>
            </p>
            <a href="#" class="auth-forgot" id="authForgot">Password dimenticata?</a>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
    this.modal = document.getElementById('authModal');
    
    // Add styles if not already present
    this._addStyles();
  }

  /**
   * Attach event listeners
   * @private
   */
  _attachEventListeners() {
    // Close button
    this.modal.querySelector('.auth-modal-close').addEventListener('click', () => {
      this.hide();
    });

    // Click outside to close
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) {
        this.hide();
      }
    });

    // ESC key to close
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.modal.classList.contains('active')) {
        this.hide();
      }
    });

    // Switch between login/register
    document.getElementById('authSwitchLink').addEventListener('click', (e) => {
      e.preventDefault();
      this.mode = this.mode === 'login' ? 'register' : 'login';
      this._updateModalContent();
    });

    // Login form submission
    document.getElementById('loginForm').addEventListener('submit', (e) => {
      e.preventDefault();
      this._handleSubmit();
    });

    // Register form submission
    document.getElementById('registerForm').addEventListener('submit', (e) => {
      e.preventDefault();
      this._handleSubmit();
    });

    // Forgot password
    document.getElementById('authForgot').addEventListener('click', (e) => {
      e.preventDefault();
      this._handleForgotPassword();
    });
  }

  /**
   * Update modal content based on mode
   * @private
   */
  _updateModalContent() {
    const title = document.getElementById('authModalTitle');
    const subtitle = document.getElementById('authModalSubtitle');
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    const switchText = document.getElementById('authSwitch');
    const forgotLink = document.getElementById('authForgot');

    if (this.mode === 'login') {
      title.textContent = 'Accedi';
      subtitle.textContent = 'Accedi al tuo account Mimmo Fratelli';
      loginForm.style.display = 'block';
      registerForm.style.display = 'none';
      switchText.innerHTML = 'Non hai un account? <a href="#" id="authSwitchLink">Registrati</a>';
      forgotLink.style.display = 'block';
    } else {
      title.textContent = 'Registrati';
      // Show special message if referral code is present
      if (this.referralCode) {
        subtitle.innerHTML = '🎁 <strong>Ottieni il 15% di sconto</strong> sul tuo primo ordine!<br><small style="color:#666;">Sei stato invitato da un amico</small>';
      } else {
        subtitle.textContent = 'Crea il tuo account e ottieni il 10% di sconto sul primo ordine!';
      }
      loginForm.style.display = 'none';
      registerForm.style.display = 'block';
      switchText.innerHTML = 'Hai già un account? <a href="#" id="authSwitchLink">Accedi</a>';
      forgotLink.style.display = 'none';
    }

    // Re-attach switch link listener
    document.getElementById('authSwitchLink').addEventListener('click', (e) => {
      e.preventDefault();
      this.mode = this.mode === 'login' ? 'register' : 'login';
      this._updateModalContent();
    });

    this._clearErrors();
  }

  /**
   * Handle form submission
   * @private
   */
  async _handleSubmit() {
    this._clearErrors();
    this._setLoading(true);

    try {
      if (this.mode === 'login') {
        await this._handleLogin();
      } else {
        await this._handleRegister();
      }
    } finally {
      this._setLoading(false);
    }
  }

  /**
   * Handle login
   * @private
   */
  async _handleLogin() {
    const email = document.getElementById('authEmail').value.trim();
    const password = document.getElementById('authPassword').value;

    if (!email || !password) {
      this._showError('Inserisci email e password');
      return;
    }

    const { user, error } = await authService.signIn(email, password);

    if (error) {
      this._showError(error);
      return;
    }

    // Success
    this.hide();
    
    if (this.onSuccess) {
      this.onSuccess(user);
    }

    if (this.redirectUrl) {
      window.location.href = this.redirectUrl;
    }
  }

  /**
   * Handle registration
   * @private
   */
  async _handleRegister() {
    const firstName = document.getElementById('authFirstName').value.trim();
    const lastName = document.getElementById('authLastName').value.trim();
    const email = document.getElementById('authRegEmail').value.trim();
    const password = document.getElementById('authRegPassword').value;
    const confirmPassword = document.getElementById('authConfirmPassword').value;

    // Validation
    if (!firstName || !lastName) {
      this._showError('Inserisci nome e cognome');
      return;
    }

    if (!email) {
      this._showError('Inserisci la tua email');
      return;
    }

    if (password.length < 8) {
      this._showError('La password deve essere di almeno 8 caratteri');
      return;
    }

    if (password !== confirmPassword) {
      this._showError('Le password non corrispondono');
      return;
    }

    // Include referral code if present
    const { user, error, signupData } = await authService.signUp(email, password, {
      first_name: firstName,
      last_name: lastName,
      referralCode: this.referralCode
    });

    if (error) {
      this._showError(error);
      return;
    }

    // Success - show confirmation message with discount code if available
    if (signupData?.firstOrderCode) {
      const discountPercent = signupData.discountPercent || 10;
      const isReferral = signupData.isReferral;
      this._showSuccess(
        `🎉 Registrazione completata!<br><br>` +
        `${isReferral ? '🎁 Grazie al tuo amico, hai ottenuto' : 'Hai ottenuto'} <strong>${discountPercent}% di sconto</strong> sul primo ordine!<br><br>` +
        `Il tuo codice: <code style="background:#fef3c7;padding:0.2rem 0.5rem;border-radius:4px;font-weight:bold;">${signupData.firstOrderCode}</code><br><br>` +
        `<small>Controlla la tua email per confermare l'account.</small>`
      );
      
      // Keep modal open longer to show the code
      setTimeout(() => {
        this.mode = 'login';
        this._updateModalContent();
      }, 8000);
    } else {
      this._showSuccess('Registrazione completata! Controlla la tua email per confermare l\'account.');
      
      // Switch to login after 3 seconds
      setTimeout(() => {
        this.mode = 'login';
        this._updateModalContent();
      }, 3000);
    }
  }

  /**
   * Handle forgot password
   * @private
   */
  async _handleForgotPassword() {
    const email = document.getElementById('authEmail').value.trim();

    if (!email) {
      this._showError('Inserisci la tua email per recuperare la password');
      return;
    }

    this._setLoading(true);
    
    await authService.resetPassword(email);
    
    this._setLoading(false);
    this._showSuccess('Se l\'email è registrata, riceverai le istruzioni per reimpostare la password.');
  }

  /**
   * Show error message
   * @private
   */
  _showError(message) {
    const errorEl = document.getElementById('authModalError');
    errorEl.textContent = message;
    errorEl.className = 'auth-modal-error error';
    errorEl.style.display = 'block';
  }

  /**
   * Show success message
   * @private
   */
  _showSuccess(message) {
    const errorEl = document.getElementById('authModalError');
    errorEl.innerHTML = message;
    errorEl.className = 'auth-modal-error success';
    errorEl.style.display = 'block';
  }

  /**
   * Clear error messages
   * @private
   */
  _clearErrors() {
    const errorEl = document.getElementById('authModalError');
    errorEl.style.display = 'none';
    errorEl.textContent = '';
  }

  /**
   * Clear form fields
   * @private
   */
  _clearForm() {
    document.getElementById('loginForm').reset();
    document.getElementById('registerForm').reset();
  }

  /**
   * Set loading state
   * @private
   */
  _setLoading(loading) {
    const btnId = this.mode === 'login' ? 'loginSubmitBtn' : 'registerSubmitBtn';
    const btn = document.getElementById(btnId);
    const btnText = btn.querySelector('.btn-text');
    const btnLoading = btn.querySelector('.btn-loading');

    if (loading) {
      btn.disabled = true;
      btnText.style.display = 'none';
      btnLoading.style.display = 'inline-flex';
    } else {
      btn.disabled = false;
      btnText.style.display = 'inline';
      btnLoading.style.display = 'none';
    }
  }

  /**
   * Add component styles
   * @private
   */
  _addStyles() {
    if (document.getElementById('authModalStyles')) return;

    const styles = `
      <style id="authModalStyles">
        .auth-modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(0, 0, 0, 0.6);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          opacity: 0;
          visibility: hidden;
          transition: all 0.3s ease;
        }

        .auth-modal-overlay.active {
          opacity: 1;
          visibility: visible;
        }

        .auth-modal-content {
          background: #fff;
          padding: 2.5rem;
          border-radius: 8px;
          width: 100%;
          max-width: 420px;
          max-height: 90vh;
          overflow-y: auto;
          position: relative;
          transform: translateY(20px);
          transition: transform 0.3s ease;
        }

        .auth-modal-overlay.active .auth-modal-content {
          transform: translateY(0);
        }

        .auth-modal-close {
          position: absolute;
          top: 1rem;
          right: 1rem;
          background: none;
          border: none;
          font-size: 1.5rem;
          cursor: pointer;
          color: #666;
          transition: color 0.3s;
        }

        .auth-modal-close:hover {
          color: #000;
        }

        .auth-modal-header {
          text-align: center;
          margin-bottom: 2rem;
        }

        .auth-modal-title {
          font-family: var(--font-display, 'DM Serif Display', Georgia, serif);
          font-size: 2rem;
          font-style: italic;
          margin-bottom: 0.5rem;
        }

        .auth-modal-subtitle {
          color: #444;
          font-size: 0.9rem;
        }

        .auth-modal-error {
          padding: 1rem;
          border-radius: 6px;
          margin-bottom: 1.5rem;
          font-size: 0.9rem;
        }

        .auth-modal-error.error {
          background: #fee;
          color: #c00;
          border: 1px solid #fcc;
        }

        .auth-modal-error.success {
          background: #efe;
          color: #060;
          border: 1px solid #cfc;
        }

        .auth-form .form-field {
          margin-bottom: 1.25rem;
        }

        .auth-form label {
          display: block;
          font-size: 0.8rem;
          text-transform: uppercase;
          letter-spacing: 1px;
          margin-bottom: 0.5rem;
          color: #1a1a1a;
          font-weight: 600;
        }

        .auth-form input {
          width: 100%;
          padding: 0.9rem 1rem;
          border: 1px solid #bbb;
          border-radius: 6px;
          font-size: 1rem;
          transition: border-color 0.3s, box-shadow 0.3s;
          color: #1a1a1a;
          background: #fff;
        }

        .auth-form input::placeholder {
          color: #777;
        }

        .auth-form input:focus {
          outline: none;
          border-color: var(--accent-color, #a89990);
          box-shadow: 0 0 0 3px rgba(168, 153, 144, 0.15);
        }

        /* Fix autofill browser styles */
        .auth-form input:-webkit-autofill,
        .auth-form input:-webkit-autofill:hover,
        .auth-form input:-webkit-autofill:focus,
        .auth-form input:-webkit-autofill:active {
          -webkit-text-fill-color: #1a1a1a !important;
          -webkit-box-shadow: 0 0 0 1000px #fff inset !important;
          box-shadow: 0 0 0 1000px #fff inset !important;
          background-color: #fff !important;
          color: #1a1a1a !important;
          border: 1px solid #bbb !important;
          transition: background-color 5000s ease-in-out 0s;
        }

        .auth-form input:-webkit-autofill:focus {
          border-color: var(--accent-color, #a89990) !important;
        }

        .auth-form .form-hint {
          display: block;
          font-size: 0.75rem;
          color: #555;
          margin-top: 0.25rem;
        }

        .auth-form .form-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1rem;
        }

        .auth-submit-btn {
          width: 100%;
          padding: 1rem;
          background: var(--text-color, #1a1a1a);
          color: #fff;
          border: none;
          border-radius: 6px;
          font-size: 0.9rem;
          text-transform: uppercase;
          letter-spacing: 2px;
          cursor: pointer;
          transition: background 0.3s;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
        }

        .auth-submit-btn:hover:not(:disabled) {
          background: var(--accent-color, #a89990);
        }

        .auth-submit-btn:disabled {
          opacity: 0.7;
          cursor: not-allowed;
        }

        .auth-submit-btn .spinner {
          width: 18px;
          height: 18px;
          border: 2px solid rgba(255,255,255,0.3);
          border-top-color: #fff;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        .auth-modal-footer {
          margin-top: 1.5rem;
          text-align: center;
        }

        .auth-switch {
          font-size: 0.9rem;
          color: #666;
          margin-bottom: 0.5rem;
        }

        .auth-switch a {
          color: var(--accent-color, #a89990);
          text-decoration: none;
          font-weight: 500;
        }

        .auth-forgot {
          font-size: 0.85rem;
          color: #888;
          text-decoration: none;
        }

        .auth-forgot:hover {
          color: var(--accent-color, #a89990);
        }

        @media (max-width: 480px) {
          .auth-modal-content {
            padding: 1.5rem;
            margin: 1rem;
          }

          .auth-form .form-row {
            grid-template-columns: 1fr;
          }
        }
      </style>
    `;

    document.head.insertAdjacentHTML('beforeend', styles);
  }
}

// Export singleton instance
export const authModal = new AuthModal();
export default authModal;
