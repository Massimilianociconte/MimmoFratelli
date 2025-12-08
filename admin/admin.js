/**
 * Admin CMS - Avenue M.
 * Product and Category Management
 */

import { supabase, isSupabaseConfigured } from '../js/supabase.js';

// State
let currentUser = null;
let products = [];
let categories = [];
let deleteCallback = null;

// DOM Elements
const loginScreen = document.getElementById('loginScreen');
const adminContainer = document.getElementById('adminContainer');
const loginForm = document.getElementById('loginForm');
const loginError = document.getElementById('loginError');

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    if (!isSupabaseConfigured()) {
        showToast('Supabase non configurato. Configura le variabili in js/config.js', 'error');
        return;
    }

    // Check existing session
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
        const isAdmin = await checkAdminRole(session.user.id);
        if (isAdmin) {
            currentUser = session.user;
            showAdminPanel();
        }
    }

    setupEventListeners();
});

// Event Listeners
function setupEventListeners() {
    // Login form
    loginForm.addEventListener('submit', handleLogin);

    // Logout
    document.getElementById('logoutBtn').addEventListener('click', handleLogout);

    // Mobile menu
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    const sidebar = document.getElementById('sidebar');
    const sidebarOverlay = document.getElementById('sidebarOverlay');

    mobileMenuBtn?.addEventListener('click', () => {
        sidebar.classList.toggle('open');
        sidebarOverlay.classList.toggle('active');
    });

    sidebarOverlay?.addEventListener('click', () => {
        sidebar.classList.remove('open');
        sidebarOverlay.classList.remove('active');
    });

    // Mobile view toggle for products
    setupMobileViewToggle();
    
    // Table scroll indicators
    setupTableScrollIndicators();

    // Navigation
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const section = item.dataset.section;
            navigateToSection(section);
            
            // Close mobile menu
            document.getElementById('sidebar')?.classList.remove('open');
            document.getElementById('sidebarOverlay')?.classList.remove('active');
        });
    });

    // Add Product
    document.getElementById('addProductBtn').addEventListener('click', () => openProductModal());

    // Add Category
    document.getElementById('addCategoryBtn').addEventListener('click', () => openCategoryModal());

    // Product Form
    document.getElementById('productForm').addEventListener('submit', handleProductSubmit);

    // Category Form
    document.getElementById('categoryForm').addEventListener('submit', handleCategorySubmit);

    // Auto-generate slug
    document.getElementById('productName').addEventListener('input', (e) => {
        document.getElementById('productSlug').value = generateSlug(e.target.value);
    });

    document.getElementById('categoryName').addEventListener('input', (e) => {
        document.getElementById('categorySlug').value = generateSlug(e.target.value);
    });

    // Product search and filters
    document.getElementById('productSearch').addEventListener('input', applyProductFilters);
    document.getElementById('filterCategory').addEventListener('change', applyProductFilters);
    document.getElementById('filterType').addEventListener('change', applyProductFilters);
    document.getElementById('filterStatus').addEventListener('change', applyProductFilters);
    document.getElementById('filterStock').addEventListener('change', applyProductFilters);
    document.getElementById('resetFiltersBtn').addEventListener('click', resetProductFilters);

    // Delete confirmation
    document.getElementById('confirmDeleteBtn').addEventListener('click', () => {
        if (deleteCallback) {
            deleteCallback();
            closeDeleteModal();
        }
    });

    // Test notification button
    document.getElementById('testNotificationBtn')?.addEventListener('click', handleTestNotification);
}

// Authentication
async function handleLogin(e) {
    e.preventDefault();
    loginError.textContent = '';

    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;

    try {
        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password
        });

        if (error) {
            loginError.textContent = 'Credenziali non valide';
            return;
        }

        // Check admin role
        const isAdmin = await checkAdminRole(data.user.id);
        if (!isAdmin) {
            await supabase.auth.signOut();
            loginError.textContent = 'Accesso non autorizzato. Solo admin.';
            return;
        }

        currentUser = data.user;
        showAdminPanel();
    } catch (err) {
        console.error('Login error:', err);
        loginError.textContent = 'Errore durante il login';
    }
}

async function handleLogout() {
    await supabase.auth.signOut();
    currentUser = null;
    loginScreen.style.display = 'flex';
    adminContainer.style.display = 'none';
    loginForm.reset();
}

async function checkAdminRole(userId) {
    const { data, error } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId)
        .eq('role', 'admin')
        .maybeSingle();

    return data !== null;
}

// Admin Panel
async function showAdminPanel() {
    loginScreen.style.display = 'none';
    adminContainer.style.display = 'flex';

    // Update user info
    const metadata = currentUser.user_metadata || {};
    const name = metadata.first_name || currentUser.email.split('@')[0];
    document.getElementById('userName').textContent = name;
    document.getElementById('userAvatar').textContent = name[0].toUpperCase();

    // Load data
    await loadDashboardData();
    await loadProducts();
    await loadCategories();
    
    // Restore last visited section from localStorage
    const savedSection = localStorage.getItem('cms_current_section');
    if (savedSection && document.getElementById(`${savedSection}Section`)) {
        navigateToSection(savedSection);
    }
    
    // Restore open modal state if any
    restoreModalState();
}

// Save modal state to localStorage
function saveModalState(modalType, itemId = null) {
    const state = { modalType, itemId, timestamp: Date.now() };
    localStorage.setItem('cms_modal_state', JSON.stringify(state));
}

// Clear modal state from localStorage
function clearModalState() {
    localStorage.removeItem('cms_modal_state');
}

// Restore modal state after refresh
async function restoreModalState() {
    try {
        const stateStr = localStorage.getItem('cms_modal_state');
        if (!stateStr) return;
        
        const state = JSON.parse(stateStr);
        
        // Only restore if state is less than 30 minutes old
        if (Date.now() - state.timestamp > 30 * 60 * 1000) {
            clearModalState();
            return;
        }
        
        if (state.modalType === 'product' && state.itemId) {
            // Wait for products to load, then open modal
            const product = products.find(p => p.id === state.itemId);
            if (product) {
                openProductModal(product);
            } else {
                clearModalState();
            }
        } else if (state.modalType === 'product' && !state.itemId) {
            // New product modal
            openProductModal();
        } else if (state.modalType === 'category' && state.itemId) {
            const category = categories.find(c => c.id === state.itemId);
            if (category) {
                openCategoryModal(category);
            } else {
                clearModalState();
            }
        } else if (state.modalType === 'category' && !state.itemId) {
            openCategoryModal();
        } else if (state.modalType === 'order' && state.itemId) {
            // Navigate to orders section first, then load orders and open modal
            navigateToSection('orders');
            // Wait for orders to load
            setTimeout(async () => {
                if (orders.length === 0) {
                    await loadOrders();
                }
                const order = orders.find(o => o.id === state.itemId);
                if (order) {
                    viewOrderDetails(state.itemId);
                } else {
                    clearModalState();
                }
            }, 500);
        }
    } catch (err) {
        console.error('Error restoring modal state:', err);
        clearModalState();
    }
}

// Navigation
function navigateToSection(section) {
    // Save current section to localStorage for persistence on refresh
    localStorage.setItem('cms_current_section', section);
    
    // Update nav
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.section === section);
    });

    // Update title
    const titles = {
        dashboard: 'Dashboard',
        products: 'Gestione Prodotti',
        categories: 'Gestione Categorie',
        discounts: 'Gestione Sconti',
        orders: 'Gestione Ordini',
        giftcards: 'Gestione Gift Card',
        analytics: 'Analytics'
    };
    document.getElementById('pageTitle').textContent = titles[section] || 'Dashboard';

    // Show section
    document.querySelectorAll('.section').forEach(s => s.style.display = 'none');
    document.getElementById(`${section}Section`).style.display = 'block';

    // Load gift cards if navigating to that section
    if (section === 'giftcards') {
        loadGiftCards();
    }
    
    // Load analytics if navigating to that section
    if (section === 'analytics') {
        loadAnalyticsData();
        startActiveUsersPolling();
    } else {
        stopActiveUsersPolling();
    }
    
    // Load discounts section
    if (section === 'discounts') {
        initDiscountsSection();
    }
}

// Dashboard
async function loadDashboardData() {
    try {
        // Products count
        const { count: productsCount } = await supabase
            .from('products')
            .select('*', { count: 'exact', head: true });
        document.getElementById('totalProducts').textContent = productsCount || 0;

        // Categories count
        const { count: categoriesCount } = await supabase
            .from('categories')
            .select('*', { count: 'exact', head: true });
        document.getElementById('totalCategories').textContent = categoriesCount || 0;

        // Orders count
        const { count: ordersCount } = await supabase
            .from('orders')
            .select('*', { count: 'exact', head: true });
        document.getElementById('totalOrders').textContent = ordersCount || 0;

        // Users count - use profiles table directly (no RPC needed)
        const { count: usersCount } = await supabase
            .from('profiles')
            .select('*', { count: 'exact', head: true });
        document.getElementById('totalUsers').textContent = usersCount || 0;

        // Recent products
        const { data: recentProducts } = await supabase
            .from('products')
            .select('*, categories(name)')
            .order('created_at', { ascending: false })
            .limit(5);

        renderRecentProducts(recentProducts || []);
    } catch (err) {
        console.error('Dashboard error:', err);
    }
}

function renderRecentProducts(products) {
    const tbody = document.getElementById('recentProductsTable');
    
    if (products.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="loading">Nessun prodotto</td></tr>';
        return;
    }

    tbody.innerHTML = products.map(p => {
        const hasDiscount = p.sale_price && p.sale_price < p.price;
        const priceHtml = hasDiscount 
            ? `<span class="price-original">€${p.price}</span> <span class="price-sale">€${p.sale_price}</span>`
            : `€${p.price}`;
        return `
        <tr>
            <td><img src="${getImagePath(p.images?.[0])}" alt="${p.name}" class="product-thumb" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect fill=%22%23f5f5f5%22 width=%22100%22 height=%22100%22/></svg>'"></td>
            <td>${p.name}</td>
            <td class="price-cell">${priceHtml}</td>
            <td>${p.categories?.name || '-'}</td>
            <td><span class="status-badge ${p.is_active ? 'status-active' : 'status-inactive'}">${p.is_active ? 'Attivo' : 'Inattivo'}</span></td>
        </tr>
    `}).join('');
}

// Helper to get product type label
function getProductTypeLabel(gender, withEmoji = false) {
    const types = {
        'frutta': withEmoji ? '🍎 Frutta' : 'Frutta',
        'verdura': withEmoji ? '🥬 Verdura' : 'Verdura',
        'gastronomia': withEmoji ? '🧀 Gastronomia' : 'Gastronomia',
        'preparati': withEmoji ? '🍲 Preparati' : 'Preparati',
        'altro': withEmoji ? '🧺 Altro' : 'Altro'
    };
    return types[gender] || '-';
}

// Helper to get page type label
function getPageTypeLabel(pageType) {
    const types = {
        'home': '🏠 Home',
        'promos': '🏷️ Offerte',
        'featured': '⭐ Evidenza',
        'seasonal': '🍅 Stagione'
    };
    return types[pageType] || '-';
}

// Helper to fix image paths (add ../ for relative paths)
function getImagePath(imagePath) {
    if (!imagePath) return '';
    // If it's an absolute URL, return as is
    if (imagePath.startsWith('http://') || imagePath.startsWith('https://') || imagePath.startsWith('data:')) {
        return imagePath;
    }
    // Add ../ for relative paths since we're in /admin/
    // Encode spaces and special characters in path
    const encodedPath = imagePath.split('/').map(segment => encodeURIComponent(segment)).join('/');
    return '../' + encodedPath;
}

// Products
async function loadProducts() {
    try {
        const { data, error } = await supabase
            .from('products')
            .select('*, categories(name)')
            .order('created_at', { ascending: false });

        if (error) throw error;
        products = data || [];
        
        // Populate category filter dropdown
        populateCategoryFilter();
        
        // Apply any existing filters
        applyProductFilters();
    } catch (err) {
        console.error('Load products error:', err);
        showToast('Errore nel caricamento prodotti', 'error');
    }
}

// Populate category filter dropdown
function populateCategoryFilter() {
    const filterCategory = document.getElementById('filterCategory');
    if (!filterCategory) return;
    
    filterCategory.innerHTML = '<option value="">Tutte le categorie</option>' +
        categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
}

// Apply all product filters
function applyProductFilters() {
    const searchQuery = document.getElementById('productSearch').value.toLowerCase().trim();
    const categoryFilter = document.getElementById('filterCategory').value;
    const typeFilter = document.getElementById('filterType').value;
    const statusFilter = document.getElementById('filterStatus').value;
    const stockFilter = document.getElementById('filterStock').value;
    
    let filtered = products.filter(p => {
        // Text search
        if (searchQuery) {
            const matchesSearch = 
                p.name.toLowerCase().includes(searchQuery) || 
                p.slug.toLowerCase().includes(searchQuery) ||
                (p.description && p.description.toLowerCase().includes(searchQuery)) ||
                (p.categories?.name && p.categories.name.toLowerCase().includes(searchQuery));
            if (!matchesSearch) return false;
        }
        
        // Category filter
        if (categoryFilter && p.category_id !== categoryFilter) {
            return false;
        }
        
        // Type filter (gender)
        if (typeFilter && p.gender !== typeFilter) {
            return false;
        }
        
        // Status filter
        if (statusFilter === 'active' && !p.is_active) return false;
        if (statusFilter === 'inactive' && p.is_active) return false;
        
        // Stock filter
        if (stockFilter === 'in-stock' && p.inventory <= 0) return false;
        if (stockFilter === 'low-stock' && (p.inventory <= 0 || p.inventory > 5)) return false;
        if (stockFilter === 'out-of-stock' && p.inventory > 0) return false;
        
        return true;
    });
    
    renderProducts(filtered);
    updateFilterResultsCount(filtered.length, products.length);
}

// Update filter results count
function updateFilterResultsCount(filtered, total) {
    const countEl = document.getElementById('filterResultsCount');
    if (!countEl) return;
    
    if (filtered === total) {
        countEl.textContent = `${total} prodotti`;
        countEl.classList.remove('filtered');
    } else {
        countEl.textContent = `${filtered} di ${total} prodotti`;
        countEl.classList.add('filtered');
    }
}

// Reset all product filters
function resetProductFilters() {
    document.getElementById('productSearch').value = '';
    document.getElementById('filterCategory').value = '';
    document.getElementById('filterType').value = '';
    document.getElementById('filterStatus').value = '';
    document.getElementById('filterStock').value = '';
    applyProductFilters();
}

function renderProducts(productList) {
    const tbody = document.getElementById('productsTable');
    const mobileCardsContainer = document.getElementById('mobileProductCards');
    
    if (productList.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="loading">Nessun prodotto trovato</td></tr>';
        if (mobileCardsContainer) mobileCardsContainer.innerHTML = '<p class="empty-state">Nessun prodotto trovato</p>';
        return;
    }

    // Desktop table view
    tbody.innerHTML = productList.map(p => {
        const hasDiscount = p.sale_price && p.sale_price < p.price;
        const discountPercent = hasDiscount ? Math.round((1 - p.sale_price / p.price) * 100) : 0;
        return `
        <tr class="${hasDiscount ? 'has-discount' : ''}">
            <td><img src="${getImagePath(p.images?.[0])}" alt="${p.name}" class="product-thumb" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect fill=%22%23f5f5f5%22 width=%22100%22 height=%22100%22/></svg>'"></td>
            <td><strong>${p.name}</strong><br><small style="color:#999">${p.slug}</small></td>
            <td class="price-cell">${hasDiscount ? `<span class="price-original">€${p.price}</span>` : `€${p.price}`}</td>
            <td class="price-cell">${hasDiscount ? `<span class="price-sale">€${p.sale_price}</span> <span class="discount-tag">-${discountPercent}%</span>` : '-'}</td>
            <td>${getProductTypeLabel(p.gender)}</td>
            <td>${p.inventory}</td>
            <td><span class="status-badge ${p.is_active ? 'status-active' : 'status-inactive'}">${p.is_active ? 'Attivo' : 'Inattivo'}</span></td>
            <td class="actions-cell">
                <button class="btn-edit" onclick="editProduct('${p.id}')">Modifica</button>
                <button class="btn-delete" onclick="confirmDeleteProduct('${p.id}', '${p.name}')">Elimina</button>
            </td>
        </tr>
    `}).join('');

    // Mobile cards view
    if (mobileCardsContainer) {
        mobileCardsContainer.innerHTML = productList.map(p => {
            const hasDiscount = p.sale_price && p.sale_price < p.price;
            const discountPercent = hasDiscount ? Math.round((1 - p.sale_price / p.price) * 100) : 0;
            return `
            <div class="mobile-product-card ${hasDiscount ? 'has-discount' : ''}">
                <div class="mobile-card-header">
                    <img src="${getImagePath(p.images?.[0])}" alt="${p.name}" class="mobile-card-thumb" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect fill=%22%23f5f5f5%22 width=%22100%22 height=%22100%22/></svg>'">
                    <div class="mobile-card-title">
                        <h4>${p.name}</h4>
                        <span class="status-badge mobile-card-status ${p.is_active ? 'status-active' : 'status-inactive'}">${p.is_active ? 'Attivo' : 'Inattivo'}</span>
                    </div>
                    ${hasDiscount ? `<span class="mobile-discount-badge">-${discountPercent}%</span>` : ''}
                </div>
                <div class="mobile-card-grid">
                    <div class="mobile-card-field">
                        <span class="mobile-card-label">Prezzo Listino</span>
                        <span class="mobile-card-value ${hasDiscount ? 'price-original' : 'price'}">€${p.price}</span>
                    </div>
                    <div class="mobile-card-field">
                        <span class="mobile-card-label">Prezzo Attuale</span>
                        <span class="mobile-card-value ${hasDiscount ? 'price-sale' : ''}">${hasDiscount ? '€' + p.sale_price : '€' + p.price}</span>
                    </div>
                    <div class="mobile-card-field">
                        <span class="mobile-card-label">Tipo</span>
                        <span class="mobile-card-value">${getProductTypeLabel(p.gender, true)}</span>
                    </div>
                    <div class="mobile-card-field">
                        <span class="mobile-card-label">Inventario</span>
                        <span class="mobile-card-value">${p.inventory} pz</span>
                    </div>
                </div>
                <div class="mobile-card-actions">
                    <button class="btn-edit" onclick="editProduct('${p.id}')">✏️ Modifica</button>
                    <button class="btn-delete" onclick="confirmDeleteProduct('${p.id}', '${p.name}')">🗑️ Elimina</button>
                </div>
            </div>
        `}).join('');
    }
}

function openProductModal(product = null) {
    const modal = document.getElementById('productModal');
    const form = document.getElementById('productForm');
    const title = document.getElementById('modalTitle');

    form.reset();
    document.getElementById('productError').textContent = '';

    if (product) {
        title.textContent = 'Modifica Prodotto';
        document.getElementById('productId').value = product.id;
        document.getElementById('productName').value = product.name;
        document.getElementById('productSlug').value = product.slug;
        document.getElementById('productDescription').value = product.description || '';
        document.getElementById('productPrice').value = product.price;
        document.getElementById('productSalePrice').value = product.sale_price || '';
        document.getElementById('productGender').value = product.gender || '';
        document.getElementById('productPageType').value = product.page_type || '';
        document.getElementById('productCategory').value = product.category_id || '';
        document.getElementById('productActive').checked = product.is_active;
        document.getElementById('productFeatured').checked = product.is_featured;
        document.getElementById('productSeasonal').checked = product.is_seasonal || false;
        document.getElementById('productNew').checked = product.is_new || false;
        document.getElementById('productImages').value = (product.images || []).join('\n');
        document.getElementById('productColors').value = (product.colors || []).join(', ');
        
        // Populate search keywords
        populateKeywords(product.search_keywords || []);
        
        // Populate weight inventory fields
        populateWeightInventory(product);
        
        // Show image preview
        updateImagePreview();
    } else {
        title.textContent = 'Nuovo Prodotto';
        document.getElementById('productId').value = '';
        document.getElementById('productActive').checked = true;
        document.getElementById('productSeasonal').checked = false;
        document.getElementById('productNew').checked = false;
        document.getElementById('productPageType').value = '';
        
        // Reset weight inventory to defaults
        resetWeightInventory();
        
        // Reset keywords
        clearKeywords();
        
        // Hide image preview
        document.getElementById('imagePreviewSection').style.display = 'none';
    }
    
    // Reset notification checkbox
    document.getElementById('sendPushNotification').checked = false;
    updateSeasonalNotificationPanel();

    // Populate categories dropdown
    const categorySelect = document.getElementById('productCategory');
    categorySelect.innerHTML = '<option value="">Nessuna categoria</option>' +
        categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    
    if (product?.category_id) {
        categorySelect.value = product.category_id;
    }
    
    // Add event listener for seasonal checkbox
    document.getElementById('productSeasonal').addEventListener('change', updateSeasonalNotificationPanel);

    modal.classList.add('active');
    
    // Save modal state for session persistence
    saveModalState('product', product?.id || null);
}

// Update visibility of seasonal notification panel
function updateSeasonalNotificationPanel() {
    const isSeasonal = document.getElementById('productSeasonal').checked;
    const panel = document.getElementById('seasonalNotificationPanel');
    panel.style.display = isSeasonal ? 'block' : 'none';
}

// Weight inventory functions
function populateWeightInventory(product) {
    const unitMeasure = product.unit_measure || 'kg';
    
    // Set unit measure
    document.getElementById('productUnitMeasure').value = unitMeasure;
    
    // Load inventory variants from database (net/gross weight are now per-variant)
    loadInventoryVariants(product.id);
    
    // Update labels after a short delay to ensure rows are loaded
    setTimeout(() => {
        if (typeof updateUnitMeasureLabels === 'function') {
            updateUnitMeasureLabels();
        }
    }, 100);
}

async function loadInventoryVariants(productId) {
    const grid = document.getElementById('inventoryVariantsGrid');
    grid.innerHTML = '';
    
    if (!productId) {
        // New product - add default variant
        addInventoryVariantRow(1000, 0, null, null);
        updateInventorySummary();
        setTimeout(() => updateUnitMeasureLabels(), 50);
        return;
    }
    
    try {
        const { data, error } = await supabase
            .from('weight_inventory')
            .select('weight_grams, quantity, net_weight_grams, gross_weight_grams')
            .eq('product_id', productId)
            .order('weight_grams');
        
        if (error) throw error;
        
        if (data && data.length > 0) {
            data.forEach(row => {
                addInventoryVariantRow(row.weight_grams, row.quantity, row.net_weight_grams, row.gross_weight_grams);
            });
        } else {
            // No inventory - add default variant
            addInventoryVariantRow(1000, 0, null, null);
        }
    } catch (err) {
        console.error('Error loading inventory variants:', err);
        addInventoryVariantRow(1000, 0, null, null);
    }
    
    updateInventorySummary();
    setTimeout(() => updateUnitMeasureLabels(), 50);
}

function resetInventoryVariants() {
    // Reset unit measure
    document.getElementById('productUnitMeasure').value = 'kg';
    
    // Reset variants grid
    const grid = document.getElementById('inventoryVariantsGrid');
    grid.innerHTML = '';
    
    // Add default variants (0.5 Kg, 1 Kg, 2 Kg)
    [500, 1000, 2000].forEach(grams => {
        addInventoryVariantRow(grams, 0, null, null);
    });
    
    updateInventorySummary();
    setTimeout(() => updateUnitMeasureLabels(), 50);
}

function addInventoryVariantRow(weightGrams, qty, netWeightGrams = null, grossWeightGrams = null) {
    const grid = document.getElementById('inventoryVariantsGrid');
    const row = document.createElement('div');
    row.className = 'inventory-row';
    
    const unitMeasure = document.getElementById('productUnitMeasure')?.value || 'kg';
    const labels = getUnitLabels(unitMeasure);
    const isPieces = unitMeasure === 'pz';
    
    // Convert grams to display value
    let displayValue;
    if (isPieces) {
        displayValue = weightGrams;
    } else {
        displayValue = weightGrams / 1000; // Convert to Kg/L
    }
    
    // Convert net/gross weights to display values
    const netDisplay = netWeightGrams ? (isPieces ? netWeightGrams : netWeightGrams / 1000) : '';
    const grossDisplay = grossWeightGrams ? (isPieces ? grossWeightGrams : grossWeightGrams / 1000) : '';
    
    const qtyClass = qty === 0 ? 'out-of-stock' : (qty <= 5 ? 'low-stock' : '');
    
    row.innerHTML = `
        <div class="weight-inputs">
            <input type="number" class="weight-value" min="0" step="${isPieces ? '1' : '0.01'}" value="${displayValue}" onchange="updateInventoryRow(this)" placeholder="0">
            <span class="unit-label">${labels.major}</span>
        </div>
        <input type="number" class="net-weight-input" min="0" step="${isPieces ? '1' : '0.01'}" value="${netDisplay}" placeholder="-">
        <input type="number" class="gross-weight-input" min="0" step="${isPieces ? '1' : '0.01'}" value="${grossDisplay}" placeholder="-">
        <input type="number" class="stock-input ${qtyClass}" min="0" value="${qty}" onchange="checkStockLevel(this)" placeholder="0">
        <button type="button" class="btn-remove-row" onclick="removeInventoryRow(this)">×</button>
    `;
    grid.appendChild(row);
}

// Backward compatibility aliases
async function loadWeightInventoryRows(productId) {
    return loadInventoryVariants(productId);
}

function resetWeightInventory() {
    return resetInventoryVariants();
}

function addWeightRowWithData(weightGrams, qty) {
    return addInventoryVariantRow(weightGrams, qty);
}

// Get unit labels based on unit measure
function getUnitLabels(unitMeasure) {
    switch (unitMeasure) {
        case 'l':
            return { major: 'L', minor: 'ml' };
        case 'ml':
            return { major: 'L', minor: 'ml' };
        case 'kg':
        case 'g':
        default:
            return { major: 'Kg', minor: 'g' };
    }
}

// Convert decimal input (Kg/L) to grams/ml for database storage
function convertToGrams(value, unitMeasure) {
    const numValue = parseFloat(value);
    if (isNaN(numValue) || numValue === 0) return null;
    
    // If unit is already in minor units (g, ml) or pieces, store as-is
    if (unitMeasure === 'g' || unitMeasure === 'ml' || unitMeasure === 'pz') {
        return Math.round(numValue);
    }
    // Convert Kg/L to g/ml (multiply by 1000)
    return Math.round(numValue * 1000);
}

// Convert grams/ml from database to decimal (Kg/L) for display
function convertFromGrams(grams, unitMeasure) {
    if (grams === null || grams === undefined) return '';
    
    // If unit is already in minor units (g, ml) or pieces, display as-is
    if (unitMeasure === 'g' || unitMeasure === 'ml' || unitMeasure === 'pz') {
        return grams;
    }
    // Convert g/ml to Kg/L (divide by 1000)
    return grams / 1000;
}

// Format weight with correct unit
function formatWeightWithUnit(grams, unitMeasure) {
    const labels = getUnitLabels(unitMeasure);
    if (grams >= 1000) {
        const major = grams / 1000;
        return major % 1 === 0 ? `${major} ${labels.major}` : `${major.toFixed(1)} ${labels.major}`;
    }
    return `${grams} ${labels.minor}`;
}

function formatWeight(grams) {
    const unitMeasure = document.getElementById('productUnitMeasure')?.value || 'kg';
    return formatWeightWithUnit(grams, unitMeasure);
}

// Update all weight labels when unit measure changes
window.updateUnitMeasureLabels = function() {
    const unitMeasure = document.getElementById('productUnitMeasure')?.value || 'kg';
    const labels = getUnitLabels(unitMeasure);
    const isPieces = unitMeasure === 'pz';
    const isLiquid = unitMeasure === 'l' || unitMeasure === 'ml';
    
    // Update unit labels in inventory rows
    document.querySelectorAll('.inventory-row .unit-label').forEach(el => {
        el.textContent = labels.major;
    });
    
    // Update header labels
    const headerWeight = document.querySelector('.col-weight');
    if (headerWeight) {
        headerWeight.textContent = isPieces ? 'Quantità' : 'Peso/Volume';
    }
    
    // Update net/gross column headers
    let weightUnit = 'Kg';
    if (isLiquid) weightUnit = 'L';
    else if (isPieces) weightUnit = 'pz';
    else if (unitMeasure === 'g') weightUnit = 'g';
    
    const colNetWeight = document.getElementById('colNetWeight');
    const colGrossWeight = document.getElementById('colGrossWeight');
    
    if (colNetWeight) {
        colNetWeight.textContent = `Netto (${weightUnit})`;
    }
    if (colGrossWeight) {
        colGrossWeight.textContent = `Lordo (${weightUnit})`;
    }
    
    // Update input step values based on unit
    const step = isPieces ? '1' : '0.01';
    document.querySelectorAll('.inventory-row .weight-value, .inventory-row .net-weight-input, .inventory-row .gross-weight-input').forEach(input => {
        input.step = step;
    });
};

// Add new inventory variant
window.addInventoryVariant = function() {
    addInventoryVariantRow(1000, 0); // Default 1 Kg
    updateInventorySummary();
};

// Remove inventory row
window.removeInventoryRow = function(btn) {
    btn.closest('.inventory-row').remove();
    updateInventorySummary();
};

// Update inventory row
window.updateInventoryRow = function(input) {
    updateInventorySummary();
};

// Check stock level
window.checkStockLevel = function(input) {
    const qty = parseInt(input.value) || 0;
    input.classList.remove('out-of-stock', 'low-stock');
    if (qty === 0) {
        input.classList.add('out-of-stock');
    } else if (qty <= 5) {
        input.classList.add('low-stock');
    }
    updateInventorySummary();
};

// Legacy aliases
window.addWeightRow = window.addInventoryVariant;
window.removeWeightRow = window.removeInventoryRow;
window.removeVariantRow = window.removeInventoryRow;

function updateInventorySummary() {
    const rows = document.querySelectorAll('.inventory-row');
    let totalQty = 0;
    
    rows.forEach(row => {
        const qtyInput = row.querySelector('.stock-input');
        const qty = parseInt(qtyInput?.value) || 0;
        totalQty += qty;
    });
    
    const summaryEl = document.getElementById('totalInventoryCount');
    if (summaryEl) {
        summaryEl.textContent = `${totalQty} pz`;
    }
}

function getWeightInventoryData() {
    const rows = document.querySelectorAll('.inventory-row');
    const weightInventory = [];
    let totalQty = 0;
    const unitMeasure = document.getElementById('productUnitMeasure')?.value || 'kg';
    const isPieces = unitMeasure === 'pz';
    
    rows.forEach(row => {
        const weightInput = row.querySelector('.weight-value');
        const qtyInput = row.querySelector('.stock-input');
        const netInput = row.querySelector('.net-weight-input');
        const grossInput = row.querySelector('.gross-weight-input');
        
        const displayValue = parseFloat(weightInput?.value) || 0;
        const qty = parseInt(qtyInput?.value) || 0;
        const netDisplay = parseFloat(netInput?.value) || null;
        const grossDisplay = parseFloat(grossInput?.value) || null;
        
        // Convert display values to grams
        let weightGrams, netGrams, grossGrams;
        if (isPieces) {
            weightGrams = Math.round(displayValue);
            netGrams = netDisplay ? Math.round(netDisplay) : null;
            grossGrams = grossDisplay ? Math.round(grossDisplay) : null;
        } else {
            weightGrams = Math.round(displayValue * 1000); // Kg/L to g/ml
            netGrams = netDisplay ? Math.round(netDisplay * 1000) : null;
            grossGrams = grossDisplay ? Math.round(grossDisplay * 1000) : null;
        }
        
        if (weightGrams > 0 || qty > 0) {
            weightInventory.push({ 
                weight_grams: weightGrams, 
                quantity: qty,
                net_weight_grams: netGrams,
                gross_weight_grams: grossGrams
            });
            totalQty += qty;
        }
    });
    
    return { weightInventory, totalQty };
}

// Image preview
window.updateImagePreview = function() {
    const imagesText = document.getElementById('productImages').value;
    const images = imagesText.split('\n').map(s => s.trim()).filter(Boolean);
    const previewSection = document.getElementById('imagePreviewSection');
    const previewGrid = document.getElementById('imagePreviewGrid');
    
    if (images.length === 0) {
        previewSection.style.display = 'none';
        return;
    }
    
    previewSection.style.display = 'block';
    previewGrid.innerHTML = images.map(img => `
        <div class="image-preview-item">
            <img src="${getImagePath(img)}" alt="Preview" onerror="this.parentElement.innerHTML='<span style=\\'color:#999;font-size:0.7rem;padding:0.5rem;\\'>Errore</span>'">
        </div>
    `).join('');
};

function getSizeInventoryData() {
    const rows = document.querySelectorAll('.size-inventory-row');
    const sizeInventory = {};
    const sizes = [];
    
    rows.forEach(row => {
        const size = row.querySelector('.size-input').value.trim().toUpperCase();
        const qty = parseInt(row.querySelector('.qty-input').value) || 0;
        if (size) {
            sizeInventory[size] = qty;
            sizes.push(size);
        }
    });
    
    return { sizeInventory, sizes };
}

window.closeProductModal = function() {
    document.getElementById('productModal').classList.remove('active');
    clearModalState();
};

window.editProduct = function(id) {
    const product = products.find(p => p.id === id);
    if (product) openProductModal(product);
};

window.confirmDeleteProduct = function(id, name) {
    document.getElementById('deleteMessage').textContent = `Sei sicuro di voler eliminare "${name}"?`;
    deleteCallback = () => deleteProduct(id);
    document.getElementById('deleteModal').classList.add('active');
};

async function handleProductSubmit(e) {
    e.preventDefault();
    const errorEl = document.getElementById('productError');
    errorEl.textContent = '';

    const id = document.getElementById('productId').value;
    const sendNotification = document.getElementById('sendPushNotification').checked;
    const isSeasonal = document.getElementById('productSeasonal').checked;
    
    // Get inventory variants data
    const { weightInventory, totalQty } = getWeightInventoryData();
    
    const unitMeasure = document.getElementById('productUnitMeasure').value || 'kg';
    
    const productData = {
        name: document.getElementById('productName').value.trim(),
        slug: document.getElementById('productSlug').value.trim(),
        description: document.getElementById('productDescription').value.trim() || null,
        price: parseFloat(document.getElementById('productPrice').value),
        sale_price: document.getElementById('productSalePrice').value ? parseFloat(document.getElementById('productSalePrice').value) : null,
        gender: document.getElementById('productGender').value || null,
        page_type: document.getElementById('productPageType').value || null,
        category_id: document.getElementById('productCategory').value || null,
        inventory: totalQty,
        is_active: document.getElementById('productActive').checked,
        is_featured: document.getElementById('productFeatured').checked,
        is_seasonal: isSeasonal,
        is_new: document.getElementById('productNew').checked,
        images: document.getElementById('productImages').value.split('\n').map(s => s.trim()).filter(Boolean),
        colors: document.getElementById('productColors').value.split(',').map(s => s.trim()).filter(Boolean),
        search_keywords: getKeywordsArray(),
        unit_measure: unitMeasure,
        // net_weight_grams and gross_weight_grams are now per-variant in weight_inventory table
        net_weight_grams: null,
        gross_weight_grams: null
    };

    try {
        console.log('Saving product:', productData);
        
        let result;
        let savedProductId = id;
        
        if (id) {
            result = await supabase.from('products').update(productData).eq('id', id).select();
        } else {
            result = await supabase.from('products').insert(productData).select();
            if (result.data && result.data[0]) {
                savedProductId = result.data[0].id;
            }
        }

        console.log('Save result:', result);

        if (result.error) {
            console.error('Supabase error:', result.error);
            if (result.error.code === '23505') {
                errorEl.textContent = 'Slug già esistente. Usa un nome diverso.';
                return;
            } else {
                errorEl.textContent = result.error.message;
                return;
            }
        }
        
        // Get the saved product ID
        if (result.data && result.data[0]) {
            savedProductId = result.data[0].id;
        }
        
        // Save weight inventory
        if (savedProductId && weightInventory.length > 0) {
            await saveWeightInventory(savedProductId, weightInventory);
        }

        // Send push notification if requested
        if (sendNotification && isSeasonal && savedProductId) {
            await sendSeasonalNotification(savedProductId, productData.name);
        }

        closeProductModal();
        await loadProducts();
        await loadDashboardData();
        showToast(id ? 'Prodotto aggiornato!' : 'Prodotto creato!', 'success');
    } catch (err) {
        console.error('Save product error:', err);
        errorEl.textContent = 'Errore nel salvataggio: ' + err.message;
    }
}

// Save weight inventory to database
async function saveWeightInventory(productId, weightInventory) {
    try {
        // Delete existing weight inventory for this product
        await supabase
            .from('weight_inventory')
            .delete()
            .eq('product_id', productId);
        
        // Insert new weight inventory rows
        if (weightInventory.length > 0) {
            const rows = weightInventory.map(item => ({
                product_id: productId,
                weight_grams: item.weight_grams,
                quantity: item.quantity,
                net_weight_grams: item.net_weight_grams || null,
                gross_weight_grams: item.gross_weight_grams || null
            }));
            
            const { error } = await supabase
                .from('weight_inventory')
                .insert(rows);
            
            if (error) {
                console.error('Error saving weight inventory:', error);
            }
        }
    } catch (err) {
        console.error('Save weight inventory error:', err);
    }
}

// Send seasonal product notification
async function sendSeasonalNotification(productId, productName) {
    try {
        showToast('📱 Invio notifiche in corso...', 'success');
        
        // Try FCM first (preferred), fallback to legacy
        let result;
        let usedFCM = false;
        
        // Try FCM
        const fcmResult = await supabase.functions.invoke('send-fcm-notification', {
            body: {
                product_id: productId,
                notification_type: 'seasonal_product',
                title: `🍅 Nuovo Prodotto di Stagione!`,
                body: `${productName} è ora disponibile! Fresco e di stagione.`
            }
        });
        
        if (!fcmResult.error && fcmResult.data?.success) {
            result = fcmResult;
            usedFCM = true;
        } else {
            // Fallback to legacy push notification
            result = await supabase.functions.invoke('send-push-notification', {
                body: {
                    product_id: productId,
                    notification_type: 'seasonal_product',
                    custom_title: `🍅 Nuovo Prodotto di Stagione!`,
                    custom_body: `${productName} è ora disponibile! Fresco e di stagione.`
                }
            });
        }
        
        if (result.error) {
            console.error('Notification error:', result.error);
            showToast('⚠️ Prodotto salvato, ma errore nell\'invio notifiche', 'error');
        } else {
            console.log('Notification result:', result.data);
            const sent = result.data?.sent || 0;
            const method = usedFCM ? 'FCM' : 'Web Push';
            showToast(`✅ Notifica inviata a ${sent} dispositivi via ${method}!`, 'success');
        }
    } catch (err) {
        console.error('Send notification error:', err);
        showToast('⚠️ Prodotto salvato, ma errore nell\'invio notifiche', 'error');
    }
}

// Test notification function
async function handleTestNotification() {
    const btn = document.getElementById('testNotificationBtn');
    const result = document.getElementById('notificationTestResult');
    
    btn.disabled = true;
    btn.textContent = '⏳ Invio...';
    result.textContent = '';
    
    try {
        const response = await supabase.functions.invoke('send-fcm-notification', {
            body: {
                notification_type: 'test',
                title: '🔔 Test Notifica',
                body: 'Questa è una notifica di test da Mimmo Fratelli Admin!',
                url: '/'
            }
        });
        
        if (response.error) {
            throw new Error(response.error.message);
        }
        
        const data = response.data;
        if (data.success) {
            result.innerHTML = `<span style="color: green;">✅ Inviata a ${data.sent} dispositivi</span>`;
            showToast(`Notifica inviata a ${data.sent} dispositivi!`, 'success');
        } else {
            throw new Error(data.error || 'Errore sconosciuto');
        }
    } catch (err) {
        console.error('Test notification error:', err);
        result.innerHTML = `<span style="color: red;">❌ ${err.message}</span>`;
        showToast('Errore invio notifica: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = '📤 Invia Notifica Test';
    }
}

async function deleteProduct(id) {
    try {
        const { error } = await supabase.from('products').delete().eq('id', id);
        if (error) throw error;

        await loadProducts();
        await loadDashboardData();
        showToast('Prodotto eliminato!', 'success');
    } catch (err) {
        console.error('Delete product error:', err);
        showToast('Errore nell\'eliminazione', 'error');
    }
}

// Categories
async function loadCategories() {
    try {
        const { data, error } = await supabase
            .from('categories')
            .select('*')
            .order('name');

        if (error) throw error;
        categories = data || [];
        renderCategories(categories);
    } catch (err) {
        console.error('Load categories error:', err);
    }
}

function renderCategories(categoryList) {
    const tbody = document.getElementById('categoriesTable');
    const mobileCardsContainer = document.getElementById('mobileCategoryCards');
    
    if (categoryList.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="loading">Nessuna categoria</td></tr>';
        if (mobileCardsContainer) mobileCardsContainer.innerHTML = '<p class="empty-state">Nessuna categoria</p>';
        return;
    }

    // Desktop table view
    tbody.innerHTML = categoryList.map(c => `
        <tr>
            <td><strong>${c.name}</strong></td>
            <td>${c.slug}</td>
            <td>${products.filter(p => p.category_id === c.id).length}</td>
            <td><span class="status-badge ${c.is_active ? 'status-active' : 'status-inactive'}">${c.is_active ? 'Attiva' : 'Inattiva'}</span></td>
            <td class="action-btns">
                <button class="btn-edit" onclick="editCategory('${c.id}')">Modifica</button>
                <button class="btn-delete" onclick="confirmDeleteCategory('${c.id}', '${c.name}')">Elimina</button>
            </td>
        </tr>
    `).join('');

    // Mobile cards view
    if (mobileCardsContainer) {
        mobileCardsContainer.innerHTML = categoryList.map(c => {
            const productCount = products.filter(p => p.category_id === c.id).length;
            return `
            <div class="mobile-product-card">
                <div class="mobile-card-header" style="border-bottom: none; padding-bottom: 0; margin-bottom: 0.5rem;">
                    <div class="mobile-card-title" style="flex: 1;">
                        <h4>📁 ${c.name}</h4>
                        <span class="status-badge mobile-card-status ${c.is_active ? 'status-active' : 'status-inactive'}">${c.is_active ? 'Attiva' : 'Inattiva'}</span>
                    </div>
                </div>
                <div class="mobile-card-grid" style="grid-template-columns: 1fr 1fr;">
                    <div class="mobile-card-field">
                        <span class="mobile-card-label">Slug</span>
                        <span class="mobile-card-value">${c.slug}</span>
                    </div>
                    <div class="mobile-card-field">
                        <span class="mobile-card-label">Prodotti</span>
                        <span class="mobile-card-value">${productCount}</span>
                    </div>
                </div>
                <div class="mobile-card-actions">
                    <button class="btn-edit" onclick="editCategory('${c.id}')">✏️ Modifica</button>
                    <button class="btn-delete" onclick="confirmDeleteCategory('${c.id}', '${c.name}')">🗑️ Elimina</button>
                </div>
            </div>
        `}).join('');
    }
}

function openCategoryModal(category = null) {
    const modal = document.getElementById('categoryModal');
    const form = document.getElementById('categoryForm');
    const title = document.getElementById('categoryModalTitle');

    form.reset();
    document.getElementById('categoryError').textContent = '';

    if (category) {
        title.textContent = 'Modifica Categoria';
        document.getElementById('categoryId').value = category.id;
        document.getElementById('categoryName').value = category.name;
        document.getElementById('categorySlug').value = category.slug;
        document.getElementById('categoryDescription').value = category.description || '';
        document.getElementById('categoryActive').checked = category.is_active;
    } else {
        title.textContent = 'Nuova Categoria';
        document.getElementById('categoryId').value = '';
        document.getElementById('categoryActive').checked = true;
    }

    modal.classList.add('active');
    
    // Save modal state for session persistence
    saveModalState('category', category?.id || null);
}

window.closeCategoryModal = function() {
    document.getElementById('categoryModal').classList.remove('active');
    clearModalState();
};

window.editCategory = function(id) {
    const category = categories.find(c => c.id === id);
    if (category) openCategoryModal(category);
};

window.confirmDeleteCategory = function(id, name) {
    document.getElementById('deleteMessage').textContent = `Sei sicuro di voler eliminare la categoria "${name}"?`;
    deleteCallback = () => deleteCategory(id);
    document.getElementById('deleteModal').classList.add('active');
};

async function handleCategorySubmit(e) {
    e.preventDefault();
    const errorEl = document.getElementById('categoryError');
    errorEl.textContent = '';

    const id = document.getElementById('categoryId').value;
    const categoryData = {
        name: document.getElementById('categoryName').value.trim(),
        slug: document.getElementById('categorySlug').value.trim(),
        description: document.getElementById('categoryDescription').value.trim() || null,
        is_active: document.getElementById('categoryActive').checked
    };

    try {
        let result;
        if (id) {
            result = await supabase.from('categories').update(categoryData).eq('id', id);
        } else {
            result = await supabase.from('categories').insert(categoryData);
        }

        if (result.error) {
            if (result.error.code === '23505') {
                errorEl.textContent = 'Slug già esistente.';
            } else {
                errorEl.textContent = result.error.message;
            }
            return;
        }

        closeCategoryModal();
        await loadCategories();
        await loadDashboardData();
        showToast(id ? 'Categoria aggiornata!' : 'Categoria creata!', 'success');
    } catch (err) {
        console.error('Save category error:', err);
        errorEl.textContent = 'Errore nel salvataggio';
    }
}

async function deleteCategory(id) {
    try {
        const { error } = await supabase.from('categories').delete().eq('id', id);
        if (error) throw error;

        await loadCategories();
        await loadDashboardData();
        showToast('Categoria eliminata!', 'success');
    } catch (err) {
        console.error('Delete category error:', err);
        showToast('Errore nell\'eliminazione', 'error');
    }
}

// Mobile View Toggle
function setupMobileViewToggle() {
    const toggleBtn = document.getElementById('viewToggleBtn');
    const productsSection = document.getElementById('productsSection');
    
    toggleBtn?.addEventListener('click', () => {
        productsSection?.classList.toggle('show-cards-mobile');
        toggleBtn.classList.toggle('active');
        
        if (productsSection?.classList.contains('show-cards-mobile')) {
            toggleBtn.innerHTML = '📋 Vista Tabella';
        } else {
            toggleBtn.innerHTML = '📱 Vista Card';
        }
    });
}

// Table Scroll Indicators
function setupTableScrollIndicators() {
    const tableContainers = document.querySelectorAll('.table-container');
    
    tableContainers.forEach(container => {
        const checkScroll = () => {
            const hasScroll = container.scrollWidth > container.clientWidth;
            const isScrolledEnd = container.scrollLeft + container.clientWidth >= container.scrollWidth - 5;
            
            container.classList.toggle('has-scroll', hasScroll);
            container.classList.toggle('scrolled-end', isScrolledEnd);
        };
        
        container.addEventListener('scroll', checkScroll);
        window.addEventListener('resize', checkScroll);
        
        // Initial check
        setTimeout(checkScroll, 100);
    });
}

// Utilities
function generateSlug(text) {
    return text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function closeDeleteModal() {
    document.getElementById('deleteModal').classList.remove('active');
    deleteCallback = null;
}

window.closeDeleteModal = closeDeleteModal;

function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast ${type} show`;
    
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// ============================================
// GIFT CARD ADMIN - SEARCH & MANAGEMENT
// ============================================

// Initialize Gift Card Admin UI
function initGiftCardUI() {
    // Search button
    document.getElementById('gcSearchBtn')?.addEventListener('click', searchGiftCards);
    
    // Search on Enter
    document.getElementById('gcSearchInput')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') searchGiftCards();
    });
    
    // Status filter change
    document.getElementById('gcStatusFilter')?.addEventListener('change', searchGiftCards);
}

// Load gift card stats
async function loadGiftCardStats() {
    try {
        const { data, error } = await supabase
            .from('gift_cards')
            .select('amount, is_redeemed, is_active, remaining_balance, expires_at');

        if (error) throw error;

        const now = new Date();
        const stats = {
            total: data.length,
            totalValue: data.reduce((sum, gc) => sum + parseFloat(gc.amount || 0), 0),
            redeemed: data.filter(gc => gc.is_redeemed).length,
            active: data.filter(gc => !gc.is_redeemed && gc.is_active && (!gc.expires_at || new Date(gc.expires_at) > now)).length
        };

        document.getElementById('gcStatTotal').textContent = stats.total;
        document.getElementById('gcStatValue').textContent = `€${stats.totalValue.toFixed(0)}`;
        document.getElementById('gcStatRedeemed').textContent = stats.redeemed;
        document.getElementById('gcStatActive').textContent = stats.active;
    } catch (err) {
        console.error('Error loading gift card stats:', err);
    }
}

// Search gift cards
async function searchGiftCards() {
    const query = document.getElementById('gcSearchInput')?.value.trim() || '';
    const status = document.getElementById('gcStatusFilter')?.value || '';
    const resultsGrid = document.getElementById('gcResultsGrid');
    const resultsCount = document.getElementById('gcResultsCount');

    resultsGrid.innerHTML = '<p class="gc-no-results">Ricerca in corso...</p>';

    try {
        let queryBuilder = supabase
            .from('gift_cards')
            .select('*');

        // Search by name or code
        if (query) {
            queryBuilder = queryBuilder.or(
                `recipient_name.ilike.%${query}%,` +
                `sender_name.ilike.%${query}%,` +
                `purchaser_first_name.ilike.%${query}%,` +
                `purchaser_last_name.ilike.%${query}%,` +
                `code.ilike.%${query}%`
            );
        }

        // Filter by status
        const now = new Date().toISOString();
        if (status === 'redeemed') {
            queryBuilder = queryBuilder.eq('is_redeemed', true);
        } else if (status === 'active') {
            queryBuilder = queryBuilder.eq('is_redeemed', false).eq('is_active', true);
        } else if (status === 'expired') {
            queryBuilder = queryBuilder.lt('expires_at', now);
        }

        const { data, error } = await queryBuilder
            .order('created_at', { ascending: false })
            .limit(50);

        if (error) throw error;

        resultsCount.textContent = `(${data?.length || 0})`;

        if (!data || data.length === 0) {
            resultsGrid.innerHTML = '<p class="gc-no-results">Nessuna gift card trovata</p>';
            return;
        }

        resultsGrid.innerHTML = data.map(gc => {
            const isExpired = gc.expires_at && new Date(gc.expires_at) < new Date();
            const statusClass = gc.is_redeemed ? 'redeemed' : isExpired ? 'expired' : 'active';
            const statusText = gc.is_redeemed ? 'Riscattata' : isExpired ? 'Scaduta' : 'Attiva';
            const style = gc.template || gc.style || 'elegant';

            return `
                <div class="gc-result-item" onclick="showGcDetail('${gc.id}')">
                    <div class="gc-result-preview ${style}">
                        <div class="gc-logo">Mimmo Fratelli</div>
                        <div class="gc-amount">€${gc.amount}</div>
                        <div class="gc-code">${gc.code}</div>
                    </div>
                    <div class="gc-result-info">
                        <div class="gc-result-row">
                            <span class="gc-result-label">Destinatario</span>
                            <span class="gc-result-value">${gc.recipient_name}</span>
                        </div>
                        <div class="gc-result-row">
                            <span class="gc-result-label">Da</span>
                            <span class="gc-result-value">${gc.sender_name}</span>
                        </div>
                        <div class="gc-result-row">
                            <span class="gc-result-label">Stato</span>
                            <span class="gc-status ${statusClass}">${statusText}</span>
                        </div>
                        <div class="gc-result-row">
                            <span class="gc-result-label">Credito Rimanente</span>
                            <span class="gc-result-value">€${gc.remaining_balance || gc.amount}</span>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    } catch (err) {
        console.error('Search gift cards error:', err);
        resultsGrid.innerHTML = '<p class="gc-no-results">Errore nella ricerca</p>';
    }
}

// Show gift card detail
async function showGcDetail(gcId) {
    const modal = document.getElementById('gcDetailModal');
    const body = document.getElementById('gcDetailBody');

    try {
        const { data: gc, error } = await supabase
            .from('gift_cards')
            .select('*')
            .eq('id', gcId)
            .single();

        if (error) throw error;

        const isExpired = gc.expires_at && new Date(gc.expires_at) < new Date();
        const statusClass = gc.is_redeemed ? 'redeemed' : isExpired ? 'expired' : 'active';
        const statusText = gc.is_redeemed ? 'Riscattata' : isExpired ? 'Scaduta' : 'Attiva';
        const style = gc.template || gc.style || 'elegant';
        const usedAmount = parseFloat(gc.amount) - parseFloat(gc.remaining_balance || gc.amount);
        
        // Generate QR code URL
        const redeemUrl = `${window.location.origin}/redeem.html?token=${gc.qr_code_token}`;
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(redeemUrl)}`;

        body.innerHTML = `
            <div class="gc-detail-header">
                <div class="gc-detail-preview ${style}">
                    <div class="gc-pattern"></div>
                    <div class="gc-header">
                        <div class="gc-logo">Mimmo Fratelli</div>
                        <div class="gc-badge">GIFT CARD</div>
                    </div>
                    <div class="gc-amount" style="${style === 'elegant' ? 'color:#e6c347' : style === 'minimal' ? 'color:#a83f39' : ''}">€${gc.amount}</div>
                    <div class="gc-recipient">
                        <span class="gc-label">Per</span>
                        <span class="gc-name">${gc.recipient_name}</span>
                    </div>
                    ${gc.message ? `<div class="gc-message">${gc.message}</div>` : ''}
                    <div class="gc-footer">
                        <div class="gc-from">
                            <span class="gc-label">Da</span>
                            <span>${gc.sender_name}</span>
                        </div>
                        <div class="gc-code">${gc.code}</div>
                    </div>
                </div>
                
                ${gc.qr_code_token ? `
                <div class="gc-detail-qr">
                    <img src="${qrUrl}" alt="QR Code">
                    <p>QR Code per riscatto</p>
                </div>
                ` : ''}
            </div>
            
            <div class="gc-detail-info">
                <div class="gc-detail-grid">
                    <div class="gc-detail-field">
                        <label>Codice</label>
                        <span style="font-family:monospace">${gc.code}</span>
                    </div>
                    <div class="gc-detail-field">
                        <label>Stato</label>
                        <span class="gc-status ${statusClass}">${statusText}</span>
                    </div>
                    <div class="gc-detail-field">
                        <label>Destinatario</label>
                        <span>${gc.recipient_name}</span>
                    </div>
                    <div class="gc-detail-field">
                        <label>Email</label>
                        <span>${gc.recipient_email}</span>
                    </div>
                    <div class="gc-detail-field">
                        <label>Mittente</label>
                        <span>${gc.sender_name}</span>
                    </div>
                    <div class="gc-detail-field">
                        <label>Data Creazione</label>
                        <span>${new Date(gc.created_at).toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' })}</span>
                    </div>
                    ${gc.expires_at ? `
                    <div class="gc-detail-field">
                        <label>Scadenza</label>
                        <span>${new Date(gc.expires_at).toLocaleDateString('it-IT')}</span>
                    </div>
                    ` : ''}
                    ${gc.is_redeemed ? `
                    <div class="gc-detail-field">
                        <label>Riscattata il</label>
                        <span>${new Date(gc.redeemed_at).toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                    ` : ''}
                    ${gc.message ? `
                    <div class="gc-detail-field full">
                        <label>Messaggio</label>
                        <span>"${gc.message}"</span>
                    </div>
                    ` : ''}
                </div>
                
                <div class="gc-credit-info">
                    <h4>💰 Riepilogo Credito</h4>
                    <div class="gc-credit-values">
                        <div class="gc-credit-item">
                            <span class="value">€${gc.amount}</span>
                            <span class="label">Valore Iniziale</span>
                        </div>
                        <div class="gc-credit-item">
                            <span class="value">€${usedAmount.toFixed(2)}</span>
                            <span class="label">Utilizzato</span>
                        </div>
                        <div class="gc-credit-item">
                            <span class="value">€${gc.remaining_balance || gc.amount}</span>
                            <span class="label">Rimanente</span>
                        </div>
                    </div>
                </div>
            </div>
        `;

        modal.style.display = 'flex';
    } catch (err) {
        console.error('Error loading gift card detail:', err);
        showToast('Errore nel caricamento dei dettagli', 'error');
    }
}

// Close gift card detail modal
window.closeGcDetail = function() {
    document.getElementById('gcDetailModal').style.display = 'none';
};

// Load gift cards when navigating to section
async function loadGiftCards() {
    await loadGiftCardStats();
    // Don't auto-search, let user search manually
}

// Initialize gift card UI when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(initGiftCardUI, 100);
});

// ============================================
// ANALYTICS - REAL-TIME USER TRACKING
// ============================================

let analyticsPollingInterval = null;

// Load analytics data
async function loadAnalyticsData() {
    try {
        // Total registered users - use profiles table directly (no RPC needed)
        const { count: usersCount } = await supabase
            .from('profiles')
            .select('*', { count: 'exact', head: true });
        document.getElementById('analyticsUsers').textContent = usersCount || 0;

        // Active users count
        await updateActiveUsersCount();

        // Total orders
        const { count: ordersCount } = await supabase
            .from('orders')
            .select('*', { count: 'exact', head: true });
        document.getElementById('analyticsOrders').textContent = ordersCount || 0;

        // Total revenue - calculate from orders table directly
        const { data: orders, error: ordersError } = await supabase
            .from('orders')
            .select('total, status');
        const revenue = !ordersError && orders
            ? orders.filter(o => o.status !== 'cancelled' && o.status !== 'refunded')
                    .reduce((sum, o) => sum + parseFloat(o.total || 0), 0)
            : 0;
        document.getElementById('analyticsRevenue').textContent = `€${revenue.toFixed(0)}`;

        // New users stats
        await loadNewUsersStats();

        // Orders today
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const { count: ordersToday } = await supabase
            .from('orders')
            .select('*', { count: 'exact', head: true })
            .gte('created_at', today.toISOString());
        document.getElementById('ordersToday').textContent = ordersToday || 0;

    } catch (err) {
        console.error('Analytics error:', err);
    }
}

// Load new users statistics - uses profiles table directly (no RPC needed)
async function loadNewUsersStats() {
    try {
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const weekStart = new Date(now);
        weekStart.setDate(weekStart.getDate() - weekStart.getDay());
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

        const [todayResult, weekResult, monthResult] = await Promise.all([
            supabase.from('profiles').select('*', { count: 'exact', head: true }).gte('created_at', todayStart.toISOString()),
            supabase.from('profiles').select('*', { count: 'exact', head: true }).gte('created_at', weekStart.toISOString()),
            supabase.from('profiles').select('*', { count: 'exact', head: true }).gte('created_at', monthStart.toISOString())
        ]);

        document.getElementById('newUsersToday').textContent = todayResult.count || 0;
        document.getElementById('newUsersWeek').textContent = weekResult.count || 0;
        document.getElementById('newUsersMonth').textContent = monthResult.count || 0;
    } catch (err) {
        console.error('New users stats error:', err);
        document.getElementById('newUsersToday').textContent = '0';
        document.getElementById('newUsersWeek').textContent = '0';
        document.getElementById('newUsersMonth').textContent = '0';
    }
}

// Update active users count - uses user_presence table directly (no RPC needed)
async function updateActiveUsersCount() {
    try {
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        const { count, error } = await supabase
            .from('user_presence')
            .select('session_id', { count: 'exact', head: true })
            .gte('last_seen', fiveMinutesAgo);
        
        // If table doesn't exist, show 0
        const activeCount = error ? 0 : (count || 0);
        document.getElementById('analyticsActiveUsers').textContent = activeCount;
        
        // Update active users list
        await updateActiveUsersList();
    } catch (err) {
        console.error('Active users count error:', err);
        document.getElementById('analyticsActiveUsers').textContent = '0';
    }
}

// Update active users list - uses user_presence table directly (no RPC needed)
async function updateActiveUsersList() {
    const listEl = document.getElementById('activeUsersList');
    
    try {
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        const { data: activeUsers, error } = await supabase
            .from('user_presence')
            .select('*')
            .gte('last_seen', fiveMinutesAgo)
            .order('last_seen', { ascending: false })
            .limit(20);

        // If table doesn't exist or no users, show empty message
        if (error || !activeUsers || activeUsers.length === 0) {
            listEl.innerHTML = '<p class="no-active-users">Nessun utente attivo al momento</p>';
            return;
        }

        listEl.innerHTML = activeUsers.map(user => {
            const lastSeen = new Date(user.last_seen);
            const timeAgo = getTimeAgo(lastSeen);
            const userType = user.is_authenticated ? '👤 Registrato' : '👻 Ospite';
            const page = user.page_url ? user.page_url.split('/').pop() || 'Home' : 'Sconosciuta';
            
            return `
                <div class="active-user-item">
                    <div class="active-user-status ${user.is_authenticated ? 'authenticated' : 'guest'}"></div>
                    <div class="active-user-info">
                        <span class="active-user-type">${userType}</span>
                        <span class="active-user-page">📄 ${page}</span>
                    </div>
                    <span class="active-user-time">${timeAgo}</span>
                </div>
            `;
        }).join('');
    } catch (err) {
        listEl.innerHTML = '<p class="no-active-users">Nessun utente attivo al momento</p>';
    }
}

// Helper: get time ago string
function getTimeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);
    if (seconds < 60) return 'Adesso';
    if (seconds < 120) return '1 min fa';
    if (seconds < 300) return `${Math.floor(seconds / 60)} min fa`;
    return 'Più di 5 min fa';
}

// Start polling for active users
function startActiveUsersPolling() {
    // Update immediately
    updateActiveUsersCount();
    
    // Then poll every 30 seconds
    if (analyticsPollingInterval) clearInterval(analyticsPollingInterval);
    analyticsPollingInterval = setInterval(() => {
        updateActiveUsersCount();
    }, 30000);
}

// Stop polling
function stopActiveUsersPolling() {
    if (analyticsPollingInterval) {
        clearInterval(analyticsPollingInterval);
        analyticsPollingInterval = null;
    }
}


// ============================================
// DISCOUNTS SECTION - BULK DISCOUNT MANAGEMENT
// ============================================

let discountMode = 'all';
let selectedGenders = [];
let selectedCategories = [];
let selectedProductIds = [];

// Initialize discounts section
function initDiscountsSection() {
    populateCategoryChips();
    populateProductSelection();
    loadDiscountedProducts();
    updateDiscountPreview();
}

// Set discount mode
window.setDiscountMode = function(mode) {
    discountMode = mode;
    
    // Update button states
    document.querySelectorAll('.discount-mode-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === mode);
    });
    
    // Show/hide selection step
    const selectionStep = document.getElementById('discountSelectionStep');
    const genderSelection = document.getElementById('genderSelection');
    const categorySelection = document.getElementById('categorySelection');
    const productSelection = document.getElementById('productSelection');
    
    // Hide all
    genderSelection.style.display = 'none';
    categorySelection.style.display = 'none';
    productSelection.style.display = 'none';
    
    if (mode === 'all') {
        selectionStep.style.display = 'none';
    } else {
        selectionStep.style.display = 'block';
        if (mode === 'gender') {
            genderSelection.style.display = 'block';
        } else if (mode === 'category') {
            categorySelection.style.display = 'block';
        } else if (mode === 'products') {
            productSelection.style.display = 'block';
        }
    }
    
    // Reset selections
    selectedGenders = [];
    selectedCategories = [];
    selectedProductIds = [];
    
    // Uncheck all checkboxes
    document.querySelectorAll('#genderSelection input, #categorySelection input, #productSelection input').forEach(cb => {
        cb.checked = false;
    });
    document.querySelectorAll('.product-select-item').forEach(item => {
        item.classList.remove('selected');
    });
    
    updateDiscountPreview();
};

// Populate category chips
function populateCategoryChips() {
    const container = document.getElementById('categoryChips');
    if (!container || !categories.length) return;
    
    container.innerHTML = categories.map(cat => `
        <label class="selection-chip">
            <input type="checkbox" value="${cat.id}" onchange="updateDiscountSelection()">
            <span>📁 ${cat.name}</span>
        </label>
    `).join('');
}

// Populate product selection grid - optimized for large catalogs
let productSelectionPage = 0;
const PRODUCTS_PER_PAGE = 50;

function populateProductSelection() {
    const grid = document.getElementById('productSelectionGrid');
    if (!grid || !products.length) return;
    
    productSelectionPage = 0;
    renderProductSelectionPage();
    
    // Add load more button if needed
    if (products.length > PRODUCTS_PER_PAGE) {
        const existingLoadMore = document.getElementById('loadMoreProducts');
        if (existingLoadMore) existingLoadMore.remove();
        
        const loadMoreBtn = document.createElement('button');
        loadMoreBtn.id = 'loadMoreProducts';
        loadMoreBtn.className = 'btn-secondary btn-load-more';
        loadMoreBtn.innerHTML = `📦 Carica altri (${Math.min(PRODUCTS_PER_PAGE, products.length - PRODUCTS_PER_PAGE)} di ${products.length - PRODUCTS_PER_PAGE} rimanenti)`;
        loadMoreBtn.onclick = loadMoreProducts;
        grid.parentElement.appendChild(loadMoreBtn);
    }
}

function renderProductSelectionPage() {
    const grid = document.getElementById('productSelectionGrid');
    const start = 0;
    const end = (productSelectionPage + 1) * PRODUCTS_PER_PAGE;
    const visibleProducts = products.slice(start, end);
    
    grid.innerHTML = visibleProducts.map(p => `
        <label class="product-select-item" data-name="${p.name.toLowerCase()}" data-id="${p.id}">
            <input type="checkbox" value="${p.id}" ${selectedProductIds.includes(p.id) ? 'checked' : ''} onchange="toggleProductSelection(this, '${p.id}')">
            <img src="${getImagePath(p.images?.[0])}" alt="${p.name}" class="product-select-thumb" loading="lazy" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect fill=%22%23f5f5f5%22 width=%22100%22 height=%22100%22/></svg>'">
            <div class="product-select-info">
                <div class="product-select-name">${p.name}</div>
                <div class="product-select-price">
                    ${p.sale_price ? `<span class="original">€${p.price}</span><span class="sale">€${p.sale_price}</span>` : `€${p.price}`}
                </div>
            </div>
        </label>
    `).join('');
    
    // Update selected state
    document.querySelectorAll('.product-select-item').forEach(item => {
        if (selectedProductIds.includes(item.dataset.id)) {
            item.classList.add('selected');
        }
    });
}

window.loadMoreProducts = function() {
    productSelectionPage++;
    renderProductSelectionPage();
    
    const remaining = products.length - ((productSelectionPage + 1) * PRODUCTS_PER_PAGE);
    const loadMoreBtn = document.getElementById('loadMoreProducts');
    
    if (remaining <= 0) {
        loadMoreBtn?.remove();
    } else {
        loadMoreBtn.innerHTML = `📦 Carica altri (${Math.min(PRODUCTS_PER_PAGE, remaining)} di ${remaining} rimanenti)`;
    }
};

// Toggle product selection
window.toggleProductSelection = function(checkbox, productId) {
    const item = checkbox.closest('.product-select-item');
    if (checkbox.checked) {
        selectedProductIds.push(productId);
        item.classList.add('selected');
    } else {
        selectedProductIds = selectedProductIds.filter(id => id !== productId);
        item.classList.remove('selected');
    }
    updateDiscountPreview();
};

// Update discount selection (for gender/category)
window.updateDiscountSelection = function() {
    if (discountMode === 'gender') {
        selectedGenders = Array.from(document.querySelectorAll('#genderSelection input:checked')).map(cb => cb.value);
    } else if (discountMode === 'category') {
        selectedCategories = Array.from(document.querySelectorAll('#categorySelection input:checked')).map(cb => cb.value);
    }
    updateDiscountPreview();
};

// Filter products in selection
window.filterDiscountProducts = function() {
    const query = document.getElementById('discountProductSearch').value.toLowerCase();
    document.querySelectorAll('.product-select-item').forEach(item => {
        const name = item.dataset.name;
        item.style.display = name.includes(query) ? 'flex' : 'none';
    });
};

// Select all visible products
window.selectAllDiscountProducts = function() {
    document.querySelectorAll('.product-select-item').forEach(item => {
        if (item.style.display !== 'none') {
            const checkbox = item.querySelector('input');
            if (!checkbox.checked) {
                checkbox.checked = true;
                selectedProductIds.push(item.dataset.id);
                item.classList.add('selected');
            }
        }
    });
    updateDiscountPreview();
};

// Deselect all products
window.deselectAllDiscountProducts = function() {
    document.querySelectorAll('.product-select-item').forEach(item => {
        const checkbox = item.querySelector('input');
        checkbox.checked = false;
        item.classList.remove('selected');
    });
    selectedProductIds = [];
    updateDiscountPreview();
};

// Update discount preview
window.updateDiscountPreview = function() {
    const discountType = document.getElementById('discountType').value;
    const discountValue = parseFloat(document.getElementById('discountValue').value) || 0;
    const suffix = document.getElementById('discountSuffix');
    const previewText = document.getElementById('previewText');
    const previewStats = document.getElementById('previewStats');
    const previewCount = document.getElementById('previewCount');
    const previewDiscount = document.getElementById('previewDiscount');
    
    // Update suffix
    suffix.textContent = discountType === 'percentage' ? '%' : '€';
    
    // Get affected products count
    const affectedProducts = getAffectedProducts();
    const count = affectedProducts.length;
    
    if (count === 0) {
        previewText.textContent = 'Seleziona i prodotti e imposta lo sconto';
        previewStats.style.display = 'none';
        return;
    }
    
    // Update preview
    let modeText = '';
    if (discountMode === 'all') modeText = 'tutti i prodotti';
    else if (discountMode === 'gender') modeText = `prodotti ${selectedGenders.map(g => g === 'woman' ? 'Donna' : g === 'man' ? 'Uomo' : 'Unisex').join(', ')}`;
    else if (discountMode === 'category') modeText = `categorie selezionate`;
    else if (discountMode === 'products') modeText = `prodotti selezionati`;
    
    previewText.textContent = `Sconto su ${modeText}`;
    previewStats.style.display = 'flex';
    previewCount.textContent = `${count} prodott${count === 1 ? 'o' : 'i'}`;
    previewDiscount.textContent = discountType === 'percentage' ? `-${discountValue}%` : `-€${discountValue.toFixed(2)}`;
};

// Get affected products based on current selection
function getAffectedProducts() {
    if (discountMode === 'all') {
        return products;
    } else if (discountMode === 'gender') {
        return products.filter(p => selectedGenders.includes(p.gender));
    } else if (discountMode === 'category') {
        return products.filter(p => selectedCategories.includes(p.category_id));
    } else if (discountMode === 'products') {
        return products.filter(p => selectedProductIds.includes(p.id));
    }
    return [];
}

// Apply discount - optimized for bulk operations (hundreds of products)
window.applyDiscount = async function() {
    const discountType = document.getElementById('discountType').value;
    const discountValue = parseFloat(document.getElementById('discountValue').value) || 0;
    
    if (discountValue <= 0) {
        showToast('Inserisci un valore di sconto valido', 'error');
        return;
    }
    
    const affectedProducts = getAffectedProducts();
    
    if (affectedProducts.length === 0) {
        showToast('Nessun prodotto selezionato', 'error');
        return;
    }
    
    const btn = document.getElementById('applyDiscountBtn');
    btn.disabled = true;
    btn.textContent = `⏳ Applicando a ${affectedProducts.length} prodotti...`;
    
    try {
        // Prepare batch updates - group by calculated sale price for efficiency
        const updates = [];
        
        for (const product of affectedProducts) {
            let newSalePrice;
            
            if (discountType === 'percentage') {
                newSalePrice = product.price * (1 - discountValue / 100);
            } else {
                newSalePrice = Math.max(0, product.price - discountValue);
            }
            
            // Round to 2 decimals
            newSalePrice = Math.round(newSalePrice * 100) / 100;
            
            // Don't apply if sale price would be >= original price
            if (newSalePrice >= product.price) continue;
            
            updates.push({ id: product.id, sale_price: newSalePrice });
        }
        
        if (updates.length === 0) {
            showToast('Nessun prodotto da scontare (sconto troppo basso)', 'error');
            btn.disabled = false;
            btn.textContent = '✅ Applica Sconto';
            return;
        }
        
        // Process in batches of 50 for optimal performance
        const BATCH_SIZE = 50;
        let successCount = 0;
        let processedCount = 0;
        
        for (let i = 0; i < updates.length; i += BATCH_SIZE) {
            const batch = updates.slice(i, i + BATCH_SIZE);
            
            // Use Promise.all for parallel updates within batch
            const results = await Promise.all(
                batch.map(update => 
                    supabase
                        .from('products')
                        .update({ sale_price: update.sale_price })
                        .eq('id', update.id)
                )
            );
            
            successCount += results.filter(r => !r.error).length;
            processedCount += batch.length;
            
            // Update progress
            const progress = Math.round((processedCount / updates.length) * 100);
            btn.textContent = `⏳ ${progress}% (${processedCount}/${updates.length})`;
        }
        
        showToast(`Sconto applicato a ${successCount} prodotti!`, 'success');
        
        // Reload data
        await loadProducts();
        loadDiscountedProducts();
        populateProductSelection();
        resetDiscountForm();
        
    } catch (err) {
        console.error('Apply discount error:', err);
        showToast('Errore nell\'applicazione dello sconto', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = '✅ Applica Sconto';
    }
};

// Reset discount form
window.resetDiscountForm = function() {
    setDiscountMode('all');
    document.getElementById('discountType').value = 'percentage';
    document.getElementById('discountValue').value = '10';
    document.getElementById('discountProductSearch').value = '';
    filterDiscountProducts();
    updateDiscountPreview();
};

// Load discounted products
async function loadDiscountedProducts() {
    const grid = document.getElementById('discountedProductsGrid');
    if (!grid) return;
    
    const discountedProducts = products.filter(p => p.sale_price && p.sale_price < p.price);
    
    if (discountedProducts.length === 0) {
        grid.innerHTML = '<p class="no-discounts">Nessun prodotto scontato al momento</p>';
        return;
    }
    
    grid.innerHTML = discountedProducts.map(p => {
        const discountPercent = Math.round((1 - p.sale_price / p.price) * 100);
        return `
            <div class="discounted-product-card">
                <span class="discount-badge">-${discountPercent}%</span>
                <div class="product-info">
                    <img src="${getImagePath(p.images?.[0])}" alt="${p.name}" class="product-thumb" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect fill=%22%23f5f5f5%22 width=%22100%22 height=%22100%22/></svg>'">
                    <div class="product-details">
                        <div class="product-name">${p.name}</div>
                        <div class="product-prices">
                            <span class="original-price">€${p.price}</span>
                            <span class="sale-price">€${p.sale_price}</span>
                        </div>
                    </div>
                </div>
                <button class="btn-remove-discount" onclick="removeDiscount('${p.id}')">🗑️ Rimuovi Sconto</button>
            </div>
        `;
    }).join('');
}

// Remove discount from single product
window.removeDiscount = async function(productId) {
    try {
        const { error } = await supabase
            .from('products')
            .update({ sale_price: null })
            .eq('id', productId);
        
        if (error) throw error;
        
        showToast('Sconto rimosso!', 'success');
        await loadProducts();
        loadDiscountedProducts();
        populateProductSelection();
    } catch (err) {
        console.error('Remove discount error:', err);
        showToast('Errore nella rimozione dello sconto', 'error');
    }
};

// Remove all discounts - optimized for bulk operations
window.removeAllDiscounts = async function() {
    const discountedProducts = products.filter(p => p.sale_price && p.sale_price < p.price);
    
    if (discountedProducts.length === 0) {
        showToast('Nessun prodotto scontato', 'error');
        return;
    }
    
    if (!confirm(`Sei sicuro di voler rimuovere gli sconti da ${discountedProducts.length} prodotti?`)) {
        return;
    }
    
    try {
        // Use batch processing for efficiency
        const BATCH_SIZE = 50;
        const productIds = discountedProducts.map(p => p.id);
        
        for (let i = 0; i < productIds.length; i += BATCH_SIZE) {
            const batchIds = productIds.slice(i, i + BATCH_SIZE);
            
            // Use Promise.all for parallel updates
            await Promise.all(
                batchIds.map(id => 
                    supabase
                        .from('products')
                        .update({ sale_price: null })
                        .eq('id', id)
                )
            );
        }
        
        showToast(`Sconti rimossi da ${discountedProducts.length} prodotti!`, 'success');
        await loadProducts();
        loadDiscountedProducts();
        populateProductSelection();
    } catch (err) {
        console.error('Remove all discounts error:', err);
        showToast('Errore nella rimozione degli sconti', 'error');
    }
};

// Make showGcDetail available globally
window.showGcDetail = showGcDetail;

// ==================== ORDERS MANAGEMENT ====================

// ==================== ORDERS MANAGEMENT - ADVANCED ====================

let orders = [];
let filteredOrders = [];
let orderSortField = 'created_at';
let orderSortDir = 'desc';

async function loadOrders() {
    try {
        const { data, error } = await supabase
            .from('orders')
            .select(`
                *,
                order_items (
                    id,
                    product_name,
                    product_price,
                    quantity,
                    size,
                    color
                )
            `)
            .order('created_at', { ascending: false });

        if (error) throw error;
        orders = data || [];
        filteredOrders = [...orders];
        applyOrderFilters();
        setupOrdersEventListeners();
    } catch (err) {
        console.error('Load orders error:', err);
        showToast('Errore nel caricamento ordini', 'error');
    }
}

function setupOrdersEventListeners() {
    // Search input
    const searchInput = document.getElementById('orderSearch');
    const clearBtn = document.getElementById('clearSearchBtn');
    
    searchInput?.addEventListener('input', (e) => {
        clearBtn.style.display = e.target.value ? 'flex' : 'none';
        applyOrderFilters();
    });
    
    clearBtn?.addEventListener('click', () => {
        searchInput.value = '';
        clearBtn.style.display = 'none';
        applyOrderFilters();
    });
    
    // Filters
    document.getElementById('orderStatusFilter')?.addEventListener('change', applyOrderFilters);
    document.getElementById('orderDateFilter')?.addEventListener('change', (e) => {
        const customRange = document.getElementById('customDateRange');
        if (e.target.value === 'custom') {
            customRange.classList.add('show');
        } else {
            customRange.classList.remove('show');
        }
        applyOrderFilters();
    });
    document.getElementById('orderDateFrom')?.addEventListener('change', applyOrderFilters);
    document.getElementById('orderDateTo')?.addEventListener('change', applyOrderFilters);
    document.getElementById('orderAmountFilter')?.addEventListener('change', applyOrderFilters);
    document.getElementById('orderPaymentFilter')?.addEventListener('change', applyOrderFilters);
    
    // Reset filters
    document.getElementById('resetFiltersBtn')?.addEventListener('click', resetOrderFilters);
    
    // Sortable headers
    document.querySelectorAll('.orders-table th.sortable').forEach(th => {
        th.addEventListener('click', () => {
            const field = th.dataset.sort;
            if (orderSortField === field) {
                orderSortDir = orderSortDir === 'asc' ? 'desc' : 'asc';
            } else {
                orderSortField = field;
                orderSortDir = 'desc';
            }
            document.querySelectorAll('.orders-table th.sortable').forEach(h => h.classList.remove('asc', 'desc'));
            th.classList.add(orderSortDir);
            applyOrderFilters();
        });
    });
}

function applyOrderFilters() {
    const searchQuery = (document.getElementById('orderSearch')?.value || '').toLowerCase().trim();
    const statusFilter = document.getElementById('orderStatusFilter')?.value || '';
    const dateFilter = document.getElementById('orderDateFilter')?.value || '';
    const amountFilter = document.getElementById('orderAmountFilter')?.value || '';
    const paymentFilter = document.getElementById('orderPaymentFilter')?.value || '';
    const dateFrom = document.getElementById('orderDateFrom')?.value || '';
    const dateTo = document.getElementById('orderDateTo')?.value || '';
    
    filteredOrders = orders.filter(order => {
        // Text search - search in ALL fields
        if (searchQuery) {
            const searchableText = buildSearchableText(order).toLowerCase();
            if (!searchableText.includes(searchQuery)) return false;
        }
        
        // Status filter
        if (statusFilter && order.status !== statusFilter) return false;
        
        // Date filter
        if (dateFilter) {
            const orderDate = new Date(order.created_at);
            const now = new Date();
            
            if (dateFilter === 'today') {
                if (orderDate.toDateString() !== now.toDateString()) return false;
            } else if (dateFilter === 'week') {
                const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                if (orderDate < weekAgo) return false;
            } else if (dateFilter === 'month') {
                const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                if (orderDate < monthAgo) return false;
            } else if (dateFilter === 'custom') {
                if (dateFrom && orderDate < new Date(dateFrom)) return false;
                if (dateTo && orderDate > new Date(dateTo + 'T23:59:59')) return false;
            }
        }
        
        // Amount filter
        if (amountFilter) {
            const total = parseFloat(order.total);
            if (amountFilter === '0-25' && (total < 0 || total > 25)) return false;
            if (amountFilter === '25-50' && (total < 25 || total > 50)) return false;
            if (amountFilter === '50-100' && (total < 50 || total > 100)) return false;
            if (amountFilter === '100+' && total < 100) return false;
        }
        
        // Payment filter
        if (paymentFilter && order.payment_provider !== paymentFilter) return false;
        
        return true;
    });
    
    // Sort
    filteredOrders.sort((a, b) => {
        let valA, valB;
        
        if (orderSortField === 'customer') {
            valA = `${a.shipping_address?.firstName || ''} ${a.shipping_address?.lastName || ''}`.toLowerCase();
            valB = `${b.shipping_address?.firstName || ''} ${b.shipping_address?.lastName || ''}`.toLowerCase();
        } else if (orderSortField === 'total') {
            valA = parseFloat(a.total);
            valB = parseFloat(b.total);
        } else if (orderSortField === 'created_at') {
            valA = new Date(a.created_at).getTime();
            valB = new Date(b.created_at).getTime();
        } else {
            valA = a[orderSortField] || '';
            valB = b[orderSortField] || '';
        }
        
        if (orderSortDir === 'asc') {
            return valA > valB ? 1 : -1;
        } else {
            return valA < valB ? 1 : -1;
        }
    });
    
    renderOrders(filteredOrders, searchQuery);
    updateOrdersStats(filteredOrders);
}

function buildSearchableText(order) {
    const addr = order.shipping_address || {};
    const items = order.order_items || [];
    
    const parts = [
        order.order_number,
        addr.firstName,
        addr.lastName,
        addr.address,
        addr.city,
        addr.province,
        addr.postalCode,
        addr.phone,
        order.payment_provider,
        order.payment_id,
        order.status,
        order.tracking_number,
        order.courier,
        order.notes,
        order.gift_card_code,
        ...items.map(i => i.product_name),
        ...items.map(i => i.size),
        ...items.map(i => i.color)
    ];
    
    return parts.filter(Boolean).join(' ');
}

function highlightMatch(text, query) {
    if (!query || !text) return text;
    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return text.replace(regex, '<span class="search-match">$1</span>');
}

function resetOrderFilters() {
    document.getElementById('orderSearch').value = '';
    document.getElementById('orderStatusFilter').value = '';
    document.getElementById('orderDateFilter').value = '';
    document.getElementById('orderAmountFilter').value = '';
    document.getElementById('orderPaymentFilter').value = '';
    document.getElementById('orderDateFrom').value = '';
    document.getElementById('orderDateTo').value = '';
    document.getElementById('customDateRange').classList.remove('show');
    document.getElementById('clearSearchBtn').style.display = 'none';
    applyOrderFilters();
}

function updateOrdersStats(orderList) {
    const count = orderList.length;
    const total = orderList.reduce((sum, o) => sum + parseFloat(o.total), 0);
    
    document.getElementById('ordersCount').textContent = `${count} ordine${count !== 1 ? 'i' : ''}`;
    document.getElementById('ordersTotalAmount').textContent = `Totale: €${total.toFixed(2)}`;
}

function renderOrders(orderList, searchQuery = '') {
    const tbody = document.getElementById('ordersTable');
    const mobileCards = document.getElementById('mobileOrderCards');
    
    if (!orderList || orderList.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="loading">Nessun ordine trovato</td></tr>';
        if (mobileCards) mobileCards.innerHTML = '<p style="text-align:center;padding:2rem;color:#888;">Nessun ordine trovato</p>';
        return;
    }

    const statusColors = {
        'pending': 'status-pending',
        'confirmed': 'status-confirmed',
        'processing': 'status-processing',
        'shipped': 'status-shipped',
        'delivered': 'status-active',
        'cancelled': 'status-inactive',
        'refunded': 'status-inactive'
    };

    // Desktop table
    tbody.innerHTML = orderList.map(order => {
        const date = new Date(order.created_at).toLocaleDateString('it-IT', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
        
        const addr = order.shipping_address || {};
        const isGiftCard = addr.type === 'digital';
        let customerName = `${addr.firstName || ''} ${addr.lastName || ''}`.trim();
        
        // Per le gift card, estrai il nome dalle note o mostra "Gift Card"
        if (isGiftCard && !customerName) {
            // Le note contengono "Gift Card per NomeDestinatario (email)"
            const noteMatch = order.notes?.match(/Gift Card per ([^(]+)/);
            customerName = noteMatch ? `🎁 ${noteMatch[1].trim()}` : '🎁 Gift Card';
        }
        customerName = customerName || 'N/D';
        
        const productNames = (order.order_items || []).map(i => i.product_name).join(', ');
        
        const displayOrderNum = highlightMatch(order.order_number, searchQuery);
        const displayCustomer = highlightMatch(customerName, searchQuery);
        const displayCity = highlightMatch(addr.city || '', searchQuery);
        
        return `
        <tr class="${searchQuery && buildSearchableText(order).toLowerCase().includes(searchQuery) ? 'order-row-highlight' : ''}">
            <td>
                <strong>#${displayOrderNum}</strong>
                <br><small style="color:#999" title="${productNames}">${order.order_items?.length || 0} prodotti</small>
            </td>
            <td>
                <strong>${displayCustomer}</strong>
                <br><small style="color:#999">${displayCity}</small>
                ${addr.phone ? `<br><small style="color:#aaa">📞 ${highlightMatch(addr.phone, searchQuery)}</small>` : ''}
            </td>
            <td>${date}</td>
            <td><strong>€${parseFloat(order.total).toFixed(2)}</strong></td>
            <td>
                <select class="order-status-select ${statusColors[order.status] || ''}" 
                        onchange="updateOrderStatus('${order.id}', this.value)">
                    <option value="pending" ${order.status === 'pending' ? 'selected' : ''}>⏳ In attesa</option>
                    <option value="confirmed" ${order.status === 'confirmed' ? 'selected' : ''}>✅ Confermato</option>
                    <option value="processing" ${order.status === 'processing' ? 'selected' : ''}>🔄 In lavorazione</option>
                    <option value="shipped" ${order.status === 'shipped' ? 'selected' : ''}>🚚 Spedito</option>
                    <option value="delivered" ${order.status === 'delivered' ? 'selected' : ''}>📦 Consegnato</option>
                    <option value="cancelled" ${order.status === 'cancelled' ? 'selected' : ''}>❌ Annullato</option>
                    <option value="refunded" ${order.status === 'refunded' ? 'selected' : ''}>💸 Rimborsato</option>
                </select>
            </td>
            <td class="actions-cell">
                <button class="btn-edit" onclick="viewOrderDetails('${order.id}')">👁️ Dettagli</button>
            </td>
        </tr>
    `}).join('');
    
    // Mobile cards
    if (mobileCards) {
        mobileCards.innerHTML = orderList.map(order => {
            const date = new Date(order.created_at).toLocaleDateString('it-IT', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
            
            const addr = order.shipping_address || {};
            const isGiftCard = addr.type === 'digital';
            let customerName = `${addr.firstName || ''} ${addr.lastName || ''}`.trim();
            
            // Per le gift card, estrai il nome dalle note
            if (isGiftCard && !customerName) {
                const noteMatch = order.notes?.match(/Gift Card per ([^(]+)/);
                customerName = noteMatch ? `🎁 ${noteMatch[1].trim()}` : '🎁 Gift Card';
            }
            customerName = customerName || 'N/D';
            
            const productNames = (order.order_items || []).slice(0, 2).map(i => i.product_name).join(', ');
            const moreItems = (order.order_items?.length || 0) > 2 ? ` +${order.order_items.length - 2}` : '';
            
            return `
            <div class="mobile-order-card">
                <div class="mobile-order-header">
                    <div>
                        <div class="mobile-order-number">#${order.order_number}</div>
                        <div class="mobile-order-date">${date}</div>
                    </div>
                    <span class="order-status ${statusColors[order.status] || ''}" style="font-size:0.75rem;padding:0.25rem 0.5rem;">
                        ${order.status === 'pending' ? '⏳' : order.status === 'confirmed' ? '✅' : order.status === 'processing' ? '🔄' : order.status === 'shipped' ? '🚚' : order.status === 'delivered' ? '📦' : order.status === 'cancelled' ? '❌' : '💸'}
                    </span>
                </div>
                
                <div class="mobile-order-customer">
                    <span class="mobile-customer-name">${customerName}</span>
                    <span class="mobile-customer-city">📍 ${addr.city || 'N/D'}</span>
                    ${addr.phone ? `<span class="mobile-customer-phone">📞 ${addr.phone}</span>` : ''}
                </div>
                
                <div class="mobile-order-items">
                    🛒 ${productNames}${moreItems} (${order.order_items?.length || 0} prodotti)
                </div>
                
                <div class="mobile-order-footer">
                    <span class="mobile-order-total">€${parseFloat(order.total).toFixed(2)}</span>
                    <div class="mobile-order-status">
                        <select class="order-status-select" onchange="updateOrderStatus('${order.id}', this.value)">
                            <option value="pending" ${order.status === 'pending' ? 'selected' : ''}>⏳ In attesa</option>
                            <option value="confirmed" ${order.status === 'confirmed' ? 'selected' : ''}>✅ Confermato</option>
                            <option value="processing" ${order.status === 'processing' ? 'selected' : ''}>🔄 In lavorazione</option>
                            <option value="shipped" ${order.status === 'shipped' ? 'selected' : ''}>🚚 Spedito</option>
                            <option value="delivered" ${order.status === 'delivered' ? 'selected' : ''}>📦 Consegnato</option>
                            <option value="cancelled" ${order.status === 'cancelled' ? 'selected' : ''}>❌ Annullato</option>
                            <option value="refunded" ${order.status === 'refunded' ? 'selected' : ''}>💸 Rimborsato</option>
                        </select>
                    </div>
                </div>
                
                <div class="mobile-order-actions">
                    <button class="btn-details" onclick="viewOrderDetails('${order.id}')">👁️ Vedi dettagli</button>
                </div>
            </div>
            `;
        }).join('');
    }
}

window.updateOrderStatus = async function(orderId, newStatus) {
    try {
        const { error } = await supabase
            .from('orders')
            .update({ status: newStatus, updated_at: new Date().toISOString() })
            .eq('id', orderId);

        if (error) throw error;
        
        // Update local data
        const order = orders.find(o => o.id === orderId);
        if (order) order.status = newStatus;
        
        showToast('Stato ordine aggiornato!', 'success');
        applyOrderFilters();
    } catch (err) {
        console.error('Update order status error:', err);
        showToast('Errore nell\'aggiornamento', 'error');
    }
};

window.viewOrderDetails = function(orderId) {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;
    
    // Save modal state for session persistence
    saveModalState('order', orderId);
    
    const addr = order.shipping_address || {};
    const items = order.order_items || [];
    const isGiftCard = addr.type === 'digital';
    
    let detailsHtml;
    
    if (isGiftCard) {
        // Gift Card order - mostra info specifiche
        const noteMatch = order.notes?.match(/Gift Card per ([^(]+)\(([^)]+)\)/);
        const recipientName = noteMatch ? noteMatch[1].trim() : 'N/D';
        const recipientEmail = noteMatch ? noteMatch[2].trim() : 'N/D';
        
        detailsHtml = `
            <div style="max-width:550px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem;">
                    <h3 style="margin:0;">🎁 Gift Card #${order.order_number}</h3>
                    <span style="background:${order.payment_status === 'completed' ? '#e8f5e9' : '#fff3e0'};padding:0.3rem 0.8rem;border-radius:20px;font-size:0.85rem;">
                        ${order.payment_status === 'completed' ? '✅ Pagato' : '⏳ ' + order.payment_status}
                    </span>
                </div>
                
                <div style="background:linear-gradient(135deg, #4a7c59 0%, #6b9b7a 100%);padding:1.5rem;border-radius:12px;margin-bottom:1rem;color:white;text-align:center;">
                    <div style="font-size:0.85rem;opacity:0.9;margin-bottom:0.5rem;">Importo Gift Card</div>
                    <div style="font-size:2.5rem;font-weight:700;">€${parseFloat(order.total).toFixed(2)}</div>
                </div>
                
                <div style="background:#f8f9fa;padding:1rem;border-radius:10px;margin-bottom:1rem;">
                    <h4 style="margin:0 0 0.75rem 0;font-size:0.9rem;color:#666;">🎯 Destinatario</h4>
                    <div style="display:flex;justify-content:space-between;padding:0.4rem 0;border-bottom:1px solid #eee;">
                        <span style="color:#666;">Nome:</span>
                        <strong>${recipientName}</strong>
                    </div>
                    <div style="display:flex;justify-content:space-between;padding:0.4rem 0;">
                        <span style="color:#666;">Email:</span>
                        <span>${recipientEmail}</span>
                    </div>
                </div>
                
                <div style="background:#f8f9fa;padding:1rem;border-radius:10px;margin-bottom:1rem;">
                    <h4 style="margin:0 0 0.75rem 0;font-size:0.9rem;color:#666;">📋 Dettagli ordine</h4>
                    <div style="display:flex;justify-content:space-between;padding:0.4rem 0;border-bottom:1px solid #eee;">
                        <span style="color:#666;">Tipo:</span>
                        <span>🎁 Gift Card Digitale</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;padding:0.4rem 0;border-bottom:1px solid #eee;">
                        <span style="color:#666;">Consegna:</span>
                        <span>📧 Via Email</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;padding:0.4rem 0;">
                        <span style="color:#666;">Data:</span>
                        <span>${new Date(order.created_at).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                </div>
                
                <div style="background:#e3f2fd;padding:0.75rem 1rem;border-radius:8px;font-size:0.9rem;">
                    <strong>💳 Pagamento:</strong> ${order.payment_provider?.toUpperCase() || 'N/D'}<br>
                    <small style="color:#666;">ID: ${order.payment_id || 'N/D'}</small>
                </div>
                
                <div style="background:#e8f5e9;padding:0.75rem 1rem;border-radius:8px;margin-top:0.5rem;font-size:0.85rem;text-align:center;">
                    💡 Per i dettagli completi della Gift Card, vai alla sezione <strong>Gestione Gift Card</strong>
                </div>
            </div>
        `;
    } else {
        // Ordine normale - mostra info prodotti
        const itemsHtml = items.map(item => `
            <div style="display:flex;justify-content:space-between;padding:0.5rem 0;border-bottom:1px solid #eee;">
                <div>
                    <strong>${item.product_name}</strong>
                    <br><small style="color:#888">Taglia: ${item.size || 'N/D'} | Colore: ${item.color || 'N/D'} | Qtà: ${item.quantity}</small>
                </div>
                <span style="font-weight:600;">€${(item.product_price * item.quantity).toFixed(2)}</span>
            </div>
        `).join('');
        
        detailsHtml = `
            <div style="max-width:550px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem;">
                    <h3 style="margin:0;">Ordine #${order.order_number}</h3>
                    <span style="background:${order.payment_status === 'completed' ? '#e8f5e9' : '#fff3e0'};padding:0.3rem 0.8rem;border-radius:20px;font-size:0.85rem;">
                        ${order.payment_status === 'completed' ? '✅ Pagato' : '⏳ ' + order.payment_status}
                    </span>
                </div>
                
                <div style="background:#f8f9fa;padding:1rem;border-radius:10px;margin-bottom:1rem;">
                    <h4 style="margin:0 0 0.75rem 0;font-size:0.9rem;color:#666;">📍 Indirizzo di spedizione</h4>
                    <p style="margin:0;line-height:1.7;">
                        <strong>${addr.firstName || ''} ${addr.lastName || ''}</strong><br>
                        ${addr.address || ''}<br>
                        ${addr.postalCode || ''} ${addr.city || ''} (${addr.province || ''})<br>
                        📞 <a href="tel:${addr.phone}" style="color:inherit;">${addr.phone || 'N/D'}</a>
                    </p>
                </div>
                
                <div style="background:#f8f9fa;padding:1rem;border-radius:10px;margin-bottom:1rem;">
                    <h4 style="margin:0 0 0.75rem 0;font-size:0.9rem;color:#666;">🛒 Prodotti ordinati</h4>
                    ${itemsHtml || '<p style="color:#888;margin:0;">Nessun prodotto</p>'}
                </div>
                
                <div style="background:#f8f9fa;padding:1rem;border-radius:10px;margin-bottom:1rem;">
                    <h4 style="margin:0 0 0.75rem 0;font-size:0.9rem;color:#666;">💰 Riepilogo pagamento</h4>
                    <div style="display:flex;justify-content:space-between;padding:0.3rem 0;"><span>Subtotale:</span><span>€${parseFloat(order.subtotal).toFixed(2)}</span></div>
                    <div style="display:flex;justify-content:space-between;padding:0.3rem 0;"><span>Spedizione:</span><span>€${parseFloat(order.shipping_cost).toFixed(2)}</span></div>
                    ${parseFloat(order.discount) > 0 ? `<div style="display:flex;justify-content:space-between;padding:0.3rem 0;color:#e74c3c;"><span>Sconto:</span><span>-€${parseFloat(order.discount).toFixed(2)}</span></div>` : ''}
                    ${parseFloat(order.gift_card_amount) > 0 ? `<div style="display:flex;justify-content:space-between;padding:0.3rem 0;color:#9c27b0;"><span>Gift Card:</span><span>-€${parseFloat(order.gift_card_amount).toFixed(2)}</span></div>` : ''}
                    <div style="display:flex;justify-content:space-between;font-weight:bold;margin-top:0.5rem;padding-top:0.5rem;border-top:2px solid #dee2e6;font-size:1.1rem;"><span>Totale:</span><span>€${parseFloat(order.total).toFixed(2)}</span></div>
                </div>
                
                <div style="background:#e3f2fd;padding:0.75rem 1rem;border-radius:8px;font-size:0.9rem;">
                    <strong>💳 Pagamento:</strong> ${order.payment_provider?.toUpperCase() || 'N/D'}<br>
                    <small style="color:#666;">ID: ${order.payment_id || 'N/D'}</small>
                </div>
                
                ${order.tracking_number ? `
                <div style="background:#fff3e0;padding:0.75rem 1rem;border-radius:8px;margin-top:0.5rem;font-size:0.9rem;">
                    <strong>🚚 Tracking:</strong> ${order.tracking_number}<br>
                    ${order.courier ? `<small>Corriere: ${order.courier}</small>` : ''}
                </div>
                ` : ''}
            </div>
        `;
    }
    
    // Remove any existing modal
    document.querySelector('.order-detail-modal')?.remove();
    
    const modal = document.createElement('div');
    modal.className = 'order-detail-modal';
    modal.onclick = (e) => {
        if (e.target === modal) modal.remove();
    };
    modal.innerHTML = `
        <div class="order-detail-box">
            <button class="order-detail-close" onclick="this.closest('.order-detail-modal').remove()">×</button>
            ${detailsHtml}
        </div>
    `;
    document.body.appendChild(modal);
    
    // Prevent body scroll when modal is open
    document.body.style.overflow = 'hidden';
    modal.querySelector('.order-detail-close').onclick = () => {
        modal.remove();
        document.body.style.overflow = '';
        clearModalState();
    };
    
    // Also clear state when clicking outside
    modal.onclick = (e) => {
        if (e.target === modal) {
            modal.remove();
            document.body.style.overflow = '';
            clearModalState();
        }
    };
    modal.onclick = (e) => {
        if (e.target === modal) {
            modal.remove();
            document.body.style.overflow = '';
        }
    };
};

// Update navigateToSection to load orders
const originalNavigateToSection = navigateToSection;
navigateToSection = function(section) {
    originalNavigateToSection(section);
    if (section === 'orders') {
        loadOrders();
    }
};


// ============================================
// NOTIFICATION CENTER - PRODUCT UPDATES
// ============================================

const NOTIFICATION_STORAGE_KEY = 'admin_notifications';
const NOTIFICATION_MAX_AGE_DAYS = 3;

// Initialize notification center
function initNotificationCenter() {
    const notificationBtn = document.getElementById('notificationBtn');
    const notificationPanel = document.getElementById('notificationPanel');
    const notificationOverlay = document.getElementById('notificationOverlay');
    const markAllReadBtn = document.getElementById('markAllReadBtn');
    
    if (!notificationBtn) return;
    
    // Toggle panel
    notificationBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isActive = notificationPanel.classList.toggle('active');
        notificationOverlay.classList.toggle('active', isActive);
    });
    
    // Close on overlay click
    notificationOverlay?.addEventListener('click', () => {
        notificationPanel.classList.remove('active');
        notificationOverlay.classList.remove('active');
    });
    
    // Close on outside click
    document.addEventListener('click', (e) => {
        if (!notificationPanel.contains(e.target) && !notificationBtn.contains(e.target)) {
            notificationPanel.classList.remove('active');
            notificationOverlay?.classList.remove('active');
        }
    });
    
    // Mark all as read
    markAllReadBtn?.addEventListener('click', () => {
        markAllNotificationsRead();
    });
    
    // Clean old notifications and render
    cleanOldNotifications();
    renderNotifications();
    
    // Subscribe to real-time product changes
    subscribeToProductChanges();
}

// Get notifications from localStorage
function getNotifications() {
    try {
        const stored = localStorage.getItem(NOTIFICATION_STORAGE_KEY);
        return stored ? JSON.parse(stored) : [];
    } catch {
        return [];
    }
}

// Save notifications to localStorage
function saveNotifications(notifications) {
    try {
        localStorage.setItem(NOTIFICATION_STORAGE_KEY, JSON.stringify(notifications));
    } catch (e) {
        console.error('Error saving notifications:', e);
    }
}

// Add a new notification
function addNotification(notification) {
    const notifications = getNotifications();
    const newNotification = {
        id: Date.now().toString(),
        ...notification,
        timestamp: new Date().toISOString(),
        read: false
    };
    notifications.unshift(newNotification);
    saveNotifications(notifications);
    renderNotifications();
    showToast(`📬 ${notification.title}`, 'success');
}

// Mark notification as read
function markNotificationRead(notificationId) {
    const notifications = getNotifications();
    const notification = notifications.find(n => n.id === notificationId);
    if (notification) {
        notification.read = true;
        saveNotifications(notifications);
        renderNotifications();
    }
}

// Mark all notifications as read
function markAllNotificationsRead() {
    const notifications = getNotifications();
    notifications.forEach(n => n.read = true);
    saveNotifications(notifications);
    renderNotifications();
}

// Clean notifications older than 3 days
function cleanOldNotifications() {
    const notifications = getNotifications();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - NOTIFICATION_MAX_AGE_DAYS);
    
    const filtered = notifications.filter(n => {
        const notifDate = new Date(n.timestamp);
        return notifDate >= cutoffDate;
    });
    
    if (filtered.length !== notifications.length) {
        saveNotifications(filtered);
    }
}

// Format relative time
function formatNotificationTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 1) return 'Adesso';
    if (diffMins < 60) return `${diffMins} min fa`;
    if (diffHours < 24) return `${diffHours} ore fa`;
    if (diffDays === 1) return 'Ieri';
    return `${diffDays} giorni fa`;
}

// Format date for separator
function formatDateSeparator(timestamp) {
    const date = new Date(timestamp);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    if (date.toDateString() === today.toDateString()) return 'Oggi';
    if (date.toDateString() === yesterday.toDateString()) return 'Ieri';
    return date.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
}

// Render notifications
function renderNotifications() {
    const notificationList = document.getElementById('notificationList');
    const notificationBadge = document.getElementById('notificationBadge');
    const notificationCount = document.getElementById('notificationCount');
    
    if (!notificationList) return;
    
    const notifications = getNotifications();
    const unreadCount = notifications.filter(n => !n.read).length;
    
    // Update badge
    if (notificationBadge) {
        notificationBadge.textContent = unreadCount > 0 ? unreadCount : '';
        notificationBadge.dataset.count = unreadCount;
    }
    
    // Update count in header
    if (notificationCount) {
        notificationCount.textContent = unreadCount > 0 ? unreadCount : '';
    }
    
    // Empty state
    if (notifications.length === 0) {
        notificationList.innerHTML = `
            <div class="notification-empty">
                <div class="notification-empty-icon">📭</div>
                <p>Nessuna notifica</p>
            </div>
        `;
        return;
    }
    
    // Group by date
    let html = '';
    let currentDate = '';
    
    notifications.forEach(notification => {
        const notifDate = formatDateSeparator(notification.timestamp);
        
        // Add date separator if new date
        if (notifDate !== currentDate) {
            currentDate = notifDate;
            html += `<div class="notification-date-separator">${notifDate}</div>`;
        }
        
        const iconClass = notification.type === 'new_product' ? 'new-product' : 
                         notification.type === 'updated_product' ? 'updated-product' : 'low-stock';
        const icon = notification.type === 'new_product' ? '🆕' : 
                    notification.type === 'updated_product' ? '✏️' : '⚠️';
        
        const time = new Date(notification.timestamp).toLocaleTimeString('it-IT', { 
            hour: '2-digit', 
            minute: '2-digit' 
        });
        
        html += `
            <div class="notification-item ${notification.read ? '' : 'unread'}" 
                 onclick="handleNotificationClick('${notification.id}', '${notification.productId || ''}', '${notification.productSlug || ''}')">
                <div class="notification-icon ${iconClass}">${icon}</div>
                <div class="notification-content">
                    <div class="notification-title">${notification.title}</div>
                    <div class="notification-message">${notification.message}</div>
                    <div class="notification-time">🕐 ${time} · ${formatNotificationTime(notification.timestamp)}</div>
                </div>
            </div>
        `;
    });
    
    notificationList.innerHTML = html;
}

// Handle notification click - navigate to product
window.handleNotificationClick = function(notificationId, productId, productSlug) {
    markNotificationRead(notificationId);
    
    // Close panel
    document.getElementById('notificationPanel')?.classList.remove('active');
    document.getElementById('notificationOverlay')?.classList.remove('active');
    
    if (productId) {
        // Navigate to products section and open edit modal
        navigateToSection('products');
        
        // Wait for products to load then open modal
        setTimeout(() => {
            const product = products.find(p => p.id === productId || p.slug === productSlug);
            if (product) {
                openProductModal(product);
            } else {
                // Try to find by slug in case ID changed
                const productBySlug = products.find(p => p.slug === productSlug);
                if (productBySlug) {
                    openProductModal(productBySlug);
                } else {
                    showToast('Prodotto non trovato', 'error');
                }
            }
        }, 500);
    }
};

// Subscribe to real-time product changes
function subscribeToProductChanges() {
    if (!supabase) return;
    
    // Subscribe to INSERT events
    supabase
        .channel('product-inserts')
        .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'products'
        }, (payload) => {
            const product = payload.new;
            addNotification({
                type: 'new_product',
                title: 'Nuovo prodotto aggiunto',
                message: `"${product.name}" è stato aggiunto al catalogo`,
                productId: product.id,
                productSlug: product.slug
            });
            // Reload products list
            loadProducts();
        })
        .subscribe();
    
    // Subscribe to UPDATE events
    supabase
        .channel('product-updates')
        .on('postgres_changes', {
            event: 'UPDATE',
            schema: 'public',
            table: 'products'
        }, (payload) => {
            const product = payload.new;
            const oldProduct = payload.old;
            
            // Only notify for significant changes
            const significantChange = 
                product.name !== oldProduct.name ||
                product.price !== oldProduct.price ||
                product.sale_price !== oldProduct.sale_price ||
                product.is_active !== oldProduct.is_active ||
                product.inventory !== oldProduct.inventory;
            
            if (significantChange) {
                let changeDetails = [];
                if (product.price !== oldProduct.price) changeDetails.push(`prezzo: €${product.price}`);
                if (product.sale_price !== oldProduct.sale_price) changeDetails.push(`sconto: €${product.sale_price || 'rimosso'}`);
                if (product.is_active !== oldProduct.is_active) changeDetails.push(product.is_active ? 'attivato' : 'disattivato');
                if (product.inventory !== oldProduct.inventory) changeDetails.push(`stock: ${product.inventory}`);
                
                addNotification({
                    type: 'updated_product',
                    title: 'Prodotto aggiornato',
                    message: `"${product.name}" - ${changeDetails.join(', ') || 'modifiche varie'}`,
                    productId: product.id,
                    productSlug: product.slug
                });
                // Reload products list
                loadProducts();
            }
        })
        .subscribe();
}

// Initialize notification center when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(initNotificationCenter, 200);
});


// ============================================
// SEARCH KEYWORDS MANAGEMENT
// ============================================

let currentKeywords = [];

/**
 * Populate keywords tags from array
 */
function populateKeywords(keywords) {
    currentKeywords = Array.isArray(keywords) ? [...keywords] : [];
    renderKeywordTags();
}

/**
 * Clear all keywords
 */
function clearKeywords() {
    currentKeywords = [];
    renderKeywordTags();
    const input = document.getElementById('keywordInput');
    if (input) input.value = '';
}

/**
 * Get keywords array for saving
 */
function getKeywordsArray() {
    return currentKeywords;
}

/**
 * Add a keyword from input
 */
window.addKeyword = function() {
    const input = document.getElementById('keywordInput');
    if (!input) return;
    
    const keyword = input.value.trim().toLowerCase();
    
    if (keyword && !currentKeywords.includes(keyword)) {
        currentKeywords.push(keyword);
        renderKeywordTags();
        input.value = '';
        input.focus();
    }
};

/**
 * Remove a keyword by index
 */
window.removeKeyword = function(index) {
    currentKeywords.splice(index, 1);
    renderKeywordTags();
};

/**
 * Render keyword tags in the container
 */
function renderKeywordTags() {
    const container = document.getElementById('keywordsTags');
    if (!container) return;
    
    if (currentKeywords.length === 0) {
        container.innerHTML = '';
        return;
    }
    
    container.innerHTML = currentKeywords.map((keyword, index) => `
        <span class="keyword-tag">
            ${escapeHtml(keyword)}
            <button type="button" class="remove-keyword" onclick="removeKeyword(${index})" aria-label="Rimuovi">×</button>
        </span>
    `).join('');
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Handle Enter key in keyword input
document.addEventListener('DOMContentLoaded', () => {
    const keywordInput = document.getElementById('keywordInput');
    if (keywordInput) {
        keywordInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                addKeyword();
            }
        });
    }
});

/**
 * Suggest keywords based on product name and type
 */
window.suggestKeywords = function() {
    const name = document.getElementById('productName').value.trim().toLowerCase();
    const gender = document.getElementById('productGender').value;
    
    if (!name) {
        showToast('Inserisci prima il nome del prodotto', 'warning');
        return;
    }
    
    const suggestions = new Set();
    
    // Add words from product name
    const nameWords = name.split(/\s+/).filter(w => w.length > 2);
    nameWords.forEach(word => suggestions.add(word));
    
    // Add singular/plural variations
    nameWords.forEach(word => {
        if (word.endsWith('e')) {
            suggestions.add(word.slice(0, -1) + 'a'); // mele -> mela
        } else if (word.endsWith('i')) {
            suggestions.add(word.slice(0, -1) + 'o'); // pomodori -> pomodoro
        } else if (word.endsWith('a')) {
            suggestions.add(word.slice(0, -1) + 'e'); // mela -> mele
        } else if (word.endsWith('o')) {
            suggestions.add(word.slice(0, -1) + 'i'); // pomodoro -> pomodori
        }
    });
    
    // Add type-based keywords
    const typeKeywords = {
        'frutta': ['frutta', 'frutto', 'dolce', 'fresco', 'naturale', 'vitamine'],
        'verdura': ['verdura', 'ortaggio', 'verde', 'fresco', 'naturale', 'salute'],
        'gastronomia': ['gastronomia', 'formaggio', 'salume', 'tipico', 'locale'],
        'preparati': ['preparato', 'pronto', 'cucinare', 'facile', 'veloce']
    };
    
    if (gender && typeKeywords[gender]) {
        typeKeywords[gender].forEach(kw => suggestions.add(kw));
    }
    
    // Add suggested keywords that aren't already present
    let addedCount = 0;
    suggestions.forEach(suggestion => {
        if (!currentKeywords.includes(suggestion)) {
            currentKeywords.push(suggestion);
            addedCount++;
        }
    });
    
    renderKeywordTags();
    
    if (addedCount > 0) {
        showToast(`Aggiunte ${addedCount} parole chiave suggerite`, 'success');
    } else {
        showToast('Nessuna nuova parola chiave da suggerire', 'info');
    }
};
