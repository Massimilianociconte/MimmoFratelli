import { isLocalDemo } from '../config/tenant.js';
import { getClient } from './supabase.js';

const DEMO_SESSION_KEY = 'caricofacile:demo-session';
let cachedSession = null;
let authSubscription = null;

async function userIsAdmin(client, userId) {
  const { data, error } = await client
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .eq('role', 'admin')
    .maybeSingle();

  if (error) throw error;
  return data?.role === 'admin';
}

function demoSession() {
  return {
    access_token: 'local-demo-token',
    user: {
      id: '00000000-0000-0000-0000-000000000000',
      email: 'anteprima@caricofacile.local',
    },
    isDemo: true,
  };
}

export async function getAdminSession({ refresh = false } = {}) {
  if (!refresh && cachedSession) return cachedSession;

  if (isLocalDemo()) {
    cachedSession =
      sessionStorage.getItem(DEMO_SESSION_KEY) === 'active' ? demoSession() : null;
    return cachedSession;
  }

  const client = getClient();
  const {
    data: { session },
    error,
  } = await client.auth.getSession();

  if (error || !session) {
    cachedSession = null;
    return null;
  }

  if (!(await userIsAdmin(client, session.user.id))) {
    await client.auth.signOut();
    cachedSession = null;
    return null;
  }

  cachedSession = session;
  return session;
}

export async function signInAdmin(email, password) {
  if (isLocalDemo()) {
    sessionStorage.setItem(DEMO_SESSION_KEY, 'active');
    cachedSession = demoSession();
    return cachedSession;
  }

  const client = getClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;

  const isAdmin = await userIsAdmin(client, data.user.id);
  if (!isAdmin) {
    await client.auth.signOut();
    throw new Error('not_admin');
  }

  cachedSession = data.session;
  return data.session;
}

export async function signOut() {
  if (isLocalDemo()) {
    sessionStorage.removeItem(DEMO_SESSION_KEY);
  } else {
    await getClient().auth.signOut();
  }
  cachedSession = null;
}

export function subscribeToAuth(callback) {
  authSubscription?.unsubscribe();

  if (isLocalDemo()) {
    authSubscription = { unsubscribe() {} };
    return authSubscription;
  }

  const client = getClient();
  const {
    data: { subscription },
  } = client.auth.onAuthStateChange(() => {
    // A Supabase session is not an authorized CaricoFacile session until the
    // user_roles check has completed. Also defer getSession()/database work
    // until after the auth callback has released its internal lock.
    cachedSession = null;
    globalThis.setTimeout(callback, 0);
  });
  authSubscription = subscription;
  return subscription;
}
