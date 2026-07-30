import { createStore, del, entries, get, set } from 'idb-keyval';
import {
  fromRemoteDraft,
  toRemoteDraft,
  toRemoteParsed,
  updateDraftFields,
} from '../core/draft.js';
import { isLocalDemo } from '../config/tenant.js';
import { getAdminSession } from './auth.js';
import { getClient } from './supabase.js';

const draftStore = createStore('caricofacile', 'drafts');
const CHANGE_EVENT = 'caricofacile:drafts-changed';
let syncPromise = null;

function isOnline() {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

function emitChange() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
  }
}

function mergeImages(remoteImages = [], localImages = []) {
  const merged = [...remoteImages];
  for (const image of localImages) {
    const identity = typeof image === 'string' ? image : image?.dataUrl;
    if (
      identity &&
      !merged.some((candidate) =>
        typeof candidate === 'string'
          ? candidate === identity
          : candidate?.dataUrl === identity
      )
    ) {
      merged.push(image);
    }
  }
  return merged;
}

function mergeDrafts(remote, local) {
  if (!remote) return local;
  if (!local) return remote;

  const remoteIsNewer =
    new Date(remote.updatedAt).getTime() > new Date(local.updatedAt).getTime();
  const primary = remoteIsNewer && local.syncState === 'synced' ? remote : local;

  return {
    ...primary,
    parsed: {
      ...primary.parsed,
      images: mergeImages(remote.parsed.images, local.parsed.images),
    },
  };
}

export async function saveDraftLocal(draft) {
  const nextDraft = {
    ...draft,
    updatedAt: draft.updatedAt || new Date().toISOString(),
  };
  await set(nextDraft.id, nextDraft, draftStore);
  emitChange();
  return nextDraft;
}

export async function getLocalDraft(id) {
  return (await get(id, draftStore)) || null;
}

export async function listLocalDrafts({ status = 'draft' } = {}) {
  const rows = await entries(draftStore);
  return rows
    .map(([, draft]) => draft)
    .filter((draft) => !status || draft.status === status)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export async function deleteLocalDraft(id) {
  await del(id, draftStore);
  emitChange();
}

export async function saveDraft(draft, { sync = true } = {}) {
  const saved = await saveDraftLocal({
    ...draft,
    syncState: draft.syncState === 'synced' ? 'local' : draft.syncState || 'local',
  });

  if (sync && isOnline()) {
    syncDrafts().catch(() => {
      // The local draft is already durable; the next online event retries it.
    });
  }

  return saved;
}

export async function updateDraft(id, patch) {
  const draft = await getDraft(id);
  if (!draft) throw new Error('draft_not_found');
  return saveDraft(updateDraftFields(draft, patch));
}

export async function listRemoteDrafts({ status = 'draft' } = {}) {
  if (isLocalDemo() || !isOnline()) return [];
  const client = getClient();
  let query = client.from('product_drafts').select('*').order('created_at', {
    ascending: false,
  });
  if (status) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map(fromRemoteDraft);
}

export async function listDrafts({ status = 'draft' } = {}) {
  const local = await listLocalDrafts({ status });
  let remote = [];

  try {
    remote = await listRemoteDrafts({ status });
  } catch {
    // Offline-first: a remote read failure must not hide local work.
  }

  const merged = new Map(remote.map((draft) => [draft.id, draft]));
  for (const draft of local) {
    merged.set(draft.id, mergeDrafts(merged.get(draft.id), draft));
  }

  return [...merged.values()].sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
  );
}

export async function getDraft(id) {
  const local = await getLocalDraft(id);
  if (isLocalDemo() || !isOnline()) return local;

  try {
    const client = getClient();
    const { data, error } = await client
      .from('product_drafts')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return mergeDrafts(data ? fromRemoteDraft(data) : null, local);
  } catch {
    return local;
  }
}

async function performSync() {
  if (!isOnline() || isLocalDemo()) {
    return { synced: 0, failed: 0, skipped: true };
  }

  const session = await getAdminSession();
  if (!session) return { synced: 0, failed: 0, skipped: true };

  const client = getClient();
  const localDrafts = await listLocalDrafts({ status: null });
  let synced = 0;
  let failed = 0;

  for (const draft of localDrafts) {
    if (draft.syncState === 'synced') continue;

    const remoteDraft = toRemoteDraft(draft, session.user.id);
    const { error } = await client
      .from('product_drafts')
      .upsert(remoteDraft, { onConflict: 'id' });

    if (error) {
      failed += 1;
      await saveDraftLocal({
        ...draft,
        syncState: 'error',
        syncError: error.message,
      });
      continue;
    }

    synced += 1;
    await saveDraftLocal({
      ...draft,
      syncState: 'synced',
      syncError: null,
      lastSyncedAt: new Date().toISOString(),
    });
  }

  return { synced, failed, skipped: false };
}

export async function syncDrafts() {
  if (!syncPromise) {
    syncPromise = performSync().finally(() => {
      syncPromise = null;
    });
  }
  return syncPromise;
}

export async function discardDraft(id) {
  const draft = await getDraft(id);
  if (!draft) return;

  const discarded = {
    ...draft,
    status: 'discarded',
    syncState: 'local',
    updatedAt: new Date().toISOString(),
  };
  await saveDraftLocal(discarded);

  if (isOnline() && !isLocalDemo()) {
    try {
      await syncDrafts();
    } catch {
      // It remains queued locally.
    }
  }
}

export async function markDraftPublished(id, productId) {
  const draft = await getLocalDraft(id);
  if (draft) {
    await saveDraftLocal({
      ...draft,
      status: 'published',
      publishedProductId: productId,
      syncState: 'synced',
      updatedAt: new Date().toISOString(),
    });
  }
  await deleteLocalDraft(id);
}

export async function updateRemoteParsed(draft) {
  if (isLocalDemo()) return;
  const client = getClient();
  const { error } = await client
    .from('product_drafts')
    .update({
      parsed: toRemoteParsed(draft),
      updated_at: draft.updatedAt,
    })
    .eq('id', draft.id);
  if (error) throw error;
}

export function subscribeToDraftChanges(callback) {
  window.addEventListener(CHANGE_EVENT, callback);
  return () => window.removeEventListener(CHANGE_EVENT, callback);
}

export function initDraftSync() {
  const handleOnline = () => {
    syncDrafts().catch(() => {});
  };
  window.addEventListener('online', handleOnline);
  return () => window.removeEventListener('online', handleOnline);
}
