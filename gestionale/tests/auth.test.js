import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  client: null,
  authCallback: null,
  roleResult: { data: null, error: null },
}));

vi.mock('../src/config/tenant.js', () => ({
  isLocalDemo: () => false,
}));

vi.mock('../src/lib/supabase.js', () => ({
  getClient: () => state.client,
}));

import {
  getAdminSession,
  signOut,
  subscribeToAuth,
} from '../src/lib/auth.js';

function makeClient(session) {
  const roleQuery = {
    select: vi.fn(() => roleQuery),
    eq: vi.fn(() => roleQuery),
    maybeSingle: vi.fn(async () => state.roleResult),
  };

  return {
    roleQuery,
    from: vi.fn(() => roleQuery),
    auth: {
      getSession: vi.fn(async () => ({
        data: { session },
        error: null,
      })),
      signOut: vi.fn(async () => {}),
      onAuthStateChange: vi.fn((callback) => {
        state.authCallback = callback;
        return {
          data: {
            subscription: {
              unsubscribe: vi.fn(),
            },
          },
        };
      }),
    },
  };
}

describe('admin session authorization', () => {
  beforeEach(async () => {
    state.authCallback = null;
    state.roleResult = { data: null, error: null };
    state.client = makeClient(null);
    await signOut();
  });

  it('does not promote an unverified auth callback session', async () => {
    const rawSession = {
      access_token: 'unverified-token',
      user: { id: 'user-without-admin-role' },
    };
    state.client = makeClient(rawSession);
    const onChange = vi.fn();

    subscribeToAuth(onChange);
    state.authCallback('SIGNED_IN', rawSession);

    await expect(getAdminSession()).resolves.toBeNull();
    expect(state.client.roleQuery.maybeSingle).toHaveBeenCalledOnce();
    expect(state.client.auth.signOut).toHaveBeenCalledOnce();
  });

  it('accepts a session only after the admin role check', async () => {
    const adminSession = {
      access_token: 'verified-token',
      user: { id: 'admin-user' },
    };
    state.client = makeClient(adminSession);
    state.roleResult = { data: { role: 'admin' }, error: null };

    await expect(getAdminSession({ refresh: true })).resolves.toEqual(adminSession);
    expect(state.client.roleQuery.maybeSingle).toHaveBeenCalledOnce();
    expect(state.client.auth.signOut).not.toHaveBeenCalled();
  });
});
