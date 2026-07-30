import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  JwtVerificationError,
  validateClaims,
  verifyTenantAdmin,
} from '../src/jwt.js';

const supabaseUrl = 'https://project.supabase.co';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('validateClaims', () => {
  it('accetta claim Supabase autenticati', () => {
    const now = Date.parse('2026-07-29T12:00:00Z');
    expect(
      validateClaims(
        {
          aud: 'authenticated',
          role: 'authenticated',
          iss: `${supabaseUrl}/auth/v1`,
          sub: 'f9144e15-4e84-4fbf-aabd-aa57599c2d5d',
          exp: Math.floor(now / 1000) + 600,
        },
        supabaseUrl,
        now,
      ),
    ).toHaveProperty('role', 'authenticated');
  });

  it('rifiuta token scaduti o di un altro issuer', () => {
    const now = Date.parse('2026-07-29T12:00:00Z');
    expect(() =>
      validateClaims(
        {
          aud: 'authenticated',
          role: 'authenticated',
          iss: 'https://evil.example/auth/v1',
          sub: 'user',
          exp: Math.floor(now / 1000) + 600,
        },
        supabaseUrl,
        now,
      ),
    ).toThrow(JwtVerificationError);
  });
});

describe('verifyTenantAdmin', () => {
  const parsed = {
    token: 'signed-user-token',
    payload: { sub: 'f9144e15-4e84-4fbf-aabd-aa57599c2d5d' },
  };
  const tenantConfig = { public: { anonKey: 'public-anon-key' } };

  it('accetta soltanto il ruolo admin restituito con le RLS del tenant', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([{ role: 'admin' }]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      verifyTenantAdmin(parsed, tenantConfig, supabaseUrl),
    ).resolves.toBeUndefined();

    const [requestUrl, options] = fetchMock.mock.calls[0];
    expect(String(requestUrl)).toContain('/rest/v1/user_roles?');
    expect(String(requestUrl)).toContain('role=eq.admin');
    expect(options.headers.authorization).toBe('Bearer signed-user-token');
  });

  it('rifiuta un utente autenticato senza ruolo admin', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    await expect(
      verifyTenantAdmin(parsed, tenantConfig, supabaseUrl),
    ).rejects.toMatchObject({ code: 'admin_required', status: 403 });
  });
});
