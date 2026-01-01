/**
 * CORS Configuration
 * Mimmo Fratelli E-commerce Platform
 * 
 * Shared CORS headers for all Edge Functions
 */

// Allowed origins for CORS
const ALLOWED_ORIGINS = [
  // Local development
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:5500',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5500',
  // Production - all variants of mimmofratelli.com
  'http://mimmofratelli.com',
  'https://mimmofratelli.com',
  'http://www.mimmofratelli.com',
  'https://www.mimmofratelli.com'
];

/**
 * Check if origin is from mimmofratelli.com domain
 */
function isAllowedOrigin(origin: string): boolean {
  if (!origin) return false;
  
  // Check exact match first
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  
  // Check if it's a mimmofratelli.com domain (any protocol/subdomain)
  try {
    const url = new URL(origin);
    const hostname = url.hostname.toLowerCase();
    if (hostname === 'mimmofratelli.com' || hostname.endsWith('.mimmofratelli.com')) {
      return true;
    }
  } catch {
    // Invalid URL, not allowed
  }
  
  return false;
}

/**
 * Get CORS headers based on request origin
 */
export function getCorsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('origin') || '';
  
  // Check if origin is allowed - if so, echo it back; otherwise use default
  const allowedOrigin = isAllowedOrigin(origin) ? origin : 'https://www.mimmofratelli.com';
  
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Max-Age': '86400',
  };
}

/**
 * Security headers for all responses
 */
export const securityHeaders: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' https://js.stripe.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' https://*.supabase.co https://api.stripe.com;",
};

/**
 * Handle CORS preflight request
 */
export function handleCorsPreflightRequest(request: Request): Response {
  return new Response('ok', {
    headers: getCorsHeaders(request),
  });
}

/**
 * Create response with CORS and security headers
 */
export function createResponse(
  body: unknown,
  request: Request,
  status: number = 200
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...getCorsHeaders(request),
      ...securityHeaders,
    },
  });
}

/**
 * Create error response
 */
export function createErrorResponse(
  error: string,
  request: Request,
  status: number = 400
): Response {
  return createResponse({ error }, request, status);
}
