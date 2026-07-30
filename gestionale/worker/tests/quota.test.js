import { describe, expect, it } from 'vitest';
import { checkQuota, quotaKey } from '../src/quota.js';

class MemoryKv {
  constructor() {
    this.values = new Map();
    this.options = new Map();
  }

  async get(key) {
    return this.values.get(key) ?? null;
  }

  async put(key, value, options) {
    this.values.set(key, value);
    this.options.set(key, options);
  }
}

describe('quotaKey', () => {
  it('usa tenant e giorno UTC', () => {
    expect(quotaKey('mimmo', new Date('2026-07-29T23:59:00Z'))).toBe(
      'quota:mimmo:2026-07-29',
    );
  });
});

describe('checkQuota', () => {
  it('incrementa e applica una scadenza di due giorni', async () => {
    const kv = new MemoryKv();
    const result = await checkQuota(kv, 'mimmo', 3, new Date('2026-07-29T10:00:00Z'));

    expect(result).toEqual({ allowed: true, count: 1, remaining: 2, limit: 3 });
    expect(kv.options.get('quota:mimmo:2026-07-29')).toEqual({
      expirationTtl: 172800,
    });
  });

  it('blocca dopo il limite', async () => {
    const kv = new MemoryKv();
    const date = new Date('2026-07-29T10:00:00Z');
    await checkQuota(kv, 'mimmo', 1, date);
    expect(await checkQuota(kv, 'mimmo', 1, date)).toEqual({
      allowed: false,
      count: 1,
      remaining: 0,
      limit: 1,
    });
  });
});
