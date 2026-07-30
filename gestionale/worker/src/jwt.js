const JWKS_CACHE_MS = 10 * 60 * 1000;
const CLOCK_SKEW_SECONDS = 30;
const jwksCache = new Map();

export class JwtVerificationError extends Error {
  constructor(code, status = 401) {
    super(code);
    this.name = 'JwtVerificationError';
    this.code = code;
    this.status = status;
  }
}

function base64UrlBytes(value) {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const padding = '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(normalized + padding);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function base64UrlJson(value) {
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlBytes(value)));
  } catch {
    throw new JwtVerificationError('invalid_token');
  }
}

export function parseJwt(token) {
  if (typeof token !== 'string' || token.length > 8_192) {
    throw new JwtVerificationError('invalid_token');
  }

  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((part) => !part)) {
    throw new JwtVerificationError('invalid_token');
  }

  const header = base64UrlJson(parts[0]);
  const payload = base64UrlJson(parts[1]);
  if (!['ES256', 'RS256', 'HS256'].includes(header.alg)) {
    throw new JwtVerificationError('unsupported_token_algorithm');
  }

  return {
    token,
    header,
    payload,
    signingInput: new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    signature: base64UrlBytes(parts[2]),
  };
}

function validateSupabaseUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new JwtVerificationError('invalid_tenant_auth_config', 500);
  }

  const local =
    ['localhost', '127.0.0.1'].includes(url.hostname) &&
    ['http:', 'https:'].includes(url.protocol);
  if (url.protocol !== 'https:' && !local) {
    throw new JwtVerificationError('invalid_tenant_auth_config', 500);
  }
  return url.origin;
}

async function responseJsonLimited(response, maxBytes = 262_144) {
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > maxBytes) throw new JwtVerificationError('jwks_too_large', 502);

  const reader = response.body?.getReader();
  if (!reader) return response.json();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new JwtVerificationError('jwks_too_large', 502);
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(body));
  } catch {
    throw new JwtVerificationError('invalid_jwks', 502);
  }
}

async function fetchJwks(supabaseUrl, force = false) {
  const jwksUrl = `${supabaseUrl}/auth/v1/.well-known/jwks.json`;
  const cached = jwksCache.get(jwksUrl);
  if (!force && cached && Date.now() - cached.fetchedAt < JWKS_CACHE_MS) {
    return cached.value;
  }

  const response = await fetch(jwksUrl, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(6_000),
  });
  if (!response.ok) throw new JwtVerificationError('jwks_unavailable', 502);
  const value = await responseJsonLimited(response);
  if (!Array.isArray(value?.keys)) {
    throw new JwtVerificationError('invalid_jwks', 502);
  }
  jwksCache.set(jwksUrl, { value, fetchedAt: Date.now() });
  return value;
}

async function importVerificationKey(jwk, alg) {
  if (alg === 'ES256' && jwk.kty === 'EC' && jwk.crv === 'P-256') {
    return crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
  }

  if (alg === 'RS256' && jwk.kty === 'RSA') {
    return crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
  }

  throw new JwtVerificationError('unsupported_signing_key');
}

async function verifyAsymmetric(parsed, supabaseUrl) {
  if (!parsed.header.kid) throw new JwtVerificationError('token_key_missing');

  let jwks = await fetchJwks(supabaseUrl);
  let jwk = jwks.keys.find(
    (candidate) =>
      candidate.kid === parsed.header.kid && candidate.alg === parsed.header.alg,
  );

  if (!jwk) {
    jwks = await fetchJwks(supabaseUrl, true);
    jwk = jwks.keys.find(
      (candidate) =>
        candidate.kid === parsed.header.kid && candidate.alg === parsed.header.alg,
    );
  }
  if (!jwk) throw new JwtVerificationError('token_key_unknown');

  const key = await importVerificationKey(jwk, parsed.header.alg);
  const algorithm =
    parsed.header.alg === 'ES256'
      ? { name: 'ECDSA', hash: 'SHA-256' }
      : { name: 'RSASSA-PKCS1-v1_5' };
  const verified = await crypto.subtle.verify(
    algorithm,
    key,
    parsed.signature,
    parsed.signingInput,
  );
  if (!verified) throw new JwtVerificationError('invalid_token_signature');
}

async function verifyLegacyWithAuthServer(parsed, tenantConfig, supabaseUrl) {
  const anonKey = tenantConfig.public?.anonKey || tenantConfig.anonKey;
  if (!anonKey) throw new JwtVerificationError('legacy_auth_not_configured', 500);

  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      accept: 'application/json',
      apikey: anonKey,
      authorization: `Bearer ${parsed.token}`,
    },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new JwtVerificationError('invalid_token');
}

export async function verifyTenantAdmin(parsed, tenantConfig, supabaseUrl) {
  const anonKey = tenantConfig.public?.anonKey || tenantConfig.anonKey;
  if (!anonKey) throw new JwtVerificationError('admin_check_not_configured', 500);

  const endpoint = new URL(`${supabaseUrl}/rest/v1/user_roles`);
  endpoint.searchParams.set('select', 'role');
  endpoint.searchParams.set('user_id', `eq.${parsed.payload.sub}`);
  endpoint.searchParams.set('role', 'eq.admin');
  endpoint.searchParams.set('limit', '1');

  const response = await fetch(endpoint, {
    headers: {
      accept: 'application/json',
      apikey: anonKey,
      authorization: `Bearer ${parsed.token}`,
    },
    signal: AbortSignal.timeout(8_000),
  });

  if (response.status === 401) throw new JwtVerificationError('invalid_token');
  if (!response.ok) {
    throw new JwtVerificationError('admin_check_unavailable', 502);
  }

  const rows = await responseJsonLimited(response);
  if (!Array.isArray(rows) || rows[0]?.role !== 'admin') {
    throw new JwtVerificationError('admin_required', 403);
  }
}

export function validateClaims(payload, supabaseUrl, now = Date.now()) {
  const nowSeconds = Math.floor(now / 1000);
  const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audience.includes('authenticated') || payload.role !== 'authenticated') {
    throw new JwtVerificationError('invalid_token_audience');
  }
  if (!Number.isFinite(payload.exp) || payload.exp < nowSeconds - CLOCK_SKEW_SECONDS) {
    throw new JwtVerificationError('token_expired');
  }
  if (Number.isFinite(payload.nbf) && payload.nbf > nowSeconds + CLOCK_SKEW_SECONDS) {
    throw new JwtVerificationError('token_not_active');
  }
  if (payload.iss !== `${supabaseUrl}/auth/v1`) {
    throw new JwtVerificationError('invalid_token_issuer');
  }
  if (typeof payload.sub !== 'string' || !payload.sub) {
    throw new JwtVerificationError('invalid_token_subject');
  }
  return payload;
}

export async function verifySupabaseJwt(request, tenantConfig) {
  const authorization = request.headers.get('authorization') || '';
  if (!authorization.startsWith('Bearer ')) {
    throw new JwtVerificationError('missing_token');
  }

  const parsed = parseJwt(authorization.slice(7));
  const supabaseUrl = validateSupabaseUrl(
    tenantConfig.supabaseUrl || tenantConfig.public?.supabaseUrl,
  );

  if (parsed.header.alg === 'HS256') {
    await verifyLegacyWithAuthServer(parsed, tenantConfig, supabaseUrl);
  } else {
    await verifyAsymmetric(parsed, supabaseUrl);
  }

  const claims = validateClaims(parsed.payload, supabaseUrl);
  await verifyTenantAdmin(parsed, tenantConfig, supabaseUrl);
  return claims;
}

export function clearJwksCacheForTests() {
  jwksCache.clear();
}
