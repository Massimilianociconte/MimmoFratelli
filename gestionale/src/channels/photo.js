import { aiParse } from '../ai/client.js';
import { newDraft } from '../core/draft.js';
import { compressImage } from '../core/image.js';
import { saveDraft } from '../lib/store.js';
import { icon } from '../ui/icons.js';
import { escAttr, renderFocusedHeader, safeImageUrl, toast } from '../ui/shell.js';

export function renderPhoto(container) {
  let photo = null;

  container.innerHTML = `
    <div class="focused-view photo-view">
      ${renderFocusedHeader('Carica da foto')}
      <main class="focused-content">
        <section class="photo-intro">
          <h1>Fotografa il prodotto</h1>
          <p class="muted">Il nome e la categoria verranno proposti automaticamente.</p>
        </section>
        <label class="photo-capture" for="product-photo">
          <span id="photo-capture-content">
            ${icon('camera', 'photo-capture-icon')}
            <strong>Scatta o scegli una foto</strong>
          </span>
          <input
            class="sr-only"
            id="product-photo"
            type="file"
            accept="image/*"
            capture="environment"
          />
        </label>
        <p class="field-hint photo-privacy">
          La foto viene ritagliata e compressa sul dispositivo prima dell’analisi.
        </p>
        <p class="form-error visually-stable" id="photo-error" role="alert"></p>
        <button class="btn btn-primary" id="analyze-photo" type="button" disabled>
          Analizza foto
        </button>
      </main>
    </div>
  `;

  const input = container.querySelector('#product-photo');
  const capture = container.querySelector('#photo-capture-content');
  const analyzeButton = container.querySelector('#analyze-photo');
  const errorElement = container.querySelector('#photo-error');

  input.addEventListener('change', async (event) => {
    const [file] = event.target.files;
    if (!file) return;
    capture.innerHTML = '<span class="spinner" aria-label="Compressione foto"></span>';
    analyzeButton.disabled = true;
    errorElement.textContent = '';
    try {
      photo = await compressImage(file);
      capture.innerHTML = `
        <img src="${escAttr(safeImageUrl(photo))}" alt="Anteprima del prodotto" />
        <span class="photo-retake">Tocca per cambiare foto</span>
      `;
      analyzeButton.disabled = false;
    } catch {
      photo = null;
      capture.innerHTML = `${icon('camera', 'photo-capture-icon')}<strong>Scatta o scegli una foto</strong>`;
      errorElement.textContent = 'La foto non è leggibile. Scegline un’altra.';
    }
  });

  analyzeButton.addEventListener('click', async () => {
    if (!photo) return;
    analyzeButton.disabled = true;
    analyzeButton.textContent = 'Analisi in corso…';
    errorElement.textContent = '';

    let result = null;
    try {
      result = await aiParse('image', {
        imageBase64: photo.dataUrl,
        imageMimeType: photo.type,
      });
    } catch {
      // A blank review is the designed fallback.
    }

    const item = result?.items?.[0] || result || {};
    const draft = newDraft(
      'photo',
      {
        capturedAt: new Date().toISOString(),
        originalSize: photo.size,
      },
      {
        ...(item.parsed || {}),
        price: null,
        images: [photo],
      },
      {
        ...(item.confidence || {}),
        price: 0,
      },
    );
    await saveDraft(draft);
    if (!result) {
      toast('Analisi AI non disponibile: completa i campi in revisione.', 'warn');
    }
    window.location.hash = `#/review/${draft.id}`;
  });
}
