import { developmentTenants } from './tenants.dev.js';

const TENANT_KEY = 'caricofacile:tenant';
const CACHE_PREFIX = 'caricofacile:tenant-config:';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TENANT = import.meta.env.VITE_DEFAULT_TENANT || 'mimmo';
const WORKER_URL = (import.meta.env.VITE_CARICOFACILE_WORKER_URL || '').replace(/\/+$/, '');

let currentConfig = null;

function safePublicUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(String(value));
    const local =
      ['localhost', '127.0.0.1'].includes(url.hostname) &&
      ['http:', 'https:'].includes(url.protocol);
    return url.protocol === 'https:' || local ? url.href.replace(/\/$/, '') : '';
  } catch {
    return '';
  }
}

function validTenantSlug(value) {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,62}$/.test(value);
}

function getRequestedTenant() {
  const params = new URLSearchParams(window.location.search);
  const queryTenant = params.get('t');

  if (validTenantSlug(queryTenant)) {
    localStorage.setItem(TENANT_KEY, queryTenant);
    return queryTenant;
  }

  const savedTenant = localStorage.getItem(TENANT_KEY);
  return validTenantSlug(savedTenant) ? savedTenant : DEFAULT_TENANT;
}

function cacheKey(slug) {
  return `${CACHE_PREFIX}${slug}`;
}

function readCachedConfig(slug, { allowStale = false } = {}) {
  try {
    const raw = localStorage.getItem(cacheKey(slug));
    if (!raw) return null;
    const cached = JSON.parse(raw);
    if (!cached?.config || !Number.isFinite(cached.savedAt)) return null;
    if (!allowStale && Date.now() - cached.savedAt > CACHE_TTL_MS) return null;
    return cached.config;
  } catch {
    return null;
  }
}

function writeCachedConfig(slug, config) {
  try {
    localStorage.setItem(cacheKey(slug), JSON.stringify({ savedAt: Date.now(), config }));
  } catch {
    // Private browsing or a full quota must not block the app.
  }
}

function normalizeConfig(slug, rawConfig) {
  const config = rawConfig?.public ? rawConfig.public : rawConfig;
  if (!config || typeof config !== 'object') return null;

  return {
    slug,
    appName: String(config.appName || 'CaricoFacile'),
    storeName: String(config.storeName || slug),
    supabaseUrl: safePublicUrl(config.supabaseUrl),
    anonKey: String(config.anonKey || ''),
    accentColor: /^#[0-9a-f]{6}$/i.test(config.accentColor || '')
      ? config.accentColor
      : '#1a7f4e',
    categories: Array.isArray(config.categories) ? config.categories.slice(0, 100) : [],
    productTypes: Array.isArray(config.productTypes)
      ? config.productTypes.slice(0, 30)
      : [],
    aiLevel: ['none', 'free', 'byok'].includes(config.aiLevel) ? config.aiLevel : 'none',
    aiDailyLimit: Number.isFinite(config.aiDailyLimit) ? config.aiDailyLimit : 100,
    adminUrl: safePublicUrl(config.adminUrl),
    siteUrl: safePublicUrl(config.siteUrl),
    storageBucket: /^[a-z0-9][a-z0-9._-]{0,62}$/.test(config.storageBucket || '')
      ? config.storageBucket
      : 'product-photos',
    locale: /^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(config.locale || '')
      ? config.locale
      : 'it-IT',
    currency: /^[A-Z]{3}$/.test(config.currency || '') ? config.currency : 'EUR',
    allowedOrigins: Array.isArray(config.allowedOrigins) ? config.allowedOrigins : [],
    productSchema: config.productSchema || {},
  };
}

async function fetchRemoteConfig(slug) {
  if (!WORKER_URL) throw new Error('worker_not_configured');

  const response = await fetch(`${WORKER_URL}/tenants/${encodeURIComponent(slug)}/config`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(6_000),
  });

  if (!response.ok) {
    throw new Error(`tenant_config_${response.status}`);
  }

  return response.json();
}

function applyTenantTheme(config) {
  document.documentElement.style.setProperty('--accent', config.accentColor);
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', config.accentColor);
  document.title = `${config.appName} · ${config.storeName}`;
}

export async function loadTenantConfig() {
  const slug = getRequestedTenant();
  const freshCache = readCachedConfig(slug);
  let rawConfig = freshCache;

  if (!rawConfig) {
    try {
      rawConfig = await fetchRemoteConfig(slug);
      writeCachedConfig(slug, rawConfig);
    } catch {
      rawConfig = readCachedConfig(slug, { allowStale: true });
    }
  }

  if (!rawConfig && import.meta.env.DEV) {
    rawConfig = developmentTenants[slug];
  }

  if (!rawConfig) {
    throw new Error('tenant_config_unavailable');
  }

  currentConfig = normalizeConfig(slug, rawConfig);
  if (!currentConfig) throw new Error('tenant_config_invalid');
  applyTenantTheme(currentConfig);
  return currentConfig;
}

export function getTenantConfig() {
  if (!currentConfig) {
    throw new Error('Tenant config has not been loaded.');
  }
  return currentConfig;
}

export function getWorkerUrl() {
  return WORKER_URL;
}

export function isLocalDemo() {
  return (
    import.meta.env.DEV &&
    currentConfig &&
    (!currentConfig.supabaseUrl || !currentConfig.anonKey)
  );
}
