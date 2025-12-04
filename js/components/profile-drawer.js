/**
 * Profile Drawer Component
 * Mimmo Fratelli - E-commerce Food Fresh
 * 
 * Provides user profile UI with account info and actions
 */

import { authService } from '../services/auth.js';

/**
 * Profile Drawer Class
 */
class ProfileDrawer {
  constructor() {
    this.drawer = null;
    this.user = null;
  }

  /**
   * Initialize the drawer
   */
  init() {
    this._createDrawer();
    this._attachEventListeners();
  }

  /**
   * Show the drawer
   */
  async show() {
    this.user = await authService.getUser();
    this._updateContent();
    this.drawer.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  /**
   * Hide the drawer
   */
  hide() {
    this.drawer.classList.remove('active');
    document.body.style.overflow = '';
  }

  /**
   * Create drawer HTML structure
   * @private
   */
  _createDrawer() {
    if (document.getElementById('profileDrawer')) {
      this.drawer = document.getElementById('profileDrawer');
      return;
    }

    const drawerHTML = `
      <div class="profile-drawer-overlay" id="profileDrawer">
        <div class="profile-drawer-content">
          <button class="profile-drawer-close" aria-label="Chiudi">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
          
          <div class="profile-header">
            <div class="profile-avatar" id="profileAvatar">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                <circle cx="12" cy="7" r="4"/>
              </svg>
            </div>
            <div class="profile-info">
              <h2 class="profile-name" id="profileName">Utente</h2>
              <p class="profile-email" id="profileEmail">email@example.com</p>
            </div>
          </div>

          <!-- Credit Balance Section -->
          <div class="profile-credit-section" id="profileCreditSection">
            <div class="credit-balance">
              <div class="credit-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/>
                  <line x1="1" y1="10" x2="23" y2="10"/>
                </svg>
              </div>
              <div class="credit-info">
                <span class="credit-label">Il tuo credito</span>
                <span class="credit-value" id="creditBalance">€0.00</span>
              </div>
            </div>
          </div>

          <div class="profile-menu">
            <a href="#" class="profile-menu-item" id="profileGiftCard">
              <span class="menu-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <rect x="3" y="8" width="18" height="13" rx="2"/>
                  <path d="M12 8V21M3 12h18M7.5 8a2.5 2.5 0 0 1 0-5C9.5 3 12 8 12 8M16.5 8a2.5 2.5 0 0 0 0-5C14.5 3 12 8 12 8"/>
                </svg>
              </span>
              <span class="menu-text">Crea Gift Card</span>
              <span class="menu-arrow">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </span>
            </a>
            <a href="orders.html" class="profile-menu-item" id="profileOrders">
              <span class="menu-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <path d="M16.5 9.4l-9-5.19M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                  <polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>
                </svg>
              </span>
              <span class="menu-text">I miei ordini</span>
              <span class="menu-arrow">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </span>
            </a>
            <a href="wishlist.html" class="profile-menu-item" id="profileWishlist">
              <span class="menu-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                </svg>
              </span>
              <span class="menu-text">Lista preferiti</span>
              <span class="menu-arrow">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </span>
            </a>
            <a href="#" class="profile-menu-item" id="profileMyGiftCards">
              <span class="menu-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/>
                  <line x1="1" y1="10" x2="23" y2="10"/>
                </svg>
              </span>
              <span class="menu-text">Le mie Gift Card</span>
              <span class="menu-arrow">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </span>
            </a>
            <a href="settings.html" class="profile-menu-item" id="profileSettings">
              <span class="menu-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <circle cx="12" cy="12" r="3"/>
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                </svg>
              </span>
              <span class="menu-text">Impostazioni</span>
              <span class="menu-arrow">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </span>
            </a>
          </div>

          <div class="profile-stats">
            <div class="stat-item">
              <span class="stat-value" id="statOrders">0</span>
              <span class="stat-label">Ordini</span>
            </div>
            <div class="stat-item">
              <span class="stat-value" id="statWishlist">0</span>
              <span class="stat-label">Preferiti</span>
            </div>
            <div class="stat-item">
              <span class="stat-value" id="statGiftCards">0</span>
              <span class="stat-label">Gift Card</span>
            </div>
          </div>

          <div class="profile-footer">
            <button class="profile-logout-btn" id="profileLogout">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                <polyline points="16 17 21 12 16 7"/>
                <line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
              <span>Esci dall'account</span>
            </button>
            <p class="profile-version">Mimmo Fratelli v1.0</p>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', drawerHTML);
    this.drawer = document.getElementById('profileDrawer');
    
    this._addStyles();
  }

  /**
   * Attach event listeners
   * @private
   */
  _attachEventListeners() {
    // Close button
    this.drawer.querySelector('.profile-drawer-close').addEventListener('click', () => {
      this.hide();
    });

    // Click outside to close
    this.drawer.addEventListener('click', (e) => {
      if (e.target === this.drawer) {
        this.hide();
      }
    });

    // ESC key to close
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.drawer.classList.contains('active')) {
        this.hide();
      }
    });

    // Logout button
    document.getElementById('profileLogout').addEventListener('click', async () => {
      if (confirm('Sei sicuro di voler uscire?')) {
        await authService.signOut();
        this.hide();
        location.reload();
      }
    });

    // Wishlist link - close drawer before navigating
    document.getElementById('profileWishlist').addEventListener('click', () => {
      this.hide();
    });

    // Gift Card creator
    document.getElementById('profileGiftCard').addEventListener('click', (e) => {
      e.preventDefault();
      this.hide();
      this._showGiftCardCreator();
    });

    // My Gift Cards
    document.getElementById('profileMyGiftCards').addEventListener('click', (e) => {
      e.preventDefault();
      this._showMyGiftCards();
    });

    // Orders link - close drawer before navigating
    document.getElementById('profileOrders').addEventListener('click', () => {
      this.hide();
    });

    // Settings link - close drawer before navigating
    document.getElementById('profileSettings').addEventListener('click', () => {
      this.hide();
    });
  }

  /**
   * Update drawer content with user data
   * @private
   */
  _updateContent() {
    if (!this.user) return;

    const metadata = this.user.user_metadata || {};
    const firstName = metadata.first_name || '';
    const lastName = metadata.last_name || '';
    const fullName = `${firstName} ${lastName}`.trim() || 'Utente';
    
    document.getElementById('profileName').textContent = fullName;
    document.getElementById('profileEmail').textContent = this.user.email || '';
    
    // Update avatar with initials
    const initials = this._getInitials(fullName);
    const avatar = document.getElementById('profileAvatar');
    if (initials) {
      avatar.innerHTML = `<span class="avatar-initials">${initials}</span>`;
    }

    // Update stats
    this._updateWishlistCount();
    this._updateCreditBalance();
  }

  /**
   * Update wishlist count in stats
   * @private
   */
  async _updateWishlistCount() {
    try {
      // Import wishlistService dynamically to avoid circular dependency
      const { wishlistService } = await import('../services/wishlist.js');
      const { items } = await wishlistService.getAllFavorites();
      document.getElementById('statWishlist').textContent = items.length;
    } catch {
      document.getElementById('statWishlist').textContent = '0';
    }
  }

  /**
   * Update credit balance
   * @private
   */
  async _updateCreditBalance() {
    try {
      const { giftCardService } = await import('../services/giftcard.js');
      const credits = await giftCardService.getUserCredits();
      const balance = typeof credits.balance === 'number' ? credits.balance : 0;
      document.getElementById('creditBalance').textContent = `€${balance.toFixed(2)}`;
      
      // Update gift cards count
      const { giftCards } = await giftCardService.getMyGiftCards();
      document.getElementById('statGiftCards').textContent = giftCards?.length || 0;
    } catch (err) {
      console.log('Credit balance not available:', err?.message);
      document.getElementById('creditBalance').textContent = '€0.00';
      document.getElementById('statGiftCards').textContent = '0';
    }
  }

  /**
   * Show gift card creator modal
   * @private
   */
  _showGiftCardCreator() {
    // Create modal if not exists
    let modal = document.getElementById('giftCardCreatorModal');
    if (!modal) {
      this._createGiftCardModal();
      modal = document.getElementById('giftCardCreatorModal');
    }
    modal.classList.add('active');
  }

  /**
   * Create gift card creator modal
   * @private
   */
  _createGiftCardModal() {
    const modalHTML = `
      <div class="gc-modal-overlay" id="giftCardCreatorModal">
        <div class="gc-modal-content">
          <button class="gc-modal-close" onclick="document.getElementById('giftCardCreatorModal').classList.remove('active')">&times;</button>
          
          <div class="gc-modal-body">
            <div class="gc-form-section">
              <h2>🎁 Crea una Gift Card</h2>
              <p class="gc-subtitle">Regala un'esperienza di freschezza Mimmo Fratelli.</p>
              
              <form id="userGiftCardForm">
                <div class="gc-form-group">
                  <label>Importo *</label>
                  <div class="gc-amount-btns">
                    <button type="button" class="gc-amt-btn" data-amount="25">€25</button>
                    <button type="button" class="gc-amt-btn" data-amount="50">€50</button>
                    <button type="button" class="gc-amt-btn active" data-amount="100">€100</button>
                    <button type="button" class="gc-amt-btn" data-amount="150">€150</button>
                    <button type="button" class="gc-amt-btn" data-amount="200">€200</button>
                  </div>
                  <input type="number" id="gcUserCustomAmount" placeholder="Importo personalizzato (€10-€500)" min="10" max="500">
                </div>

                <div class="gc-form-group">
                  <label for="gcUserRecipient">Nome Destinatario *</label>
                  <input type="text" id="gcUserRecipient" required placeholder="Es. Maria Rossi" maxlength="50">
                </div>

                <div class="gc-form-group">
                  <label for="gcUserEmail">Email Destinatario *</label>
                  <input type="email" id="gcUserEmail" required placeholder="email@esempio.com">
                </div>

                <div class="gc-form-group">
                  <label for="gcUserMessage">Messaggio (opzionale)</label>
                  <textarea id="gcUserMessage" rows="2" placeholder="Scrivi un messaggio speciale..." maxlength="150"></textarea>
                </div>

                <div class="gc-form-group">
                  <label>Stile</label>
                  <div class="gc-style-btns">
                    <button type="button" class="gc-style-btn active" data-style="elegant">
                      <span class="gc-style-preview elegant"></span>
                      <span>Elegante</span>
                    </button>
                    <button type="button" class="gc-style-btn" data-style="avenue">
                      <span class="gc-style-preview avenue"></span>
                      <span>Nature</span>
                    </button>
                    <button type="button" class="gc-style-btn" data-style="minimal">
                      <span class="gc-style-preview minimal"></span>
                      <span>Minimal</span>
                    </button>
                    <button type="button" class="gc-style-btn" data-style="festive">
                      <span class="gc-style-preview festive"></span>
                      <span>Festivo</span>
                    </button>
                  </div>
                </div>

                <div class="gc-form-error" id="gcUserError"></div>

                <button type="submit" class="gc-submit-btn">
                  🎁 Crea Gift Card
                </button>
              </form>
            </div>

            <div class="gc-preview-section">
              <h3>Anteprima <span class="gc-3d-hint">🖱️ Trascina per ruotare</span></h3>
              <div class="gc-preview-wrapper gc-3d-scene" id="gc3dScene">
                <div class="gc-card-3d" id="gcCard3d">
                  <div class="gc-card-face gc-card-front">
                    <div class="gc-preview elegant" id="gcUserPreview">
                      <div class="gc-pattern"></div>
                      <div class="gc-header">
                        <div class="gc-logo">Mimmo Fratelli</div>
                        <div class="gc-badge">GIFT CARD</div>
                      </div>
                      <div class="gc-amount">€<span id="gcPreviewAmount">100</span></div>
                      <div class="gc-recipient">
                        <span class="gc-label">Per</span>
                        <span class="gc-name" id="gcPreviewRecipient">Nome Destinatario</span>
                      </div>
                      <div class="gc-message" id="gcPreviewMessage"></div>
                      <div class="gc-footer">
                        <div class="gc-from">
                          <span class="gc-label">Da</span>
                          <span id="gcPreviewSender">Te</span>
                        </div>
                        <div class="gc-code">XXXX-XXXX-XXXX</div>
                      </div>
                    </div>
                  </div>
                  <div class="gc-card-face gc-card-back">
                    <div class="gc-back-content elegant" id="gcBackContent">
                      <div class="gc-back-logo">Mimmo Fratelli</div>
                      <div class="gc-back-stripe"></div>
                      <div class="gc-back-info">
                        <p>Gift Card Mimmo Fratelli</p>
                        <p class="gc-back-terms">Valida 12 mesi dalla data di emissione</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div class="gc-rotate-controls">
                <button class="gc-rotate-btn" data-rotate="left">↺</button>
                <button class="gc-rotate-btn gc-auto-rotate" data-rotate="auto">⟳ Auto</button>
                <button class="gc-rotate-btn" data-rotate="right">↻</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
    this._addGiftCardModalStyles();
    this._attachGiftCardFormListeners();
  }

  /**
   * Attach gift card form listeners
   * @private
   */
  _attachGiftCardFormListeners() {
    // Amount buttons
    document.querySelectorAll('.gc-amt-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.gc-amt-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('gcUserCustomAmount').value = '';
        document.getElementById('gcPreviewAmount').textContent = btn.dataset.amount;
      });
    });

    // Custom amount
    document.getElementById('gcUserCustomAmount').addEventListener('input', (e) => {
      if (e.target.value) {
        document.querySelectorAll('.gc-amt-btn').forEach(b => b.classList.remove('active'));
        document.getElementById('gcPreviewAmount').textContent = e.target.value;
      }
    });

    // Style buttons
    document.querySelectorAll('.gc-style-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.gc-style-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const style = btn.dataset.style;
        const preview = document.getElementById('gcUserPreview');
        const backContent = document.getElementById('gcBackContent');
        preview.className = 'gc-preview ' + style;
        if (backContent) {
          backContent.className = 'gc-back-content ' + style;
        }
      });
    });

    // Live preview updates
    document.getElementById('gcUserRecipient').addEventListener('input', (e) => {
      document.getElementById('gcPreviewRecipient').textContent = e.target.value || 'Nome Destinatario';
    });

    document.getElementById('gcUserMessage').addEventListener('input', (e) => {
      document.getElementById('gcPreviewMessage').textContent = e.target.value;
    });

    // Form submit
    document.getElementById('userGiftCardForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      await this._handleGiftCardSubmit();
    });
    
    // Initialize 3D card rotation
    this._init3DCard();
  }
  
  /**
   * Initialize 3D card rotation
   * @private
   */
  _init3DCard() {
    const scene = document.getElementById('gc3dScene');
    const card = document.getElementById('gcCard3d');
    if (!scene || !card) return;
    
    let rotateX = 0;
    let rotateY = 0;
    let isDragging = false;
    let startX, startY;
    let autoRotate = false;
    let autoRotateInterval = null;
    
    // Mouse drag
    scene.addEventListener('mousedown', (e) => {
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      scene.style.cursor = 'grabbing';
    });
    
    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;
      rotateY += deltaX * 0.5;
      rotateX -= deltaY * 0.3;
      rotateX = Math.max(-30, Math.min(30, rotateX));
      card.style.transform = `rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
      startX = e.clientX;
      startY = e.clientY;
    });
    
    document.addEventListener('mouseup', () => {
      isDragging = false;
      scene.style.cursor = 'grab';
    });
    
    // Touch support
    scene.addEventListener('touchstart', (e) => {
      isDragging = true;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    });
    
    scene.addEventListener('touchmove', (e) => {
      if (!isDragging) return;
      e.preventDefault();
      const deltaX = e.touches[0].clientX - startX;
      const deltaY = e.touches[0].clientY - startY;
      rotateY += deltaX * 0.5;
      rotateX -= deltaY * 0.3;
      rotateX = Math.max(-30, Math.min(30, rotateX));
      card.style.transform = `rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    });
    
    scene.addEventListener('touchend', () => {
      isDragging = false;
    });
    
    // Rotation controls
    document.querySelectorAll('.gc-rotate-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.rotate;
        if (action === 'left') {
          rotateY -= 90;
          card.style.transform = `rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
        } else if (action === 'right') {
          rotateY += 90;
          card.style.transform = `rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
        } else if (action === 'auto') {
          autoRotate = !autoRotate;
          btn.classList.toggle('active', autoRotate);
          if (autoRotate && !autoRotateInterval) {
            autoRotateInterval = setInterval(() => {
              if (autoRotate && !isDragging) {
                rotateY += 0.8;
                card.style.transform = `rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
              }
            }, 30);
          } else if (!autoRotate && autoRotateInterval) {
            clearInterval(autoRotateInterval);
            autoRotateInterval = null;
          }
        }
      });
    });
  }

  /**
   * Handle gift card form submission
   * @private
   */
  async _handleGiftCardSubmit() {
    const errorEl = document.getElementById('gcUserError');
    const submitBtn = document.querySelector('.gc-submit-btn');
    
    const activeAmountBtn = document.querySelector('.gc-amt-btn.active');
    const customAmount = document.getElementById('gcUserCustomAmount').value;
    const amount = customAmount || (activeAmountBtn ? activeAmountBtn.dataset.amount : null);
    
    const recipientName = document.getElementById('gcUserRecipient').value;
    const recipientEmail = document.getElementById('gcUserEmail').value;
    const message = document.getElementById('gcUserMessage').value;
    const activeStyleBtn = document.querySelector('.gc-style-btn.active');
    const style = activeStyleBtn ? activeStyleBtn.dataset.style : 'elegant';

    // Get sender name from user metadata
    const senderName = this.user?.user_metadata?.first_name || 'Un amico';

    if (!amount || !recipientName || !recipientEmail) {
      errorEl.textContent = 'Compila tutti i campi obbligatori';
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Creazione in corso...';
    errorEl.textContent = '';

    try {
      const { giftCardService } = await import('../services/giftcard.js');
      const result = await giftCardService.createGiftCard({
        amount,
        recipientName,
        recipientEmail,
        senderName,
        message,
        style
      });

      if (result.error) {
        errorEl.textContent = result.error;
        submitBtn.disabled = false;
        submitBtn.textContent = '🎁 Crea Gift Card';
        return;
      }

      // If redirecting to Stripe, don't show success modal
      if (result.redirecting) {
        submitBtn.textContent = 'Reindirizzamento a Stripe...';
        return;
      }

      // Success - show QR code (only if gift card returned directly)
      if (result.giftCard) {
        this._showGiftCardSuccess(result.giftCard);
      }
    } catch (err) {
      errorEl.textContent = 'Errore durante la creazione';
      submitBtn.disabled = false;
      submitBtn.textContent = '🎁 Crea Gift Card';
    }
  }

  /**
   * Show gift card success with QR code
   * @private
   */
  async _showGiftCardSuccess(giftCard) {
    const { giftCardService } = await import('../services/giftcard.js');
    const qrUrl = giftCardService.getQRCodeUrl(giftCard.qr_code_token, 180);
    const style = giftCard.template || 'elegant';
    
    const modal = document.getElementById('giftCardCreatorModal');
    modal.querySelector('.gc-modal-body').innerHTML = `
      <div class="gc-success-wrapper">
        <div class="gc-success-header">
          <div class="gc-success-icon">🎉</div>
          <h2>Gift Card Creata!</h2>
          <p>La tua gift card è pronta per essere regalata</p>
        </div>
        
        <div class="gc-success-layout">
          <div class="gc-success-left">
            <div class="gc-3d-scene-success" id="gcSuccess3dScene">
              <div class="gc-card-3d gc-auto-spinning" id="gcSuccessCard3d">
                <div class="gc-card-face gc-card-front">
                  <div class="gc-preview ${style}">
                    <div class="gc-pattern"></div>
                    <div class="gc-header">
                      <div class="gc-logo">Mimmo Fratelli</div>
                      <div class="gc-badge">GIFT CARD</div>
                    </div>
                    <div class="gc-amount" style="${style === 'elegant' ? 'color:#f9ca24' : style === 'avenue' ? 'color:#fff' : style === 'minimal' ? 'color:#3d7c47' : ''}">€${giftCard.amount}</div>
                    <div class="gc-recipient">
                      <span class="gc-label">Per</span>
                      <span class="gc-name">${giftCard.recipient_name}</span>
                    </div>
                    ${giftCard.message ? `<div class="gc-message">${giftCard.message}</div>` : ''}
                    <div class="gc-footer">
                      <div class="gc-from">
                        <span class="gc-label">Da</span>
                        <span>${giftCard.sender_name}</span>
                      </div>
                      <div class="gc-code">${giftCard.code}</div>
                    </div>
                  </div>
                </div>
                <div class="gc-card-face gc-card-back">
                  <div class="gc-back-content ${style}">
                    <div class="gc-back-logo">Mimmo Fratelli</div>
                    <div class="gc-back-stripe"></div>
                    <div class="gc-back-qr">
                      <img src="${qrUrl}" alt="QR Code">
                    </div>
                    <div class="gc-back-info">
                      <p class="gc-back-terms">Scansiona per riscattare</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <p class="gc-3d-hint">🖱️ Clicca e trascina per ruotare</p>
          </div>
          
          <div class="gc-success-right">
            <div class="gc-info-grid">
              <div class="gc-qr-box">
                <img src="${qrUrl}" alt="QR Code">
                <span>QR Code</span>
              </div>
              <div class="gc-details-box">
                <div class="gc-detail-item">
                  <span class="gc-label">Codice</span>
                  <span class="gc-value gc-mono">${giftCard.code}</span>
                </div>
                <div class="gc-detail-item">
                  <span class="gc-label">Importo</span>
                  <span class="gc-value gc-highlight">€${giftCard.amount}</span>
                </div>
                <div class="gc-detail-item">
                  <span class="gc-label">Destinatario</span>
                  <span class="gc-value">${giftCard.recipient_name}</span>
                </div>
                <div class="gc-detail-item">
                  <span class="gc-label">Email</span>
                  <span class="gc-value gc-email">${giftCard.recipient_email}</span>
                </div>
              </div>
            </div>
            <div class="gc-note">
              📧 Un'email con il QR code verrà inviata al destinatario
            </div>
            
            <div class="gc-wallet-section">
              <div class="gc-wallet-title">Salva nel Wallet</div>
              <div class="gc-wallet-buttons">
                <button class="gc-wallet-btn gc-wallet-google" data-giftcard-id="${giftCard.id}" onclick="window.addGiftCardToGoogleWallet('${giftCard.id}')">
                  <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                  </svg>
                  Google Wallet
                </button>
                <button class="gc-wallet-btn gc-wallet-apple" data-giftcard-id="${giftCard.id}" onclick="window.addGiftCardToAppleWallet('${giftCard.id}')">
                  <svg viewBox="0 0 384 512" fill="currentColor" width="16" height="20">
                    <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"/>
                  </svg>
                  Apple Wallet
                </button>
              </div>
              <p class="gc-wallet-note">Aggiungi gratis con un click</p>
            </div>
          </div>
        </div>
        
        <button class="gc-done-btn" onclick="document.getElementById('giftCardCreatorModal').classList.remove('active'); location.reload();">
          ✓ Fatto
        </button>
      </div>
    `;
    
    // Initialize 3D rotation for success card
    this._init3DCardSuccess();
  }
  
  /**
   * Initialize 3D card rotation for success view
   * @private
   */
  _init3DCardSuccess() {
    const scene = document.getElementById('gcSuccess3dScene');
    const card = document.getElementById('gcSuccessCard3d');
    if (!scene || !card) return;
    
    let rotateX = 0;
    let rotateY = 0;
    let isDragging = false;
    let startX, startY;
    let autoRotate = true;
    let autoRotateInterval;
    
    // Auto rotate
    autoRotateInterval = setInterval(() => {
      if (autoRotate && !isDragging) {
        rotateY += 0.5;
        card.style.transform = `rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
      }
    }, 30);
    
    // Mouse/touch drag
    scene.addEventListener('mousedown', (e) => {
      isDragging = true;
      autoRotate = false;
      card.classList.remove('gc-auto-spinning');
      startX = e.clientX;
      startY = e.clientY;
    });
    
    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;
      rotateY += deltaX * 0.5;
      rotateX -= deltaY * 0.3;
      rotateX = Math.max(-30, Math.min(30, rotateX));
      card.style.transform = `rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
      startX = e.clientX;
      startY = e.clientY;
    });
    
    document.addEventListener('mouseup', () => {
      isDragging = false;
    });
    
    // Touch support
    scene.addEventListener('touchstart', (e) => {
      isDragging = true;
      autoRotate = false;
      card.classList.remove('gc-auto-spinning');
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    });
    
    scene.addEventListener('touchmove', (e) => {
      if (!isDragging) return;
      const deltaX = e.touches[0].clientX - startX;
      const deltaY = e.touches[0].clientY - startY;
      rotateY += deltaX * 0.5;
      rotateX -= deltaY * 0.3;
      rotateX = Math.max(-30, Math.min(30, rotateX));
      card.style.transform = `rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    });
    
    scene.addEventListener('touchend', () => {
      isDragging = false;
    });
  }

  /**
   * Show user's gift cards
   * @private
   */
  async _showMyGiftCards() {
    const { giftCardService } = await import('../services/giftcard.js');
    const { giftCards } = await giftCardService.getMyGiftCards();
    
    let content = '<h3 style="margin-bottom: 1rem;">Le mie Gift Card</h3>';
    
    if (giftCards.length === 0) {
      content += '<p style="color: #888; text-align: center; padding: 2rem;">Non hai ancora creato gift card.</p>';
    } else {
      content += '<div class="my-giftcards-list">';
      giftCards.forEach(gc => {
        const status = gc.is_redeemed ? 'Riscattata' : gc.is_active ? 'Attiva' : 'In attesa';
        const statusClass = gc.is_redeemed ? 'redeemed' : gc.is_active ? 'active' : 'pending';
        const qrUrl = giftCardService.getQRCodeUrl(gc.qr_code_token, 80);
        content += `
          <div class="my-gc-item" style="display: flex; flex-direction: column; gap: 0.75rem; padding: 1rem; background: #f8f9fa; border-radius: 12px; margin-bottom: 0.75rem;">
            <div style="display: flex; gap: 1rem; align-items: center;">
              <img src="${qrUrl}" alt="QR" style="width: 70px; height: 70px; border-radius: 8px; flex-shrink: 0;">
              <div class="my-gc-info" style="flex: 1; min-width: 0;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.25rem;">
                  <span class="my-gc-amount" style="font-size: 1.25rem; font-weight: 700; color: var(--primary);">€${gc.amount}</span>
                  <span class="my-gc-status ${statusClass}" style="font-size: 0.7rem; padding: 0.2rem 0.5rem; border-radius: 4px; background: ${statusClass === 'active' ? '#d4edda' : statusClass === 'pending' ? '#fff3cd' : '#f8d7da'}; color: ${statusClass === 'active' ? '#155724' : statusClass === 'pending' ? '#856404' : '#721c24'};">${status.toUpperCase()}</span>
                </div>
                <div style="font-size: 0.85rem; color: #666; margin-bottom: 0.25rem;">Per: ${gc.recipient_name}</div>
                <div class="my-gc-code" style="font-family: monospace; font-size: 0.75rem; color: #999;">${gc.code}</div>
              </div>
            </div>
            <div class="my-gc-wallet-btns" style="display: flex; gap: 0.5rem; justify-content: flex-end;">
              <button class="my-gc-wallet-btn" data-wallet="google" data-gc-id="${gc.id}" style="display: flex; align-items: center; gap: 0.3rem; padding: 0.4rem 0.6rem; border: 1px solid #ddd; border-radius: 6px; background: white; font-size: 0.7rem; cursor: pointer; transition: all 0.2s;">
                <svg viewBox="0 0 24 24" fill="#4285f4" width="14" height="14"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34a853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#fbbc05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#ea4335"/></svg>
                Google
              </button>
              <button class="my-gc-wallet-btn" data-wallet="apple" data-gc-id="${gc.id}" style="display: flex; align-items: center; gap: 0.3rem; padding: 0.4rem 0.6rem; border: 1px solid #ddd; border-radius: 6px; background: white; font-size: 0.7rem; cursor: pointer; transition: all 0.2s;">
                <svg viewBox="0 0 384 512" fill="#000" width="12" height="14"><path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"/></svg>
                Apple
              </button>
            </div>
          </div>
        `;
      });
      content += '</div>';
    }
    
    content += '<button class="gc-back-btn">← Indietro</button>';
    
    const overlay = document.createElement('div');
    overlay.className = 'my-gc-overlay';
    overlay.innerHTML = `<div class="my-gc-content">${content}</div>`;
    this.drawer.querySelector('.profile-drawer-content').appendChild(overlay);
    
    // Attach back button listener to remove the entire overlay
    overlay.querySelector('.gc-back-btn').addEventListener('click', () => {
      overlay.remove();
    });
    
    // Attach wallet button listeners
    overlay.querySelectorAll('.my-gc-wallet-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const wallet = btn.dataset.wallet;
        const gcId = btn.dataset.gcId;
        btn.disabled = true;
        btn.style.opacity = '0.6';
        btn.innerHTML = wallet === 'google' ? 'Caricamento...' : 'Caricamento...';
        
        if (wallet === 'google') {
          await this._addToGoogleWallet(gcId);
        } else if (wallet === 'apple') {
          alert('Funzionalità Apple Wallet in arrivo! Scansiona il QR code con il tuo iPhone.');
        }
        
        btn.disabled = false;
        btn.style.opacity = '1';
        btn.innerHTML = wallet === 'google' 
          ? '<svg viewBox="0 0 24 24" fill="#4285f4" width="14" height="14"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34a853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#fbbc05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#ea4335"/></svg> Google'
          : '<svg viewBox="0 0 384 512" fill="#000" width="12" height="14"><path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"/></svg> Apple';
      });
    });
  }

  /**
   * Add gift card to Google Wallet
   * @private
   */
  async _addToGoogleWallet(giftCardId) {
    try {
      const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
      const supabaseUrl = window.SUPABASE_URL || 'https://onvufwqybriaoadsdjyk.supabase.co';
      const supabaseKey = window.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9udnVmd3F5YnJpYW9hZHNkanlrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzI5OTQ3NjUsImV4cCI6MjA0ODU3MDc2NX0.lPPcPmjCjMqhPoBotbKauVHBTmRS-E0-uFKJXudnBPY';
      
      // Use existing supabase instance if available
      const supabase = window.supabase || createClient(supabaseUrl, supabaseKey);
      
      const { data, error } = await supabase.functions.invoke('add-to-wallet', {
        body: { giftCardId, walletType: 'google' }
      });
      
      if (error) {
        console.error('Google Wallet error:', error);
        alert('Errore durante l\'aggiunta al wallet. Riprova.');
        return;
      }
      
      if (data?.walletUrl) {
        window.open(data.walletUrl, '_blank');
      } else {
        alert('Errore: URL wallet non disponibile');
      }
    } catch (err) {
      console.error('Google Wallet error:', err);
      alert('Errore durante l\'aggiunta al wallet. Riprova.');
    }
  }

  /**
   * Get initials from name
   * @private
   */
  _getInitials(name) {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }

  /**
   * Add component styles
   * @private
   */
  _addStyles() {
    // Remove old styles and re-inject to ensure updates
    const oldStyles = document.getElementById('profileDrawerStyles');
    if (oldStyles) oldStyles.remove();

    const styles = `
      <style id="profileDrawerStyles">
        .profile-drawer-overlay {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(31, 45, 31, 0.5);
          backdrop-filter: blur(8px);
          z-index: 1000;
          opacity: 0;
          visibility: hidden;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .profile-drawer-overlay.active {
          opacity: 1;
          visibility: visible;
        }

        .profile-drawer-content {
          position: absolute;
          top: 0;
          right: 0;
          width: 100%;
          max-width: 380px;
          height: 100%;
          background: linear-gradient(180deg, #fafcf8 0%, #f5f8f2 100%);
          box-shadow: -12px 0 40px rgba(31, 45, 31, 0.15);
          transform: translateX(100%);
          transition: transform 0.35s cubic-bezier(0.4, 0, 0.2, 1);
          display: flex;
          flex-direction: column;
          overflow-y: auto;
          overflow-x: hidden;
        }

        .profile-drawer-overlay.active .profile-drawer-content {
          transform: translateX(0);
        }

        .profile-drawer-close {
          position: absolute;
          top: 0.75rem;
          right: 0.75rem;
          background: rgba(255,255,255,0.15);
          border: none;
          cursor: pointer;
          color: #fff;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          width: 36px;
          height: 36px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          z-index: 10;
          backdrop-filter: blur(4px);
        }

        .profile-drawer-close:hover {
          background: rgba(255,255,255,0.25);
          transform: rotate(90deg);
        }

        .profile-header {
          padding: 3rem 1.75rem 2.25rem;
          background: linear-gradient(135deg, #2d5c35 0%, #3d7c47 50%, #4a8c52 100%);
          color: #fff;
          display: flex;
          align-items: center;
          gap: 1.25rem;
          position: relative;
          overflow: hidden;
        }

        .profile-header::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: repeating-linear-gradient(45deg, transparent, transparent 35px, rgba(255,255,255,0.03) 35px, rgba(255,255,255,0.03) 36px);
          pointer-events: none;
        }

        .profile-avatar {
          width: 64px;
          height: 64px;
          background: linear-gradient(135deg, #6ab04c, #5a9963);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #fff;
          flex-shrink: 0;
          position: relative;
          box-shadow: 0 4px 15px rgba(0,0,0,0.2);
        }

        .avatar-initials {
          font-family: 'DM Serif Display', Georgia, serif;
          font-size: 1.6rem;
          font-weight: 600;
          font-style: italic;
        }

        .profile-info {
          flex: 1;
          min-width: 0;
          position: relative;
        }

        .profile-name {
          font-family: 'DM Serif Display', Georgia, serif;
          font-size: 1.4rem;
          font-style: italic;
          font-weight: 400;
          margin: 0 0 0.6rem;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          line-height: 1.2;
        }

        .profile-email {
          font-size: 0.72rem;
          color: rgba(255,255,255,0.65);
          margin: 0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          letter-spacing: 0.5px;
        }

        .profile-credit-section {
          padding: 0;
          background: transparent;
          margin: 0;
        }

        .credit-balance {
          display: flex;
          align-items: center;
          gap: 1rem;
          padding: 1.1rem 1.75rem 1.1rem 2.5rem;
          background: linear-gradient(135deg, #5a9963, #6ab04c);
          color: #fff;
        }

        .credit-icon {
          width: 40px;
          height: 40px;
          background: rgba(255,255,255,0.15);
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .credit-info {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 0.15rem;
        }

        .credit-label {
          font-size: 0.65rem;
          text-transform: uppercase;
          letter-spacing: 1.5px;
          opacity: 0.85;
          font-family: 'Inter', sans-serif;
        }

        .credit-value {
          font-family: 'DM Serif Display', Georgia, serif;
          font-size: 1.6rem;
          font-weight: 600;
          line-height: 1;
        }

        .profile-menu {
          padding: 1.5rem 1.25rem;
          flex: 1;
        }

        .profile-menu-item {
          display: flex;
          align-items: center;
          gap: 1rem;
          padding: 1rem 1.15rem;
          background: #fff;
          border-radius: 14px;
          margin-bottom: 0.6rem;
          text-decoration: none;
          color: #1f2d1f;
          transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
          border: 1px solid transparent;
          box-shadow: 0 2px 8px rgba(31, 45, 31, 0.04);
        }

        .profile-menu-item:hover {
          border-color: #e4ebe4;
          transform: translateX(6px);
          box-shadow: 0 4px 15px rgba(31, 45, 31, 0.08);
        }

        .menu-icon {
          width: 42px;
          height: 42px;
          background: linear-gradient(135deg, #f5f8f2, #e8f0e5);
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #3d7c47;
          transition: all 0.25s ease;
        }

        .profile-menu-item:hover .menu-icon {
          background: linear-gradient(135deg, #2d5c35, #3d7c47);
          color: #fff;
        }

        .menu-text {
          flex: 1;
          font-size: 0.9rem;
          font-weight: 500;
          font-family: 'Inter', sans-serif;
        }

        .menu-arrow {
          color: #ccc;
          display: flex;
          align-items: center;
          transition: all 0.25s ease;
        }

        .profile-menu-item:hover .menu-arrow {
          transform: translateX(4px);
          color: #3d7c47;
        }

        .profile-stats {
          display: flex;
          justify-content: space-around;
          padding: 1.5rem;
          background: #fff;
          margin: 0 1.25rem;
          border-radius: 16px;
          border: 1px solid #e4ebe4;
          box-shadow: 0 4px 15px rgba(31, 45, 31, 0.04);
        }

        .stat-item {
          text-align: center;
          position: relative;
        }

        .stat-item:not(:last-child)::after {
          content: '';
          position: absolute;
          right: -30px;
          top: 50%;
          transform: translateY(-50%);
          width: 1px;
          height: 30px;
          background: #e4ebe4;
        }

        .stat-value {
          display: block;
          font-family: 'DM Serif Display', Georgia, serif;
          font-size: 1.75rem;
          font-weight: 600;
          color: #1f2d1f;
          line-height: 1;
        }

        .stat-label {
          font-size: 0.65rem;
          text-transform: uppercase;
          letter-spacing: 1px;
          color: #5a6b5a;
          margin-top: 0.3rem;
          display: block;
          font-family: 'Inter', sans-serif;
        }

        .profile-footer {
          padding: 1.5rem 1.25rem;
          margin-top: auto;
          background: linear-gradient(180deg, transparent, rgba(31, 45, 31, 0.02));
        }

        .profile-logout-btn {
          width: 100%;
          padding: 1rem;
          background: transparent;
          border: 1.5px solid #e4ebe4;
          color: #5a6b5a;
          border-radius: 12px;
          font-family: 'Inter', sans-serif;
          font-size: 0.75rem;
          text-transform: uppercase;
          letter-spacing: 2px;
          cursor: pointer;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          font-weight: 500;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.6rem;
        }

        .profile-logout-btn:hover {
          background: #d63031;
          border-color: #d63031;
          color: #fff;
        }

        .profile-version {
          text-align: center;
          font-size: 0.7rem;
          color: #5a6b5a;
          margin-top: 1rem;
          font-family: 'Inter', sans-serif;
        }

        /* My Gift Cards Overlay */
        .my-gc-overlay {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: #fff;
          padding: 1.5rem;
          overflow-y: auto;
          z-index: 10;
        }

        .my-giftcards-list {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }

        .my-gc-item {
          background: #f5f8f2;
          padding: 1rem;
          border-radius: 8px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .my-gc-info {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }

        .my-gc-amount {
          font-weight: 700;
          font-size: 1.2rem;
          color: #3d7c47;
        }

        .my-gc-recipient {
          font-size: 0.85rem;
          color: #5a6b5a;
        }

        .my-gc-status {
          font-size: 0.7rem;
          text-transform: uppercase;
          padding: 0.2rem 0.5rem;
          border-radius: 10px;
          display: inline-block;
          width: fit-content;
        }

        .my-gc-status.active {
          background: #d1fae5;
          color: #065f46;
        }

        .my-gc-status.redeemed {
          background: #fee2e2;
          color: #991b1b;
        }

        .my-gc-code {
          font-family: monospace;
          font-size: 0.75rem;
          color: #5a6b5a;
        }

        .gc-back-btn {
          margin-top: 1.5rem;
          padding: 0.75rem 1.5rem;
          background: transparent;
          border: 1px solid #e4ebe4;
          border-radius: 8px;
          cursor: pointer;
          width: 100%;
          transition: all 0.2s;
        }

        .gc-back-btn:hover {
          background: #3d7c47;
          border-color: #3d7c47;
          color: #fff;
        }

        @media (max-width: 480px) {
          .profile-drawer-content {
            max-width: 100%;
          }

          .profile-header {
            padding: 2.5rem 1.5rem 2.5rem;
          }

          .credit-balance {
            padding-left: 2.25rem;
          }

          .profile-stats {
            margin: 0 1rem;
          }
        }
      </style>
    `;

    document.head.insertAdjacentHTML('beforeend', styles);
  }

  /**
   * Add gift card modal styles
   * @private
   */
  _addGiftCardModalStyles() {
    if (document.getElementById('giftCardModalStyles')) return;

    const styles = `
      <style id="giftCardModalStyles">
        .gc-modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(0,0,0,0.6);
          z-index: 2000;
          display: flex;
          align-items: center;
          justify-content: center;
          opacity: 0;
          visibility: hidden;
          transition: all 0.3s;
          padding: 1rem;
        }

        .gc-modal-overlay.active {
          opacity: 1;
          visibility: visible;
        }

        .gc-modal-content {
          background: #fff;
          border-radius: 16px;
          max-width: 950px;
          width: 95%;
          max-height: 90vh;
          overflow-y: auto;
          position: relative;
        }

        .gc-modal-close {
          position: absolute;
          top: 1rem;
          right: 1rem;
          background: none;
          border: none;
          font-size: 2rem;
          cursor: pointer;
          z-index: 10;
          color: #666;
        }

        .gc-modal-body {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 2rem;
        }

        .gc-form-section {
          padding: 2rem;
        }

        .gc-form-section h2 {
          margin: 0 0 0.5rem;
          font-size: 1.5rem;
        }

        .gc-subtitle {
          color: #888;
          margin: 0 0 1.5rem;
        }

        .gc-form-group {
          margin-bottom: 1.25rem;
        }

        .gc-form-group label {
          display: block;
          font-size: 0.8rem;
          font-weight: 600;
          margin-bottom: 0.5rem;
        }

        .gc-form-group input,
        .gc-form-group textarea {
          width: 100%;
          padding: 0.75rem;
          border: 1px solid #ddd;
          border-radius: 8px;
          font-size: 0.9rem;
        }

        .gc-amount-btns {
          display: flex;
          gap: 0.5rem;
          flex-wrap: wrap;
          margin-bottom: 0.5rem;
        }

        .gc-amt-btn {
          padding: 0.6rem 1rem;
          border: 2px solid #e0e0e0;
          background: #fff;
          border-radius: 6px;
          cursor: pointer;
          font-weight: 600;
          transition: all 0.2s;
        }

        .gc-amt-btn:hover {
          border-color: #3d7c47;
        }

        .gc-amt-btn.active {
          background: #3d7c47;
          color: #fff;
          border-color: #3d7c47;
        }

        .gc-style-btns {
          display: flex;
          gap: 0.75rem;
        }

        .gc-style-btn {
          flex: 1;
          padding: 0.75rem;
          border: 2px solid #e0e0e0;
          background: #fff;
          border-radius: 8px;
          cursor: pointer;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.5rem;
          transition: all 0.2s;
        }

        .gc-style-btn.active {
          border-color: #3d7c47;
          background: rgba(61, 124, 71, 0.08);
        }

        .gc-style-preview {
          width: 40px;
          height: 25px;
          border-radius: 3px;
        }

        .gc-style-preview.elegant {
          background: linear-gradient(135deg, #2d5c35, #3d7c47);
        }

        .gc-style-preview.minimal {
          background: #fff;
          border: 1px solid #e4ebe4;
        }

        .gc-style-preview.festive {
          background: linear-gradient(135deg, #e8722a, #f59d5e);
        }

        .gc-form-error {
          color: #d63031;
          font-size: 0.85rem;
          min-height: 1.2rem;
        }

        .gc-submit-btn {
          width: 100%;
          padding: 1rem;
          background: linear-gradient(135deg, #3d7c47, #5a9963);
          color: #fff;
          border: none;
          border-radius: 8px;
          font-size: 1rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s;
        }

        .gc-submit-btn:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 4px 15px rgba(61, 124, 71, 0.4);
        }

        .gc-submit-btn:disabled {
          opacity: 0.7;
          cursor: not-allowed;
        }

        .gc-preview-section {
          background: #f5f5f5;
          padding: 2rem;
          display: flex;
          flex-direction: column;
          border-radius: 0 16px 16px 0;
        }

        .gc-preview-section h3 {
          margin: 0 0 1rem;
          color: #666;
        }

        .gc-preview-wrapper {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .gc-preview {
          width: 320px;
          height: 200px;
          border-radius: 12px;
          padding: 1.25rem;
          position: relative;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          box-shadow: 0 15px 40px rgba(0,0,0,0.2);
        }

        .gc-preview.elegant {
          background: linear-gradient(135deg, #2d5c35, #3d7c47);
          color: #fff;
        }

        .gc-preview.minimal {
          background: #fff;
          color: #1f2d1f;
          border: 1px solid #e4ebe4;
        }

        .gc-preview.festive {
          background: linear-gradient(135deg, #e8722a, #f59d5e);
          color: #fff;
        }

        .gc-pattern {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-image: repeating-linear-gradient(45deg, transparent, transparent 15px, rgba(255,255,255,0.02) 15px, rgba(255,255,255,0.02) 16px);
          pointer-events: none;
        }

        .gc-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          position: relative;
          z-index: 1;
        }

        .gc-logo {
          font-family: 'DM Serif Display', Georgia, serif;
          font-size: 1.2rem;
          font-style: italic;
          font-weight: 600;
        }

        .gc-badge {
          font-size: 0.5rem;
          letter-spacing: 1.5px;
          padding: 0.2rem 0.4rem;
          border-radius: 3px;
          background: rgba(255,255,255,0.15);
        }

        .gc-preview.minimal .gc-badge {
          background: #3d7c47;
          color: #fff;
        }

        .gc-amount {
          font-family: 'DM Serif Display', Georgia, serif;
          font-size: 2.5rem;
          font-weight: 700;
          position: relative;
          z-index: 1;
        }

        .gc-preview.elegant .gc-amount {
          color: #f9ca24;
        }

        .gc-preview.minimal .gc-amount {
          color: #3d7c47;
        }

        .gc-recipient {
          position: relative;
          z-index: 1;
          margin-bottom: 0.25rem;
        }

        .gc-label {
          font-size: 0.6rem;
          text-transform: uppercase;
          letter-spacing: 1px;
          opacity: 0.7;
          display: block;
        }

        .gc-name {
          font-family: 'DM Serif Display', Georgia, serif;
          font-size: 1.1rem;
          font-style: italic;
        }

        .gc-message {
          font-size: 0.7rem;
          font-style: italic;
          opacity: 0.8;
          line-height: 1.3;
          max-height: 35px;
          overflow: hidden;
          position: relative;
          z-index: 1;
        }

        .gc-footer {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          margin-top: auto;
          position: relative;
          z-index: 1;
        }

        .gc-from {
          font-size: 0.75rem;
        }

        .gc-code {
          font-family: monospace;
          font-size: 0.6rem;
          letter-spacing: 1px;
          background: rgba(255,255,255,0.1);
          padding: 0.3rem 0.5rem;
          border-radius: 3px;
        }

        /* Nature Style */
        .gc-preview.avenue {
          background: linear-gradient(135deg, #6ab04c 0%, #00b894 50%, #6ab04c 100%);
          color: #fff;
        }
        
        .gc-preview.avenue .gc-amount {
          color: #fff;
          text-shadow: 0 2px 10px rgba(0,0,0,0.15);
        }
        
        .gc-preview.avenue .gc-badge {
          background: rgba(255,255,255,0.25);
        }
        
        .gc-style-preview.avenue {
          background: linear-gradient(135deg, #6ab04c, #00b894);
        }

        /* 3D Card Styles */
        .gc-3d-hint {
          font-size: 0.7rem;
          color: #999;
          font-weight: 400;
          margin-left: 0.5rem;
        }
        
        .gc-3d-scene {
          perspective: 1000px;
          cursor: grab;
          user-select: none;
          -webkit-user-select: none;
          -moz-user-select: none;
          -ms-user-select: none;
        }
        
        .gc-3d-scene * {
          user-select: none;
          -webkit-user-select: none;
        }
        
        .gc-card-3d {
          width: 320px;
          height: 200px;
          position: relative;
          transform-style: preserve-3d;
          transition: transform 0.1s ease-out;
        }
        
        .gc-card-face {
          position: absolute;
          width: 100%;
          height: 100%;
          backface-visibility: hidden;
          border-radius: 12px;
          overflow: hidden;
        }
        
        .gc-card-front {
          z-index: 2;
        }
        
        .gc-card-front .gc-preview {
          width: 100%;
          height: 100%;
          box-shadow: 0 25px 50px rgba(0,0,0,0.3);
        }
        
        .gc-card-back {
          transform: rotateY(180deg);
        }
        
        .gc-back-content {
          width: 100%;
          height: 100%;
          padding: 1.25rem;
          display: flex;
          flex-direction: column;
          box-shadow: 0 25px 50px rgba(0,0,0,0.3);
          border-radius: 12px;
        }
        
        .gc-back-content.elegant {
          background: linear-gradient(135deg, #3d7c47, #2d5c35);
          color: #fff;
        }
        
        .gc-back-content.avenue {
          background: linear-gradient(135deg, #00b894, #6ab04c);
          color: #fff;
        }
        
        .gc-back-content.minimal {
          background: #fafcf8;
          color: #1f2d1f;
          border: 1px solid #e4ebe4;
        }
        
        .gc-back-content.festive {
          background: linear-gradient(135deg, #f59d5e, #e8722a);
          color: #fff;
        }
        
        .gc-back-logo {
          font-family: 'DM Serif Display', Georgia, serif;
          font-size: 1.5rem;
          font-style: italic;
          font-weight: 600;
          text-align: center;
          margin-bottom: 0.75rem;
        }
        
        .gc-back-stripe {
          height: 35px;
          background: rgba(0,0,0,0.2);
          margin: 0 -1.25rem;
        }
        
        .gc-back-content.minimal .gc-back-stripe {
          background: #3d7c47;
        }
        
        .gc-back-qr {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        
        .gc-back-qr img {
          width: 80px;
          height: 80px;
          border-radius: 6px;
          background: #fff;
          padding: 4px;
        }
        
        .gc-back-info {
          text-align: center;
        }
        
        .gc-back-terms {
          font-size: 0.65rem;
          opacity: 0.7;
        }
        
        .gc-rotate-controls {
          display: flex;
          justify-content: center;
          gap: 0.5rem;
          margin-top: 1rem;
        }
        
        .gc-rotate-btn {
          padding: 0.5rem 1rem;
          background: #fff;
          border: 1px solid #ddd;
          border-radius: 6px;
          cursor: pointer;
          font-size: 1rem;
          transition: all 0.2s;
        }
        
        .gc-rotate-btn:hover, .gc-rotate-btn.active {
          background: #3d7c47;
          color: #fff;
          border-color: #3d7c47;
        }
        
        .gc-auto-rotate {
          font-size: 0.8rem;
        }

        /* ===== SUCCESS STATE - NEW LAYOUT ===== */
        .gc-success-wrapper {
          padding: 2.5rem 3rem;
          text-align: center;
        }
        
        .gc-success-header {
          margin-bottom: 2rem;
        }
        
        .gc-success-header .gc-success-icon {
          font-size: 3rem;
          line-height: 1;
          margin-bottom: 0.75rem;
        }
        
        .gc-success-header h2 {
          color: #3d7c47;
          margin: 0 0 0.5rem;
          font-size: 1.75rem;
          font-weight: 600;
        }
        
        .gc-success-header p {
          color: #666;
          margin: 0;
          font-size: 0.95rem;
        }
        
        /* Desktop: Two columns - card left, info right */
        .gc-success-layout {
          display: flex;
          gap: 2.5rem;
          align-items: stretch;
          margin-bottom: 2rem;
        }
        
        .gc-success-left {
          flex: 0 0 340px;
          background: linear-gradient(145deg, #f5f5f5, #fafafa);
          border-radius: 16px;
          padding: 1.5rem;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
        }
        
        .gc-3d-scene-success {
          perspective: 1000px;
          cursor: grab;
          user-select: none;
          -webkit-user-select: none;
        }
        
        .gc-3d-scene-success * {
          user-select: none;
          -webkit-user-select: none;
        }
        
        .gc-3d-hint {
          font-size: 0.8rem;
          color: #999;
          margin-top: 1.25rem;
        }
        
        .gc-auto-spinning {
          animation: autoSpin 8s linear infinite;
        }
        
        @keyframes autoSpin {
          from { transform: rotateY(0deg); }
          to { transform: rotateY(360deg); }
        }
        
        .gc-success-right {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
          min-width: 0;
        }
        
        /* QR + Details side by side on desktop */
        .gc-info-grid {
          display: flex;
          gap: 1rem;
          align-items: stretch;
        }
        
        .gc-qr-box {
          flex: 0 0 130px;
          background: #fff;
          border: 1px solid #e8e8e8;
          border-radius: 12px;
          padding: 1rem;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          box-shadow: 0 2px 8px rgba(0,0,0,0.04);
        }
        
        .gc-qr-box img {
          width: 90px;
          height: 90px;
          border-radius: 8px;
        }
        
        .gc-qr-box span {
          font-size: 0.75rem;
          color: #888;
          margin-top: 0.5rem;
          font-weight: 500;
        }
        
        .gc-details-box {
          flex: 1;
          background: #fff;
          border: 1px solid #e8e8e8;
          border-radius: 12px;
          padding: 1rem 1.25rem;
          box-shadow: 0 2px 8px rgba(0,0,0,0.04);
          min-width: 0;
        }
        
        .gc-detail-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0.5rem 0;
          border-bottom: 1px solid #f0f0f0;
          gap: 1rem;
        }
        
        .gc-detail-item:last-child {
          border-bottom: none;
          padding-bottom: 0;
        }
        
        .gc-detail-item:first-child {
          padding-top: 0;
        }
        
        .gc-detail-item .gc-label {
          font-size: 0.8rem;
          color: #888;
          font-weight: 500;
          display: inline;
          text-transform: none;
          letter-spacing: 0;
          opacity: 1;
          white-space: nowrap;
          flex-shrink: 0;
        }
        
        .gc-detail-item .gc-value {
          font-size: 0.85rem;
          font-weight: 600;
          color: #333;
          text-align: right;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        
        .gc-detail-item .gc-mono {
          font-family: 'SF Mono', Monaco, Consolas, monospace;
          letter-spacing: 0.3px;
          font-size: 0.8rem;
        }
        
        .gc-detail-item .gc-highlight {
          color: #3d7c47;
          font-size: 1rem;
          font-weight: 700;
        }
        
        .gc-detail-item .gc-email {
          font-size: 0.8rem;
        }
        
        .gc-note {
          background: linear-gradient(135deg, #f0f9f0, #e8f5e8);
          border: 1px solid #c8e6c9;
          border-radius: 10px;
          padding: 1rem 1.25rem;
          font-size: 0.9rem;
          color: #2d5c35;
          text-align: left;
          line-height: 1.4;
        }
        
        /* Wallet Section Styles */
        .gc-wallet-section {
          margin-top: 1.25rem;
          padding-top: 1.25rem;
          border-top: 1px solid #e4ebe4;
          text-align: center;
        }
        
        .gc-wallet-title {
          font-size: 0.8rem;
          color: #888;
          text-transform: uppercase;
          letter-spacing: 1px;
          margin-bottom: 0.75rem;
        }
        
        .gc-wallet-buttons {
          display: flex;
          gap: 0.75rem;
          justify-content: center;
          flex-wrap: wrap;
        }
        
        .gc-wallet-btn {
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.7rem 1.1rem;
          border: none;
          border-radius: 8px;
          font-size: 0.85rem;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.3s;
        }
        
        .gc-wallet-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        
        .gc-wallet-google {
          background: #2d5c35;
          color: #fff;
        }
        
        .gc-wallet-google:hover:not(:disabled) {
          background: #3d7c47;
          transform: translateY(-1px);
        }
        
        .gc-wallet-apple {
          background: #1f2d1f;
          color: #fff;
        }
        
        .gc-wallet-apple:hover:not(:disabled) {
          background: #2d3d2d;
          transform: translateY(-1px);
        }
        
        .gc-wallet-btn svg {
          width: 18px;
          height: 18px;
        }
        
        .gc-wallet-note {
          font-size: 0.75rem;
          color: #999;
          margin-top: 0.6rem;
        }
        
        .gc-done-btn {
          width: 100%;
          max-width: 280px;
          margin: 0 auto;
          padding: 1rem 2rem;
          background: linear-gradient(135deg, #3d7c47, #5a9963);
          color: #fff;
          border: none;
          border-radius: 10px;
          font-size: 1rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s;
        }
        
        .gc-done-btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 15px rgba(61, 124, 71, 0.4);
        }

        /* ===== TABLET (768-1024px) ===== */
        @media (max-width: 1024px) and (min-width: 769px) {
          .gc-success-wrapper {
            padding: 2rem;
          }
          
          .gc-success-left {
            flex: 0 0 320px;
            padding: 1.5rem;
          }
          
          .gc-preview, .gc-card-3d {
            width: 280px;
            height: 175px;
          }
          
          .gc-qr-box {
            flex: 0 0 140px;
            padding: 1rem;
          }
          
          .gc-qr-box img {
            width: 90px;
            height: 90px;
          }
          
          .gc-details-box {
            padding: 1rem 1.25rem;
          }
        }

        /* ===== MOBILE (<768px) ===== */
        @media (max-width: 768px) {
          .gc-modal-body {
            grid-template-columns: 1fr;
          }

          .gc-preview-section {
            border-radius: 0;
            padding: 1.5rem;
          }
          
          .gc-success-wrapper {
            padding: 1.5rem 1rem;
          }
          
          .gc-success-header {
            margin-bottom: 1.5rem;
          }
          
          .gc-success-header .gc-success-icon {
            font-size: 2.5rem;
          }
          
          .gc-success-header h2 {
            font-size: 1.4rem;
          }
          
          .gc-success-header p {
            font-size: 0.9rem;
          }
          
          .gc-success-layout {
            flex-direction: column;
            gap: 1.25rem;
            margin-bottom: 1.5rem;
          }
          
          .gc-success-left {
            flex: none;
            padding: 1.25rem;
            border-radius: 12px;
          }
          
          .gc-preview, .gc-card-3d {
            width: 260px;
            height: 162px;
          }
          
          .gc-3d-hint {
            font-size: 0.75rem;
            margin-top: 1rem;
          }
          
          .gc-info-grid {
            flex-direction: column;
            gap: 1rem;
          }
          
          .gc-qr-box {
            flex: none;
            padding: 1rem;
          }
          
          .gc-qr-box img {
            width: 100px;
            height: 100px;
          }
          
          .gc-details-box {
            padding: 1rem;
          }
          
          .gc-detail-item {
            padding: 0.5rem 0;
          }
          
          .gc-detail-item .gc-label {
            font-size: 0.8rem;
          }
          
          .gc-detail-item .gc-value {
            font-size: 0.85rem;
          }
          
          .gc-detail-item .gc-highlight {
            font-size: 1rem;
          }
          
          .gc-note {
            font-size: 0.85rem;
            padding: 0.85rem 1rem;
          }
          
          .gc-done-btn {
            max-width: 100%;
            padding: 0.9rem 1.5rem;
          }
          
          .gc-style-btns {
            flex-wrap: wrap;
          }
          
          .gc-style-btn {
            flex: 1 1 45%;
          }
        }
      </style>
    `;

    document.head.insertAdjacentHTML('beforeend', styles);
  }
}

// Global functions for wallet buttons
window.addGiftCardToGoogleWallet = async function(giftCardId) {
  const btn = document.querySelector('.gc-wallet-google');
  if (!btn) return;
  
  const originalHTML = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span>Caricamento...</span>';
  
  try {
    const { giftCardService } = await import('../services/giftcard.js');
    const result = await giftCardService.addToGoogleWallet(giftCardId);
    
    if (result.success) {
      btn.innerHTML = '<span>✓ Aggiunto!</span>';
      setTimeout(() => {
        btn.innerHTML = originalHTML;
        btn.disabled = false;
      }, 2000);
    } else {
      alert(result.error || 'Errore durante l\'aggiunta a Google Wallet');
      btn.innerHTML = originalHTML;
      btn.disabled = false;
    }
  } catch (error) {
    console.error('Google Wallet error:', error);
    alert('Errore durante l\'aggiunta a Google Wallet');
    btn.innerHTML = originalHTML;
    btn.disabled = false;
  }
};

window.addGiftCardToAppleWallet = async function(giftCardId) {
  const btn = document.querySelector('.gc-wallet-apple');
  if (!btn) return;
  
  const originalHTML = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span>Caricamento...</span>';
  
  try {
    const { giftCardService } = await import('../services/giftcard.js');
    const result = await giftCardService.addToAppleWallet(giftCardId);
    
    if (result.success) {
      if (result.message) {
        alert(result.message);
      }
      btn.innerHTML = '<span>✓ Pronto!</span>';
      setTimeout(() => {
        btn.innerHTML = originalHTML;
        btn.disabled = false;
      }, 2000);
    } else {
      alert(result.error || 'Errore durante l\'aggiunta a Apple Wallet');
      btn.innerHTML = originalHTML;
      btn.disabled = false;
    }
  } catch (error) {
    console.error('Apple Wallet error:', error);
    alert('Errore durante l\'aggiunta a Apple Wallet');
    btn.innerHTML = originalHTML;
    btn.disabled = false;
  }
};

// Export singleton instance
export const profileDrawer = new ProfileDrawer();
export default profileDrawer;
