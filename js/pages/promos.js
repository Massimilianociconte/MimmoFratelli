/**
 * Promotions Page - Discounted Products & Promo Codes
 * Avenue M. E-commerce Platform
 */

import { productService } from '../services/products.js';
import { promotionService } from '../services/promotions.js';
import { wishlistService } from '../services/wishlist.js';
import { authService } from '../services/auth.js';
import { authModal } from '../components/auth-modal.js';
import { profileDrawer } from '../components/profile-drawer.js';
import { cartService } from '../services/cart.js';
import { cartDrawer } from '../components/cart-drawer.js';

class PromosPage {
  constructor() {
    this.discountedProducts = [];
    this.promoCodes = [];
    this.currentTab = 'products';
    this.filters = {
      discount: 'all',
      gender: 'all'
    };
    this.init();
  }

  async init() {
    // Initialize auth and UI components
    await authService.init();
    authModal.init();
    profileDrawer.init();
    cartDrawer.init();

    // Setup event listeners
    this.setupEventListeners();

    // Load all data
    await this.loadAllData();

    // Update badges
    this.updateCartBadge();
    this.updateWishlistBadge();
    cartService.onChange(() => this.updateCartBadge());
    wishlistService.onChange(() => this.updateWishlistBadge());
  }

  setupEventListeners() {
    // Menu toggle
    window.toggleMenu = () => {
      const menuOverlay = document.getElementById('menuOverlay');
      const menuBtn = document.querySelector('.menu-btn');
      const isOpen = menuOverlay.classList.contains('active');
      
      if (isOpen) {
        menuOverlay.classList.remove('active');
        document.body.classList.remove('menu-open');
        menuBtn.textContent = 'Menu';
        menuBtn.style.color = '';
        document.querySelectorAll('.menu-category').forEach(cat => cat.classList.remove('open'));
      } else {
        menuOverlay.classList.add('active');
        document.body.classList.add('menu-open');
        menuBtn.textContent = 'Close';
        menuBtn.style.color = 'white';
      }
    };

    // Menu category toggle (Mobile)
    document.querySelectorAll('.menu-category-title').forEach(title => {
      title.addEventListener('click', (e) => {
        if (window.innerWidth <= 768) {
          e.preventDefault();
          const category = title.closest('.menu-category');
          document.querySelectorAll('.menu-category').forEach(cat => {
            if (cat !== category) cat.classList.remove('open');
          });
          category.classList.toggle('open');
        }
      });
    });

    // Auth button
    document.getElementById('authBtn')?.addEventListener('click', async () => {
      const isAuth = await authService.isAuthenticated();
      if (isAuth) {
        profileDrawer.show();
      } else {
        authModal.show('login');
      }
    });

    // Cart button
    document.getElementById('cartBtn')?.addEventListener('click', () => {
      cartDrawer.show();
    });

    // Tab switching
    document.querySelectorAll('.promo-tab').forEach(tab => {
      tab.addEventListener('click', () => this.switchTab(tab.dataset.tab));
    });

    // Discount filter chips
    document.querySelectorAll('.discount-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('.discount-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        this.filters.discount = chip.dataset.discount;
        this.applyFilters();
      });
    });

    // Type filter chips (frutta/verdura/altro)
    document.querySelectorAll('.gender-chip, .type-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('.gender-chip, .type-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        this.filters.gender = chip.dataset.gender || chip.dataset.type;
        this.applyFilters();
      });
    });

    // Reset filters
    window.resetFilters = () => {
      this.filters = { discount: 'all', gender: 'all' };
      document.querySelectorAll('.discount-chip').forEach(c => c.classList.remove('active'));
      document.querySelectorAll('.gender-chip, .type-chip').forEach(c => c.classList.remove('active'));
      document.querySelector('.discount-chip[data-discount="all"]')?.classList.add('active');
      document.querySelector('.gender-chip[data-gender="all"], .type-chip[data-type="all"]')?.classList.add('active');
      this.applyFilters();
    };

    // ESC key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const menuOverlay = document.getElementById('menuOverlay');
        if (menuOverlay?.classList.contains('active')) toggleMenu();
      }
    });
  }

  async updateCartBadge() {
    const count = await cartService.getCount();
    const badge = document.getElementById('cartBadge');
    if (badge) {
      badge.textContent = count;
      badge.style.display = count > 0 ? 'flex' : 'none';
    }
  }

  async updateWishlistBadge() {
    const { items } = await wishlistService.getAllFavorites();
    const count = items.length;
    const badge = document.getElementById('wishlistBadge');
    if (badge) {
      badge.textContent = count;
      badge.style.display = count > 0 ? 'flex' : 'none';
    }
  }

  switchTab(tab) {
    this.currentTab = tab;
    
    // Update tab buttons
    document.querySelectorAll('.promo-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === tab);
    });
    
    // Show/hide sections
    document.getElementById('productsSection').style.display = tab === 'products' ? 'block' : 'none';
    document.getElementById('codesSection').style.display = tab === 'codes' ? 'block' : 'none';
    document.getElementById('productFilters').style.display = tab === 'products' ? 'flex' : 'none';
  }

  async loadAllData() {
    const loadingEl = document.getElementById('loadingPromos');
    
    try {
      // Load both discounted products and promo codes in parallel
      const [productsResult, codesResult] = await Promise.all([
        productService.getDiscountedProducts(),
        promotionService.getActivePromotions()
      ]);

      loadingEl.style.display = 'none';

      // Handle products
      if (!productsResult.error && productsResult.products) {
        this.discountedProducts = productsResult.products;
      }

      // Handle promo codes
      if (!codesResult.error && codesResult.promotions) {
        this.promoCodes = codesResult.promotions;
      }

      // Update counts
      document.getElementById('productsCount').textContent = this.discountedProducts.length;
      document.getElementById('codesCount').textContent = this.promoCodes.length;

      // Check if we have any content
      if (this.discountedProducts.length === 0 && this.promoCodes.length === 0) {
        document.getElementById('noPromos').style.display = 'block';
        return;
      }

      // Render content
      this.renderProducts(this.discountedProducts);
      this.renderPromoCodes(this.promoCodes);

      // If no products but have codes, switch to codes tab
      if (this.discountedProducts.length === 0 && this.promoCodes.length > 0) {
        this.switchTab('codes');
      }

    } catch (err) {
      console.error('Load promos error:', err);
      loadingEl.style.display = 'none';
      document.getElementById('noPromos').style.display = 'block';
    }
  }

  async applyFilters() {
    let filtered = [...this.discountedProducts];

    // Filter by discount percentage
    if (this.filters.discount !== 'all') {
      const minDiscount = parseInt(this.filters.discount);
      filtered = filtered.filter(p => {
        const discountPercent = Math.round((1 - p.sale_price / p.price) * 100);
        return discountPercent >= minDiscount;
      });
    }

    // Filter by type (frutta/verdura/altro)
    if (this.filters.gender !== 'all') {
      filtered = filtered.filter(p => p.gender === this.filters.gender);
    }

    // Update count
    document.getElementById('filteredCount').textContent = filtered.length;

    // Show/hide no products message
    document.getElementById('noProducts').style.display = filtered.length === 0 ? 'block' : 'none';
    document.getElementById('discountedProductsGrid').style.display = filtered.length > 0 ? 'grid' : 'none';

    // Render filtered products
    if (filtered.length > 0) {
      await this.renderProducts(filtered);
    }
  }

  async renderProducts(products) {
    const container = document.getElementById('discountedProductsGrid');
    document.getElementById('filteredCount').textContent = products.length;
    
    // Get favorites status for all products
    const favoritesStatus = await Promise.all(
      products.map(async (product) => ({
        id: product.id,
        isFav: await wishlistService.isFavoriteAsync(product.id)
      }))
    );
    const favoritesMap = new Map(favoritesStatus.map(f => [f.id, f.isFav]));
    
    container.innerHTML = products.map(product => this.renderProductCard(product, favoritesMap.get(product.id))).join('');

    // Add click handlers for wishlist
    container.querySelectorAll('.card-favorite-small').forEach(btn => {
      btn.addEventListener('click', (e) => this.handleWishlistClick(e));
    });
  }

  renderProductCard(product, isFav = false) {
    const discountPercent = Math.round((1 - product.sale_price / product.price) * 100);
    const productUrl = `product.html?id=${product.id}`;
    const img = product.images?.[0] || '';

    return `
      <div class="product-card-small" data-product-id="${product.id}">
        <a href="${productUrl}" class="card-image-small">
          <img src="${img}" alt="${product.name}" loading="lazy" 
               onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect fill=%22%23f5f5f5%22 width=%22100%22 height=%22100%22/></svg>'">
          <span class="sale-badge">-${discountPercent}%</span>
        </a>
        <button class="card-favorite-small wishlist-btn ${isFav ? 'active' : ''}" data-product-id="${product.id}" title="Aggiungi ai preferiti">
          ${isFav ? '♥' : '♡'}
        </button>
        <div class="card-info-small">
          <a href="${productUrl}" class="card-title-link"><h3>${product.name}</h3></a>
          <p class="card-price-small">
            <span class="original-price">€${product.price.toFixed(2)}</span>
            €${product.sale_price.toFixed(2)}
          </p>
          <button class="add-cart-btn-small" onclick="window.addToCartFromPromos('${product.id}')">+ Carrello</button>
        </div>
      </div>
    `;
  }

  renderPromoCodes(codes) {
    const container = document.getElementById('promoCodesList');
    const noCodesEl = document.getElementById('noCodes');

    if (codes.length === 0) {
      noCodesEl.style.display = 'block';
      container.innerHTML = '';
      return;
    }

    noCodesEl.style.display = 'none';
    container.innerHTML = codes.map(promo => this.renderPromoCodeCard(promo)).join('');

    // Add copy handlers
    container.querySelectorAll('.copy-code-btn').forEach(btn => {
      btn.addEventListener('click', () => this.copyCode(btn.dataset.code));
    });
  }

  renderPromoCodeCard(promo) {
    const discountText = promotionService.formatDiscount(promo);
    const endDate = new Date(promo.ends_at).toLocaleDateString('it-IT', {
      day: 'numeric',
      month: 'long'
    });

    const minPurchaseText = promo.min_purchase 
      ? `<p class="promo-min">Acquisto minimo: €${promo.min_purchase.toFixed(2)}</p>` 
      : '';

    const usageText = promo.usage_limit 
      ? `<p class="promo-usage">${promo.usage_limit - (promo.usage_count || 0)} utilizzi rimanenti</p>`
      : '';

    return `
      <div class="promo-code-card">
        <div class="promo-code-header">
          <span class="promo-discount-badge">${discountText}</span>
          <span class="promo-validity">Fino al ${endDate}</span>
        </div>
        <div class="promo-code-body">
          <h3 class="promo-code-title">${promo.name}</h3>
          <p class="promo-code-desc">${promo.description || ''}</p>
          ${minPurchaseText}
          ${usageText}
        </div>
        ${promo.code ? `
        <div class="promo-code-footer">
          <div class="promo-code-value">
            <span class="code-label">Codice:</span>
            <span class="code-text">${promo.code}</span>
          </div>
          <button class="copy-code-btn" data-code="${promo.code}">
            📋 Copia
          </button>
        </div>
        ` : `
        <div class="promo-code-footer auto-apply">
          <span class="auto-apply-text">✨ Applicato automaticamente al checkout</span>
        </div>
        `}
      </div>
    `;
  }

  async copyCode(code) {
    try {
      await navigator.clipboard.writeText(code);
      // Show feedback
      const btn = document.querySelector(`[data-code="${code}"]`);
      const originalText = btn.innerHTML;
      btn.innerHTML = '✅ Copiato!';
      btn.classList.add('copied');
      setTimeout(() => {
        btn.innerHTML = originalText;
        btn.classList.remove('copied');
      }, 2000);
    } catch (err) {
      console.error('Copy failed:', err);
    }
  }

  async handleWishlistClick(e) {
    e.preventDefault();
    e.stopPropagation();
    
    const btn = e.currentTarget;
    const productId = btn.dataset.productId;
    
    if (!productId) return;

    // Use toggleFavorite which handles auth state automatically
    const { isFavorite, error } = await wishlistService.toggleFavorite(productId);
    
    if (error) {
      console.error('Wishlist toggle error:', error);
      return;
    }
    
    if (isFavorite) {
      btn.classList.add('active');
      btn.textContent = '♥';
    } else {
      btn.classList.remove('active');
      btn.textContent = '♡';
    }
    
    // Update wishlist badge
    this.updateWishlistBadge();
  }

  async addToCart(productId) {
    const product = this.discountedProducts.find(p => p.id === productId);
    if (!product) return;

    await cartService.addItem({
      id: product.id,
      name: product.name,
      price: product.sale_price || product.price,
      image: product.images?.[0] || '',
      quantity: 1
    });
    
    this.updateCartBadge();
    cartDrawer.show();
  }
}

const promosPage = new PromosPage();

// Global function for add to cart from HTML onclick
window.addToCartFromPromos = (productId) => {
  promosPage.addToCart(productId);
};
