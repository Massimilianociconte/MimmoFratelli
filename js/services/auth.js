/**
 * Authentication Service
 * Avenue M. E-commerce Platform
 * 
 * Handles user authentication, registration, and session management
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7
 */

import { supabase, isSupabaseConfigured } from '../supabase.js';

// Rate limiting configuration
const RATE_LIMIT_KEY = 'avenue_login_attempts';
const MAX_ATTEMPTS = window.AVENUE_CONFIG?.MAX_LOGIN_ATTEMPTS || 5;
const LOCKOUT_MINUTES = window.AVENUE_CONFIG?.LOGIN_LOCKOUT_MINUTES || 15;

// Generic error message for security (Requirement 1.4)
const INVALID_CREDENTIALS_ERROR = 'Email o password non corretti';

/**
 * Authentication Service Class
 */
class AuthService {
  constructor() {
    this.currentUser = null;
    this.session = null;
    this.authStateListeners = [];
  }

  /**
   * Get the correct URL for a page
   * @param {string} page - The page filename
   * @returns {string} The full URL to the page
   */
  _getPageUrl(page) {
    // Use the official domain for production
    const baseUrl = 'https://www.mimmofratelli.com';
    
    // If running locally, use origin
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      return `${window.location.origin}/${page}`;
    }
    
    return `${baseUrl}/${page}`;
  }

  /**
   * Initialize auth service and set up listeners
   */
  async init() {
    if (!isSupabaseConfigured()) {
      console.warn('AuthService: Supabase not configured');
      return;
    }

    // Get initial session
    const { data: { session } } = await supabase.auth.getSession();
    this.session = session;
    this.currentUser = session?.user || null;

    // Listen for auth state changes
    supabase.auth.onAuthStateChange((event, session) => {
      this.session = session;
      this.currentUser = session?.user || null;
      
      // Notify listeners
      this.authStateListeners.forEach(callback => {
        callback(event, session);
      });

      // Handle specific events
      if (event === 'SIGNED_IN') {
        this._clearRateLimitData();
      }
    });
  }

  /**
   * Register a new user
   * Requirements: 1.1, 1.2
   * 
   * @param {string} email - User email
   * @param {string} password - User password
   * @param {Object} metadata - Additional user data (first_name, last_name, referralCode)
   * @returns {Promise<{user: Object|null, error: string|null, signupData: Object|null}>}
   */
  async signUp(email, password, metadata = {}) {
    if (!isSupabaseConfigured()) {
      return { user: null, error: 'Sistema non configurato', signupData: null };
    }

    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            first_name: metadata.first_name || '',
            last_name: metadata.last_name || ''
          }
        }
      });

      if (error) {
        // Return generic error for security
        return { user: null, error: this._sanitizeError(error), signupData: null };
      }

      // Create profile record
      if (data.user) {
        await this._createProfile(data.user.id, metadata);
        
        // Call handle-signup Edge Function to create referral code and first-order discount
        const signupData = await this._processSignup(data.user.id, email, metadata.referralCode);
        return { user: data.user, error: null, signupData };
      }

      return { user: data.user, error: null, signupData: null };
    } catch (err) {
      console.error('SignUp error:', err);
      return { user: null, error: 'Errore durante la registrazione', signupData: null };
    }
  }

  /**
   * Process signup by calling handle-signup Edge Function
   * Creates referral code and first-order discount
   * @private
   */
  async _processSignup(userId, email, referralCode = null) {
    try {
      // Get stored referral code from localStorage if not provided
      const storedRefCode = referralCode || localStorage.getItem('mimmo_referral_code');
      
      const response = await fetch(`${window.AVENUE_CONFIG?.SUPABASE_URL || ''}/functions/v1/handle-signup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${window.AVENUE_CONFIG?.SUPABASE_ANON_KEY || ''}`
        },
        body: JSON.stringify({
          userId,
          email,
          referralCode: storedRefCode,
          ipAddress: null // Could be obtained from a service if needed
        })
      });

      if (!response.ok) {
        console.error('Handle signup failed:', await response.text());
        return null;
      }

      const data = await response.json();
      
      // Clear stored referral code after use
      if (storedRefCode) {
        localStorage.removeItem('mimmo_referral_code');
      }
      
      return data;
    } catch (err) {
      console.error('Process signup error:', err);
      return null;
    }
  }

  /**
   * Sign in an existing user
   * Requirements: 1.3, 1.4, 1.7
   * 
   * @param {string} email - User email
   * @param {string} password - User password
   * @returns {Promise<{user: Object|null, session: Object|null, error: string|null}>}
   */
  async signIn(email, password) {
    if (!isSupabaseConfigured()) {
      return { user: null, session: null, error: 'Sistema non configurato' };
    }

    // Check rate limiting (Requirement 1.7)
    if (this._isRateLimited()) {
      const remainingMinutes = this._getRemainingLockoutMinutes();
      return { 
        user: null, 
        session: null, 
        error: `Troppi tentativi. Riprova tra ${remainingMinutes} minuti.` 
      };
    }

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (error) {
        // Record failed attempt for rate limiting
        this._recordFailedAttempt();
        
        // Return generic error message (Requirement 1.4)
        return { user: null, session: null, error: INVALID_CREDENTIALS_ERROR };
      }

      // Clear rate limit data on successful login
      this._clearRateLimitData();

      return { user: data.user, session: data.session, error: null };
    } catch (err) {
      console.error('SignIn error:', err);
      this._recordFailedAttempt();
      return { user: null, session: null, error: INVALID_CREDENTIALS_ERROR };
    }
  }

  /**
   * Sign out the current user
   * Requirement: 1.5
   * 
   * @returns {Promise<{error: string|null}>}
   */
  async signOut() {
    if (!isSupabaseConfigured()) {
      return { error: null };
    }

    try {
      const { error } = await supabase.auth.signOut();
      
      if (error) {
        return { error: 'Errore durante il logout' };
      }

      this.currentUser = null;
      this.session = null;

      return { error: null };
    } catch (err) {
      console.error('SignOut error:', err);
      return { error: 'Errore durante il logout' };
    }
  }

  /**
   * Get current session
   * @returns {Promise<Object|null>}
   */
  async getSession() {
    if (!isSupabaseConfigured()) {
      return null;
    }

    const { data: { session } } = await supabase.auth.getSession();
    this.session = session;
    return session;
  }

  /**
   * Get current user
   * @returns {Promise<Object|null>}
   */
  async getUser() {
    if (!isSupabaseConfigured()) {
      return null;
    }

    const { data: { user } } = await supabase.auth.getUser();
    this.currentUser = user;
    return user;
  }

  /**
   * Check if user is authenticated
   * @returns {Promise<boolean>}
   */
  async isAuthenticated() {
    const session = await this.getSession();
    return session !== null;
  }

  /**
   * Subscribe to auth state changes
   * @param {Function} callback - Callback function (event, session) => void
   * @returns {Function} Unsubscribe function
   */
  onAuthStateChange(callback) {
    this.authStateListeners.push(callback);
    
    // Return unsubscribe function
    return () => {
      const index = this.authStateListeners.indexOf(callback);
      if (index > -1) {
        this.authStateListeners.splice(index, 1);
      }
    };
  }

  /**
   * Request password reset
   * @param {string} email - User email
   * @returns {Promise<{error: string|null}>}
   */
  async resetPassword(email) {
    if (!isSupabaseConfigured()) {
      return { error: 'Sistema non configurato' };
    }

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: this._getPageUrl('reset-password.html')
      });

      if (error) {
        // Don't reveal if email exists or not
        return { error: null };
      }

      return { error: null };
    } catch (err) {
      console.error('Reset password error:', err);
      return { error: null }; // Don't reveal errors
    }
  }

  /**
   * Update user profile metadata
   * @param {Object} data - Profile data to update
   * @returns {Promise<{error: string|null}>}
   */
  async updateProfile(data) {
    if (!isSupabaseConfigured()) {
      return { error: 'Sistema non configurato' };
    }

    try {
      // Update auth user metadata
      const { data: { user }, error } = await supabase.auth.updateUser({
        data: data
      });

      if (error) {
        return { error: 'Errore durante l\'aggiornamento del profilo' };
      }

      // Also sync to profiles table for data consistency
      if (user) {
        await this._syncProfileTable(user.id, data);
      }

      return { error: null, user };
    } catch (err) {
      console.error('Update profile error:', err);
      return { error: 'Errore durante l\'aggiornamento del profilo' };
    }
  }

  /**
   * Get user profile from profiles table
   * @returns {Promise<{profile: Object|null, error: string|null}>}
   */
  async getProfile() {
    if (!isSupabaseConfigured()) {
      return { profile: null, error: 'Sistema non configurato' };
    }

    try {
      const user = await this.getUser();
      if (!user) {
        return { profile: null, error: 'Utente non autenticato' };
      }

      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      if (error && error.code !== 'PGRST116') {
        return { profile: null, error: 'Errore nel recupero del profilo' };
      }

      return { profile: data, error: null };
    } catch (err) {
      console.error('Get profile error:', err);
      return { profile: null, error: 'Errore nel recupero del profilo' };
    }
  }

  /**
   * Sync profile data to profiles table
   * @private
   */
  async _syncProfileTable(userId, data) {
    try {
      // Map data fields to profile columns
      const profileData = {};
      
      if (data.first_name !== undefined) profileData.first_name = data.first_name;
      if (data.last_name !== undefined) profileData.last_name = data.last_name;
      if (data.phone !== undefined) profileData.phone = data.phone;
      if (data.address !== undefined) profileData.address = data.address;
      if (data.city !== undefined) profileData.city = data.city;
      if (data.zip !== undefined) profileData.zip = data.zip;
      if (data.province !== undefined) profileData.province = data.province;
      if (data.newsletter !== undefined) profileData.newsletter = data.newsletter;
      if (data.order_notifications !== undefined) profileData.order_notifications = data.order_notifications;
      if (data.seasonal_notifications !== undefined) profileData.seasonal_notifications = data.seasonal_notifications;

      if (Object.keys(profileData).length === 0) return;

      // First check if profile exists
      const { data: existingProfile } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', userId)
        .single();

      if (existingProfile) {
        // Update existing profile
        const { error } = await supabase
          .from('profiles')
          .update({
            ...profileData,
            updated_at: new Date().toISOString()
          })
          .eq('id', userId);

        if (error) {
          console.error('Error updating profile:', error);
        }
      } else {
        // Insert new profile
        const { error } = await supabase
          .from('profiles')
          .insert({
            id: userId,
            ...profileData,
            updated_at: new Date().toISOString()
          });

        if (error) {
          console.error('Error inserting profile:', error);
        }
      }
    } catch (err) {
      console.error('Sync profile error:', err);
    }
  }

  /**
   * Update user password
   * @param {string} newPassword - New password
   * @returns {Promise<{error: string|null}>}
   */
  async updatePassword(newPassword) {
    if (!isSupabaseConfigured()) {
      return { error: 'Sistema non configurato' };
    }

    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword
      });

      if (error) {
        return { error: 'Errore durante l\'aggiornamento della password' };
      }

      return { error: null };
    } catch (err) {
      console.error('Update password error:', err);
      return { error: 'Errore durante l\'aggiornamento della password' };
    }
  }

  /**
   * Delete user account
   * Calls Edge Function to delete all user data and auth account
   * @returns {Promise<{error: string|null}>}
   */
  async deleteAccount() {
    if (!isSupabaseConfigured()) {
      return { error: 'Sistema non configurato' };
    }

    try {
      const session = await this.getSession();
      if (!session) {
        return { error: 'Utente non autenticato' };
      }

      // Call the delete-account Edge Function
      const response = await fetch(`${window.AVENUE_CONFIG?.SUPABASE_URL || ''}/functions/v1/delete-account`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json'
        }
      });

      const data = await response.json();

      if (!response.ok) {
        return { error: data.error || 'Errore durante l\'eliminazione dell\'account' };
      }

      // Clear local state
      this.currentUser = null;
      this.session = null;
      this._clearRateLimitData();

      // Sign out locally
      await supabase.auth.signOut();

      return { error: null };
    } catch (err) {
      console.error('Delete account error:', err);
      return { error: 'Errore durante l\'eliminazione dell\'account' };
    }
  }

  // ============================================
  // Private Methods
  // ============================================

  /**
   * Create user profile in profiles table
   * @private
   */
  async _createProfile(userId, metadata) {
    try {
      await supabase.from('profiles').insert({
        id: userId,
        first_name: metadata.first_name || '',
        last_name: metadata.last_name || '',
        phone: metadata.phone || null
      });
    } catch (err) {
      console.error('Error creating profile:', err);
    }
  }

  /**
   * Sanitize error messages for security
   * @private
   */
  _sanitizeError(error) {
    // Map Supabase errors to user-friendly messages
    const errorMap = {
      'Invalid login credentials': INVALID_CREDENTIALS_ERROR,
      'Email not confirmed': 'Conferma la tua email prima di accedere',
      'User already registered': 'Questa email è già registrata'
    };

    return errorMap[error.message] || 'Si è verificato un errore';
  }

  /**
   * Check if user is rate limited
   * Requirement: 1.7
   * @private
   */
  _isRateLimited() {
    const data = this._getRateLimitData();
    if (!data) return false;

    const { attempts, lockoutUntil } = data;
    
    if (lockoutUntil && Date.now() < lockoutUntil) {
      return true;
    }

    // Clear expired lockout
    if (lockoutUntil && Date.now() >= lockoutUntil) {
      this._clearRateLimitData();
      return false;
    }

    return false;
  }

  /**
   * Record a failed login attempt
   * @private
   */
  _recordFailedAttempt() {
    let data = this._getRateLimitData() || { attempts: [], lockoutUntil: null };
    const now = Date.now();
    const windowStart = now - (LOCKOUT_MINUTES * 60 * 1000);

    // Filter attempts within the time window
    data.attempts = data.attempts.filter(time => time > windowStart);
    data.attempts.push(now);

    // Check if should lock out
    if (data.attempts.length >= MAX_ATTEMPTS) {
      data.lockoutUntil = now + (LOCKOUT_MINUTES * 60 * 1000);
    }

    localStorage.setItem(RATE_LIMIT_KEY, JSON.stringify(data));
  }

  /**
   * Get rate limit data from localStorage
   * @private
   */
  _getRateLimitData() {
    try {
      const data = localStorage.getItem(RATE_LIMIT_KEY);
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  }

  /**
   * Clear rate limit data
   * @private
   */
  _clearRateLimitData() {
    localStorage.removeItem(RATE_LIMIT_KEY);
  }

  /**
   * Get remaining lockout minutes
   * @private
   */
  _getRemainingLockoutMinutes() {
    const data = this._getRateLimitData();
    if (!data?.lockoutUntil) return 0;
    
    const remaining = Math.ceil((data.lockoutUntil - Date.now()) / 60000);
    return Math.max(0, remaining);
  }
}

// Export singleton instance
export const authService = new AuthService();
export default authService;
