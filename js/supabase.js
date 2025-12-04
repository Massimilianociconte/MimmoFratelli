/**
 * Supabase Client Configuration
 * Avenue M. E-commerce Platform
 * 
 * This module initializes and exports the Supabase client
 * for use throughout the application.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Environment configuration
// In production, these should be set via environment variables or a config file
const SUPABASE_URL = window.AVENUE_CONFIG?.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = window.AVENUE_CONFIG?.SUPABASE_ANON_KEY || '';

// Check if Supabase is configured
const _isConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

// Validate configuration (only warn, don't throw)
if (!_isConfigured) {
  console.warn(
    'Avenue M.: Supabase configuration missing. ' +
    'Please set AVENUE_CONFIG.SUPABASE_URL and AVENUE_CONFIG.SUPABASE_ANON_KEY'
  );
}

// Create Supabase client with options (only if configured)
const supabaseOptions = {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    storage: window.localStorage
  }
};

// Initialize client only if configured, otherwise create a mock/null client
let supabase = null;

if (_isConfigured) {
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, supabaseOptions);
}

export { supabase };

/**
 * Check if Supabase is properly configured
 * @returns {boolean} True if configured, false otherwise
 */
export function isSupabaseConfigured() {
  return _isConfigured;
}

/**
 * Get current authenticated user
 * @returns {Promise<User|null>} Current user or null
 */
export async function getCurrentUser() {
  if (!supabase) return null;
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

/**
 * Get current session
 * @returns {Promise<Session|null>} Current session or null
 */
export async function getSession() {
  if (!supabase) return null;
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

/**
 * Check if user is authenticated
 * @returns {Promise<boolean>} True if authenticated
 */
export async function isAuthenticated() {
  if (!supabase) return false;
  const session = await getSession();
  return session !== null;
}

/**
 * Check if current user has admin role
 * @returns {Promise<boolean>} True if user is admin
 */
export async function isAdmin() {
  if (!supabase) return false;
  const user = await getCurrentUser();
  if (!user) return false;
  
  const { data, error } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .eq('role', 'admin')
    .single();
  
  return !error && data !== null;
}

export default supabase;
