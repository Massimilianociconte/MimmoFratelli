import { createClient } from '@supabase/supabase-js';
import { getTenantConfig, isLocalDemo } from '../config/tenant.js';

let client = null;
let clientTenant = null;

export function getClient() {
  if (isLocalDemo()) return null;

  const config = getTenantConfig();
  if (!config.supabaseUrl || !config.anonKey) {
    throw new Error('supabase_not_configured');
  }

  if (!client || clientTenant !== config.slug) {
    client = createClient(config.supabaseUrl, config.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: `caricofacile:${config.slug}:auth`,
      },
    });
    clientTenant = config.slug;
  }

  return client;
}

export function resetClientForTests() {
  client = null;
  clientTenant = null;
}
