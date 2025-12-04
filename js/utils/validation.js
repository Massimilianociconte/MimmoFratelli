/**
 * Input Validation Utilities
 * Avenue M. E-commerce Platform
 * 
 * Schema validation and input sanitization
 * Requirements: 13.1
 */

/**
 * Validation schemas for different input types
 */
const schemas = {
  email: {
    pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    maxLength: 254,
    message: 'Email non valida'
  },
  password: {
    minLength: 8,
    maxLength: 128,
    message: 'La password deve essere di almeno 8 caratteri'
  },
  name: {
    pattern: /^[\p{L}\s'-]+$/u,
    minLength: 1,
    maxLength: 100,
    message: 'Nome non valido'
  },
  phone: {
    pattern: /^[\d\s+()-]{6,20}$/,
    message: 'Numero di telefono non valido'
  },
  uuid: {
    pattern: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    message: 'ID non valido'
  },
  price: {
    min: 0,
    max: 999999.99,
    message: 'Prezzo non valido'
  },
  quantity: {
    min: 1,
    max: 100,
    message: 'Quantità non valida'
  },
  text: {
    maxLength: 1000,
    message: 'Testo troppo lungo'
  },
  slug: {
    pattern: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    maxLength: 100,
    message: 'Slug non valido'
  }
};

/**
 * Validate a value against a schema
 * @param {any} value - Value to validate
 * @param {string} schemaName - Name of the schema to use
 * @returns {{valid: boolean, error: string|null}}
 */
export function validate(value, schemaName) {
  const schema = schemas[schemaName];
  if (!schema) {
    return { valid: false, error: 'Schema non trovato' };
  }

  // Null/undefined check
  if (value === null || value === undefined) {
    return { valid: false, error: schema.message || 'Valore richiesto' };
  }

  // String validations
  if (typeof value === 'string') {
    // Length checks
    if (schema.minLength && value.length < schema.minLength) {
      return { valid: false, error: schema.message };
    }
    if (schema.maxLength && value.length > schema.maxLength) {
      return { valid: false, error: schema.message };
    }
    // Pattern check
    if (schema.pattern && !schema.pattern.test(value)) {
      return { valid: false, error: schema.message };
    }
  }

  // Number validations
  if (typeof value === 'number') {
    if (schema.min !== undefined && value < schema.min) {
      return { valid: false, error: schema.message };
    }
    if (schema.max !== undefined && value > schema.max) {
      return { valid: false, error: schema.message };
    }
  }

  return { valid: true, error: null };
}

/**
 * Validate multiple fields at once
 * @param {Object} data - Object with field values
 * @param {Object} fieldSchemas - Object mapping field names to schema names
 * @returns {{valid: boolean, errors: Object}}
 */
export function validateAll(data, fieldSchemas) {
  const errors = {};
  let valid = true;

  for (const [field, schemaName] of Object.entries(fieldSchemas)) {
    const result = validate(data[field], schemaName);
    if (!result.valid) {
      valid = false;
      errors[field] = result.error;
    }
  }

  return { valid, errors };
}

/**
 * Sanitize a string to prevent XSS
 * @param {string} input - Input string
 * @returns {string} Sanitized string
 */
export function sanitizeString(input) {
  if (typeof input !== 'string') return '';
  
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;')
    .trim();
}

/**
 * Sanitize an object's string values
 * @param {Object} obj - Object to sanitize
 * @returns {Object} Sanitized object
 */
export function sanitizeObject(obj) {
  if (!obj || typeof obj !== 'object') return {};
  
  const sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      sanitized[key] = sanitizeString(value);
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeObject(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

/**
 * Validate email format
 * @param {string} email - Email to validate
 * @returns {boolean}
 */
export function isValidEmail(email) {
  return validate(email, 'email').valid;
}

/**
 * Validate password strength
 * @param {string} password - Password to validate
 * @returns {{valid: boolean, error: string|null}}
 */
export function validatePassword(password) {
  if (!password || password.length < 8) {
    return { valid: false, error: 'La password deve essere di almeno 8 caratteri' };
  }
  if (password.length > 128) {
    return { valid: false, error: 'La password è troppo lunga' };
  }
  return { valid: true, error: null };
}

/**
 * Validate UUID format
 * @param {string} id - UUID to validate
 * @returns {boolean}
 */
export function isValidUUID(id) {
  return validate(id, 'uuid').valid;
}

/**
 * Validate price value
 * @param {number} price - Price to validate
 * @returns {boolean}
 */
export function isValidPrice(price) {
  return typeof price === 'number' && 
         !isNaN(price) && 
         price >= 0 && 
         price <= 999999.99;
}

/**
 * Validate quantity value
 * @param {number} quantity - Quantity to validate
 * @returns {boolean}
 */
export function isValidQuantity(quantity) {
  return Number.isInteger(quantity) && 
         quantity >= 1 && 
         quantity <= 100;
}

/**
 * Strip HTML tags from string
 * @param {string} input - Input string
 * @returns {string} String without HTML tags
 */
export function stripHtml(input) {
  if (typeof input !== 'string') return '';
  return input.replace(/<[^>]*>/g, '').trim();
}

/**
 * Normalize whitespace in string
 * @param {string} input - Input string
 * @returns {string} String with normalized whitespace
 */
export function normalizeWhitespace(input) {
  if (typeof input !== 'string') return '';
  return input.replace(/\s+/g, ' ').trim();
}

export default {
  validate,
  validateAll,
  sanitizeString,
  sanitizeObject,
  isValidEmail,
  validatePassword,
  isValidUUID,
  isValidPrice,
  isValidQuantity,
  stripHtml,
  normalizeWhitespace
};
