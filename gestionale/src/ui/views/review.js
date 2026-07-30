import { getTenantConfig } from '../../config/tenant.js';
import {
  lowConfidenceFields,
  updateDraftFields,
  validateDraft,
} from '../../core/draft.js';
import { centsToEuros, normalizeName, parsePriceCents } from '../../core/normalize.js';
import { publishDraft } from '../../lib/publish.js';
import { discardDraft, getDraft, listDrafts, saveDraft } from '../../lib/store.js';
import { productTypeForCategory } from '../../channels/manual.js';
import { icon } from '../icons.js';
import {
  esc,
  escAttr,
  renderFocusedHeader,
  safeImageUrl,
  toast,
} from '../shell.js';

function euroInput(cents) {
  const euros = centsToEuros(cents);
  return euros === null ? '' : euros.toFixed(2).replace('.', ',');
}

function weightRow({ grams = '', qty = 0 } = {}) {
  return `
    <div class="weight-row review-weight-row">
      <div class="field">
        <label class="sr-only">Pezzatura in grammi</label>
        <input name="weight_grams" type="number" min="1" step="1" value="${escAttr(grams)}" />
      </div>
      <span class="weight-unit">g</span>
      <div class="field">
        <label class="sr-only">Quantità</label>
        <input name="weight_qty" type="number" min="0" step="1" value="${escAttr(qty)}" />
      </div>
      <button class="btn btn-icon btn-quiet remove-weight" type="button" aria-label="Rimuovi pezzatura">
        ${icon('trash')}
      </button>
    </div>
  `;
}

function productImage(draft) {
  const imageUrl = safeImageUrl(draft.parsed.images[0]);
  if (!imageUrl) {
    return `
      <div class="review-image review-image-empty">
        ${icon('image', 'review-image-icon')}
        <span>Nessuna foto</span>
      </div>
    `;
  }
  return `
    <div class="review-image scan-frame">
      <img src="${escAttr(imageUrl)}" alt="${escAttr(`Foto di ${draft.parsed.name || 'prodotto'}`)}" />
    </div>
  `;
}

function collectDraft(form, draft) {
  const formData = new FormData(form);
  const parsedPrice = parsePriceCents(String(formData.get('price') || ''));
  const unitType = String(formData.get('unit_type'));
  const categorySlug = String(formData.get('category_slug') || '');
  const weights = [...form.querySelectorAll('.review-weight-row')]
    .map((row) => ({
      grams: Number(row.querySelector('[name="weight_grams"]').value),
      qty: Number(row.querySelector('[name="weight_qty"]').value || 0),
    }))
    .filter((weight) => Number.isInteger(weight.grams) && weight.grams > 0);

  return updateDraftFields(draft, {
    name: normalizeName(formData.get('name')),
    price: parsedPrice?.value ?? null,
    category_slug: categorySlug,
    product_type: productTypeForCategory(categorySlug),
    description: String(formData.get('description') || '').trim(),
    unit_type: unitType,
    weights: unitType === 'weight' ? weights : [],
    num_items:
      unitType === 'piece' ? Math.max(0, Number(formData.get('num_items') || 0)) : 0,
  });
}

function errorCopy(error) {
  const messages = {
    not_admin: 'Il tuo account non ha più i permessi amministratore.',
    missing_required_fields: 'Compila nome e prezzo prima di pubblicare.',
    invalid_price: 'Controlla il prezzo e riprova.',
    invalid_product_data: 'Uno dei campi non è compatibile con il catalogo.',
    draft_sync_failed: 'La bozza non è stata sincronizzata. Controlla la rete.',
    photo_upload_failed: 'La foto non è stata caricata. Riprova tra poco.',
  };
  const key = String(error?.message || '').split(':')[0];
  return messages[key] || 'Pubblicazione non riuscita. La bozza è al sicuro: riprova.';
}

export async function renderReview(container, id) {
  const [draft, drafts, config] = await Promise.all([
    getDraft(id),
    listDrafts(),
    Promise.resolve(getTenantConfig()),
  ]);

  if (!draft) {
    container.innerHTML = `
      <main class="loading-screen">
        ${icon('alert', 'empty-icon')}
        <h1>Bozza non trovata</h1>
        <a class="btn" href="#/drafts">Torna alle bozze</a>
      </main>
    `;
    return;
  }

  const index = Math.max(0, drafts.findIndex((item) => item.id === draft.id));
  const nextDraft = drafts[index + 1] || drafts[0];
  const lowConfidence = new Set(lowConfidenceFields(draft.confidence));
  const priceWarn = !draft.parsed.price || lowConfidence.has('price');
  const nameWarn = lowConfidence.has('name');

  container.innerHTML = `
    <div class="focused-view review-view">
      ${renderFocusedHeader('Rivedi prodotto', {
        progress: `${index + 1} di ${Math.max(drafts.length, 1)}`,
        back: '#/drafts',
      })}
      <main class="focused-content review-content">
        ${productImage(draft)}
        <form class="form-grid product-form" id="review-form">
          <div class="field ${nameWarn ? 'field-warn' : ''}">
            <label for="review-name">Nome</label>
            <input
              id="review-name"
              name="name"
              value="${escAttr(draft.parsed.name)}"
              required
            />
            ${nameWarn ? '<small class="field-hint warn">Da verificare</small>' : ''}
          </div>
          <div class="field ${priceWarn ? 'field-warn' : ''}">
            <label for="review-price">Prezzo</label>
            <div class="input-suffix">
              <input
                id="review-price"
                name="price"
                inputmode="decimal"
                value="${escAttr(euroInput(draft.parsed.price))}"
                placeholder="0,00"
                required
              />
              <span>€</span>
            </div>
            ${priceWarn ? '<small class="field-hint warn">Da verificare</small>' : ''}
          </div>
          <div class="field">
            <label for="review-category">Categoria</label>
            <select id="review-category" name="category_slug">
              <option value="">Seleziona una categoria</option>
              ${config.categories
                .map(
                  (category) => `
                    <option
                      value="${escAttr(category.slug)}"
                      ${category.slug === draft.parsed.category_slug ? 'selected' : ''}
                    >${esc(category.emoji)} ${esc(category.name)}</option>
                  `,
                )
                .join('')}
            </select>
          </div>
          <fieldset class="field fieldset-reset">
            <legend class="field-label">Tipo vendita</legend>
            <div class="segmented">
              <label>
                <input
                  type="radio"
                  name="unit_type"
                  value="weight"
                  ${draft.parsed.unit_type !== 'piece' ? 'checked' : ''}
                />
                A peso
              </label>
              <label>
                <input
                  type="radio"
                  name="unit_type"
                  value="piece"
                  ${draft.parsed.unit_type === 'piece' ? 'checked' : ''}
                />
                A pezzo
              </label>
            </div>
          </fieldset>
          <section id="review-weight-fields" ${draft.parsed.unit_type === 'piece' ? 'hidden' : ''}>
            <div class="section-heading">
              <div>
                <h2>Pezzature</h2>
                <p class="muted">Peso in grammi e quantità disponibile.</p>
              </div>
              <button class="btn btn-quiet" id="review-add-weight" type="button">
                ${icon('plus')} Aggiungi
              </button>
            </div>
            <div class="weight-labels" aria-hidden="true">
              <span>Pezzatura</span><span>Quantità</span>
            </div>
            <div class="weight-list" id="review-weight-list">
              ${(draft.parsed.weights.length ? draft.parsed.weights : [{ grams: 500, qty: 0 }])
                .map(weightRow)
                .join('')}
            </div>
          </section>
          <div class="field" id="review-piece-fields" ${draft.parsed.unit_type !== 'piece' ? 'hidden' : ''}>
            <label for="review-items">Numero pezzi disponibili</label>
            <input
              id="review-items"
              name="num_items"
              type="number"
              min="0"
              step="1"
              value="${escAttr(draft.parsed.num_items || 0)}"
            />
          </div>
          <div class="field">
            <label for="review-description">Descrizione</label>
            <textarea id="review-description" name="description" maxlength="2000">${esc(draft.parsed.description)}</textarea>
          </div>
          <p class="form-error visually-stable" id="review-error" role="alert"></p>
        </form>
      </main>
      <div class="fixed-actions review-actions">
        <div class="fixed-actions-inner">
          <button class="btn btn-primary" id="publish-draft" type="button">Pubblica</button>
          <div class="action-links">
            <button class="btn btn-quiet" id="discard-draft" type="button">Scarta</button>
            <button
              class="btn btn-quiet"
              id="next-draft"
              type="button"
              ${drafts.length < 2 ? 'disabled' : ''}
            >Prossima</button>
          </div>
        </div>
      </div>
    </div>
  `;

  const form = container.querySelector('#review-form');
  const errorElement = container.querySelector('#review-error');
  const publishButton = container.querySelector('#publish-draft');
  const weightFields = container.querySelector('#review-weight-fields');
  const pieceFields = container.querySelector('#review-piece-fields');

  function bindRemoveButtons() {
    container.querySelectorAll('.remove-weight').forEach((button) => {
      button.onclick = () => {
        if (container.querySelectorAll('.review-weight-row').length > 1) {
          button.closest('.review-weight-row').remove();
        }
      };
    });
  }

  bindRemoveButtons();
  container.querySelector('#review-add-weight').addEventListener('click', () => {
    container
      .querySelector('#review-weight-list')
      .insertAdjacentHTML('beforeend', weightRow());
    bindRemoveButtons();
  });

  form.querySelectorAll('[name="unit_type"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      const isWeight = form.elements.unit_type.value === 'weight';
      weightFields.hidden = !isWeight;
      pieceFields.hidden = isWeight;
    });
  });

  async function persistForm() {
    const updated = collectDraft(form, draft);
    await saveDraft(updated);
    return updated;
  }

  publishButton.addEventListener('click', async () => {
    errorElement.textContent = '';
    let updated;
    try {
      updated = await persistForm();
    } catch {
      errorElement.textContent = 'Non riesco a salvare le modifiche.';
      return;
    }

    const validation = validateDraft(updated.parsed);
    if (!validation.ok) {
      errorElement.textContent = 'Compila nome e prezzo prima di pubblicare.';
      const target = validation.missing[0] || validation.invalid[0];
      form.elements[target]?.focus();
      return;
    }

    publishButton.disabled = true;
    publishButton.textContent = 'Pubblicazione…';
    try {
      const result = await publishDraft(draft.id);
      toast(
        result.queued
          ? 'Pubblicazione in coda: partirà appena torni online.'
          : 'Prodotto pubblicato.',
        'ok',
      );
      window.location.hash = result.queued ? '#/drafts' : '#/products';
    } catch (error) {
      errorElement.textContent = errorCopy(error);
      publishButton.disabled = false;
      publishButton.textContent = 'Pubblica';
    }
  });

  container.querySelector('#discard-draft').addEventListener('click', async () => {
    await discardDraft(draft.id);
    toast('Bozza scartata.', 'ok');
    window.location.hash = '#/drafts';
  });

  container.querySelector('#next-draft').addEventListener('click', async () => {
    if (!nextDraft || nextDraft.id === draft.id) return;
    await persistForm();
    window.location.hash = `#/review/${nextDraft.id}`;
  });
}
