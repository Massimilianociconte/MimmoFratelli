/**
 * Audit Logging Utility
 * Avenue M. E-commerce Platform
 * 
 * Centralized audit logging for sensitive operations
 */

import { supabase, isSupabaseConfigured, getCurrentUser } from '../supabase.js';

const SENSITIVE_ACTIONS = [
  'login',
  'logout',
  'password_change',
  'email_change',
  'order_created',
  'order_cancelled',
  'payment_processed',
  'payment_failed',
  'giftcard_created',
  'giftcard_redeemed',
  'admin_access',
  'product_created',
  'product_updated',
  'product_deleted',
  'promotion_created',
  'promotion_updated',
  'user_role_changed'
];

class AuditLogger {
  /**
   * Log an audit entry
   */
  async log(action, details = {}) {
    if (!isSupabaseConfigured()) {
      console.warn('Audit: Supabase not configured');
      return { success: false };
    }

    try {
      const user = await getCurrentUser();
      const sanitizedDetails = this._sanitizeDetails(details);

      const { error } = await supabase
        .from('audit_log')
        .insert({
          user_id: user?.id || null,
          action: action,
          details: sanitizedDetails,
          ip_address: null, // Set by server
          user_agent: navigator.userAgent?.substring(0, 255) || null
        });

      if (error) {
        console.error('Audit log error:', error);
        return { success: false, error: error.message };
      }

      return { success: true };
    } catch (err) {
      console.error('Audit log error:', err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Log authentication events
   */
  async logAuth(action, success, details = {}) {
    return this.log(`auth_${action}`, {
      success,
      ...details,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Log order events
   */
  async logOrder(action, orderId, details = {}) {
    return this.log(`order_${action}`, {
      orderId,
      ...details
    });
  }

  /**
   * Log payment events
   */
  async logPayment(action, paymentId, details = {}) {
    return this.log(`payment_${action}`, {
      paymentId,
      ...this._sanitizePaymentDetails(details)
    });
  }

  /**
   * Log admin actions
   */
  async logAdmin(action, targetType, targetId, details = {}) {
    return this.log(`admin_${action}`, {
      targetType,
      targetId,
      ...details
    });
  }

  /**
   * Sanitize details to remove sensitive information
   */
  _sanitizeDetails(details) {
    const sanitized = { ...details };
    
    // Remove sensitive fields
    const sensitiveFields = [
      'password',
      'token',
      'secret',
      'apiKey',
      'cardNumber',
      'cvv',
      'cvc',
      'pin',
      'ssn',
      'creditCard'
    ];

    const sanitize = (obj) => {
      if (typeof obj !== 'object' || obj === null) return obj;
      
      const result = Array.isArray(obj) ? [] : {};
      
      for (const [key, value] of Object.entries(obj)) {
        const lowerKey = key.toLowerCase();
        if (sensitiveFields.some(f => lowerKey.includes(f.toLowerCase()))) {
          result[key] = '[REDACTED]';
        } else if (typeof value === 'object') {
          result[key] = sanitize(value);
        } else {
          result[key] = value;
        }
      }
      
      return result;
    };

    return sanitize(sanitized);
  }

  /**
   * Sanitize payment details specifically
   */
  _sanitizePaymentDetails(details) {
    const sanitized = { ...details };
    
    // Mask card numbers
    if (sanitized.last4) {
      sanitized.cardMask = `****${sanitized.last4}`;
      delete sanitized.last4;
    }
    
    // Remove any full card data
    delete sanitized.cardNumber;
    delete sanitized.cvv;
    delete sanitized.cvc;
    delete sanitized.expiry;
    
    return sanitized;
  }

  /**
   * Check if action is sensitive
   */
  isSensitiveAction(action) {
    return SENSITIVE_ACTIONS.some(a => action.toLowerCase().includes(a.toLowerCase()));
  }
}

export const auditLogger = new AuditLogger();
export default auditLogger;
