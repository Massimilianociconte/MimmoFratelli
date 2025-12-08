/**
 * Notification Center Component
 * Mimmo Fratelli E-commerce Platform
 * 
 * Persistent notification center accessible from navbar
 * Shows product updates for the last 3 days
 */

import { supabase, isSupabaseConfigured } from '../supabase.js';

const STORAGE_KEY = 'mimmo_notification_center';
const MAX_AGE_DAYS = 3;

class NotificationCenter {
    constructor() {
        this.notifications = [];
        this.isOpen = false;
        this.container = null;
        this.initialized = false;
    }

    /**
     * Initialize the notification center
     */
    async init() {
        console.log('[NotificationCenter] init() called, initialized:', this.initialized);
        if (this.initialized) return;
        this.initialized = true;

        this.createUI();
        this.loadNotifications();
        this.cleanOldNotifications();
        this.render();
        this.setupEventListeners();
        
        console.log('[NotificationCenter] UI created and listeners set up');
        
        // Load recent products from database and subscribe to changes
        if (isSupabaseConfigured()) {
            await this.loadRecentProductNotifications();
            this.subscribeToChanges();
        }
    }

    /**
     * Create the UI elements
     */
    createUI() {
        console.log('[NotificationCenter] createUI() called');
        
        // Check if already created
        if (document.getElementById('notifCenterBtn')) {
            console.log('[NotificationCenter] UI already exists');
            this.render();
            return;
        }

        // Find nav container - try multiple selectors for different page layouts
        const navContainer = document.querySelector('.nav-right') || 
                            document.querySelector('.nav-actions') ||
                            document.querySelector('.nav-icons') ||
                            document.querySelector('nav .menu-btn')?.parentElement;
        
        console.log('[NotificationCenter] navContainer found:', !!navContainer);
        
        if (!navContainer) {
            // Retry after a short delay
            console.log('[NotificationCenter] Retrying createUI in 200ms...');
            setTimeout(() => this.createUI(), 200);
            return;
        }

        // Create notification button wrapper
        const wrapper = document.createElement('div');
        wrapper.className = 'notif-center-wrapper';
        wrapper.innerHTML = `
            <button class="notif-center-btn" id="notifCenterBtn" aria-label="Centro Notifiche">
                <span class="notif-center-icon">✉️</span>
                <span class="notif-center-badge" id="notifCenterBadge"></span>
            </button>
            <div class="notif-center-panel" id="notifCenterPanel">
                <div class="notif-center-header">
                    <h3>🔔 Notifiche</h3>
                    <button class="notif-mark-all-read" id="notifMarkAllRead">Segna tutte lette</button>
                </div>
                <div class="notif-center-list" id="notifCenterList">
                    <div class="notif-center-empty">
                        <span class="notif-empty-icon">📭</span>
                        <p>Nessuna notifica</p>
                    </div>
                </div>
            </div>
        `;

        // Insert before the menu button
        const menuBtn = navContainer.querySelector('.menu-btn');
        if (menuBtn) {
            navContainer.insertBefore(wrapper, menuBtn);
        } else {
            navContainer.appendChild(wrapper);
        }

        // Create overlay for mobile (only if not exists)
        if (!document.getElementById('notifCenterOverlay')) {
            const overlay = document.createElement('div');
            overlay.className = 'notif-center-overlay';
            overlay.id = 'notifCenterOverlay';
            document.body.appendChild(overlay);
        }

        this.container = wrapper;
    }

    /**
     * Setup event listeners
     */
    setupEventListeners() {
        const btn = document.getElementById('notifCenterBtn');
        const panel = document.getElementById('notifCenterPanel');
        const overlay = document.getElementById('notifCenterOverlay');
        const markAllBtn = document.getElementById('notifMarkAllRead');

        if (btn) {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggle();
            });
        }

        if (overlay) {
            overlay.addEventListener('click', () => this.close());
        }

        if (markAllBtn) {
            markAllBtn.addEventListener('click', () => this.markAllRead());
        }

        // Close on outside click
        document.addEventListener('click', (e) => {
            if (this.isOpen && panel && !panel.contains(e.target) && !btn?.contains(e.target)) {
                this.close();
            }
        });

        // Close on escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isOpen) {
                this.close();
            }
        });
    }

    /**
     * Toggle panel visibility
     */
    toggle() {
        this.isOpen ? this.close() : this.open();
    }

    /**
     * Check if mobile viewport
     */
    isMobile() {
        return window.innerWidth <= 768;
    }

    /**
     * Open the panel
     */
    open() {
        const panel = document.getElementById('notifCenterPanel');
        const overlay = document.getElementById('notifCenterOverlay');
        
        if (panel) panel.classList.add('active');
        // Only show overlay on mobile
        if (overlay && this.isMobile()) overlay.classList.add('active');
        this.isOpen = true;
    }

    /**
     * Close the panel
     */
    close() {
        const panel = document.getElementById('notifCenterPanel');
        const overlay = document.getElementById('notifCenterOverlay');
        
        if (panel) panel.classList.remove('active');
        if (overlay) overlay.classList.remove('active');
        this.isOpen = false;
    }

    /**
     * Load notifications from localStorage
     */
    loadNotifications() {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            this.notifications = stored ? JSON.parse(stored) : [];
        } catch {
            this.notifications = [];
        }
    }

    /**
     * Save notifications to localStorage
     */
    saveNotifications() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.notifications));
        } catch (e) {
            console.error('Error saving notifications:', e);
        }
    }

    /**
     * Add a new notification
     */
    addNotification(notification) {
        console.log('[NotificationCenter] Adding notification:', notification.title);
        
        // Check for duplicates by productId
        if (notification.productId) {
            const exists = this.notifications.some(n => 
                n.productId === notification.productId && n.type === notification.type
            );
            if (exists) {
                console.log('[NotificationCenter] Duplicate notification, skipping');
                return;
            }
        }
        
        const newNotif = {
            id: Date.now().toString(),
            ...notification,
            timestamp: new Date().toISOString(),
            read: false
        };
        
        this.notifications.unshift(newNotif);
        this.saveNotifications();
        this.render();
        
        // Show toast
        this.showToast(notification.title);
    }

    /**
     * Mark notification as read
     */
    markAsRead(notificationId) {
        const notif = this.notifications.find(n => n.id === notificationId);
        if (notif) {
            notif.read = true;
            this.saveNotifications();
            this.render();
        }
    }

    /**
     * Mark all notifications as read
     */
    markAllRead() {
        this.notifications.forEach(n => n.read = true);
        this.saveNotifications();
        this.render();
    }

    /**
     * Clean notifications older than 3 days
     */
    cleanOldNotifications() {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - MAX_AGE_DAYS);
        
        const before = this.notifications.length;
        this.notifications = this.notifications.filter(n => {
            return new Date(n.timestamp) >= cutoff;
        });
        
        if (this.notifications.length !== before) {
            this.saveNotifications();
        }
    }

    /**
     * Handle notification click
     */
    handleNotificationClick(notificationId) {
        const notif = this.notifications.find(n => n.id === notificationId);
        if (!notif) return;

        this.markAsRead(notificationId);
        this.close();

        // Navigate to product page
        if (notif.productId) {
            window.location.href = `product.html?id=${notif.productId}`;
        } else if (notif.productSlug) {
            window.location.href = `product.html?slug=${notif.productSlug}`;
        }
    }

    /**
     * Format time for display
     */
    formatTime(timestamp) {
        const date = new Date(timestamp);
        return date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    }

    /**
     * Format date separator
     */
    formatDateSeparator(timestamp) {
        const date = new Date(timestamp);
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);

        if (date.toDateString() === today.toDateString()) return 'Oggi';
        if (date.toDateString() === yesterday.toDateString()) return 'Ieri';
        return date.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
    }

    /**
     * Format relative time
     */
    formatRelativeTime(timestamp) {
        const now = new Date();
        const date = new Date(timestamp);
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);

        if (diffMins < 1) return 'Adesso';
        if (diffMins < 60) return `${diffMins} min fa`;
        if (diffHours < 24) return `${diffHours} ore fa`;
        return this.formatTime(timestamp);
    }

    /**
     * Render the notification list
     */
    render() {
        const list = document.getElementById('notifCenterList');
        const badge = document.getElementById('notifCenterBadge');
        
        if (!list) {
            console.warn('[NotificationCenter] List element not found');
            return;
        }

        const unreadCount = this.notifications.filter(n => !n.read).length;
        console.log('[NotificationCenter] Rendering', this.notifications.length, 'notifications,', unreadCount, 'unread');

        // Update badge (navbar and mobile FAB)
        if (badge) {
            badge.textContent = unreadCount > 0 ? (unreadCount > 9 ? '9+' : unreadCount) : '';
            badge.style.display = unreadCount > 0 ? 'flex' : 'none';
        }

        // Empty state
        if (this.notifications.length === 0) {
            list.innerHTML = `
                <div class="notif-center-empty">
                    <span class="notif-empty-icon">📭</span>
                    <p>Nessuna notifica</p>
                </div>
            `;
            return;
        }

        // Group by date
        let html = '';
        let currentDate = '';

        this.notifications.forEach(notif => {
            const dateStr = this.formatDateSeparator(notif.timestamp);
            
            if (dateStr !== currentDate) {
                currentDate = dateStr;
                html += `<div class="notif-date-separator">${dateStr}</div>`;
            }

            const icon = notif.type === 'new_product' ? '🆕' : 
                        notif.type === 'seasonal' ? '🍅' :
                        notif.type === 'price_change' ? '💰' : 
                        notif.type === 'back_in_stock' ? '📦' : '✏️';
            
            const iconClass = notif.type === 'new_product' ? 'new' : 
                             notif.type === 'seasonal' ? 'seasonal' :
                             notif.type === 'price_change' ? 'price' : 
                             notif.type === 'back_in_stock' ? 'stock' : 'update';

            html += `
                <div class="notif-item ${notif.read ? '' : 'unread'}" 
                     onclick="window.notificationCenter?.handleNotificationClick('${notif.id}')">
                    <div class="notif-item-icon ${iconClass}">${icon}</div>
                    <div class="notif-item-content">
                        <div class="notif-item-title">${notif.title}</div>
                        <div class="notif-item-message">${notif.message}</div>
                        <div class="notif-item-time">🕐 ${this.formatTime(notif.timestamp)} · ${this.formatRelativeTime(notif.timestamp)}</div>
                    </div>
                </div>
            `;
        });

        list.innerHTML = html;
    }

    /**
     * Show a toast notification
     */
    showToast(message) {
        // Use existing toast if available
        const existingToast = document.getElementById('toast');
        if (existingToast) {
            existingToast.textContent = `📬 ${message}`;
            existingToast.classList.add('show', 'success');
            setTimeout(() => existingToast.classList.remove('show', 'success'), 3000);
            return;
        }

        // Create temporary toast
        const toast = document.createElement('div');
        toast.className = 'notif-toast';
        toast.textContent = `📬 ${message}`;
        document.body.appendChild(toast);
        
        setTimeout(() => toast.classList.add('show'), 10);
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    /**
     * Load recent product notifications from database
     * Fetches seasonal products, new products, and discounted products from last 3 days
     */
    async loadRecentProductNotifications() {
        if (!supabase) return;

        try {
            const threeDaysAgo = new Date();
            threeDaysAgo.setDate(threeDaysAgo.getDate() - MAX_AGE_DAYS);
            const cutoffDate = threeDaysAgo.toISOString();

            // Get IDs of products we already have notifications for
            const existingProductIds = new Set(
                this.notifications
                    .filter(n => n.productId)
                    .map(n => n.productId)
            );

            // Fetch seasonal products added/updated in last 3 days
            const { data: seasonalProducts, error: seasonalError } = await supabase
                .from('products')
                .select('id, name, slug, price, sale_price, is_seasonal, is_new, created_at, updated_at')
                .eq('is_active', true)
                .eq('is_seasonal', true)
                .gte('updated_at', cutoffDate)
                .order('updated_at', { ascending: false })
                .limit(10);

            // Fetch new products (is_new flag) added in last 3 days
            const { data: newProducts, error: newError } = await supabase
                .from('products')
                .select('id, name, slug, price, sale_price, is_seasonal, is_new, created_at, updated_at')
                .eq('is_active', true)
                .eq('is_new', true)
                .gte('created_at', cutoffDate)
                .order('created_at', { ascending: false })
                .limit(10);

            // Fetch products with active discounts (sale_price set) updated in last 3 days
            const { data: discountedProducts, error: discountError } = await supabase
                .from('products')
                .select('id, name, slug, price, sale_price, is_seasonal, is_new, created_at, updated_at')
                .eq('is_active', true)
                .not('sale_price', 'is', null)
                .gte('updated_at', cutoffDate)
                .order('updated_at', { ascending: false })
                .limit(10);

            // Fetch recently created products (last 3 days) - catch-all for any new products
            const { data: recentProducts, error: recentError } = await supabase
                .from('products')
                .select('id, name, slug, price, sale_price, is_seasonal, is_new, created_at, updated_at')
                .eq('is_active', true)
                .gte('created_at', cutoffDate)
                .order('created_at', { ascending: false })
                .limit(10);

            let hasNewNotifications = false;

            // Process seasonal products
            if (seasonalProducts) {
                for (const product of seasonalProducts) {
                    if (!existingProductIds.has(product.id)) {
                        this.addNotificationSilent({
                            type: 'seasonal',
                            title: '🍅 Prodotto di Stagione!',
                            message: `${product.name} è ora disponibile`,
                            productId: product.id,
                            productSlug: product.slug,
                            timestamp: product.updated_at
                        });
                        existingProductIds.add(product.id);
                        hasNewNotifications = true;
                    }
                }
            }

            // Process new products
            if (newProducts) {
                for (const product of newProducts) {
                    if (!existingProductIds.has(product.id)) {
                        this.addNotificationSilent({
                            type: 'new_product',
                            title: '🆕 Novità!',
                            message: `${product.name} è stato aggiunto al catalogo`,
                            productId: product.id,
                            productSlug: product.slug,
                            timestamp: product.created_at
                        });
                        existingProductIds.add(product.id);
                        hasNewNotifications = true;
                    }
                }
            }

            // Process discounted products
            if (discountedProducts) {
                for (const product of discountedProducts) {
                    if (!existingProductIds.has(product.id) && product.sale_price < product.price) {
                        const discount = Math.round((1 - product.sale_price / product.price) * 100);
                        this.addNotificationSilent({
                            type: 'price_change',
                            title: '💰 Offerta Speciale!',
                            message: `${product.name} ora a €${product.sale_price} (-${discount}%)`,
                            productId: product.id,
                            productSlug: product.slug,
                            timestamp: product.updated_at
                        });
                        existingProductIds.add(product.id);
                        hasNewNotifications = true;
                    }
                }
            }

            // Process recently created products (catch-all)
            if (recentProducts) {
                for (const product of recentProducts) {
                    if (!existingProductIds.has(product.id)) {
                        // Determine the best notification type based on product flags
                        let type = 'new_product';
                        let title = '🆕 Nuovo Prodotto!';
                        let message = `${product.name} è stato aggiunto`;
                        
                        if (product.is_seasonal) {
                            type = 'seasonal';
                            title = '🍅 Prodotto di Stagione!';
                            message = `${product.name} è ora disponibile`;
                        } else if (product.sale_price && product.sale_price < product.price) {
                            const discount = Math.round((1 - product.sale_price / product.price) * 100);
                            type = 'price_change';
                            title = '💰 Offerta!';
                            message = `${product.name} a €${product.sale_price} (-${discount}%)`;
                        }
                        
                        this.addNotificationSilent({
                            type,
                            title,
                            message,
                            productId: product.id,
                            productSlug: product.slug,
                            timestamp: product.created_at
                        });
                        existingProductIds.add(product.id);
                        hasNewNotifications = true;
                    }
                }
            }

            // Sort notifications by timestamp (newest first)
            if (hasNewNotifications) {
                this.notifications.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
                this.saveNotifications();
                this.render();
            }

        } catch (err) {
            console.error('Error loading product notifications:', err);
        }
    }

    /**
     * Add notification without showing toast (for bulk loading)
     */
    addNotificationSilent(notification) {
        // Check if notification with same productId already exists
        const exists = this.notifications.some(n => 
            n.productId === notification.productId && n.type === notification.type
        );
        if (exists) return;

        const newNotif = {
            id: `${notification.type}-${notification.productId}-${Date.now()}`,
            ...notification,
            timestamp: notification.timestamp || new Date().toISOString(),
            read: false
        };
        
        this.notifications.push(newNotif);
    }

    /**
     * Subscribe to real-time product changes
     */
    subscribeToChanges() {
        if (!supabase) {
            console.warn('[NotificationCenter] Supabase not available for realtime');
            return;
        }

        console.log('[NotificationCenter] Setting up realtime subscriptions');

        // Subscribe to INSERT events
        supabase
            .channel('site-product-inserts')
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'products'
            }, (payload) => {
                console.log('[NotificationCenter] New product inserted:', payload.new?.name);
                const product = payload.new;
                if (product.is_active) {
                    this.addNotification({
                        type: 'new_product',
                        title: '🆕 Nuovo prodotto!',
                        message: `${product.name} è stato aggiunto`,
                        productId: product.id,
                        productSlug: product.slug
                    });
                }
            })
            .subscribe((status) => {
                console.log('[NotificationCenter] Insert subscription status:', status);
            });

        // Subscribe to UPDATE events
        supabase
            .channel('site-product-updates')
            .on('postgres_changes', {
                event: 'UPDATE',
                schema: 'public',
                table: 'products'
            }, (payload) => {
                console.log('[NotificationCenter] Product updated:', payload.new?.name);
                const product = payload.new;
                const old = payload.old;

                // Price change notification
                if (product.sale_price && product.sale_price !== old.sale_price) {
                    const discount = Math.round((1 - product.sale_price / product.price) * 100);
                    this.addNotification({
                        type: 'price_change',
                        title: '💰 Prezzo ribassato!',
                        message: `${product.name} ora a €${product.sale_price} (-${discount}%)`,
                        productId: product.id,
                        productSlug: product.slug
                    });
                }

                // Back in stock notification
                if (product.is_active && !old.is_active) {
                    this.addNotification({
                        type: 'back_in_stock',
                        title: '📦 Tornato disponibile!',
                        message: `${product.name} è di nuovo disponibile`,
                        productId: product.id,
                        productSlug: product.slug
                    });
                }
                
                // Seasonal product notification
                if (product.is_seasonal && !old.is_seasonal) {
                    this.addNotification({
                        type: 'seasonal',
                        title: '🍅 Prodotto di Stagione!',
                        message: `${product.name} è ora disponibile`,
                        productId: product.id,
                        productSlug: product.slug
                    });
                }
            })
            .subscribe((status) => {
                console.log('[NotificationCenter] Update subscription status:', status);
            });
    }

    /**
     * Test notification (for development)
     */
    test() {
        this.addNotification({
            type: 'new_product',
            title: 'Nuovo prodotto!',
            message: 'Pomodori San Marzano freschi',
            productId: 'test-123'
        });
    }
}

// Create singleton instance
export const notificationCenter = new NotificationCenter();

// Expose to window for onclick handlers
window.notificationCenter = notificationCenter;

// Note: Auto-init removed - component should be initialized explicitly via notificationCenter.init()
// This prevents double initialization when imported as a module

export default notificationCenter;
