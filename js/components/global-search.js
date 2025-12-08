/**
 * Global Search Component
 * Live search with product suggestions and preview
 */

import { supabase, isSupabaseConfigured } from '../supabase.js';

class GlobalSearch {
    constructor() {
        this.searchOverlay = null;
        this.searchInput = null;
        this.resultsContainer = null;
        this.debounceTimer = null;
        this.isOpen = false;
        this.selectedIndex = -1;
        this.results = [];
    }

    /**
     * Initialize the global search component
     */
    init() {
        this.createSearchOverlay();
        this.bindEvents();
        this.injectSearchButton();
        this.createMobileSearchFab();
    }

    /**
     * Create the search overlay HTML
     */
    createSearchOverlay() {
        const overlay = document.createElement('div');
        overlay.className = 'global-search-overlay';
        overlay.id = 'globalSearchOverlay';
        overlay.innerHTML = `
            <div class="global-search-container">
                <div class="global-search-header">
                    <div class="global-search-input-wrapper">
                        <svg class="search-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="11" cy="11" r="8"/>
                            <path d="M21 21l-4.35-4.35"/>
                        </svg>
                        <input type="text" 
                               id="globalSearchInput" 
                               class="global-search-input" 
                               placeholder="Cerca prodotti..." 
                               autocomplete="off"
                               autocorrect="off"
                               autocapitalize="off"
                               spellcheck="false">
                        <button class="global-search-close" id="globalSearchClose" aria-label="Chiudi ricerca">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M18 6L6 18M6 6l12 12"/>
                            </svg>
                        </button>
                    </div>
                    <div class="global-search-hint">
                        <span class="hint-key">↑↓</span> per navigare
                        <span class="hint-key">Enter</span> per selezionare
                        <span class="hint-key">Esc</span> per chiudere
                    </div>
                </div>
                <div class="global-search-results" id="globalSearchResults">
                    <div class="search-empty-state">
                        <div class="search-empty-icon">🔍</div>
                        <p>Inizia a digitare per cercare prodotti</p>
                        <div class="search-suggestions">
                            <span class="suggestion-label">Suggerimenti:</span>
                            <button class="suggestion-chip" data-query="frutta">🍎 Frutta</button>
                            <button class="suggestion-chip" data-query="verdura">🥬 Verdura</button>
                            <button class="suggestion-chip" data-query="biologico">🌱 Biologico</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        
        this.searchOverlay = overlay;
        this.searchInput = document.getElementById('globalSearchInput');
        this.resultsContainer = document.getElementById('globalSearchResults');
    }

    /**
     * Inject search button into navigation
     */
    injectSearchButton() {
        // Check if search button already exists
        if (document.querySelector('.nav-search-btn')) return;

        // Find nav container (nav-right or nav-actions depending on page)
        const navContainer = document.querySelector('.nav-right') || document.querySelector('.nav-actions');
        if (!navContainer) {
            // Retry after a short delay
            setTimeout(() => this.injectSearchButton(), 200);
            return;
        }

        // Create search button
        const searchBtn = document.createElement('button');
        searchBtn.className = 'nav-search-btn';
        searchBtn.setAttribute('aria-label', 'Cerca');
        searchBtn.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="11" cy="11" r="8"/>
                <path d="M21 21l-4.35-4.35"/>
            </svg>
        `;
        
        // Insert at the beginning of nav container
        const promoBadge = navContainer.querySelector('.nav-promo-badge');
        const menuBtn = navContainer.querySelector('.menu-btn');
        
        if (promoBadge) {
            navContainer.insertBefore(searchBtn, promoBadge);
        } else if (menuBtn) {
            navContainer.insertBefore(searchBtn, menuBtn);
        } else {
            navContainer.insertBefore(searchBtn, navContainer.firstChild);
        }

        searchBtn.addEventListener('click', () => this.open());
    }

    /**
     * Create floating action button for mobile search
     */
    createMobileSearchFab() {
        // Check if FAB already exists
        if (document.querySelector('.mobile-search-fab')) return;

        const fab = document.createElement('button');
        fab.className = 'mobile-search-fab';
        fab.setAttribute('aria-label', 'Cerca prodotti');
        fab.innerHTML = `
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="11" cy="11" r="8"/>
                <path d="M21 21l-4.35-4.35"/>
            </svg>
        `;
        
        document.body.appendChild(fab);
        fab.addEventListener('click', () => this.open());
    }

    /**
     * Bind all event listeners
     */
    bindEvents() {
        // Close button
        document.getElementById('globalSearchClose')?.addEventListener('click', () => this.close());

        // Overlay click to close
        this.searchOverlay?.addEventListener('click', (e) => {
            if (e.target === this.searchOverlay) this.close();
        });

        // Input events
        this.searchInput?.addEventListener('input', (e) => this.handleInput(e));
        this.searchInput?.addEventListener('keydown', (e) => this.handleKeydown(e));

        // Suggestion chips
        this.resultsContainer?.addEventListener('click', (e) => {
            const chip = e.target.closest('.suggestion-chip');
            if (chip) {
                const query = chip.dataset.query;
                this.searchInput.value = query;
                this.search(query);
            }
        });

        // Global keyboard shortcut (Ctrl/Cmd + K)
        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                e.preventDefault();
                this.toggle();
            }
            if (e.key === 'Escape' && this.isOpen) {
                this.close();
            }
        });
    }

    /**
     * Open search overlay
     */
    open() {
        this.isOpen = true;
        this.searchOverlay.classList.add('active');
        document.body.classList.add('search-open');
        setTimeout(() => this.searchInput?.focus(), 100);
    }

    /**
     * Close search overlay
     */
    close() {
        this.isOpen = false;
        this.searchOverlay.classList.remove('active');
        document.body.classList.remove('search-open');
        this.searchInput.value = '';
        this.selectedIndex = -1;
        this.results = [];
        this.showEmptyState();
    }

    /**
     * Toggle search overlay
     */
    toggle() {
        if (this.isOpen) {
            this.close();
        } else {
            this.open();
        }
    }

    /**
     * Handle input changes with debounce
     */
    handleInput(e) {
        const query = e.target.value.trim();
        
        clearTimeout(this.debounceTimer);
        
        if (query.length < 2) {
            this.showEmptyState();
            return;
        }

        this.showLoading();
        
        this.debounceTimer = setTimeout(() => {
            this.search(query);
        }, 200);
    }

    /**
     * Handle keyboard navigation
     */
    handleKeydown(e) {
        if (!this.results.length) return;

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                this.selectedIndex = Math.min(this.selectedIndex + 1, this.results.length - 1);
                this.updateSelection();
                break;
            case 'ArrowUp':
                e.preventDefault();
                this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
                this.updateSelection();
                break;
            case 'Enter':
                e.preventDefault();
                if (this.selectedIndex >= 0 && this.results[this.selectedIndex]) {
                    this.navigateToProduct(this.results[this.selectedIndex]);
                }
                break;
        }
    }

    /**
     * Update visual selection
     */
    updateSelection() {
        const items = this.resultsContainer.querySelectorAll('.search-result-item');
        items.forEach((item, index) => {
            item.classList.toggle('selected', index === this.selectedIndex);
            if (index === this.selectedIndex) {
                item.scrollIntoView({ block: 'nearest' });
            }
        });
    }

    /**
     * Search products
     */
    async search(query) {
        if (!isSupabaseConfigured()) {
            this.showError('Sistema non configurato');
            return;
        }

        try {
            const lowerQuery = query.toLowerCase();
            
            // Check if searching for a category/section - redirect to collection page
            const categoryRedirects = {
                'frutta': 'collection.html?gender=frutta',
                'verdura': 'collection.html?gender=verdura',
                'conserve': 'collection.html?gender=conserve',
                'secchi': 'collection.html?gender=secchi-estratti',
                'estratti': 'collection.html?gender=secchi-estratti',
                'frutta secca': 'collection.html?gender=frutta&category=frutta-secca',
                'frutta disidratata': 'collection.html?gender=frutta&category=frutta-disidratata',
                'biologico': 'collection.html?gender=frutta&category=frutta-biologica',
                'bio': 'collection.html?gender=frutta&category=frutta-biologica',
                'stagione': 'collection.html?gender=frutta&seasonal=true',
                'di stagione': 'collection.html?gender=frutta&seasonal=true',
                'olio': 'collection.html?gender=secchi-estratti&category=oli',
                'oli': 'collection.html?gender=secchi-estratti&category=oli',
                'succhi': 'collection.html?gender=secchi-estratti&category=succhi-spremute',
                'marmellate': 'collection.html?gender=conserve&category=marmellate-confetture',
                'sottoli': 'collection.html?gender=conserve&category=sottoli',
                'sottaceti': 'collection.html?gender=conserve&category=sottaceti'
            };
            
            // Check for exact category match
            if (categoryRedirects[lowerQuery]) {
                this.showCategoryResult(query, categoryRedirects[lowerQuery]);
                return;
            }
            
            // Use the RPC function for enhanced search
            const { data, error } = await supabase.rpc('search_products', {
                search_query: query
            });

            if (error) {
                // Fallback to basic search if RPC fails - include gender and category search
                const { data: fallbackData, error: fallbackError } = await supabase
                    .from('products')
                    .select('*, categories(name, slug)')
                    .eq('is_active', true)
                    .or(`name.ilike.%${query}%,description.ilike.%${query}%,gender.ilike.%${query}%`)
                    .limit(10);

                if (fallbackError) throw fallbackError;
                this.results = fallbackData || [];
            } else {
                // Fetch category info for RPC results
                const productIds = data?.map(p => p.id) || [];
                if (productIds.length > 0) {
                    const { data: productsWithCategories } = await supabase
                        .from('products')
                        .select('*, categories(name, slug)')
                        .in('id', productIds);
                    
                    // Maintain search order
                    this.results = productIds.map(id => 
                        productsWithCategories?.find(p => p.id === id)
                    ).filter(Boolean);
                } else {
                    this.results = [];
                }
            }

            this.selectedIndex = -1;
            this.renderResults(query);
        } catch (err) {
            console.error('Search error:', err);
            this.showError('Errore nella ricerca');
        }
    }
    
    /**
     * Show category result with link to collection page
     */
    showCategoryResult(query, url) {
        const categoryNames = {
            'frutta': { name: 'Frutta', emoji: '🍎', desc: 'Frutta fresca di stagione' },
            'verdura': { name: 'Verdura', emoji: '🥬', desc: 'Verdura fresca selezionata' },
            'conserve': { name: 'Conserve e Preparati', emoji: '🫙', desc: 'Sott\'oli, marmellate e salse' },
            'secchi': { name: 'Prodotti Secchi e Estratti', emoji: '🫒', desc: 'Oli, succhi e frutta secca' },
            'estratti': { name: 'Prodotti Secchi e Estratti', emoji: '🫒', desc: 'Oli, succhi e frutta secca' },
            'frutta secca': { name: 'Frutta Secca', emoji: '🥜', desc: 'Noci, mandorle e nocciole' },
            'frutta disidratata': { name: 'Frutta Disidratata', emoji: '🍇', desc: 'Frutta essiccata naturale' },
            'biologico': { name: 'Prodotti Biologici', emoji: '🌱', desc: 'Certificati biologici' },
            'bio': { name: 'Prodotti Biologici', emoji: '🌱', desc: 'Certificati biologici' },
            'stagione': { name: 'Prodotti di Stagione', emoji: '🍅', desc: 'Freschi e al miglior prezzo' },
            'di stagione': { name: 'Prodotti di Stagione', emoji: '🍅', desc: 'Freschi e al miglior prezzo' },
            'olio': { name: 'Oli', emoji: '🫒', desc: 'Oli extravergine e aromatizzati' },
            'oli': { name: 'Oli', emoji: '🫒', desc: 'Oli extravergine e aromatizzati' },
            'succhi': { name: 'Succhi e Spremute', emoji: '🧃', desc: 'Succhi di frutta freschi' },
            'marmellate': { name: 'Marmellate e Confetture', emoji: '🍯', desc: 'Artigianali e genuine' },
            'sottoli': { name: 'Sott\'oli', emoji: '🫙', desc: 'Conserve sott\'olio' },
            'sottaceti': { name: 'Sott\'aceti', emoji: '🥒', desc: 'Conserve sott\'aceto' }
        };
        
        const cat = categoryNames[query.toLowerCase()] || { name: query, emoji: '📦', desc: 'Esplora la categoria' };
        
        this.resultsContainer.innerHTML = `
            <div class="search-category-result">
                <div class="category-result-card" onclick="window.location.href='${url}'">
                    <div class="category-result-icon">${cat.emoji}</div>
                    <div class="category-result-info">
                        <h4>${cat.name}</h4>
                        <p>${cat.desc}</p>
                    </div>
                    <div class="category-result-arrow">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M9 18l6-6-6-6"/>
                        </svg>
                    </div>
                </div>
                <p class="category-result-hint">Clicca per esplorare tutti i prodotti</p>
            </div>
        `;
    }

    /**
     * Render search results
     */
    renderResults(query) {
        if (!this.results.length) {
            this.showNoResults(query);
            return;
        }

        const html = `
            <div class="search-results-header">
                <span class="results-count">${this.results.length} risultat${this.results.length === 1 ? 'o' : 'i'}</span>
            </div>
            <div class="search-results-list">
                ${this.results.map((product, index) => this.renderProductItem(product, index, query)).join('')}
            </div>
        `;

        this.resultsContainer.innerHTML = html;

        // Add click handlers
        this.resultsContainer.querySelectorAll('.search-result-item').forEach((item, index) => {
            item.addEventListener('click', () => this.navigateToProduct(this.results[index]));
            item.addEventListener('mouseenter', () => {
                this.selectedIndex = index;
                this.updateSelection();
            });
        });
    }

    /**
     * Render a single product item
     */
    renderProductItem(product, index, query) {
        const hasDiscount = product.sale_price && product.sale_price < product.price;
        const discountPercent = hasDiscount ? Math.round((1 - product.sale_price / product.price) * 100) : 0;
        const imageUrl = this.getImageUrl(product.images?.[0]);
        const highlightedName = this.highlightMatch(product.name, query);
        
        return `
            <div class="search-result-item" data-index="${index}">
                <div class="result-image">
                    <img src="${imageUrl}" alt="${product.name}" loading="lazy" 
                         onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect fill=%22%23f5f5f5%22 width=%22100%22 height=%22100%22/><text x=%2250%22 y=%2255%22 text-anchor=%22middle%22 font-size=%2240%22>🍎</text></svg>'">
                    ${hasDiscount ? `<span class="result-discount-badge">-${discountPercent}%</span>` : ''}
                </div>
                <div class="result-info">
                    <h4 class="result-name">${highlightedName}</h4>
                    <div class="result-meta">
                        ${product.categories?.name ? `<span class="result-category">${product.categories.name}</span>` : ''}
                        ${product.gender ? `<span class="result-type">${this.getTypeEmoji(product.gender)}</span>` : ''}
                    </div>
                    <div class="result-price">
                        ${hasDiscount 
                            ? `<span class="price-sale">€${parseFloat(product.sale_price).toFixed(2)}</span>
                               <span class="price-original">€${parseFloat(product.price).toFixed(2)}</span>`
                            : `<span class="price">€${parseFloat(product.price).toFixed(2)}</span>`
                        }
                    </div>
                </div>
                <div class="result-arrow">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M9 18l6-6-6-6"/>
                    </svg>
                </div>
            </div>
        `;
    }

    /**
     * Highlight matching text
     */
    highlightMatch(text, query) {
        if (!query) return text;
        const regex = new RegExp(`(${this.escapeRegex(query)})`, 'gi');
        return text.replace(regex, '<mark>$1</mark>');
    }

    /**
     * Escape regex special characters
     */
    escapeRegex(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    /**
     * Get type emoji
     */
    getTypeEmoji(gender) {
        const emojis = {
            'frutta': '🍎',
            'verdura': '🥬',
            'conserve': '🫙',
            'secchi-estratti': '🫒',
            'altro': '🧺'
        };
        return emojis[gender] || '';
    }

    /**
     * Get image URL with fallback
     */
    getImageUrl(imagePath) {
        if (!imagePath) return '';
        if (imagePath.startsWith('http://') || imagePath.startsWith('https://') || imagePath.startsWith('data:')) {
            return imagePath;
        }
        return imagePath;
    }

    /**
     * Navigate to product page
     */
    navigateToProduct(product) {
        this.close();
        window.location.href = `product.html?slug=${product.slug}`;
    }

    /**
     * Show empty state
     */
    showEmptyState() {
        this.resultsContainer.innerHTML = `
            <div class="search-empty-state">
                <div class="search-empty-icon">🔍</div>
                <p>Inizia a digitare per cercare prodotti</p>
                <div class="search-suggestions">
                    <span class="suggestion-label">Categorie:</span>
                    <button class="suggestion-chip" data-query="frutta">🍎 Frutta</button>
                    <button class="suggestion-chip" data-query="verdura">🥬 Verdura</button>
                    <button class="suggestion-chip" data-query="conserve">🫙 Conserve</button>
                    <button class="suggestion-chip" data-query="secchi">🫒 Secchi e Estratti</button>
                </div>
                <div class="search-suggestions" style="margin-top: 0.75rem;">
                    <span class="suggestion-label">Sottocategorie:</span>
                    <button class="suggestion-chip" data-query="frutta secca">🥜 Frutta Secca</button>
                    <button class="suggestion-chip" data-query="biologico">🌱 Biologico</button>
                    <button class="suggestion-chip" data-query="stagione">🍅 Di Stagione</button>
                    <button class="suggestion-chip" data-query="olio">🫒 Oli</button>
                </div>
            </div>
        `;
    }

    /**
     * Show loading state
     */
    showLoading() {
        this.resultsContainer.innerHTML = `
            <div class="search-loading">
                <div class="search-spinner"></div>
                <p>Ricerca in corso...</p>
            </div>
        `;
    }

    /**
     * Show no results state
     */
    showNoResults(query) {
        this.resultsContainer.innerHTML = `
            <div class="search-no-results">
                <div class="no-results-icon">😕</div>
                <p>Nessun risultato per "<strong>${query}</strong>"</p>
                <span class="no-results-hint">Prova con termini diversi o controlla l'ortografia</span>
            </div>
        `;
    }

    /**
     * Show error state
     */
    showError(message) {
        this.resultsContainer.innerHTML = `
            <div class="search-error">
                <div class="error-icon">⚠️</div>
                <p>${message}</p>
            </div>
        `;
    }
}

// Export singleton instance
export const globalSearch = new GlobalSearch();
export default globalSearch;
