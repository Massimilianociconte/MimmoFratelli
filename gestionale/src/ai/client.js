import { getTenantConfig, getWorkerUrl, isLocalDemo } from '../config/tenant.js';
import { getAdminSession } from '../lib/auth.js';
import { getClient } from '../lib/supabase.js';
import { toast } from '../ui/shell.js';

function timeoutSignal(milliseconds) {
  if (AbortSignal.timeout) return AbortSignal.timeout(milliseconds);
  const controller = new AbortController();
  window.setTimeout(() => controller.abort(), milliseconds);
  return controller.signal;
}

async function parseWithWorker(kind, payload) {
  const config = getTenantConfig();
  const workerUrl = getWorkerUrl();
  const session = await getAdminSession();
  if (!workerUrl || !session || session.isDemo) return null;

  const body = {
    tenant: config.slug,
    kind,
    payload: kind === 'image' ? {} : payload,
  };
  if (kind === 'image') {
    body.imageBase64 = payload?.imageBase64;
    body.imageMimeType = payload?.imageMimeType || 'image/webp';
  }

  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(
        `${workerUrl}/ai/parse?tenant=${encodeURIComponent(config.slug)}`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${session.access_token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: timeoutSignal(20_000),
        },
      );

      if (response.status === 429) {
        toast('Quota AI esaurita. Riprova domani.', 'warn', 5_000);
        return null;
      }
      if (response.status === 401 || response.status === 403) {
        toast('Sessione non valida. Accedi di nuovo.', 'error');
        return null;
      }
      if (!response.ok) {
        lastError = new Error(`ai_worker_${response.status}`);
        if (response.status < 500) return null;
        continue;
      }
      return await response.json();
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) {
    console.warn('AI fallback attivato', lastError.message);
  }
  return null;
}

async function parseByok(kind, payload) {
  if (isLocalDemo()) return null;
  const client = getClient();
  const { data, error } = await client.functions.invoke('ai-byok', {
    body: { kind, payload },
  });
  if (error) return null;
  return data;
}

export async function aiParse(kind, payload) {
  const config = getTenantConfig();
  if (config.aiLevel === 'none') return null;
  if (config.aiLevel === 'byok') {
    const byok = await parseByok(kind, payload);
    if (byok) return byok;
  }
  return parseWithWorker(kind, payload);
}
