import { JwtVerificationError, verifySupabaseJwt } from './jwt.js';
import { checkQuota } from './quota.js';

const MAX_REQUEST_BYTES = 6_500_000;
const MAX_PROVIDER_BYTES = 1_000_000;
const MAX_TEXT_CHARS = 20_000;
const TENANT_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

class RequestError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function log(event, fields = {}) {
  console.log(JSON.stringify({ event, ...fields }));
}

async function readJsonLimited(message, maxBytes) {
  const contentLength = Number(message.headers.get('content-length') || 0);
  if (contentLength > maxBytes) throw new RequestError('payload_too_large', 413);

  const reader = message.body?.getReader();
  if (!reader) {
    try {
      return await message.json();
    } catch {
      throw new RequestError('invalid_json');
    }
  }

  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new RequestError('payload_too_large', 413);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new RequestError('invalid_json');
  }
}

function validTenant(value) {
  return typeof value === 'string' && TENANT_PATTERN.test(value);
}

async function loadTenant(kv, slug) {
  if (!validTenant(slug)) throw new RequestError('invalid_tenant');
  const tenantConfig = await kv.get(`tenant:${slug}`, 'json');
  if (!tenantConfig) throw new RequestError('tenant_not_found', 404);
  return tenantConfig;
}

function allowedOrigins(config) {
  return Array.isArray(config.allowedOrigins)
    ? config.allowedOrigins
    : Array.isArray(config.public?.allowedOrigins)
      ? config.public.allowedOrigins
      : [];
}

function originIsAllowed(request, config) {
  const origin = request.headers.get('origin');
  return !origin || allowedOrigins(config).includes(origin);
}

function corsHeaders(request, config) {
  const origin = request.headers.get('origin');
  if (!origin || !allowedOrigins(config).includes(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
}

function jsonResponse(data, status = 200, request = null, config = null, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': status === 200 ? 'no-store' : 'no-store',
      'x-content-type-options': 'nosniff',
      ...(request && config ? corsHeaders(request, config) : {}),
      ...headers,
    },
  });
}

const publicConfigKeys = new Set([
  'slug',
  'appName',
  'storeName',
  'supabaseUrl',
  'anonKey',
  'accentColor',
  'categories',
  'productTypes',
  'aiLevel',
  'adminUrl',
  'siteUrl',
  'storageBucket',
  'locale',
  'currency',
  'productSchema',
]);

export function getPublicTenantConfig(config) {
  const source = config.public || {};
  return Object.fromEntries(
    Object.entries(source).filter(([key]) => publicConfigKeys.has(key)),
  );
}

function trimText(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function explicitPriceCents(input) {
  const text = typeof input === 'string' ? input : JSON.stringify(input ?? '');
  const prices = new Set();
  const marked =
    /(\d{1,5})(?:[.,](\d{1,2}))?\s*(?:€|euro|euros|\/\s*kg|al\s+(?:kg|chilo)|a\s+kg)/gi;
  const spoken =
    /(\d{1,4})\s+e\s+(\d{1,2})(?=\s*(?:€|euro|al\s+(?:kg|chilo)|a\s+kg|\/\s*kg|$))/gi;

  for (const match of text.matchAll(marked)) {
    prices.add(Number(match[1]) * 100 + Number((match[2] || '0').padEnd(2, '0')));
  }
  for (const match of text.matchAll(spoken)) {
    prices.add(Number(match[1]) * 100 + Number(match[2].padEnd(2, '0')));
  }
  return prices;
}

function allowedPrice(value, explicitPrices, kind) {
  if (kind === 'image' || !Number.isFinite(Number(value))) return null;
  const numeric = Number(value);
  const asCents = Number.isInteger(numeric) ? numeric : Math.round(numeric);
  if (explicitPrices.has(asCents)) return asCents;
  const interpretedAsEuros = Math.round(numeric * 100);
  return explicitPrices.has(interpretedAsEuros) ? interpretedAsEuros : null;
}

function allowedCategory(value, config) {
  const allowed = new Set(
    (config.public?.categories || []).map((category) => category.slug),
  );
  return allowed.has(value) ? value : '';
}

function allowedProductType(value, config) {
  const allowed = new Set(
    (config.public?.productTypes || []).map((type) =>
      typeof type === 'string' ? type : type.value,
    ),
  );
  return allowed.has(value) ? value : 'altro';
}

function sanitizeConfidence(raw = {}, parsed) {
  const result = {};
  for (const field of [
    'name',
    'description',
    'price',
    'sale_price',
    'unit_type',
    'weights',
    'num_items',
    'category_slug',
    'product_type',
    'barcode',
  ]) {
    const value = Number(raw[field]);
    if (Number.isFinite(value)) result[field] = Math.min(1, Math.max(0, value));
  }
  if (parsed.price === null) result.price = 0;
  return result;
}

export function sanitizeAiResult(raw, { kind, payload, tenantConfig }) {
  const source = raw?.parsed && typeof raw.parsed === 'object' ? raw.parsed : raw || {};
  const explicitPrices = explicitPriceCents(payload);
  const price = allowedPrice(source.price, explicitPrices, kind);
  const salePrice = allowedPrice(source.sale_price, explicitPrices, kind);
  const unitType = source.unit_type === 'piece' ? 'piece' : 'weight';

  const parsed = {
    name: trimText(source.name, 180),
    description: trimText(source.description, 2_000),
    price,
    sale_price:
      salePrice && price && salePrice > 0 && salePrice < price ? salePrice : null,
    unit_type: unitType,
    weights: Array.isArray(source.weights)
      ? source.weights
          .slice(0, 20)
          .map((weight) => ({
            grams: Math.max(0, Math.round(Number(weight?.grams) || 0)),
            qty: Math.max(0, Math.round(Number(weight?.qty) || 0)),
          }))
          .filter((weight) => weight.grams > 0)
      : [],
    num_items:
      unitType === 'piece' ? Math.max(0, Math.round(Number(source.num_items) || 0)) : 0,
    category_slug: allowedCategory(source.category_slug, tenantConfig),
    product_type: allowedProductType(source.product_type, tenantConfig),
    images: [],
    keywords: Array.isArray(source.keywords)
      ? source.keywords
          .slice(0, 20)
          .map((keyword) => trimText(keyword, 80))
          .filter(Boolean)
      : [],
    barcode: /^\d{8,14}$/.test(String(source.barcode || ''))
      ? String(source.barcode)
      : '',
  };

  return {
    parsed,
    confidence: sanitizeConfidence(raw?.confidence, parsed),
  };
}

function imageInput(body) {
  const raw = body.imageBase64 || body.payload?.imageBase64;
  if (typeof raw !== 'string') return null;
  const match = raw.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/s);
  const mimeType = match?.[1] || trimText(body.imageMimeType, 30) || 'image/webp';
  const data = match?.[2] || raw;
  if (!/^image\/(?:jpeg|png|webp)$/.test(mimeType)) {
    throw new RequestError('unsupported_image_type');
  }
  if (data.length > 6_300_000 || !/^[A-Za-z0-9+/=_-]+$/.test(data)) {
    throw new RequestError('invalid_image');
  }
  return { mimeType, data };
}

function payloadText(kind, payload) {
  if (kind === 'text') {
    return trimText(typeof payload === 'string' ? payload : payload?.text, MAX_TEXT_CHARS);
  }
  if (kind === 'csv-headers') {
    const headers = Array.isArray(payload) ? payload : payload?.headers;
    return JSON.stringify(Array.isArray(headers) ? headers.slice(0, 50) : []);
  }
  return 'Analizza soltanto il prodotto visibile nella fotografia.';
}

function systemPrompt(config) {
  const categories = (config.public?.categories || [])
    .map((category) => category.slug)
    .slice(0, 100);
  const productTypes = (config.public?.productTypes || [])
    .map((type) => (typeof type === 'string' ? type : type.value))
    .slice(0, 30);

  return `Sei il parser di CaricoFacile per un negozio italiano.
Restituisci solo JSON valido con la forma {"items":[{"parsed":{...},"confidence":{...}}]}.
Campi parsed ammessi: name, description, price, sale_price, unit_type, weights,
num_items, category_slug, product_type, keywords, barcode.
price e sale_price sono centesimi di euro interi. REGOLA ASSOLUTA: non inventare
mai un prezzo. Se il prezzo non è esplicitamente presente nell'input, usa null e
confidence.price=0. Per una fotografia usa sempre price=null.
unit_type è "weight" oppure "piece". weights è un array di {"grams":intero,"qty":intero}.
Categorie ammesse: ${JSON.stringify(categories)}.
Tipi prodotto ammessi: ${JSON.stringify(productTypes)}.
Il testo può descrivere più prodotti: restituisci un item per prodotto, massimo 50.
Non inserire HTML, URL di immagini, spiegazioni o campi aggiuntivi.`;
}

async function callGemini(env, tenantConfig, kind, payload, image) {
  if (!env.GEMINI_API_KEY) throw new RequestError('ai_not_configured', 503);

  const parts = [
    {
      text: `${systemPrompt(tenantConfig)}\n\nINPUT:\n${payloadText(kind, payload)}`,
    },
  ];
  if (image) {
    parts.push({
      inline_data: {
        mime_type: image.mimeType,
        data: image.data,
      },
    });
  }

  const response = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': env.GEMINI_API_KEY,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 4_096,
          responseMimeType: 'application/json',
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
      signal: AbortSignal.timeout(18_000),
    },
  );

  if (!response.ok) {
    throw new RequestError(
      response.status === 429 ? 'provider_quota_exceeded' : 'provider_error',
      response.status === 429 ? 429 : 502,
    );
  }

  const result = await readJsonLimited(response, MAX_PROVIDER_BYTES);
  const text = result?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || '')
    .join('');
  if (!text) throw new RequestError('empty_provider_response', 502);

  try {
    return JSON.parse(text.replace(/^```json\s*|\s*```$/g, ''));
  } catch {
    throw new RequestError('invalid_provider_response', 502);
  }
}

function normalizeProviderItems(providerResult) {
  if (Array.isArray(providerResult?.items)) return providerResult.items.slice(0, 50);
  if (Array.isArray(providerResult)) return providerResult.slice(0, 50);
  if (providerResult?.parsed) return [providerResult];
  return [{ parsed: providerResult, confidence: {} }];
}

async function handleConfig(request, env, slug) {
  const tenantConfig = await loadTenant(env.KV, slug);
  if (!originIsAllowed(request, tenantConfig)) {
    return jsonResponse({ error: 'origin_not_allowed' }, 403);
  }
  return jsonResponse(
    getPublicTenantConfig(tenantConfig),
    200,
    request,
    tenantConfig,
    { 'cache-control': 'public, max-age=300, stale-while-revalidate=3600' },
  );
}

async function handleOptions(request, env, url) {
  const slug = url.searchParams.get('tenant');
  const tenantConfig = await loadTenant(env.KV, slug);
  if (!originIsAllowed(request, tenantConfig)) {
    return jsonResponse({ error: 'origin_not_allowed' }, 403);
  }
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request, tenantConfig),
  });
}

async function handleAi(request, env, url, requestId) {
  const slug = url.searchParams.get('tenant');
  const tenantConfig = await loadTenant(env.KV, slug);
  if (!originIsAllowed(request, tenantConfig)) {
    return jsonResponse({ error: 'origin_not_allowed' }, 403);
  }

  try {
    const body = await readJsonLimited(request, MAX_REQUEST_BYTES);
    if (body.tenant !== slug) throw new RequestError('invalid_tenant');
    if (!['text', 'image', 'csv-headers'].includes(body.kind)) {
      throw new RequestError('invalid_kind');
    }

    const claims = await verifySupabaseJwt(request, tenantConfig);
    const quota = await checkQuota(
      env.KV,
      slug,
      tenantConfig.aiDailyLimit || tenantConfig.public?.aiDailyLimit || 100,
    );
    if (!quota.allowed) {
      return jsonResponse(
        { error: 'quota_exceeded' },
        429,
        request,
        tenantConfig,
        { 'retry-after': '86400' },
      );
    }

    const image = body.kind === 'image' ? imageInput(body) : null;
    if (body.kind === 'image' && !image) throw new RequestError('image_required');
    const providerResult = await callGemini(
      env,
      tenantConfig,
      body.kind,
      body.payload,
      image,
    );
    const items = normalizeProviderItems(providerResult).map((item) =>
      sanitizeAiResult(item, {
        kind: body.kind,
        payload: body.payload,
        tenantConfig,
      }),
    );

    log('ai_parse_ok', {
      requestId,
      tenant: slug,
      userId: claims.sub,
      kind: body.kind,
      items: items.length,
      quotaRemaining: quota.remaining,
    });

    return jsonResponse(
      {
        parsed: items[0]?.parsed || null,
        confidence: items[0]?.confidence || {},
        items,
        quota: { remaining: quota.remaining, limit: quota.limit },
      },
      200,
      request,
      tenantConfig,
    );
  } catch (error) {
    error.tenantConfig = tenantConfig;
    throw error;
  }
}

export default {
  async fetch(request, env) {
    const requestId = crypto.randomUUID();
    const url = new URL(request.url);
    const startedAt = Date.now();

    try {
      if (request.method === 'GET' && url.pathname === '/health') {
        return jsonResponse({
          ok: true,
          service: 'caricofacile-api',
          aiConfigured: Boolean(env.GEMINI_API_KEY),
        });
      }

      const configMatch = url.pathname.match(/^\/tenants\/([a-z0-9-]+)\/config$/);
      if (request.method === 'GET' && configMatch) {
        return await handleConfig(request, env, configMatch[1]);
      }

      if (request.method === 'OPTIONS' && url.pathname === '/ai/parse') {
        return await handleOptions(request, env, url);
      }

      if (request.method === 'POST' && url.pathname === '/ai/parse') {
        return await handleAi(request, env, url, requestId);
      }

      return jsonResponse({ error: 'not_found' }, 404);
    } catch (error) {
      const status =
        error instanceof RequestError || error instanceof JwtVerificationError
          ? error.status
          : error?.name === 'TimeoutError'
            ? 504
            : 500;
      const code =
        error instanceof RequestError || error instanceof JwtVerificationError
          ? error.code
          : error?.name === 'TimeoutError'
            ? 'timeout'
            : 'internal_error';
      log('request_error', {
        requestId,
        method: request.method,
        path: url.pathname,
        status,
        code,
        durationMs: Date.now() - startedAt,
      });
      return jsonResponse(
        { error: code, requestId },
        status,
        error.tenantConfig ? request : null,
        error.tenantConfig || null,
      );
    }
  },
};
