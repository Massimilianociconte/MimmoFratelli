/**
 * User Presence Service
 * Avenue M. E-commerce Platform
 * 
 * Tracks user presence for real-time analytics
 */

import { supabase, isSupabaseConfigured } from '../supabase.js';

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
    const validSessionId =
      /^sess_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!sessionId || !validSessionId.test(sessionId)) {
      sessionId = `sess_${crypto.randomUUID()}`;
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
   * Update user presence through the database trust boundary.
   */
  async updatePresence() {
    if (!isSupabaseConfigured()) return;

    try {
      const { error } = await supabase
        .rpc('update_user_presence', {
          p_session_id: this.sessionId,
          p_page_url: window.location.pathname,
          p_user_agent: navigator.userAgent?.substring(0, 255) || null
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
