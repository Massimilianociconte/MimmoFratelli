const SOURCES = new Set(['photo', 'voice', 'file', 'barcode', 'manual']);

const parsedDefaults = Object.freeze({
  name: '',
  description: '',
  price: null,
  sale_price: null,
  unit_type: 'weight',
  weights: [],
  num_items: 0,
  category_slug: '',
  product_type: 'altro',
  images: [],
  keywords: [],
  barcode: '',
});

function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();

  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

export function canonicalParsed(parsed = {}) {
  return {
    ...parsedDefaults,
    ...parsed,
    weights: Array.isArray(parsed.weights) ? parsed.weights : [],
    images: Array.isArray(parsed.images) ? parsed.images : [],
    keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
    unit_type: parsed.unit_type === 'piece' ? 'piece' : 'weight',
  };
}

export function newDraft(source, rawInput, parsed = {}, confidence = {}) {
  if (!SOURCES.has(source)) {
    throw new TypeError(`Unsupported draft source: ${source}`);
  }

  const now = new Date().toISOString();
  return {
    id: createId(),
    source,
    rawInput: rawInput ?? null,
    parsed: canonicalParsed(parsed),
    confidence: { ...confidence },
    status: 'draft',
    syncState: 'local',
    createdAt: now,
    updatedAt: now,
  };
}

export function validateDraft(parsed = {}) {
  const missing = [];
  const invalid = [];

  if (typeof parsed.name !== 'string' || !parsed.name.trim()) {
    missing.push('name');
  }

  if (parsed.price === null || parsed.price === undefined || parsed.price === '') {
    missing.push('price');
  } else if (!Number.isInteger(parsed.price) || parsed.price <= 0) {
    invalid.push('price');
  }

  if (
    parsed.sale_price !== null &&
    parsed.sale_price !== undefined &&
    parsed.sale_price !== ''
  ) {
    if (
      !Number.isInteger(parsed.sale_price) ||
      parsed.sale_price <= 0 ||
      (Number.isInteger(parsed.price) && parsed.sale_price >= parsed.price)
    ) {
      invalid.push('sale_price');
    }
  }

  if (parsed.unit_type && !['weight', 'piece'].includes(parsed.unit_type)) {
    invalid.push('unit_type');
  }

  return {
    ok: missing.length === 0 && invalid.length === 0,
    missing,
    invalid,
  };
}

export function lowConfidenceFields(confidence = {}, threshold = 0.7) {
  return Object.entries(confidence)
    .filter(([, value]) => Number.isFinite(value) && value < threshold)
    .map(([field]) => field);
}

export function toRemoteParsed(draft) {
  const parsed = canonicalParsed(draft.parsed);
  return {
    ...parsed,
    images: parsed.images.filter(
      (image) =>
        typeof image === 'string' &&
        !image.startsWith('data:') &&
        !image.startsWith('blob:'),
    ),
    confidence: { ...(draft.confidence || {}) },
  };
}

export function toRemoteDraft(draft, userId) {
  return {
    id: draft.id,
    created_by: userId,
    source: draft.source,
    raw_input: draft.rawInput,
    parsed: toRemoteParsed(draft),
    status: draft.status,
    created_at: draft.createdAt,
    updated_at: draft.updatedAt,
  };
}

export function fromRemoteDraft(row) {
  const { confidence = {}, ...parsed } = row.parsed || {};
  return {
    id: row.id,
    source: row.source,
    rawInput: row.raw_input ?? null,
    parsed: canonicalParsed(parsed),
    confidence,
    status: row.status,
    publishedProductId: row.published_product_id ?? null,
    syncState: 'synced',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function updateDraftFields(draft, patch) {
  return {
    ...draft,
    parsed: canonicalParsed({ ...draft.parsed, ...patch }),
    syncState: 'local',
    updatedAt: new Date().toISOString(),
  };
}
