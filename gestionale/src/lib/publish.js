import { getTenantConfig, isLocalDemo } from '../config/tenant.js';
import { dataUrlToBlob } from '../core/image.js';
import { validateDraft } from '../core/draft.js';
import { getAdminSession } from './auth.js';
import { addDemoProduct } from './products.js';
import {
  getDraft,
  listLocalDrafts,
  markDraftPublished,
  saveDraft,
  saveDraftLocal,
  syncDrafts,
  updateRemoteParsed,
} from './store.js';
import { getClient } from './supabase.js';

let queuePromise = null;

function isOnline() {
  return navigator.onLine !== false;
}

function localImages(draft) {
  return draft.parsed.images.filter(
    (image) => image?.kind === 'local' && image?.dataUrl,
  );
}

async function uploadImages(draft) {
  const pending = localImages(draft);
  if (!pending.length) return draft;

  const config = getTenantConfig();
  const session = await getAdminSession();
  const client = getClient();
  const remoteImages = draft.parsed.images.filter((image) => typeof image === 'string');

  for (const image of pending) {
    const extension = image.type === 'image/png' ? 'png' : 'webp';
    const path = `${session.user.id}/${draft.id}/${crypto.randomUUID()}.${extension}`;
    const { error } = await client.storage
      .from(config.storageBucket)
      .upload(path, dataUrlToBlob(image.dataUrl), {
        contentType: image.type || 'image/webp',
        cacheControl: '31536000',
        upsert: false,
      });
    if (error) throw new Error(`photo_upload_failed:${error.message}`);

    const { data } = client.storage.from(config.storageBucket).getPublicUrl(path);
    if (data?.publicUrl) remoteImages.push(data.publicUrl);
  }

  const updated = {
    ...draft,
    parsed: { ...draft.parsed, images: remoteImages },
    syncState: 'local',
    updatedAt: new Date().toISOString(),
  };
  await saveDraftLocal(updated);
  return updated;
}

async function queuePublication(draft) {
  await saveDraftLocal({
    ...draft,
    publicationState: 'queued',
    syncState: 'local',
    updatedAt: new Date().toISOString(),
  });
  return { success: true, queued: true };
}

export async function publishDraft(id, { allowQueue = true } = {}) {
  let draft = await getDraft(id);
  if (!draft) throw new Error('draft_not_found');

  const validation = validateDraft(draft.parsed);
  if (!validation.ok) {
    const error = new Error('draft_invalid');
    error.validation = validation;
    throw error;
  }

  if (isLocalDemo()) {
    const product = await addDemoProduct(draft.parsed);
    await markDraftPublished(id, product.id);
    return { success: true, product_id: product.id, demo: true };
  }

  if (!isOnline()) {
    if (allowQueue) return queuePublication(draft);
    throw new Error('offline');
  }

  try {
    draft = await saveDraft({ ...draft, publicationState: 'publishing' });
    const firstSync = await syncDrafts();
    if (firstSync.failed) throw new Error('draft_sync_failed');

    draft = await uploadImages(draft);
    await updateRemoteParsed(draft);

    const client = getClient();
    const { data, error } = await client.rpc('publish_draft', {
      p_draft_id: draft.id,
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error || 'publish_failed');

    await markDraftPublished(id, data.product_id);
    return data;
  } catch (error) {
    if (allowQueue && (!isOnline() || error instanceof TypeError)) {
      return queuePublication(draft);
    }
    await saveDraftLocal({
      ...draft,
      publicationState: 'error',
      publicationError: error.message,
    });
    throw error;
  }
}

async function processQueue() {
  if (!isOnline() || isLocalDemo()) return { published: 0, failed: 0 };
  const drafts = await listLocalDrafts({ status: 'draft' });
  const queued = drafts.filter((draft) => draft.publicationState === 'queued');
  let published = 0;
  let failed = 0;

  for (const draft of queued) {
    try {
      await publishDraft(draft.id, { allowQueue: false });
      published += 1;
    } catch {
      failed += 1;
    }
  }
  return { published, failed };
}

export async function processPublicationQueue() {
  if (!queuePromise) {
    queuePromise = processQueue().finally(() => {
      queuePromise = null;
    });
  }
  return queuePromise;
}
