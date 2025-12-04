/**
 * Collection Page Module
 * Avenue M. E-commerce Platform
 * 
 * Handles product grid, filtering, and display logic
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 8.2, 8.3
 */

import { productService } from '../services/products.js';
import { wishlistService } from '../services/wishlist.js';
import { isSupabaseConfigured } from '../supabase.js';
import '../services/presence.js'; // Track user presence for analytics

/**
 * Collection Page Controller
 */
class CollectionPage {
  constructor() {
    this.products = [];
    this.allProducts = []; // Store all products for client-side filtering
    this.filters = {
      gender: null,
      category_id: null,
      price_min: null,
      price_max: null,
      min_discount: null,
      sort_by: 'newest'
    };
    this.currentView = 'grid';
    this.isLoading = false;
  }

  /**
   * Initialize the collection page
   */
  async init() {
    // Get gender from URL params
    const params = new URLSearchParams(window.location.search);
    this.filters.gender = params.get('gender') || null;
    
    // Update page title
    this._updatePageTitle();
    
    // Set up event listeners
    this._setupEventListeners();
    
    // Load products
    await this.loadProducts();
    
    // Load categories for filter
    await this._loadCategories();
  }

  /**
   * Load products with current filters
   */
  async loadProducts() {
    if (this.isLoading) return;
    
    this.isLoading = true;
    this._showLoading();

    try {
      if (isSupabaseConfigured()) {
        // Fetch from Supabase
        const { products, error } = await productService.getProducts(this.filters);
        
        if (error) {
          console.error('Error loading products:', error);
          this._showError('Errore nel caricamento dei prodotti');
          return;
        }
        
        this.products = products;
      } else {
        // Use fallback mock data for development
        this.products = this._getMockProducts();
      }
      
      this._renderProducts();
    } catch (err) {
      console.error('Load products error:', err);
      this._showError('Errore nel caricamento dei prodotti');
    } finally {
      this.isLoading = false;
      this._hideLoading();
    }
  }

  /**
   * Apply filter and reload products
   */
  async applyFilter(filterName, value) {
    this.filters[filterName] = value;
    
    // Client-side only filters - just re-render without reloading from server
    const clientSideFilters = ['min_discount', 'sort_by'];
    if (clientSideFilters.includes(filterName) && this.products.length > 0) {
      this._renderProducts();
    } else {
      await this.loadProducts();
    }
  }

  /**
   * Clear all filters
   * Requirement: 7.4
   */
  async clearFilters() {
    const gender = this.filters.gender; // Preserve gender from URL
    this.filters = {
      gender,
      category_id: null,
      price_min: null,
      price_max: null,
      min_discount: null,
      sort_by: 'newest'
    };
    
    this._resetFilterUI();
    await this.loadProducts();
  }

  /**
   * Set view mode (grid or list)
   */
  setView(view) {
    this.currentView = view;
    const grid = document.getElementById('productGrid');
    if (grid) {
      grid.className = view === 'list' 
        ? 'collection-grid-modern list-view' 
        : 'collection-grid-modern';
    }
  }

  // ============================================
  // Private Methods
  // ============================================

  _updatePageTitle() {
    const titleEl = document.getElementById('pageTitle');
    if (titleEl) {
      const titleMap = {
        'frutta': { title: 'Frutta', pageTitle: 'Frutta | Mimmo Fratelli' },
        'verdura': { title: 'Verdura', pageTitle: 'Verdura | Mimmo Fratelli' },
        'altro': { title: 'Altri Prodotti', pageTitle: 'Altri Prodotti | Mimmo Fratelli' }
      };
      const config = titleMap[this.filters.gender] || { title: 'Prodotti', pageTitle: 'Prodotti | Mimmo Fratelli' };
      titleEl.textContent = config.title;
      document.title = config.pageTitle;
    }
  }

  _setupEventListeners() {
    // Filter buttons
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const filter = e.target.dataset.filter;
        this._handleFilterClick(filter);
      });
    });

    // View toggle
    document.querySelectorAll('.view-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        this.setView(e.target.dataset.view);
      });
    });

    // Price range inputs (if present)
    const priceMinInput = document.getElementById('priceMin');
    const priceMaxInput = document.getElementById('priceMax');
    
    if (priceMinInput) {
      priceMinInput.addEventListener('change', (e) => {
        this.applyFilter('price_min', parseFloat(e.target.value) || null);
      });
    }
    
    if (priceMaxInput) {
      priceMaxInput.addEventListener('change', (e) => {
        this.applyFilter('price_max', parseFloat(e.target.value) || null);
      });
    }

    // Sort select (if present)
    const sortSelect = document.getElementById('sortSelect');
    if (sortSelect) {
      sortSelect.addEventListener('change', (e) => {
        this.applyFilter('sort_by', e.target.value);
      });
    }

    // Discount select (if present)
    const discountSelect = document.getElementById('discountSelect');
    if (discountSelect) {
      discountSelect.addEventListener('change', (e) => {
        this.applyFilter('min_discount', e.target.value ? parseInt(e.target.value) : null);
      });
    }

    // Category select (if present)
    const categorySelect = document.getElementById('categorySelect');
    if (categorySelect) {
      categorySelect.addEventListener('change', (e) => {
        this.applyFilter('category_id', e.target.value || null);
      });
    }

    // Clear filters button
    const clearBtn = document.getElementById('clearFiltersBtn');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => this.clearFilters());
    }
  }

  _handleFilterClick(filter) {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    event.target.classList.add('active');

    switch (filter) {
      case 'all':
        this.clearFilters();
        break;
      case 'new':
        this.applyFilter('sort_by', 'newest');
        break;
      case 'sale':
        this.applyFilter('is_promotion', true);
        break;
      case 'favorites':
        this._showFavorites();
        break;
    }
  }

  async _loadCategories() {
    if (!isSupabaseConfigured()) return;
    
    const { categories } = await productService.getCategories();
    // Could populate a category dropdown here
  }

  _renderProducts() {
    const grid = document.getElementById('productGrid');
    if (!grid) return;

    grid.innerHTML = '';

    // Apply client-side filters
    let filteredProducts = this._applyClientFilters(this.products);

    if (filteredProducts.length === 0) {
      grid.innerHTML = `
        <div class="no-products">
          <p>Nessun prodotto trovato</p>
          <button class="btn" onclick="collectionPage.clearFilters()">Rimuovi filtri</button>
        </div>
      `;
      return;
    }

    filteredProducts.forEach((product, index) => {
      const card = this._createProductCard(product, index);
      grid.appendChild(card);
    });

    // Update favorites count
    this._updateFavoritesCount();
  }

  /**
   * Apply client-side filters (discount, sorting by discount)
   */
  _applyClientFilters(products) {
    let filtered = [...products];

    // Filter by minimum discount percentage
    if (this.filters.min_discount) {
      filtered = filtered.filter(p => {
        if (!p.sale_price || p.sale_price >= p.price) return false;
        const discountPercent = Math.round((1 - p.sale_price / p.price) * 100);
        return discountPercent >= this.filters.min_discount;
      });
    }

    // Sort by discount if selected
    if (this.filters.sort_by === 'discount_desc') {
      filtered.sort((a, b) => {
        const discountA = a.sale_price && a.sale_price < a.price 
          ? (1 - a.sale_price / a.price) : 0;
        const discountB = b.sale_price && b.sale_price < b.price 
          ? (1 - b.sale_price / b.price) : 0;
        return discountB - discountA;
      });
    }

    return filtered;
  }

  _createProductCard(product, index) {
    const card = document.createElement('div');
    card.className = 'product-card-modern';
    card.style.animationDelay = `${index * 0.1}s`;

    // Get images array or use placeholder
    const images = product.images?.length > 0 
      ? product.images 
      : [this._getPlaceholderImage()];

    const isFav = wishlistService?.isFavorite(product.id) || false;
    const displayPrice = product.sale_price || product.price;
    const hasDiscount = product.sale_price && product.sale_price < product.price;

    card.innerHTML = `
      <div class="card-image-wrapper">
        <div class="carousel-container" id="carousel-${product.id}">
          ${images.map((img, idx) => `
            <img src="${img}" class="carousel-img ${idx === 0 ? 'active' : ''}" 
                 data-index="${idx}" loading="lazy" 
                 onerror="this.src='${this._getPlaceholderImage()}'">
          `).join('')}
        </div>
        <div class="card-overlay">
          <button class="quick-view-btn" onclick="collectionPage.openQuickView('${product.id}', event)">
            <span>Vista Rapida</span>
          </button>
        </div>
        ${images.length > 1 ? `
          <div class="carousel-dots">
            ${images.map((_, idx) => `
              <span class="dot ${idx === 0 ? 'active' : ''}" 
                    onclick="collectionPage.goToImage(event, '${product.id}', ${idx})"></span>
            `).join('')}
          </div>
        ` : ''}
        ${hasDiscount ? `<span class="sale-badge">-${Math.round((1 - product.sale_price / product.price) * 100)}%</span>` : ''}
      </div>
      <div class="card-info">
        <div class="card-header">
          <h3 class="card-name">${product.name}</h3>
          <button class="card-favorite ${isFav ? 'active' : ''}" data-product-id="${product.id}">
            <span class="heart-icon">${isFav ? '♥' : '♡'}</span>
          </button>
        </div>
        <p class="card-price">
          ${hasDiscount ? `<span class="original-price">€ ${product.price.toFixed(2)}</span>` : ''}
          € ${displayPrice.toFixed(2)}
        </p>
        <button class="card-cta" onclick="collectionPage.goToProduct('${product.id}')">Scopri</button>
      </div>
    `;

    // Set up hover carousel
    this._setupCardHover(card, product.id, images.length);

    return card;
  }

  _setupCardHover(card, productId, imageCount) {
    if (imageCount <= 1) return;

    let hoverInterval;
    const cardWrapper = card.querySelector('.card-image-wrapper');
    
    cardWrapper.addEventListener('mouseenter', () => {
      hoverInterval = setInterval(() => {
        this._nextImage(productId);
      }, 1500);
    });
    
    cardWrapper.addEventListener('mouseleave', () => {
      clearInterval(hoverInterval);
    });
  }

  _nextImage(productId) {
    const container = document.getElementById(`carousel-${productId}`);
    if (!container) return;

    const images = container.querySelectorAll('.carousel-img');
    const dots = container.parentElement.querySelectorAll('.dot');
    let activeIndex = 0;

    images.forEach((img, index) => {
      if (img.classList.contains('active')) {
        activeIndex = index;
        img.classList.remove('active');
      }
    });

    dots.forEach(dot => dot.classList.remove('active'));

    const nextIndex = (activeIndex + 1) % images.length;
    images[nextIndex].classList.add('active');
    if (dots[nextIndex]) dots[nextIndex].classList.add('active');
  }

  goToImage(event, productId, index) {
    event.stopPropagation();
    const container = document.getElementById(`carousel-${productId}`);
    if (!container) return;

    const images = container.querySelectorAll('.carousel-img');
    const dots = container.parentElement.querySelectorAll('.dot');

    images.forEach(img => img.classList.remove('active'));
    dots.forEach(dot => dot.classList.remove('active'));

    images[index].classList.add('active');
    if (dots[index]) dots[index].classList.add('active');
  }

  goToProduct(productId) {
    const type = this.filters.gender || 'frutta';
    window.location.href = `product.html?id=${productId}&gender=${type}`;
  }

  openQuickView(productId, event) {
    event.stopPropagation();
    const product = this.products.find(p => p.id === productId);
    if (!product) return;

    // Dispatch custom event for quick view modal
    window.dispatchEvent(new CustomEvent('openQuickView', { detail: product }));
  }

  _showFavorites() {
    const favSection = document.getElementById('favoritesSection');
    if (favSection) {
      const isVisible = favSection.style.display !== 'none';
      favSection.style.display = isVisible ? 'none' : 'block';
      
      if (!isVisible) {
        favSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  }

  _updateFavoritesCount() {
    const countEl = document.getElementById('favoritesCount');
    if (countEl && wishlistService) {
      const count = wishlistService.getLocalWishlist().length;
      countEl.textContent = count;
      countEl.style.display = count > 0 ? 'inline-flex' : 'none';
    }
  }

  _resetFilterUI() {
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.classList.remove('active');
      if (btn.dataset.filter === 'all') {
        btn.classList.add('active');
      }
    });

    // Reset select elements
    const categorySelect = document.getElementById('categorySelect');
    const discountSelect = document.getElementById('discountSelect');
    const sortSelect = document.getElementById('sortSelect');
    const priceMin = document.getElementById('priceMin');
    const priceMax = document.getElementById('priceMax');

    if (categorySelect) categorySelect.value = '';
    if (discountSelect) discountSelect.value = '';
    if (sortSelect) sortSelect.value = 'newest';
    if (priceMin) priceMin.value = '';
    if (priceMax) priceMax.value = '';
  }

  _showLoading() {
    const grid = document.getElementById('productGrid');
    if (grid) {
      grid.innerHTML = '<div class="loading-spinner">Caricamento...</div>';
    }
  }

  _hideLoading() {
    // Loading is hidden when products are rendered
  }

  _showError(message) {
    const grid = document.getElementById('productGrid');
    if (grid) {
      grid.innerHTML = `<div class="error-message">${message}</div>`;
    }
  }

  _getPlaceholderImage() {
    return 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="400" height="600" viewBox="0 0 400 600"%3E%3Crect fill="%23f3f0eb" width="400" height="600"/%3E%3Ctext fill="%23999" font-family="sans-serif" font-size="20" x="50%25" y="50%25" text-anchor="middle"%3EImmagine%3C/text%3E%3C/svg%3E';
  }

  /**
   * Fallback mock products for development without Supabase
   */
  _getMockProducts() {
    const type = this.filters.gender || 'frutta';
    if (type === 'verdura') {
      return [
        { id: '1', name: "Pomodori Cuore di Bue", price: 3.50, images: ["https://images.unsplash.com/photo-1546470427-227c7369a9b9?w=400&q=60&fm=webp"] },
        { id: '2', name: "Zucchine Biologiche", price: 2.80, images: ["https://images.unsplash.com/photo-1563252722-6434563a985d?w=400&q=60&fm=webp"] },
        { id: '3', name: "Insalata Mista", price: 1.90, images: ["https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=400&q=60&fm=webp"] }
      ];
    }
    return [
      { id: '1', name: "Arance Tarocco", price: 2.80, images: ["https://images.unsplash.com/photo-1547514701-42782101795e?w=400&q=60&fm=webp"] },
      { id: '2', name: "Mele Fuji", price: 3.20, images: ["https://images.unsplash.com/photo-1560806887-1e4cd0b6cbd6?w=400&q=60&fm=webp"] },
      { id: '3', name: "Kiwi Zespri", price: 3.90, images: ["https://images.unsplash.com/photo-1585059895524-72359e06133a?w=400&q=60&fm=webp"] }
    ];
  }
}

// Export singleton
export const collectionPage = new CollectionPage();

// Make available globally for inline event handlers
if (typeof window !== 'undefined') {
  window.collectionPage = collectionPage;
}

export default collectionPage;
