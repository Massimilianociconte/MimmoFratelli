/**
 * Gift Card Service - Avenue M.
 * Handles gift card creation, redemption, and credit management
 */

import { supabase, isSupabaseConfigured } from '../supabase.js';

class GiftCardService {
    constructor() {
        this.listeners = [];
    }

    /**
     * Get the correct URL for a page, handling both localhost and GitHub Pages
     * @param {string} page - The page filename (e.g., 'checkout-success.html')
     * @returns {string} The full URL to the page
     */
    _getPageUrl(page) {
        const { origin, pathname } = window.location;
        
        // Check if we're on GitHub Pages (pathname contains repo name)
        if (origin.includes('github.io')) {
            const pathParts = pathname.split('/').filter(Boolean);
            if (pathParts.length > 0) {
                const repoName = pathParts[0];
                return `${origin}/${repoName}/${page}`;
            }
        }
        
        return `${origin}/${page}`;
    }

    /**
     * Create a new gift card with Stripe payment
     * Gift card is created by the webhook after successful payment
     */
    async createGiftCard(data) {
        if (!isSupabaseConfigured()) {
            return { error: 'Database non configurato' };
        }

        const { data: session } = await supabase.auth.getSession();
        if (!session?.session?.user) {
            return { error: 'Devi effettuare il login per creare una gift card' };
        }

        const {
            amount,
            recipientName,
            recipientEmail,
            senderName,
            message,
            style = 'elegant'
        } = data;

        // Validation
        const numAmount = parseFloat(amount);
        if (!numAmount || isNaN(numAmount) || numAmount < 10 || numAmount > 500) {
            return { error: 'Importo non valido (min €10, max €500)' };
        }
        if (!recipientName || !recipientEmail || !senderName) {
            return { error: 'Compila tutti i campi obbligatori' };
        }

        try {
            // Create Stripe checkout session - gift card will be created by webhook after payment
            const requestBody = {
                amount: numAmount,
                recipientName: recipientName.trim(),
                recipientEmail: recipientEmail.trim(),
                senderName: senderName.trim(),
                message: message || '',
                template: style,
                successUrl: this._getPageUrl('checkout-success.html?type=giftcard'),
                cancelUrl: this._getPageUrl('settings.html?tab=giftcards&cancelled=true')
            };
            
            console.log('[GiftCard] Creating checkout with:', requestBody);
            
            const { data: checkoutData, error: stripeError } = await supabase.functions.invoke('create-giftcard-checkout', {
                body: requestBody
            });

            if (stripeError) {
                throw stripeError;
            }

            if (checkoutData?.url) {
                // Redirect to Stripe checkout
                window.location.href = checkoutData.url;
                return { redirecting: true };
            }

            return { error: 'Impossibile creare la sessione di pagamento' };
        } catch (error) {
            console.error('Error creating gift card:', error);
            return { error: error.message };
        }
    }

    /**
     * Get gift card by QR token (for redemption page)
     */
    async getGiftCardByToken(qrToken) {
        if (!isSupabaseConfigured()) {
            return { error: 'Database non configurato' };
        }

        try {
            const { data: giftCard, error } = await supabase
                .from('gift_cards')
                .select('*')
                .eq('qr_code_token', qrToken)
                .maybeSingle();

            if (error) throw error;
            if (!giftCard) {
                return { error: 'Gift card non trovata' };
            }

            return { giftCard };
        } catch (error) {
            console.error('Error fetching gift card:', error);
            return { error: error.message };
        }
    }

    /**
     * Redeem a gift card using QR token
     */
    async redeemGiftCard(qrToken) {
        if (!isSupabaseConfigured()) {
            return { success: false, error: 'Database non configurato' };
        }

        const { data: session } = await supabase.auth.getSession();
        if (!session?.session?.user) {
            return { success: false, error: 'Devi effettuare il login per riscattare la gift card' };
        }

        try {
            const { data, error } = await supabase
                .rpc('redeem_gift_card', {
                    p_qr_token: qrToken,
                    p_user_id: session.session.user.id
                });

            if (error) throw error;

            // Normalize response
            const result = {
                success: data?.success || false,
                error: data?.error || null,
                amount_credited: data?.amount || 0,
                new_balance: data?.new_balance || 0,
                gift_card_code: data?.gift_card_code || null
            };

            if (result.success) {
                this.notifyListeners('credit_updated', result);
            }

            return result;
        } catch (error) {
            console.error('Error redeeming gift card:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Get user's credit balance
     */
    async getUserCredits() {
        if (!isSupabaseConfigured()) {
            return { balance: 0, totalEarned: 0, totalSpent: 0 };
        }

        const { data: session } = await supabase.auth.getSession();
        if (!session?.session?.user) {
            return { balance: 0, totalEarned: 0, totalSpent: 0 };
        }

        try {
            const { data, error } = await supabase
                .from('user_credits')
                .select('*')
                .eq('user_id', session.session.user.id)
                .maybeSingle();

            if (error) throw error;

            return {
                balance: parseFloat(data?.balance) || 0,
                totalEarned: parseFloat(data?.total_earned) || 0,
                totalSpent: parseFloat(data?.total_spent) || 0
            };
        } catch (error) {
            console.error('Error fetching user credits:', error);
            return { balance: 0, totalEarned: 0, totalSpent: 0 };
        }
    }

    /**
     * Get user's credit transaction history
     */
    async getCreditHistory(limit = 20) {
        if (!isSupabaseConfigured()) {
            return { transactions: [] };
        }

        const { data: session } = await supabase.auth.getSession();
        if (!session?.session?.user) {
            return { transactions: [] };
        }

        try {
            const { data, error } = await supabase
                .from('credit_transactions')
                .select('*')
                .eq('user_id', session.session.user.id)
                .order('created_at', { ascending: false })
                .limit(limit);

            if (error) throw error;

            return { transactions: data || [] };
        } catch (error) {
            console.error('Error fetching credit history:', error);
            return { transactions: [] };
        }
    }

    /**
     * Use credits for a purchase
     */
    async useCredits(amount, orderId) {
        if (!isSupabaseConfigured()) {
            return { success: false, error: 'Database non configurato' };
        }

        const { data: session } = await supabase.auth.getSession();
        if (!session?.session?.user) {
            return { success: false, error: 'Non autenticato' };
        }

        try {
            const { data, error } = await supabase
                .rpc('use_credits', {
                    p_user_id: session.session.user.id,
                    p_amount: amount,
                    p_order_id: orderId
                });

            if (error) throw error;

            if (data.success) {
                this.notifyListeners('credit_updated', data);
            }

            return data;
        } catch (error) {
            console.error('Error using credits:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Get user's purchased gift cards
     */
    async getMyGiftCards() {
        if (!isSupabaseConfigured()) {
            return { giftCards: [] };
        }

        const { data: session } = await supabase.auth.getSession();
        if (!session?.session?.user) {
            return { giftCards: [] };
        }

        try {
            const { data, error } = await supabase
                .from('gift_cards')
                .select('*')
                .eq('purchased_by', session.session.user.id)
                .order('created_at', { ascending: false });

            if (error) throw error;

            return { giftCards: data || [] };
        } catch (error) {
            console.error('Error fetching gift cards:', error);
            return { giftCards: [] };
        }
    }

    /**
     * Check if a gift card code is available (not in blacklist)
     */
    async isCodeAvailable(code) {
        if (!isSupabaseConfigured()) {
            return false;
        }

        try {
            const { data, error } = await supabase
                .rpc('is_gift_card_code_available', { p_code: code });

            if (error) throw error;
            return data || false;
        } catch (error) {
            console.error('Error checking code availability:', error);
            return false;
        }
    }

    /**
     * Generate a unique gift card code
     */
    generateCode() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let code = '';
        for (let i = 0; i < 14; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return code;
    }

    /**
     * Validate a gift card code
     */
    async validateCode(code) {
        if (!isSupabaseConfigured()) {
            return { valid: false, error: 'Sistema non configurato' };
        }

        if (!code || typeof code !== 'string' || code.length < 10) {
            return { valid: false, error: 'Codice non valido' };
        }

        try {
            const { data, error } = await supabase
                .from('gift_cards')
                .select('*')
                .eq('code', code.toUpperCase().trim().replace(/-/g, ''))
                .maybeSingle();

            // Try with dashes if not found
            if (!data) {
                const { data: data2 } = await supabase
                    .from('gift_cards')
                    .select('*')
                    .eq('code', code.toUpperCase().trim())
                    .maybeSingle();
                
                if (data2) {
                    return this._validateGiftCardData(data2);
                }
            }

            if (error || !data) {
                return { valid: false, error: 'Codice non trovato o non valido' };
            }

            return this._validateGiftCardData(data);
        } catch (err) {
            console.error('Validate code error:', err);
            return { valid: false, error: 'Errore nella verifica del codice' };
        }
    }

    /**
     * Internal helper to validate gift card data
     */
    _validateGiftCardData(data) {
        if (!data.is_active) {
            return { valid: false, error: 'Gift card non attiva' };
        }

        if (data.is_redeemed) {
            return { valid: false, error: 'Gift card già riscattata' };
        }

        if (data.remaining_balance <= 0 && data.balance <= 0) {
            return { valid: false, error: 'Gift card esaurita' };
        }

        if (data.expires_at && new Date(data.expires_at) < new Date()) {
            return { valid: false, error: 'Gift card scaduta' };
        }

        return { 
            valid: true, 
            balance: data.remaining_balance || data.balance || data.amount, 
            giftCard: data 
        };
    }

    /**
     * Generate QR code URL for a gift card
     */
    getQRCodeUrl(qrToken, size = 200) {
        const redeemUrl = this._getPageUrl(`redeem.html?token=${qrToken}`);
        // Using QR Server API (free, no API key needed)
        return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(redeemUrl)}&format=png&margin=10`;
    }

    /**
     * Add gift card to Google Wallet
     */
    async addToGoogleWallet(giftCardId) {
        if (!isSupabaseConfigured()) {
            return { success: false, error: 'Database non configurato' };
        }

        try {
            const { data, error } = await supabase.functions.invoke('add-to-wallet', {
                body: { giftCardId, walletType: 'google' }
            });

            if (error) throw error;

            if (data?.walletUrl) {
                // Open Google Wallet save link in new tab
                window.open(data.walletUrl, '_blank');
                return { success: true };
            }

            return { success: false, error: 'URL wallet non generato' };
        } catch (error) {
            console.error('Error adding to Google Wallet:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Add gift card to Apple Wallet
     * Note: Full Apple Wallet integration requires server-side pass signing
     * This provides the pass data structure for manual integration
     */
    async addToAppleWallet(giftCardId) {
        if (!isSupabaseConfigured()) {
            return { success: false, error: 'Database non configurato' };
        }

        try {
            const { data, error } = await supabase.functions.invoke('add-to-wallet', {
                body: { giftCardId, walletType: 'apple' }
            });

            if (error) throw error;

            if (data?.passData) {
                // For full Apple Wallet integration, you would need to:
                // 1. Sign the pass with Apple certificates on the server
                // 2. Return a .pkpass file
                // For now, we show a fallback with QR code
                return { 
                    success: true, 
                    passData: data.passData,
                    message: 'Scansiona il QR code con il tuo iPhone per aggiungere al Wallet'
                };
            }

            return { success: false, error: 'Dati pass non generati' };
        } catch (error) {
            console.error('Error adding to Apple Wallet:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Check if device supports wallet features
     */
    getWalletSupport() {
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
        const isAndroid = /Android/.test(navigator.userAgent);
        const isMobile = isIOS || isAndroid;

        return {
            googleWallet: true, // Google Wallet works on all platforms via web
            appleWallet: isIOS, // Apple Wallet only on iOS devices
            isMobile,
            isIOS,
            isAndroid
        };
    }

    /**
     * Subscribe to credit updates
     */
    onChange(callback) {
        this.listeners.push(callback);
        return () => {
            this.listeners = this.listeners.filter(l => l !== callback);
        };
    }

    notifyListeners(event, data) {
        this.listeners.forEach(l => l(event, data));
    }
}

// Admin functions
class GiftCardAdminService {
    /**
     * Search gift cards by name
     */
    async searchGiftCards(query, filters = {}) {
        if (!isSupabaseConfigured()) {
            return { giftCards: [], total: 0 };
        }

        try {
            let queryBuilder = supabase
                .from('gift_cards')
                .select('*', { count: 'exact' });

            // Search by name
            if (query) {
                queryBuilder = queryBuilder.or(
                    `recipient_name.ilike.%${query}%,` +
                    `purchaser_first_name.ilike.%${query}%,` +
                    `purchaser_last_name.ilike.%${query}%,` +
                    `code.ilike.%${query}%`
                );
            }

            // Filter by status
            if (filters.status === 'redeemed') {
                queryBuilder = queryBuilder.eq('is_redeemed', true);
            } else if (filters.status === 'active') {
                queryBuilder = queryBuilder.eq('is_redeemed', false).eq('is_active', true);
            } else if (filters.status === 'expired') {
                queryBuilder = queryBuilder.lt('expires_at', new Date().toISOString());
            }

            const { data, error, count } = await queryBuilder
                .order('created_at', { ascending: false })
                .limit(50);

            if (error) throw error;

            return { giftCards: data || [], total: count || 0 };
        } catch (error) {
            console.error('Error searching gift cards:', error);
            return { giftCards: [], total: 0, error: error.message };
        }
    }

    /**
     * Get gift card statistics
     */
    async getStats() {
        if (!isSupabaseConfigured()) {
            return { total: 0, totalValue: 0, redeemed: 0, active: 0 };
        }

        try {
            const { data, error } = await supabase
                .from('gift_cards')
                .select('amount, is_redeemed, is_active, remaining_balance');

            if (error) throw error;

            const stats = {
                total: data.length,
                totalValue: data.reduce((sum, gc) => sum + parseFloat(gc.amount), 0),
                redeemed: data.filter(gc => gc.is_redeemed).length,
                active: data.filter(gc => !gc.is_redeemed && gc.is_active).length,
                totalRedeemed: data.filter(gc => gc.is_redeemed).reduce((sum, gc) => sum + parseFloat(gc.amount), 0)
            };

            return stats;
        } catch (error) {
            console.error('Error fetching stats:', error);
            return { total: 0, totalValue: 0, redeemed: 0, active: 0 };
        }
    }

    /**
     * Get blacklist statistics
     */
    async getBlacklistStats() {
        if (!isSupabaseConfigured()) {
            return { total: 0, generated: 0, reserved: 0, blocked: 0 };
        }

        try {
            const { data, error } = await supabase
                .from('used_gift_card_codes')
                .select('reason');

            if (error) throw error;

            const stats = {
                total: data.length,
                generated: data.filter(c => c.reason === 'generated').length,
                reserved: data.filter(c => c.reason === 'reserved').length,
                blocked: data.filter(c => c.reason === 'admin_blocked').length
            };

            return stats;
        } catch (error) {
            console.error('Error fetching blacklist stats:', error);
            return { total: 0, generated: 0, reserved: 0, blocked: 0 };
        }
    }

    /**
     * Reserve/block a gift card code (admin only)
     */
    async reserveCode(code, reason = 'reserved') {
        if (!isSupabaseConfigured()) {
            return { success: false, error: 'Database non configurato' };
        }

        try {
            const { data, error } = await supabase
                .rpc('reserve_gift_card_code', { 
                    p_code: code,
                    p_reason: reason
                });

            if (error) throw error;

            return { success: data, code };
        } catch (error) {
            console.error('Error reserving code:', error);
            return { success: false, error: error.message };
        }
    }
}

export const giftCardService = new GiftCardService();
export const giftCardAdminService = new GiftCardAdminService();
