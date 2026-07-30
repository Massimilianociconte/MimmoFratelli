import { lowConfidenceFields, validateDraft } from '../../core/draft.js';
import {
  listDrafts,
  subscribeToDraftChanges,
  syncDrafts,
} from '../../lib/store.js';
import { icon } from '../icons.js';
import { esc, escAttr, toast } from '../shell.js';

const sourceLabels = {
  photo: 'Foto',
  voice: 'Detta',
  file: 'File',
  barcode: 'Barcode',
  manual: 'A mano',
};

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const sameDay = (left, right) =>
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate();

  const time = new Intl.DateTimeFormat('it-IT', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
  if (sameDay(date, today)) return `Oggi, ${time}`;
  if (sameDay(date, yesterday)) return `Ieri, ${time}`;
  return new Intl.DateTimeFormat('it-IT', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function draftState(draft) {
  if (draft.publicationState === 'queued') {
    return { label: 'Pubblicazione in coda', tone: 'warn' };
  }
  if (draft.syncState === 'error') {
    return { label: 'Da sincronizzare', tone: 'warn' };
  }

  const validation = validateDraft(draft.parsed);
  if (validation.missing.includes('price')) {
    return { label: 'Prezzo mancante', tone: 'warn' };
  }
  if (validation.missing.includes('name')) {
    return { label: 'Nome mancante', tone: 'warn' };
  }
  const low = lowConfidenceFields(draft.confidence);
  if (low.includes('price')) {
    return { label: 'Prezzo da verificare', tone: 'warn' };
  }
  if (!validation.ok) {
    return { label: 'Da verificare', tone: 'warn' };
  }
  return { label: 'Pronta', tone: 'ok' };
}

function draftRows(drafts) {
  return drafts
    .map((draft) => {
      const state = draftState(draft);
      return `
        <a
          class="data-row draft-row"
          href="#/review/${escAttr(draft.id)}"
          data-search="${escAttr(`${draft.parsed.name} ${sourceLabels[draft.source] || draft.source}`.toLocaleLowerCase('it-IT'))}"
          data-source="${escAttr(draft.source)}"
        >
          <strong>${esc(draft.parsed.name || 'Senza nome')}</strong>
          <span>${esc(sourceLabels[draft.source] || draft.source)}</span>
          <time datetime="${escAttr(draft.createdAt)}">${esc(formatDate(draft.createdAt))}</time>
          <span class="row-state ${state.tone}">${esc(state.label)}</span>
          ${icon('chevron', 'row-chevron')}
        </a>
      `;
    })
    .join('');
}

export async function renderDrafts(container) {
  const drafts = await listDrafts();
  container.innerHTML = `
    <section class="data-view" aria-labelledby="drafts-title">
      <div class="view-header">
        <div>
          <h1 id="drafts-title">Bozze</h1>
          <p class="sync-state" id="draft-sync-state">
            ${icon('check')} <span>Sincronizzato</span>
          </p>
        </div>
        <a class="btn btn-primary header-action" href="#/home">Carica prodotto</a>
      </div>
      ${
        drafts.length
          ? `
            <div class="filter-row">
              <label class="search-field">
                <span class="sr-only">Cerca una bozza</span>
                ${icon('search')}
                <input id="draft-search" type="search" placeholder="Cerca una bozza" />
              </label>
              <label class="sr-only" for="draft-source">Filtra per fonte</label>
              <select class="filter-select" id="draft-source">
                <option value="">Tutte le fonti</option>
                <option value="photo">Foto</option>
                <option value="voice">Detta</option>
                <option value="file">File</option>
                <option value="barcode">Barcode</option>
                <option value="manual">A mano</option>
              </select>
            </div>
            <div class="data-list" id="draft-list">
              <div class="data-header" aria-hidden="true">
                <span>Prodotto</span><span>Fonte</span><span>Creata</span><span>Stato</span><span></span>
              </div>
              ${draftRows(drafts)}
            </div>
            <div class="empty-state" id="draft-filter-empty" hidden>
              ${icon('search')}
              <h2>Nessuna bozza trovata</h2>
              <p>Prova a modificare la ricerca o il filtro.</p>
            </div>
          `
          : `
            <div class="empty-state">
              ${icon('drafts')}
              <h2>Non ci sono ancora bozze</h2>
              <p>Carica il primo prodotto: resterà qui finché non lo pubblichi.</p>
              <a class="btn btn-primary" href="#/home">Carica il primo prodotto</a>
            </div>
          `
      }
    </section>
  `;

  const search = container.querySelector('#draft-search');
  const source = container.querySelector('#draft-source');
  const empty = container.querySelector('#draft-filter-empty');

  function applyFilters() {
    const query = search.value.trim().toLocaleLowerCase('it-IT');
    const selectedSource = source.value;
    let visible = 0;
    container.querySelectorAll('.draft-row').forEach((row) => {
      const matches =
        (!query || row.dataset.search.includes(query)) &&
        (!selectedSource || row.dataset.source === selectedSource);
      row.hidden = !matches;
      if (matches) visible += 1;
    });
    empty.hidden = visible > 0;
  }

  search?.addEventListener('input', applyFilters);
  source?.addEventListener('change', applyFilters);

  const syncState = container.querySelector('#draft-sync-state');
  async function refreshSync() {
    if (!syncState) return;
    syncState.classList.add('syncing');
    syncState.querySelector('span').textContent = 'Sincronizzazione…';
    try {
      const result = await syncDrafts();
      syncState.querySelector('span').textContent = result.failed
        ? 'Alcune bozze sono locali'
        : 'Sincronizzato';
      if (result.failed) syncState.classList.add('warn');
    } catch {
      syncState.querySelector('span').textContent = 'Bozze salvate sul dispositivo';
      syncState.classList.add('warn');
    } finally {
      syncState.classList.remove('syncing');
    }
  }

  refreshSync();
  const unsubscribe = subscribeToDraftChanges(() => {
    if (window.location.hash === '#/drafts') {
      toast('Bozze aggiornate.', 'ok', 1_800);
    } else {
      unsubscribe();
    }
  });
}
