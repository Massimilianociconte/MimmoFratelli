import { describe, expect, it } from 'vitest';
import worker, {
  getPublicTenantConfig,
  sanitizeAiResult,
} from '../src/index.js';

const tenantConfig = {
  public: {
    slug: 'mimmo',
    storeName: 'Mimmo Fratelli',
    supabaseUrl: 'https://example.supabase.co',
    anonKey: 'public-anon-key',
    categories: [{ slug: 'ortaggi', name: 'Ortaggi' }],
    productTypes: [{ value: 'verdura', label: 'Verdura' }],
    aiLevel: 'free',
  },
  allowedOrigins: ['https://app.example.com'],
  aiDailyLimit: 10,
  privateNote: 'must-not-leak',
};

describe('getPublicTenantConfig', () => {
  it('espone solo i campi pubblici in whitelist', () => {
    expect(getPublicTenantConfig(tenantConfig)).toEqual(tenantConfig.public);
    expect(getPublicTenantConfig(tenantConfig)).not.toHaveProperty('privateNote');
    expect(getPublicTenantConfig(tenantConfig)).not.toHaveProperty('allowedOrigins');
  });
});

describe('sanitizeAiResult', () => {
  it('accetta solo un prezzo esplicito e lo conserva in centesimi', () => {
    const result = sanitizeAiResult(
      {
        parsed: {
          name: 'Pomodori',
          price: 300,
          category_slug: 'ortaggi',
          product_type: 'verdura',
        },
        confidence: { name: 0.9, price: 0.8 },
      },
      {
        kind: 'text',
        payload: 'pomodori 3 euro al kg',
        tenantConfig,
      },
    );
    expect(result.parsed.price).toBe(300);
    expect(result.parsed.category_slug).toBe('ortaggi');
  });

  it('annulla un prezzo inventato e tutte le immagini restituite dal modello', () => {
    const result = sanitizeAiResult(
      {
        parsed: {
          name: 'Pomodori',
          price: 499,
          images: ['https://attacker.example/image.jpg'],
        },
        confidence: { price: 1 },
      },
      {
        kind: 'image',
        payload: {},
        tenantConfig,
      },
    );
    expect(result.parsed.price).toBeNull();
    expect(result.parsed.images).toEqual([]);
    expect(result.confidence.price).toBe(0);
  });
});

describe('worker routes', () => {
  it('restituisce la configurazione pubblica con CORS ristretto', async () => {
    const env = {
      KV: {
        async get(key, type) {
          expect(key).toBe('tenant:mimmo');
          expect(type).toBe('json');
          return tenantConfig;
        },
      },
    };
    const response = await worker.fetch(
      new Request('https://api.example.com/tenants/mimmo/config', {
        headers: { origin: 'https://app.example.com' },
      }),
      env,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe(
      'https://app.example.com',
    );
    expect(await response.json()).toEqual(tenantConfig.public);
  });

  it('rifiuta un origin non autorizzato', async () => {
    const env = {
      KV: { async get() { return tenantConfig; } },
    };
    const response = await worker.fetch(
      new Request('https://api.example.com/tenants/mimmo/config', {
        headers: { origin: 'https://evil.example.com' },
      }),
      env,
    );
    expect(response.status).toBe(403);
  });
});
