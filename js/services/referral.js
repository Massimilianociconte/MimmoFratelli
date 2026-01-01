/**
 * Referral Service
 * Mimmo Fratelli E-commerce Platform
 * 
 * Handles referral code generation, storage, sharing, and statistics
 * Requirements: 2.1, 2.2, 2.3, 2.4, 3.1, 4.4
 */

import { supabase, isSupabaseConfigured } from '../supabase.js';

// Constants
const REFERRAL_STORAGE_KEY = 'mimmo_referral_code';
const VALID_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const REFERRAL_MINIMUM_ORDER = 35; // €35 minimum for referral bonus
const REFERRAL_BONUS_AMOUNT = 5; // €5 bonus for referrer

/**
 * Referral Service Class
 */
class ReferralService {
  constructor() {
    this.listeners = [];
  }

  // ============================================
  // Code Generation
  // ============================================

  /**
   * Generate a random 8-character referral code
   * Uses characters that are not easily confused (no 0, O, I, 1, L)
   * @returns {string} 8-character alphanumeric code
   */
  generateReferralCode() {
    let code = '';
    for (let i = 0; i < 8; i++) {
      code += VALID_CHARS.charAt(Math.floor(Math.random() * VALID_CHARS.length));
    }
    return code;
  }

  /**
   * Generate a first-order promo code with BENVENUTO prefix
   * @returns {string} 15-character code (BENVENUTO + 6 chars)
   */
  generateFirstOrderCode() {
    let suffix = '';
    for (let i = 0; i < 6; i++) {
      suffix += VALID_CHARS.charAt(Math.floor(Math.random() * VALID_CHARS.length));
    }
    return 'BENVENUTO' + suffix;
  }

  // ============================================
  // Referral Code Management
  // ============================================

  /**
   * Get current user's referral code and stats
   * If no code exists, creates one automatically
   * Requirements: 2.1, 2.2
   * @returns {Promise<{code: string, stats: Object} | null>}
   */
  async getMyReferralCode() {
    if (!isSupabaseConfigured()) {
      return { error: 'Sistema non configurato' };
    }

    const { data: session } = await supabase.auth.getSession();
    if (!session?.session?.user) {
      return { error: 'Non autenticato' };
    }

    const userId = session.session.user.id;

    try {
      let { data, error } = await supabase
        .from('user_referral_codes')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (error) throw error;

      // If no code exists, create one
      if (!data) {
        const newCode = await this._createReferralCodeForUser(userId);
        if (newCode) {
          data = newCode;
        } else {
          return { code: null, stats: null };
        }
      }

      return {
        code: data.code,
        stats: {
          totalReferrals: data.total_referrals || 0,
          totalConversions: data.total_conversions || 0,
          totalEarned: parseFloat(data.total_earned) || 0,
          isActive: data.is_active
        }
      };
    } catch (err) {
      console.error('Error fetching referral code:', err);
      return { error: err.message };
    }
  }

  /**
   * Create a referral code for a user if they don't have one
   * @private
   */
  async _createReferralCodeForUser(userId) {
    try {
      // Generate unique code
      let code = this.generateReferralCode();
      let attempts = 0;
      
      while (attempts < 10) {
        const { data: existing } = await supabase
          .from('user_referral_codes')
          .select('code')
          .eq('code', code)
          .maybeSingle();
        
        if (!existing) break;
        code = this.generateReferralCode();
        attempts++;
      }

      // Insert new code
      const { data, error } = await supabase
        .from('user_referral_codes')
        .insert({
          user_id: userId,
          code: code,
          is_active: true,
          total_referrals: 0,
          total_conversions: 0,
          total_earned: 0
        })
        .select()
        .single();

      if (error) {
        console.error('Error creating referral code:', error);
        return null;
      }

      return data;
    } catch (err) {
      console.error('Error in _createReferralCodeForUser:', err);
      return null;
    }
  }

  /**
   * Get referral code owner by code
   * @param {string} code - Referral code
   * @returns {Promise<{userId: string} | null>}
   */
  async getReferralCodeOwner(code) {
    if (!isSupabaseConfigured() || !code) {
      return null;
    }

    try {
      const { data, error } = await supabase
        .from('user_referral_codes')
        .select('user_id')
        .eq('code', code.toUpperCase().trim())
        .eq('is_active', true)
        .maybeSingle();

      if (error || !data) return null;
      return { userId: data.user_id };
    } catch (err) {
      console.error('Error fetching code owner:', err);
      return null;
    }
  }

  // ============================================
  // URL Capture and localStorage
  // ============================================

  /**
   * Capture referral code from URL and store in localStorage
   * Requirements: 3.1
   * @param {string} url - Current page URL (optional, defaults to window.location)
   * @returns {boolean} True if code was captured
   */
  captureReferralFromUrl(url = null) {
    try {
      const urlString = url || window.location.href;
      const urlParams = new URLSearchParams(urlString.split('?')[1] || '');
      const refCode = urlParams.get('ref');

      if (refCode && refCode.length === 8 && this._isValidCode(refCode)) {
        localStorage.setItem(REFERRAL_STORAGE_KEY, refCode.toUpperCase());
        return true;
      }
      return false;
    } catch (err) {
      console.error('Error capturing referral:', err);
      return false;
    }
  }

  /**
   * Get stored referral code from localStorage
   * @returns {string | null}
   */
  getStoredReferralCode() {
    try {
      return localStorage.getItem(REFERRAL_STORAGE_KEY);
    } catch {
      return null;
    }
  }

  /**
   * Clear stored referral code
   */
  clearStoredReferralCode() {
    try {
      localStorage.removeItem(REFERRAL_STORAGE_KEY);
    } catch {
      // Ignore errors
    }
  }

  /**
   * Validate referral code format
   * @private
   */
  _isValidCode(code) {
    if (!code || typeof code !== 'string') return false;
    const validPattern = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/;
    return validPattern.test(code.toUpperCase());
  }

  // ============================================
  // Share Link Generation
  // ============================================

  /**
   * Generate share link with referral code
   * Requirements: 2.4
   * @param {string} code - Referral code
   * @param {string} baseUrl - Base URL (optional)
   * @returns {string} Full share URL
   */
  generateShareLink(code, baseUrl = null) {
    // Use the official domain for production
    const officialDomain = 'https://www.mimmofratelli.com';
    
    // If running locally, use origin; otherwise use official domain
    let base = baseUrl;
    if (!base) {
      if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        base = window.location.origin;
      } else {
        base = officialDomain;
      }
    }
    return `${base}?ref=${code}`;
  }

  /**
   * Get share link for current user
   * @returns {Promise<string | null>}
   */
  async getMyShareLink() {
    const result = await this.getMyReferralCode();
    if (result.error || !result.code) return null;
    return this.generateShareLink(result.code);
  }

  // ============================================
  // Share Actions
  // ============================================

  /**
   * Share via WhatsApp
   * Requirements: 2.3
   * @param {string} code - Referral code
   */
  shareViaWhatsApp(code) {
    const link = this.generateShareLink(code);
    const message = encodeURIComponent(
      `🍎 Ti invito a provare Mimmo Fratelli! Usa il mio link per ottenere il 15% di sconto sul tuo primo ordine: ${link}`
    );
    window.open(`https://wa.me/?text=${message}`, '_blank');
  }

  /**
   * Share via Email
   * Requirements: 2.3
   * @param {string} code - Referral code
   */
  shareViaEmail(code) {
    const link = this.generateShareLink(code);
    const subject = encodeURIComponent('Ti regalo uno sconto su Mimmo Fratelli!');
    const body = encodeURIComponent(
      `Ciao!\n\nTi invito a provare Mimmo Fratelli, il mio negozio preferito per frutta e verdura fresca.\n\n` +
      `Usa questo link per ottenere il 15% di sconto sul tuo primo ordine:\n${link}\n\n` +
      `Buona spesa! 🥬🍎`
    );
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  }

  /**
   * Copy link to clipboard
   * Requirements: 2.3
   * @param {string} code - Referral code
   * @returns {Promise<boolean>} Success status
   */
  async copyToClipboard(code) {
    const link = this.generateShareLink(code);
    try {
      await navigator.clipboard.writeText(link);
      return true;
    } catch (err) {
      // Fallback for older browsers
      try {
        const textArea = document.createElement('textarea');
        textArea.value = link;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        return true;
      } catch {
        console.error('Copy to clipboard failed:', err);
        return false;
      }
    }
  }

  // ============================================
  // Statistics
  // ============================================

  /**
   * Get detailed referral statistics
   * Requirements: 4.4
   * @returns {Promise<Object>}
   */
  async getReferralStats() {
    if (!isSupabaseConfigured()) {
      return { error: 'Sistema non configurato' };
    }

    const { data: session } = await supabase.auth.getSession();
    if (!session?.session?.user) {
      return { error: 'Non autenticato' };
    }

    try {
      // Get referral code stats
      const { data: codeData } = await supabase
        .from('user_referral_codes')
        .select('*')
        .eq('user_id', session.session.user.id)
        .maybeSingle();

      // Get pending referrals count
      const { count: pendingCount } = await supabase
        .from('referrals')
        .select('*', { count: 'exact', head: true })
        .eq('referrer_id', session.session.user.id)
        .eq('status', 'pending');

      return {
        totalInvites: codeData?.total_referrals || 0,
        conversions: codeData?.total_conversions || 0,
        pendingRewards: pendingCount || 0,
        totalEarned: parseFloat(codeData?.total_earned) || 0,
        isActive: codeData?.is_active ?? true
      };
    } catch (err) {
      console.error('Error fetching referral stats:', err);
      return { error: err.message };
    }
  }

  /**
   * Get referral history (list of referees)
   * Requirements: 4.4
   * @param {number} limit - Max results
   * @returns {Promise<Array>}
   */
  async getReferralHistory(limit = 20) {
    if (!isSupabaseConfigured()) {
      return { referrals: [], error: 'Sistema non configurato' };
    }

    const { data: session } = await supabase.auth.getSession();
    if (!session?.session?.user) {
      return { referrals: [], error: 'Non autenticato' };
    }

    try {
      const { data, error } = await supabase
        .from('referrals')
        .select(`
          id,
          status,
          reward_amount,
          reward_credited,
          created_at,
          converted_at,
          referee_id
        `)
        .eq('referrer_id', session.session.user.id)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;

      // Get referee names (from profiles)
      const refereeIds = data?.map(r => r.referee_id) || [];
      let profiles = {};
      
      if (refereeIds.length > 0) {
        const { data: profileData } = await supabase
          .from('profiles')
          .select('id, first_name')
          .in('id', refereeIds);
        
        profiles = (profileData || []).reduce((acc, p) => {
          acc[p.id] = p.first_name || 'Utente';
          return acc;
        }, {});
      }

      const referrals = (data || []).map(r => ({
        id: r.id,
        refereeName: profiles[r.referee_id] || 'Utente',
        status: r.status,
        rewardAmount: parseFloat(r.reward_amount) || 5,
        rewardCredited: r.reward_credited,
        createdAt: new Date(r.created_at),
        convertedAt: r.converted_at ? new Date(r.converted_at) : null
      }));

      return { referrals };
    } catch (err) {
      console.error('Error fetching referral history:', err);
      return { referrals: [], error: err.message };
    }
  }

  // ============================================
  // Minimum Order Check for Referral Bonus
  // ============================================

  /**
   * Check if current user was referred and has pending referral
   * @returns {Promise<{isReferred: boolean, referrerId?: string}>}
   */
  async checkIfUserWasReferred() {
    if (!isSupabaseConfigured()) {
      return { isReferred: false };
    }

    const { data: session } = await supabase.auth.getSession();
    if (!session?.session?.user) {
      return { isReferred: false };
    }

    try {
      const { data, error } = await supabase
        .from('referrals')
        .select('referrer_id, status')
        .eq('referee_id', session.session.user.id)
        .eq('status', 'pending')
        .maybeSingle();

      if (error || !data) {
        return { isReferred: false };
      }

      return { 
        isReferred: true, 
        referrerId: data.referrer_id 
      };
    } catch (err) {
      console.error('Error checking referral status:', err);
      return { isReferred: false };
    }
  }

  /**
   * Get referral bonus eligibility info for cart/checkout
   * Returns info about minimum order requirement for €5 bonus
   * @param {number} cartSubtotal - Current cart subtotal (excluding shipping)
   * @returns {Promise<Object>} Eligibility info
   */
  async getReferralBonusEligibility(cartSubtotal) {
    const result = await this.checkIfUserWasReferred();
    
    if (!result.isReferred) {
      return {
        hasReferral: false,
        isEligible: false,
        minimumOrder: REFERRAL_MINIMUM_ORDER,
        bonusAmount: REFERRAL_BONUS_AMOUNT,
        currentSubtotal: cartSubtotal,
        amountNeeded: 0,
        message: null
      };
    }

    const amountNeeded = Math.max(0, REFERRAL_MINIMUM_ORDER - cartSubtotal);
    const isEligible = cartSubtotal >= REFERRAL_MINIMUM_ORDER;

    return {
      hasReferral: true,
      isEligible,
      minimumOrder: REFERRAL_MINIMUM_ORDER,
      bonusAmount: REFERRAL_BONUS_AMOUNT,
      currentSubtotal: cartSubtotal,
      amountNeeded: Math.round(amountNeeded * 100) / 100,
      message: isEligible 
        ? `✓ Chi ti ha invitato riceverà €${REFERRAL_BONUS_AMOUNT} di credito!`
        : `Aggiungi €${amountNeeded.toFixed(2)} per far guadagnare €${REFERRAL_BONUS_AMOUNT} a chi ti ha invitato!`
    };
  }

  /**
   * Get minimum order amount for referral bonus
   * @returns {number}
   */
  getMinimumOrderAmount() {
    return REFERRAL_MINIMUM_ORDER;
  }

  /**
   * Get referral bonus amount
   * @returns {number}
   */
  getBonusAmount() {
    return REFERRAL_BONUS_AMOUNT;
  }

  // ============================================
  // Event Listeners
  // ============================================

  /**
   * Subscribe to referral updates
   * @param {Function} callback
   * @returns {Function} Unsubscribe function
   */
  onChange(callback) {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(l => l !== callback);
    };
  }

  /**
   * Notify listeners of changes
   * @private
   */
  _notifyListeners(event, data) {
    this.listeners.forEach(l => l(event, data));
  }
}

// Export singleton instance
export const referralService = new ReferralService();
export default referralService;
