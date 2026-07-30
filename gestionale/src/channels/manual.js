import { getTenantConfig } from '../config/tenant.js';
import { newDraft } from '../core/draft.js';
import { compressImage } from '../core/image.js';
import { normalizeName, parsePriceCents } from '../core/normalize.js';
import { saveDraft } from '../lib/store.js';
import { icon } from '../ui/icons.js';
import { esc, escAttr, renderFocusedHeader, safeImageUrl, toast } from '../ui/shell.js';

const categoryGroups = {
  frutta: ['frutta-fresca', 'agrumi', 'frutta-secca', 'frutta-disidratata', 'frutta-esotica', 'frutta-biologica'],
  verdura: ['verdura-fresca', 'ortaggi', 'insalate', 'verdura-biologica', 'legumi-freschi', 'erbe-aromatiche'],
  conserve: ['sottoli', 'sottaceti', 'marmellate-confetture', 'salse-sughi', 'conserve-pomodoro'],
  'secchi-estratti': ['oli', 'succhi-spremute', 'legumi-secchi', 'spezie-aromi', 'farine-cereali'],
};

export function productTypeForCategory(slug) {
  return (
    Object.entries(categoryGroups).find(([, slugs]) => slugs.includes(slug))?.[0] ||
    'altro'
  );
}

function weightRow(grams = '', qty = 0) {
  return `
    <div class="weight-row">
      <div class="field">
        <label class="sr-only">Pezzatura in grammi</label>
        <input name="weight_grams" type="number" min="1" step="1" value="${escAttr(grams)}" placeholder="500" />
      </div>
      <span class="weight-unit">g</span>
      <div class="field">
        <label class="sr-only">Quantità</label>
        <input name="weight_qty" type="number" min="0" step="1" value="${escAttr(qty)}" placeholder="0" />
      </div>
      <button class="btn btn-icon btn-quiet remove-weight" type="button" aria-label="Rimuovi pezzatura">
        ${icon('trash')}
      </button>
    </div>
  `;
}

export function renderManual(container) {
  const config = getTenantConfig();
  let compressedPhoto = null;

  container.innerHTML = `
    <div class="focused-view">
      ${renderFocusedHeader('Carica a mano')}
      <main class="focused-content">
        <form class="form-grid product-form" id="manual-form">
          <div class="field">
            <label for="manual-name">Nome</label>
            <input id="manual-name" name="name" autocomplete="off" required />
          </div>
          <div class="field">
            <label for="manual-price">Prezzo</label>
            <div class="input-suffix">
              <input
                id="manual-price"
                name="price"
                inputmode="decimal"
                placeholder="0,00"
                required
              />
              <span>€</span>
            </div>
            <small class="field-hint">Inserisci il prezzo in euro.</small>
          </div>
          <fieldset class="field fieldset-reset">
            <legend class="field-label">Tipo vendita</legend>
            <div class="segmented">
              <label>
                <input type="radio" name="unit_type" value="weight" checked />
                A peso
              </label>
              <label>
                <input type="radio" name="unit_type" value="piece" />
                A pezzo
              </label>
            </div>
          </fieldset>
          <section id="weight-fields">
            <div class="section-heading">
              <div>
                <h2>Pezzature</h2>
                <p class="muted">Peso in grammi e quantità disponibile.</p>
              </div>
              <button class="btn btn-quiet" id="add-weight" type="button">
                ${icon('plus')} Aggiungi
              </button>
            </div>
            <div class="weight-labels" aria-hidden="true">
              <span>Pezzatura</span><span>Quantità</span>
            </div>
            <div class="weight-list" id="weight-list">
              ${weightRow(500, 0)}
              ${weightRow(1000, 0)}
            </div>
          </section>
          <div class="field" id="piece-fields" hidden>
            <label for="manual-items">Numero pezzi disponibili</label>
            <input id="manual-items" name="num_items" type="number" min="0" step="1" value="0" />
          </div>
          <div class="field">
            <label for="manual-category">Categoria</label>
            <select id="manual-category" name="category_slug">
              <option value="">Seleziona una categoria</option>
              ${config.categories
                .map(
                  (category) =>
                    `<option value="${escAttr(category.slug)}">${esc(category.emoji)} ${esc(category.name)}</option>`,
                )
                .join('')}
            </select>
          </div>
          <div class="field">
            <label for="manual-description">Descrizione</label>
            <textarea id="manual-description" name="description" maxlength="2000"></textarea>
          </div>
          <div class="field">
            <span class="field-label">Foto</span>
            <label class="image-picker" for="manual-photo">
              <span class="image-picker-preview" id="manual-photo-preview">
                ${icon('image', 'image-picker-icon')}
                <span>Aggiungi una foto</span>
              </span>
              <input
                class="sr-only"
                id="manual-photo"
                name="photo"
                type="file"
                accept="image/*"
                capture="environment"
              />
            </label>
            <small class="field-hint">Verrà ritagliata e compressa sul dispositivo.</small>
          </div>
          <p class="form-error visually-stable" id="manual-error" role="alert"></p>
          <button class="btn btn-primary" type="submit">Rivedi prodotto</button>
        </form>
      </main>
    </div>
  `;

  const form = container.querySelector('#manual-form');
  const weightFields = container.querySelector('#weight-fields');
  const pieceFields = container.querySelector('#piece-fields');
  const errorElement = container.querySelector('#manual-error');
  const submitButton = form.querySelector('[type="submit"]');

  function bindRemoveButtons() {
    container.querySelectorAll('.remove-weight').forEach((button) => {
      button.onclick = () => {
        if (container.querySelectorAll('.weight-row').length > 1) {
          button.closest('.weight-row').remove();
        }
      };
    });
  }

  bindRemoveButtons();
  container.querySelector('#add-weight').addEventListener('click', () => {
    container.querySelector('#weight-list').insertAdjacentHTML('beforeend', weightRow());
    bindRemoveButtons();
  });

  form.querySelectorAll('[name="unit_type"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      const isWeight = form.elements.unit_type.value === 'weight';
      weightFields.hidden = !isWeight;
      pieceFields.hidden = isWeight;
    });
  });

  container.querySelector('#manual-photo').addEventListener('change', async (event) => {
    const [file] = event.target.files;
    if (!file) return;
    const preview = container.querySelector('#manual-photo-preview');
    preview.innerHTML = '<span class="spinner" aria-label="Compressione foto"></span>';
    try {
      compressedPhoto = await compressImage(file);
      const imageUrl = safeImageUrl(compressedPhoto);
      preview.innerHTML = `<img src="${escAttr(imageUrl)}" alt="Anteprima foto prodotto" />`;
    } catch {
      compressedPhoto = null;
      preview.innerHTML = `${icon('image', 'image-picker-icon')}<span>Aggiungi una foto</span>`;
      toast('Foto non leggibile. Scegli un’altra immagine.', 'error');
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorElement.textContent = '';
    const formData = new FormData(form);
    const parsedPrice = parsePriceCents(String(formData.get('price') || ''));
    if (!parsedPrice || parsedPrice.value <= 0) {
      errorElement.textContent = 'Inserisci un prezzo valido.';
      form.elements.price.focus();
      return;
    }

    const unitType = String(formData.get('unit_type'));
    const categorySlug = String(formData.get('category_slug') || '');
    const weights = [...form.querySelectorAll('.weight-row')]
      .map((row) => ({
        grams: Number(row.querySelector('[name="weight_grams"]').value),
        qty: Number(row.querySelector('[name="weight_qty"]').value || 0),
      }))
      .filter((weight) => Number.isInteger(weight.grams) && weight.grams > 0);

    const draft = newDraft(
      'manual',
      { enteredAt: new Date().toISOString() },
      {
        name: normalizeName(formData.get('name')),
        description: String(formData.get('description') || '').trim(),
        price: parsedPrice.value,
        unit_type: unitType,
        weights: unitType === 'weight' ? weights : [],
        num_items:
          unitType === 'piece' ? Math.max(0, Number(formData.get('num_items') || 0)) : 0,
        category_slug: categorySlug,
        product_type: productTypeForCategory(categorySlug),
        images: compressedPhoto ? [compressedPhoto] : [],
      },
      {
        name: 1,
        price: 1,
        category_slug: categorySlug ? 1 : 0,
      },
    );

    submitButton.disabled = true;
    submitButton.textContent = 'Salvataggio…';
    try {
      await saveDraft(draft);
      window.location.hash = `#/review/${draft.id}`;
    } catch {
      errorElement.textContent = 'Non riesco a salvare la bozza. Riprova.';
      submitButton.disabled = false;
      submitButton.textContent = 'Rivedi prodotto';
    }
  });
}
