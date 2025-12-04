/**
 * Error Handling Utilities
 * Avenue M. E-commerce Platform
 * 
 * Centralized error handling and user-friendly messages
 * Requirements: 13.2
 */

/**
 * Error codes and their user-friendly messages
 */
const errorMessages = {
  // Authentication errors
  'auth/invalid-credentials': 'Email o password non corretti',
  'auth/email-not-confirmed': 'Conferma la tua email prima di accedere',
  'auth/user-exists': 'Questa email è già registrata',
  'auth/weak-password': 'La password deve essere di almeno 8 caratteri',
  'auth/rate-limited': 'Troppi tentativi. Riprova più tardi',
  'auth/session-expired': 'Sessione scaduta. Effettua nuovamente l\'accesso',
  
  // Network errors
  'network/offline': 'Connessione assente. Verifica la tua connessione internet',
  'network/timeout': 'La richiesta ha impiegato troppo tempo. Riprova',
  'network/server-error': 'Si è verificato un errore. Riprova più tardi',
  
  // Validation errors
  'validation/invalid-email': 'Inserisci un\'email valida',
  'validation/invalid-phone': 'Inserisci un numero di telefono valido',
  'validation/required-field': 'Questo campo è obbligatorio',
  'validation/invalid-input': 'I dati inseriti non sono validi',
  
  // Cart errors
  'cart/item-not-found': 'Prodotto non trovato nel carrello',
  'cart/out-of-stock': 'Prodotto non disponibile',
  'cart/max-quantity': 'Quantità massima raggiunta',
  
  // Order errors
  'order/payment-failed': 'Pagamento non riuscito. Riprova',
  'order/not-found': 'Ordine non trovato',
  
  // Generic errors
  'unknown': 'Si è verificato un errore. Riprova più tardi'
};

/**
 * Application Error class
 */
export class AppError extends Error {
  constructor(code, originalError = null) {
    const message = errorMessages[code] || errorMessages['unknown'];
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.originalError = originalError;
    this.timestamp = new Date().toISOString();
  }
}

/**
 * Get user-friendly error message from error code
 * @param {string} code - Error code
 * @returns {string} User-friendly message
 */
export function getErrorMessage(code) {
  return errorMessages[code] || errorMessages['unknown'];
}

/**
 * Handle and transform errors into user-friendly format
 * @param {Error} error - Original error
 * @returns {{message: string, code: string}}
 */
export function handleError(error) {
  // Log error for debugging (in development)
  if (typeof window !== 'undefined' && window.AVENUE_CONFIG?.DEBUG) {
    console.error('Error:', error);
  }

  // Already an AppError
  if (error instanceof AppError) {
    return { message: error.message, code: error.code };
  }

  // Supabase errors
  if (error?.message) {
    const supabaseErrorMap = {
      'Invalid login credentials': 'auth/invalid-credentials',
      'Email not confirmed': 'auth/email-not-confirmed',
      'User already registered': 'auth/user-exists',
      'Password should be at least': 'auth/weak-password',
      'Rate limit exceeded': 'auth/rate-limited'
    };

    for (const [pattern, code] of Object.entries(supabaseErrorMap)) {
      if (error.message.includes(pattern)) {
        return { message: getErrorMessage(code), code };
      }
    }
  }

  // Network errors
  if (error?.name === 'TypeError' && error?.message?.includes('fetch')) {
    return { message: getErrorMessage('network/offline'), code: 'network/offline' };
  }

  // Timeout errors
  if (error?.name === 'AbortError') {
    return { message: getErrorMessage('network/timeout'), code: 'network/timeout' };
  }

  // Default to generic error
  return { message: getErrorMessage('unknown'), code: 'unknown' };
}

/**
 * Create a safe error response (no sensitive data)
 * @param {Error} error - Original error
 * @returns {Object} Safe error object
 */
export function createSafeError(error) {
  const { message, code } = handleError(error);
  return {
    success: false,
    error: message,
    code
  };
}

/**
 * Log error to console (sanitized)
 * @param {string} context - Where the error occurred
 * @param {Error} error - The error
 */
export function logError(context, error) {
  // Only log in development or if explicitly enabled
  if (typeof window !== 'undefined' && window.AVENUE_CONFIG?.DEBUG) {
    console.error(`[${context}]`, {
      message: error?.message || 'Unknown error',
      code: error?.code,
      timestamp: new Date().toISOString()
    });
  }
}

/**
 * Show error notification to user
 * @param {string} message - Error message to display
 */
export function showErrorNotification(message) {
  // Check if notification container exists
  let container = document.getElementById('notificationContainer');
  
  if (!container) {
    container = document.createElement('div');
    container.id = 'notificationContainer';
    container.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 10000;
      display: flex;
      flex-direction: column;
      gap: 10px;
    `;
    document.body.appendChild(container);
  }

  const notification = document.createElement('div');
  notification.className = 'error-notification';
  notification.style.cssText = `
    background: #fee;
    border: 1px solid #fcc;
    color: #c00;
    padding: 1rem 1.5rem;
    border-radius: 6px;
    box-shadow: 0 4px 15px rgba(0,0,0,0.1);
    font-size: 0.9rem;
    max-width: 350px;
    animation: slideIn 0.3s ease;
  `;
  notification.textContent = message;

  container.appendChild(notification);

  // Auto-remove after 5 seconds
  setTimeout(() => {
    notification.style.animation = 'slideOut 0.3s ease';
    setTimeout(() => notification.remove(), 300);
  }, 5000);
}

/**
 * Show success notification to user
 * @param {string} message - Success message to display
 */
export function showSuccessNotification(message) {
  let container = document.getElementById('notificationContainer');
  
  if (!container) {
    container = document.createElement('div');
    container.id = 'notificationContainer';
    container.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 10000;
      display: flex;
      flex-direction: column;
      gap: 10px;
    `;
    document.body.appendChild(container);
  }

  const notification = document.createElement('div');
  notification.className = 'success-notification';
  notification.style.cssText = `
    background: #efe;
    border: 1px solid #cfc;
    color: #060;
    padding: 1rem 1.5rem;
    border-radius: 6px;
    box-shadow: 0 4px 15px rgba(0,0,0,0.1);
    font-size: 0.9rem;
    max-width: 350px;
    animation: slideIn 0.3s ease;
  `;
  notification.textContent = message;

  container.appendChild(notification);

  setTimeout(() => {
    notification.style.animation = 'slideOut 0.3s ease';
    setTimeout(() => notification.remove(), 300);
  }, 4000);
}

// Add notification animations
if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slideOut {
      from { transform: translateX(0); opacity: 1; }
      to { transform: translateX(100%); opacity: 0; }
    }
  `;
  document.head.appendChild(style);
}

export default {
  AppError,
  getErrorMessage,
  handleError,
  createSafeError,
  logError,
  showErrorNotification,
  showSuccessNotification
};
