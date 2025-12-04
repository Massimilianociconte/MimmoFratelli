/**
 * User Presence Service
 * Avenue M. E-commerce Platform
 * 
 * Tracks user presence for real-time analytics
 */

import { supabase, isSupabaseConfigured, getCurrentUser } from '../supabase.js';

class PresenceService {
  constructor() {
    this.sessionId = this.getOrCreateSessionId();
    this.updateInterval = null;
    this.isTracking = false;
  }

  /**
   * Get or create a unique session ID
   */
  getOrCreateSessionId() {
    let sessionId = sessionStorage.getItem('avenue_session_id');
    if (!sessionId) {
      sessionId = 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      sessionStorage.setItem('avenue_session_id', sessionId);
    }
    return sessionId;
  }

  /**
   * Start tracking user presence
   */
  async startTracking() {
    if (this.isTracking || !isSupabaseConfigured()) return;
    
    this.isTracking = true;
    
    // Update presence immediately
    await this.updatePresence();
    
    // Then update every 60 seconds
    this.updateInterval = setInterval(() => {
      this.updatePresence();
    }, 60000);

    // Update on page visibility change
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        this.updatePresence();
      }
    });

    // Update on beforeunload
    window.addEventListener('beforeunload', () => {
      this.sendBeacon();
    });
  }

  /**
   * Stop tracking
   */
  stopTracking() {
    this.isTracking = false;
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  /**
   * Update user presence - uses direct table insert (no RPC needed)
   */
  async updatePresence() {
    if (!isSupabaseConfigured()) return;

    try {
      const user = await getCurrentUser();
      
      // Direct upsert to user_presence table (no RPC function needed)
      const { error } = await supabase
        .from('user_presence')
        .upsert({
          session_id: this.sessionId,
          user_id: user?.id || null,
          page_url: window.location.pathname,
          user_agent: navigator.userAgent?.substring(0, 255) || null,
          is_authenticated: !!user,
          last_seen: new Date().toISOString()
        }, {
          onConflict: 'session_id'
        });
      
      // Silently ignore errors - table might not exist yet
      if (error && error.code !== '42P01') {
        // Only log if it's not a "table doesn't exist" error
        console.debug('Presence update:', error.message);
      }
    } catch (err) {
      // Silently fail - presence tracking is not critical
    }
  }

  /**
   * Send beacon on page unload (for more reliable tracking)
   */
  sendBeacon() {
    if (!isSupabaseConfigured()) return;
    
    // Use sendBeacon for reliable delivery on page unload
    const data = JSON.stringify({
      session_id: this.sessionId,
      page_url: window.location.pathname,
      last_seen: new Date().toISOString()
    });
    
    // Note: This would need a dedicated endpoint to work properly
    // For now, we rely on the interval updates
  }
}

export const presenceService = new PresenceService();

// Auto-start tracking when module loads
if (typeof window !== 'undefined') {
  // Start tracking after a short delay to not block page load
  setTimeout(() => {
    presenceService.startTracking();
  }, 1000);
}

export default presenceService;
