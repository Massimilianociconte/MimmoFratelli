/**
 * Cart Drawer Component
 * Avenue M. E-commerce Platform
 */

import { cartService } from '../services/cart.js';
import { promotionService } from '../services/promotions.js';
import { referralService } from '../services/referral.js';
import { getCurrentUser } from '../supabase.js';

class CartDrawer {
  constructor() {
    this.drawer = null;
    this.isOpen = false;
    this.appliedPromo = null;
    this.discount = 0;
  }

  init() {
    this._createDrawer();
    this._attachEventListeners();
    this.updateCart();

    // Listen for cart changes
    cartService.onChange(() => this.updateCart());
  }

  show() {
    this.isOpen = true;
    this.drawer.classList.add('active');
    document.body.style.overflow = 'hidden';
    this.updateCart();
  }

  hide() {
    this.isOpen = false;
    this.drawer.classList.remove('active');
    document.body.style.overflow = '';
  }

  toggle() {
    this.isOpen ? this.hide() : this.show();
  }

  async updateCart() {
    const items = await cartService.getAllItems();
    const total = await cartService.getTotal();
    const count = await cartService.getCount();

    this._renderItems(items);
    this._updateTotal(total);
    this._updateBadges(count);
    this._updateReferralBanner(total);
  }

  async _updateReferralBanner(subtotal) {
    const bannerContainer = document.getElementById('referralBonusBanner');
    if (!bannerContainer) return;

    try {
      const eligibility = await referralService.getReferralBonusEligibility(subtotal);
      
      if (!eligibility.hasReferral) {
        bannerContainer.style.display = 'none';
        return;
      }

      bannerContainer.style.display = 'block';
      
      if (eligibility.isEligible) {
        bannerContainer.className = 'referral-bonus-banner eligible';
        bannerContainer.innerHTML = `
          <span class="referral-icon">🎁</span>
          <span class="referral-text">${eligibility.message}</span>
        `;
      } else {
        bannerContainer.className = 'referral-bonus-banner not-eligible';
        bannerContainer.innerHTML = `
          <span class="referral-icon">💰</span>
          <div class="referral-content">
            <span class="referral-text">Mancano <strong>€${eligibility.amountNeeded.toFixed(2)}</strong> per far guadagnare €${eligibility.bonusAmount} a chi ti ha invitato!</span>
            <div class="referral-progress">
              <div class="referral-progress-bar" style="width: ${Math.min(100, (subtotal / eligibility.minimumOrder) * 100)}%"></div>
            </div>
            <span class="referral-hint">Minimo €${eligibility.minimumOrder} (esclusa spedizione)</span>
          </div>
        `;
      }
    } catch (err) {
      console.log('Referral banner update skipped:', err);
      bannerContainer.style.display = 'none';
    }
  }

  _createDrawer() {
    if (document.getElementById('cartDrawer')) {
      this.drawer = document.getElementById('cartDrawer');
      return;
    }

    const drawerHTML = `
      <div class="cart-drawer-overlay" id="cartDrawer">
        <div class="cart-drawer">
          <div class="cart-drawer-header">
            <h2>Il tuo Carrello</h2>
            <button class="cart-drawer-close" aria-label="Chiudi">&times;</button>
          </div>
          
          <div class="cart-drawer-body" id="cartDrawerBody">
            <div class="cart-empty" id="cartEmpty">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
                <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
              </svg>
              <p>Il tuo carrello è vuoto</p>
              <a href="collection.html" class="cart-empty-btn">Scopri la Collezione</a>
            </div>
            <div class="cart-items" id="cartItems"></div>
          </div>
          
          <div class="cart-drawer-footer" id="cartFooter" style="display:none;">
            <div id="referralBonusBanner" class="referral-bonus-banner" style="display:none;"></div>
            <div class="cart-promo-section">
              <div class="cart-promo-input-group">
                <input type="text" id="cartPromoCode" placeholder="Codice sconto" class="cart-promo-input">
                <button id="cartApplyPromo" class="cart-promo-btn">Applica</button>
              </div>
              <div id="cartPromoMessage" class="cart-promo-message" style="display: none;"></div>
            </div>
            <div class="cart-totals-section">
              <div class="cart-subtotal">
                <span>Subtotale</span>
                <span id="cartTotal">€ 0.00</span>
              </div>
              <div class="cart-discount-row" id="cartDiscountRow" style="display: none;">
                <span>Sconto</span>
                <span id="cartDiscount">-€ 0.00</span>
              </div>
            </div>
            <p class="cart-shipping-note">Spedizione calcolata al checkout</p>
            <button class="cart-checkout-btn" id="checkoutBtn">
              Procedi al Checkout
            </button>
            <button class="cart-continue-btn" id="continueShoppingBtn">
              Continua lo Shopping
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', drawerHTML);
    this.drawer = document.getElementById('cartDrawer');
    this._addStyles();
  }

  _attachEventListeners() {
    this.drawer.querySelector('.cart-drawer-close').addEventListener('click', () => this.hide());
    this.drawer.addEventListener('click', (e) => {
      if (e.target === this.drawer) this.hide();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) this.hide();
    });

    document.getElementById('checkoutBtn')?.addEventListener('click', () => {
      // Pass promo code to checkout via URL or sessionStorage
      if (this.appliedPromo) {
        sessionStorage.setItem('appliedPromoCode', this.appliedPromo.code);
      }
      window.location.href = 'checkout.html';
    });

    document.getElementById('continueShoppingBtn')?.addEventListener('click', () => this.hide());
    
    document.getElementById('cartApplyPromo')?.addEventListener('click', () => this.applyPromoCode());
    
    document.getElementById('cartPromoCode')?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.applyPromoCode();
      }
    });
  }

  async applyPromoCode() {
    const codeInput = document.getElementById('cartPromoCode');
    const code = codeInput.value.trim().toUpperCase();
    const messageEl = document.getElementById('cartPromoMessage');
    
    if (!code) {
      this.showPromoMessage(messageEl, 'Inserisci un codice', 'error');
      return;
    }

    // Check if it's a first-order code
    const user = await getCurrentUser();
    if (user) {
      const { valid, error: firstOrderError, promotion } = await promotionService.isFirstOrderCodeValid(user.id, code);
      
      if (valid && promotion) {
        this.appliedPromo = promotion;
        await this.updateCartWithDiscount();
        const discountText = promotion.discount_type === 'percentage' 
          ? `${promotion.discount_value}%` 
          : `€${promotion.discount_value.toFixed(2)}`;
        this.showPromoMessage(messageEl, `✓ Sconto ${discountText} applicato!`, 'success');
        codeInput.disabled = true;
        return;
      }
      
      if (firstOrderError && firstOrderError !== 'Codice non valido') {
        this.showPromoMessage(messageEl, firstOrderError, 'error');
        return;
      }
    }

    // Try as regular promo code
    const { promotion, error } = await promotionService.getPromotionByCode(code);
    if (error) {
      this.showPromoMessage(messageEl, error, 'error');
      return;
    }

    this.appliedPromo = promotion;
    await this.updateCartWithDiscount();
    const discountText = promotion.discount_type === 'percentage' 
      ? `${promotion.discount_value}%` 
      : `€${promotion.discount_value.toFixed(2)}`;
    this.showPromoMessage(messageEl, `✓ Sconto ${discountText} applicato!`, 'success');
    codeInput.disabled = true;
  }

  async updateCartWithDiscount() {
    const items = await cartService.getAllItems();
    if (this.appliedPromo) {
      this.discount = promotionService.calculateDiscount(items, this.appliedPromo);
    } else {
      this.discount = 0;
    }
    await this.updateCart();
  }

  showPromoMessage(element, message, type) {
    if (!element) return;
    element.textContent = message;
    element.className = `cart-promo-message ${type}`;
    element.style.display = 'block';
  }

  _renderItems(items) {
    const container = document.getElementById('cartItems');
    const emptyState = document.getElementById('cartEmpty');
    const footer = document.getElementById('cartFooter');

    if (items.length === 0) {
      container.innerHTML = '';
      emptyState.style.display = 'flex';
      footer.style.display = 'none';
      return;
    }

    emptyState.style.display = 'none';
    footer.style.display = 'block';

    container.innerHTML = items.map(item => `
      <div class="cart-item" data-product-id="${item.productId}" data-size="${item.size}" data-color="${item.color}">
        <div class="cart-item-image">
          <img src="${item.image || 'data:image/svg+xml,...'}" alt="${item.name}" onerror="this.src='data:image/svg+xml,...'">
        </div>
        <div class="cart-item-details">
          <h4 class="cart-item-name">${item.name}</h4>
          <p class="cart-item-variant">${item.size} / ${item.color}</p>
          <p class="cart-item-price">€ ${item.price?.toFixed(2) || '0.00'}</p>
          <div class="cart-item-quantity">
            <button class="qty-btn minus" data-action="decrease">−</button>
            <span class="qty-value">${item.quantity}</span>
            <button class="qty-btn plus" data-action="increase">+</button>
          </div>
        </div>
        <button class="cart-item-remove" data-action="remove">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
          </svg>
        </button>
      </div>
    `).join('');

    // Attach quantity handlers
    container.querySelectorAll('.cart-item').forEach(itemEl => {
      const productId = itemEl.dataset.productId;
      const size = itemEl.dataset.size;
      const color = itemEl.dataset.color;
      const qtyValue = itemEl.querySelector('.qty-value');

      itemEl.querySelector('[data-action="decrease"]').addEventListener('click', async () => {
        const newQty = parseInt(qtyValue.textContent) - 1;
        await cartService.updateQuantity(productId, size, color, newQty);
      });

      itemEl.querySelector('[data-action="increase"]').addEventListener('click', async () => {
        const newQty = parseInt(qtyValue.textContent) + 1;
        await cartService.updateQuantity(productId, size, color, newQty);
      });

      itemEl.querySelector('[data-action="remove"]').addEventListener('click', async () => {
        await cartService.removeItem(productId, size, color);
      });
    });
  }

  _updateTotal(total) {
    const totalEl = document.getElementById('cartTotal');
    const discountRow = document.getElementById('cartDiscountRow');
    const discountEl = document.getElementById('cartDiscount');
    
    if (totalEl) {
      if (this.discount > 0) {
        totalEl.textContent = `€ ${(total - this.discount).toFixed(2)}`;
      } else {
        totalEl.textContent = `€ ${total.toFixed(2)}`;
      }
    }
    
    if (discountRow && discountEl) {
      if (this.discount > 0) {
        discountRow.style.display = 'flex';
        discountEl.textContent = `-€ ${this.discount.toFixed(2)}`;
      } else {
        discountRow.style.display = 'none';
      }
    }
  }

  _updateBadges(count) {
    document.querySelectorAll('#cartBadge').forEach(badge => {
      badge.textContent = count;
      badge.style.display = count > 0 ? 'flex' : 'none';
    });
  }

  _addStyles() {
    if (document.getElementById('cartDrawerStyles')) return;

    const styles = `
      <style id="cartDrawerStyles">
        .cart-drawer-overlay {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(0,0,0,0.5);
          z-index: 1001;
          opacity: 0;
          visibility: hidden;
          transition: all 0.3s ease;
        }
        .cart-drawer-overlay.active {
          opacity: 1;
          visibility: visible;
        }
        .cart-drawer {
          position: absolute;
          right: 0;
          top: 0;
          width: 100%;
          max-width: 420px;
          height: 100%;
          background: #fff;
          display: flex;
          flex-direction: column;
          transform: translateX(100%);
          transition: transform 0.3s ease;
        }
        .cart-drawer-overlay.active .cart-drawer {
          transform: translateX(0);
        }
        .cart-drawer-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 1.5rem;
          border-bottom: 1px solid #eee;
        }
        .cart-drawer-header h2 {
          font-family: var(--font-display, 'DM Serif Display', Georgia, serif);
          font-size: 1.5rem;
          font-style: italic;
          margin: 0;
        }
        .cart-drawer-close {
          background: none;
          border: none;
          font-size: 1.8rem;
          cursor: pointer;
          color: #666;
          line-height: 1;
        }
        .cart-drawer-body {
          flex: 1;
          overflow-y: auto;
          padding: 1rem;
        }
        .cart-empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
          color: #888;
          text-align: center;
          gap: 1rem;
        }
        .cart-empty svg { opacity: 0.3; }
        .cart-empty-btn {
          background: var(--text-color, #1a1a1a);
          color: #fff;
          padding: 0.8rem 1.5rem;
          text-decoration: none;
          font-size: 0.85rem;
          text-transform: uppercase;
          letter-spacing: 1px;
          transition: background 0.3s;
        }
        .cart-empty-btn:hover {
          background: var(--accent-color, #a89990);
        }
        .cart-item {
          display: flex;
          gap: 1rem;
          padding: 1rem 0;
          border-bottom: 1px solid #f0f0f0;
          position: relative;
        }
        .cart-item-image {
          width: 80px;
          height: 100px;
          background: #f5f5f5;
          flex-shrink: 0;
        }
        .cart-item-image img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .cart-item-details {
          flex: 1;
          min-width: 0;
        }
        .cart-item-name {
          font-size: 0.95rem;
          margin: 0 0 0.25rem;
          font-weight: 500;
        }
        .cart-item-variant {
          font-size: 0.8rem;
          color: #888;
          margin: 0 0 0.5rem;
        }
        .cart-item-price {
          font-size: 0.9rem;
          font-weight: 500;
          margin: 0 0 0.5rem;
        }
        .cart-item-quantity {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        .qty-btn {
          width: 28px;
          height: 28px;
          border: 1px solid #ddd;
          background: #fff;
          cursor: pointer;
          font-size: 1rem;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s;
        }
        .qty-btn:hover {
          border-color: var(--text-color);
        }
        .qty-value {
          min-width: 24px;
          text-align: center;
          font-size: 0.9rem;
        }
        .cart-item-remove {
          position: absolute;
          top: 1rem;
          right: 0;
          background: none;
          border: none;
          cursor: pointer;
          color: #999;
          padding: 0.25rem;
          transition: color 0.2s;
        }
        .cart-item-remove:hover {
          color: var(--accent-color, #a89990);
        }
        .cart-drawer-footer {
          padding: 1.5rem;
          border-top: 1px solid #eee;
          background: #fafafa;
        }
        .cart-promo-section {
          margin-bottom: 1rem;
          padding-bottom: 1rem;
          border-bottom: 1px solid #eee;
        }
        .cart-promo-input-group {
          display: flex;
          gap: 0.5rem;
        }
        .cart-promo-input {
          flex: 1;
          padding: 0.6rem 0.75rem;
          border: 1px solid #ddd;
          border-radius: 6px;
          font-size: 0.85rem;
          text-transform: uppercase;
        }
        .cart-promo-input:focus {
          outline: none;
          border-color: var(--primary, #4a7c59);
        }
        .cart-promo-input:disabled {
          background: #f5f5f5;
        }
        .cart-promo-btn {
          padding: 0.6rem 1rem;
          background: var(--primary, #4a7c59);
          color: white;
          border: none;
          border-radius: 6px;
          font-size: 0.8rem;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.2s;
        }
        .cart-promo-btn:hover {
          background: #3d6a4a;
        }
        .cart-promo-message {
          margin-top: 0.5rem;
          padding: 0.4rem 0.6rem;
          border-radius: 4px;
          font-size: 0.8rem;
        }
        .cart-promo-message.success {
          background: #d4edda;
          color: #155724;
        }
        .cart-promo-message.error {
          background: #f8d7da;
          color: #721c24;
        }
        .cart-totals-section {
          margin-bottom: 0.5rem;
        }
        .cart-subtotal {
          display: flex;
          justify-content: space-between;
          font-size: 1.1rem;
          font-weight: 500;
          margin-bottom: 0.25rem;
        }
        .cart-discount-row {
          display: flex;
          justify-content: space-between;
          font-size: 0.95rem;
          color: #16a34a;
        }
        .cart-shipping-note {
          font-size: 0.8rem;
          color: #888;
          margin: 0 0 1rem;
        }
        .cart-checkout-btn {
          width: 100%;
          padding: 1rem;
          background: var(--text-color, #1a1a1a);
          color: #fff;
          border: none;
          font-size: 0.9rem;
          text-transform: uppercase;
          letter-spacing: 2px;
          cursor: pointer;
          transition: background 0.3s;
          margin-bottom: 0.75rem;
        }
        .cart-checkout-btn:hover {
          background: var(--accent-color, #a89990);
        }
        .cart-continue-btn {
          width: 100%;
          padding: 0.75rem;
          background: transparent;
          border: 1px solid #ddd;
          font-size: 0.85rem;
          cursor: pointer;
          transition: all 0.3s;
        }
        .cart-continue-btn:hover {
          border-color: var(--text-color);
        }
        /* Referral Bonus Banner */
        .referral-bonus-banner {
          padding: 0.75rem;
          border-radius: 8px;
          margin-bottom: 1rem;
          display: flex;
          align-items: flex-start;
          gap: 0.5rem;
        }
        .referral-bonus-banner.eligible {
          background: linear-gradient(135deg, #d4edda 0%, #c3e6cb 100%);
          border: 1px solid #28a745;
        }
        .referral-bonus-banner.not-eligible {
          background: linear-gradient(135deg, #fff3cd 0%, #ffeeba 100%);
          border: 1px solid #ffc107;
        }
        .referral-icon {
          font-size: 1.2rem;
          flex-shrink: 0;
        }
        .referral-content {
          flex: 1;
          min-width: 0;
        }
        .referral-text {
          font-size: 0.85rem;
          color: #333;
          line-height: 1.4;
        }
        .referral-progress {
          height: 6px;
          background: rgba(0,0,0,0.1);
          border-radius: 3px;
          margin: 0.5rem 0 0.25rem;
          overflow: hidden;
        }
        .referral-progress-bar {
          height: 100%;
          background: linear-gradient(90deg, #28a745, #20c997);
          border-radius: 3px;
          transition: width 0.3s ease;
        }
        .referral-hint {
          font-size: 0.75rem;
          color: #666;
        }
      </style>
    `;
    document.head.insertAdjacentHTML('beforeend', styles);
  }
}

export const cartDrawer = new CartDrawer();
export default cartDrawer;
