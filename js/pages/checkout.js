/**
 * Checkout Page
 * Avenue M. E-commerce Platform
 */

import { getCurrentUser, isAuthenticated } from '../supabase.js';
import { cartService } from '../services/cart.js';
import { paymentService } from '../services/payment.js';
import { promotionService } from '../services/promotions.js';
import { giftCardService } from '../services/giftcard.js';
import { wishlistService } from '../services/wishlist.js';
import { referralService } from '../services/referral.js';
import { capAutofillService } from '../services/cap-autofill.js';
import { notificationCenter } from '../components/notification-center.js';

// Initialize notification center
notificationCenter.init();

class CheckoutPage {
  constructor() {
    this.cartItems = [];
    this.appliedPromo = null;
    this.appliedGiftCard = null;
    this.giftCardBalance = 0;
    this.userCredit = 0;
    this.useCreditEnabled = true;
    this.creditToApply = 0;
    this.autocompleteDropdown = null;
    this.init();
  }

  async init() {
    const authenticated = await isAuthenticated();
    
    if (!authenticated) {
      document.getElementById('loginRequired').style.display = 'block';
      document.getElementById('checkoutContent').style.display = 'none';
      document.getElementById('emptyCart').style.display = 'none';
      return;
    }

    this.cartItems = await cartService.getAllItems();
    
    if (this.cartItems.length === 0) {
      document.getElementById('loginRequired').style.display = 'none';
      document.getElementById('checkoutContent').style.display = 'none';
      document.getElementById('emptyCart').style.display = 'block';
      return;
    }

    document.getElementById('loginRequired').style.display = 'none';
    document.getElementById('checkoutContent').style.display = 'block';
    document.getElementById('emptyCart').style.display = 'none';

    this.renderCartItems();
    await this.loadUserCredit();
    this.updateTotals();
    this.bindEvents();
    this.prefillShippingAddress();
    this.checkFirstOrderCode();
    this.checkSavedPromoCode();
    this.initCapAutofill();
  }

  async loadUserCredit() {
    try {
      const { balance } = await giftCardService.getUserCredits();
      this.userCredit = balance || 0;
      
      const creditSection = document.getElementById('userCreditSection');
      const creditBalance = document.getElementById('userCreditBalance');
      
      if (this.userCredit > 0 && creditSection) {
        creditSection.style.display = 'block';
        creditBalance.textContent = `€${this.userCredit.toFixed(2)}`;
        
        // Setup toggle listener
        const toggle = document.getElementById('useCreditToggle');
        if (toggle) {
          toggle.checked = true;
          this.useCreditEnabled = true;
          toggle.addEventListener('change', (e) => {
            this.useCreditEnabled = e.target.checked;
            this.updateTotals();
          });
        }
      }
    } catch (err) {
      console.log('Could not load user credit:', err);
    }
  }

  async checkSavedPromoCode() {
    // Check if promo code was applied in cart drawer
    const savedCode = sessionStorage.getItem('appliedPromoCode');
    if (savedCode) {
      document.getElementById('promoCode').value = savedCode;
      await this.applyPromoCode();
      sessionStorage.removeItem('appliedPromoCode');
    }
  }

  async checkFirstOrderCode() {
    try {
      const user = await getCurrentUser();
      if (!user) return;

      const firstOrderCode = await promotionService.getFirstOrderCode(user.id);
      if (firstOrderCode) {
        this.showFirstOrderBanner(firstOrderCode);
      }
    } catch (err) {
      console.log('Could not check first order code:', err);
    }
  }

  showFirstOrderBanner(codeData) {
    const promoSection = document.querySelector('.checkout-promo');
    if (!promoSection) return;

    const banner = document.createElement('div');
    banner.className = 'first-order-banner';
    banner.innerHTML = `
      <div class="first-order-content">
        <span class="first-order-icon">🎁</span>
        <div class="first-order-text">
          <strong>Hai un codice sconto del ${codeData.discount}%!</strong>
          <span>Usa il codice <code>${codeData.code}</code> per il tuo primo ordine</span>
        </div>
        <button id="applyFirstOrderCode" class="btn btn-small btn-apply-first" data-code="${codeData.code}">Applica</button>
      </div>
    `;
    
    promoSection.insertBefore(banner, promoSection.firstChild);
    
    banner.querySelector('.btn-apply-first').addEventListener('click', (e) => {
      const code = e.target.dataset.code;
      document.getElementById('promoCode').value = code;
      this.applyPromoCode();
      banner.remove();
    });
  }

  async prefillShippingAddress() {
    try {
      const { authService } = await import('../services/auth.js');
      const user = await authService.getUser();
      const { profile } = await authService.getProfile();
      
      if (!user) return;
      
      const meta = user.user_metadata || {};
      const data = {
        first_name: profile?.first_name || meta.first_name || '',
        last_name: profile?.last_name || meta.last_name || '',
        phone: profile?.phone || meta.phone || '',
        address: profile?.address || meta.address || '',
        city: profile?.city || meta.city || '',
        zip: profile?.zip || meta.zip || '',
        province: profile?.province || meta.province || ''
      };
      
      // Pre-fill form fields if they exist and have saved values
      const fields = {
        firstName: data.first_name,
        lastName: data.last_name,
        phone: data.phone,
        address: data.address,
        city: data.city,
        postalCode: data.zip,
        province: data.province
      };
      
      Object.entries(fields).forEach(([id, value]) => {
        const el = document.getElementById(id);
        if (el && value && !el.value) {
          el.value = value;
        }
      });
    } catch (err) {
      console.log('Could not prefill shipping address:', err);
    }
  }

  renderCartItems() {
    const container = document.getElementById('cartItems');
    container.innerHTML = this.cartItems.map(item => {
      // Show weight info for weight-based products
      let variantInfo = `Peso: ${item.size}`;
      if (item.unitPrice && item.weight_grams) {
        variantInfo += ` (€${item.unitPrice.toFixed(2)}/Kg)`;
      }
      
      return `
        <div class="checkout-item">
          <img src="${item.image || 'Images/placeholder.jpg'}" alt="${item.name}" class="checkout-item-img">
          <div class="checkout-item-details">
            <h4>${item.name}</h4>
            <p>${variantInfo}</p>
            <p>Quantità: ${item.quantity}</p>
          </div>
          <div class="checkout-item-price">€${(item.price * item.quantity).toFixed(2)}</div>
        </div>
      `;
    }).join('');
  }

  updateTotals() {
    const discount = this.appliedPromo ? promotionService.calculateDiscount(this.cartItems, this.appliedPromo) : 0;
    
    // Calculate base total first (without credit)
    const subtotal = this.cartItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const shipping = subtotal >= 50 ? 0 : 5.90;
    let totalBeforeCredit = subtotal - discount + shipping;
    
    // Calculate credit to apply
    this.creditToApply = 0;
    if (this.useCreditEnabled && this.userCredit > 0) {
      this.creditToApply = Math.min(this.userCredit, totalBeforeCredit);
    }
    
    const finalTotal = Math.max(0, totalBeforeCredit - this.creditToApply);

    document.getElementById('subtotal').textContent = `€${subtotal.toFixed(2)}`;
    document.getElementById('shipping').textContent = shipping === 0 ? 'Gratuita' : `€${shipping.toFixed(2)}`;
    document.getElementById('total').textContent = `€${finalTotal.toFixed(2)}`;

    // Discount row
    const discountRow = document.querySelector('.discount-row');
    if (discountRow) {
      if (discount > 0) {
        discountRow.style.display = 'flex';
        document.getElementById('discount').textContent = `-€${discount.toFixed(2)}`;
      } else {
        discountRow.style.display = 'none';
      }
    }

    // Credit row
    const creditRow = document.querySelector('.credit-row');
    if (creditRow) {
      if (this.creditToApply > 0) {
        creditRow.style.display = 'flex';
        document.getElementById('creditAmount').textContent = `-€${this.creditToApply.toFixed(2)}`;
      } else {
        creditRow.style.display = 'none';
      }
    }
    
    // Update credit applied info
    const creditInfo = document.getElementById('creditAppliedInfo');
    if (creditInfo && this.userCredit > 0) {
      if (this.useCreditEnabled && this.creditToApply > 0) {
        const remaining = this.userCredit - this.creditToApply;
        creditInfo.textContent = `Verranno utilizzati €${this.creditToApply.toFixed(2)}. Credito residuo: €${remaining.toFixed(2)}`;
      } else {
        creditInfo.textContent = '';
      }
    }

    // Update referral bonus banner
    this.updateReferralBanner(subtotal);
  }

  async updateReferralBanner(subtotal) {
    const bannerContainer = document.getElementById('checkoutReferralBanner');
    if (!bannerContainer) return;

    try {
      const eligibility = await referralService.getReferralBonusEligibility(subtotal);
      
      if (!eligibility.hasReferral) {
        bannerContainer.style.display = 'none';
        return;
      }

      bannerContainer.style.display = 'block';
      
      if (eligibility.isEligible) {
        bannerContainer.className = 'checkout-referral-banner eligible';
        bannerContainer.innerHTML = `
          <span class="referral-icon">🎁</span>
          <span class="referral-text">${eligibility.message}</span>
        `;
      } else {
        bannerContainer.className = 'checkout-referral-banner not-eligible';
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

  bindEvents() {
    document.getElementById('applyPromo')?.addEventListener('click', () => this.applyPromoCode());
    document.getElementById('applyGiftCard')?.addEventListener('click', () => this.applyGiftCardCode());
    document.getElementById('payStripe')?.addEventListener('click', () => this.processPayment('stripe'));
    document.getElementById('payPayPal')?.addEventListener('click', () => this.processPayment('paypal'));
  }

  /**
   * Initialize CAP autofill functionality
   */
  async initCapAutofill() {
    await capAutofillService.load();
    
    const cityInput = document.getElementById('city');
    const capInput = document.getElementById('postalCode');
    const provinceInput = document.getElementById('province');
    
    if (!cityInput || !capInput) return;
    
    // Create autocomplete dropdown
    this._createAutocompleteDropdown(cityInput);
    
    // City input - show autocomplete suggestions
    let debounceTimer;
    cityInput.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const query = e.target.value;
        if (query.length >= 2) {
          const results = capAutofillService.searchCities(query, 8);
          this._showAutocomplete(results, cityInput, capInput, provinceInput);
        } else {
          this._hideAutocomplete();
        }
      }, 150);
    });
    
    // Hide autocomplete on blur (with delay for click)
    cityInput.addEventListener('blur', () => {
      setTimeout(() => this._hideAutocomplete(), 200);
    });
    
    // CAP input - autofill city when CAP is entered
    capInput.addEventListener('blur', () => {
      const cap = capInput.value.trim();
      if (cap.length === 5 && !cityInput.value.trim()) {
        const cityData = capAutofillService.getCityByCap(cap);
        if (cityData) {
          cityInput.value = cityData.city;
          if (provinceInput && !provinceInput.value) {
            provinceInput.value = cityData.province;
          }
        }
      }
    });
    
    // City input - autofill CAP when city loses focus
    cityInput.addEventListener('blur', () => {
      setTimeout(() => {
        const city = cityInput.value.trim();
        if (city && !capInput.value.trim()) {
          const capData = capAutofillService.getCapByCity(city);
          if (capData) {
            capInput.value = capData.cap;
            if (provinceInput && !provinceInput.value) {
              provinceInput.value = capData.province;
            }
          }
        }
      }, 250);
    });
  }
  
  /**
   * Create autocomplete dropdown element
   * @private
   */
  _createAutocompleteDropdown(inputEl) {
    const dropdown = document.createElement('div');
    dropdown.className = 'cap-autocomplete-dropdown';
    dropdown.style.cssText = `
      position: absolute;
      top: 100%;
      left: 0;
      right: 0;
      background: white;
      border: 1px solid var(--line-color, #e4ebe4);
      border-top: none;
      border-radius: 0 0 8px 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.1);
      max-height: 200px;
      overflow-y: auto;
      z-index: 100;
      display: none;
    `;
    
    // Wrap input in relative container if not already
    const parent = inputEl.parentElement;
    if (getComputedStyle(parent).position === 'static') {
      parent.style.position = 'relative';
    }
    parent.appendChild(dropdown);
    this.autocompleteDropdown = dropdown;
  }
  
  /**
   * Show autocomplete suggestions
   * @private
   */
  _showAutocomplete(results, cityInput, capInput, provinceInput) {
    if (!this.autocompleteDropdown || results.length === 0) {
      this._hideAutocomplete();
      return;
    }
    
    this.autocompleteDropdown.innerHTML = results.map(r => `
      <div class="cap-autocomplete-item" data-city="${r.city}" data-cap="${r.cap}" data-province="${r.province}" style="
        padding: 0.75rem 1rem;
        cursor: pointer;
        border-bottom: 1px solid #f0f0f0;
        transition: background 0.15s;
      ">
        <strong style="color: #333;">${r.city}</strong>
        <span style="color: #888; font-size: 0.85rem; margin-left: 0.5rem;">${r.cap} (${r.province})</span>
      </div>
    `).join('');
    
    // Add hover effect and click handlers
    this.autocompleteDropdown.querySelectorAll('.cap-autocomplete-item').forEach(item => {
      item.addEventListener('mouseenter', () => {
        item.style.background = '#f5f8f2';
      });
      item.addEventListener('mouseleave', () => {
        item.style.background = 'white';
      });
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        cityInput.value = item.dataset.city;
        capInput.value = item.dataset.cap;
        if (provinceInput) {
          provinceInput.value = item.dataset.province;
        }
        this._hideAutocomplete();
      });
    });
    
    this.autocompleteDropdown.style.display = 'block';
  }
  
  /**
   * Hide autocomplete dropdown
   * @private
   */
  _hideAutocomplete() {
    if (this.autocompleteDropdown) {
      this.autocompleteDropdown.style.display = 'none';
    }
  }

  async applyPromoCode() {
    const codeInput = document.getElementById('promoCode');
    const code = codeInput.value.trim().toUpperCase();
    const messageEl = document.getElementById('promoMessage');
    
    if (!code) {
      this.showPromoMessage(messageEl, 'Inserisci un codice sconto', 'error');
      return;
    }

    // First check if it's a first-order code
    const user = await getCurrentUser();
    if (user) {
      const { valid, error: firstOrderError, promotion } = await promotionService.isFirstOrderCodeValid(user.id, code);
      
      if (valid && promotion) {
        this.appliedPromo = promotion;
        this.updateTotals();
        const discount = promotion.discount_type === 'percentage' 
          ? `${promotion.discount_value}%` 
          : `€${promotion.discount_value.toFixed(2)}`;
        this.showPromoMessage(messageEl, `✓ Sconto ${discount} applicato!`, 'success');
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
    this.updateTotals();
    const discount = promotion.discount_type === 'percentage' 
      ? `${promotion.discount_value}%` 
      : `€${promotion.discount_value.toFixed(2)}`;
    this.showPromoMessage(messageEl, `✓ Sconto ${discount} applicato!`, 'success');
    codeInput.disabled = true;
  }

  showPromoMessage(element, message, type) {
    if (!element) return;
    element.textContent = message;
    element.className = `promo-message ${type}`;
    element.style.display = 'block';
  }

  async applyGiftCardCode() {
    const codeInput = document.getElementById('giftCardCode');
    const code = codeInput.value.trim().toUpperCase().replace(/-/g, '');
    const messageEl = document.getElementById('giftCardMessage');
    
    if (!code) {
      this.showPromoMessage(messageEl, 'Inserisci un codice gift card', 'error');
      return;
    }

    if (code.length < 10) {
      this.showPromoMessage(messageEl, 'Il codice deve essere di almeno 10 caratteri', 'error');
      return;
    }

    // Validate the gift card first
    const { valid, giftCard, error } = await giftCardService.validateCode(code);
    if (!valid || error) {
      this.showPromoMessage(messageEl, error || 'Codice non valido', 'error');
      return;
    }

    // Redeem the gift card to add credit to user account
    this.showPromoMessage(messageEl, 'Riscatto in corso...', 'info');
    
    const result = await giftCardService.redeemGiftCard(giftCard.qr_code_token);
    
    if (result.success) {
      // Update user credit
      this.userCredit += result.amount_credited || giftCard.amount;
      
      // Update credit section
      const creditSection = document.getElementById('userCreditSection');
      const creditBalance = document.getElementById('userCreditBalance');
      if (creditSection) {
        creditSection.style.display = 'block';
        creditBalance.textContent = `€${this.userCredit.toFixed(2)}`;
      }
      
      this.updateTotals();
      this.showPromoMessage(messageEl, `✓ Gift Card riscattata! €${(result.amount_credited || giftCard.amount).toFixed(2)} aggiunti al tuo credito`, 'success');
      codeInput.value = '';
    } else {
      this.showPromoMessage(messageEl, result.error || 'Errore durante il riscatto', 'error');
    }
  }

  validateShippingForm() {
    const form = document.getElementById('shippingForm');
    const inputs = form.querySelectorAll('input[required]');
    let valid = true;

    inputs.forEach(input => {
      if (!input.value.trim()) {
        input.classList.add('error');
        valid = false;
      } else {
        input.classList.remove('error');
      }
    });

    return valid;
  }

  getShippingAddress() {
    return {
      firstName: document.getElementById('firstName').value.trim(),
      lastName: document.getElementById('lastName').value.trim(),
      address: document.getElementById('address').value.trim(),
      city: document.getElementById('city').value.trim(),
      postalCode: document.getElementById('postalCode').value.trim(),
      province: document.getElementById('province').value.trim(),
      phone: document.getElementById('phone').value.trim(),
      country: 'IT'
    };
  }

  async processPayment(provider) {
    if (!this.validateShippingForm()) {
      alert('Compila tutti i campi dell\'indirizzo di spedizione');
      return;
    }

    const options = {
      promotionCode: this.appliedPromo?.code,
      shippingAddress: this.getShippingAddress(),
      creditToUse: this.creditToApply > 0 ? this.creditToApply : 0
    };

    let result;
    switch (provider) {
      case 'stripe':
        result = await paymentService.redirectToStripeCheckout(this.cartItems, options);
        break;
      case 'paypal':
        result = await paymentService.createPayPalOrder(this.cartItems, options);
        if (result.approvalUrl) {
          window.location.href = result.approvalUrl;
          return;
        }
        break;
    }

    if (result?.error) {
      alert(result.error);
    }
  }
}

// Auth modal helper
window.openAuthModal = function() {
  const event = new CustomEvent('openAuthModal');
  document.dispatchEvent(event);
};

// Update badges
async function updateWishlistBadge() {
  const { items } = await wishlistService.getAllFavorites();
  const badge = document.getElementById('wishlistBadge');
  if (badge) {
    const count = items ? items.length : 0;
    badge.textContent = count;
    badge.style.display = count > 0 ? 'flex' : 'none';
  }
}

// Initialize badges on load
updateWishlistBadge();
wishlistService.onChange(() => updateWishlistBadge());

new CheckoutPage();
