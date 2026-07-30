import { BrowserMultiFormatReader } from '@zxing/browser';
import { getTenantConfig } from '../config/tenant.js';
import { newDraft } from '../core/draft.js';
import { normalizeEan, normalizeName, parseWeightGrams } from '../core/normalize.js';
import { saveDraft } from '../lib/store.js';
import { productTypeForCategory } from './manual.js';
import { icon } from '../ui/icons.js';
import { renderFocusedHeader, toast } from '../ui/shell.js';

function inferCategory(product) {
  const config = getTenantConfig();
  const haystack = [
    product.product_name_it,
    product.product_name,
    ...(product.categories_tags || []),
  ]
    .join(' ')
    .toLocaleLowerCase('it-IT');

  const matches = [
    ['marmellate-confetture', ['marmellata', 'confettura', 'jam']],
    ['conserve-pomodoro', ['passata', 'pelati', 'tomato sauce']],
    ['salse-sughi', ['salsa', 'sugo', 'sauce']],
    ['sottoli', ["sott'olio", 'sottolio']],
    ['sottaceti', ["sott'aceto", 'sottaceto', 'pickles']],
    ['oli', ['olio', 'oil']],
    ['succhi-spremute', ['succo', 'spremuta', 'juice']],
    ['farine-cereali', ['farina', 'cereali', 'flour', 'cereal']],
    ['legumi-secchi', ['lenticchie', 'ceci', 'fagioli secchi', 'legumes']],
    ['spezie-aromi', ['spezia', 'spezie', 'spice']],
    ['frutta-secca', ['mandorle', 'noci', 'nocciole', 'nuts']],
    ['agrumi', ['arancia', 'limone', 'mandarino', 'citrus']],
    ['frutta-fresca', ['frutta', 'fruit']],
    ['verdura-fresca', ['verdura', 'vegetable']],
  ];

  return (
    matches.find(
      ([slug, keywords]) =>
        config.categories.some((category) => category.slug === slug) &&
        keywords.some((keyword) => haystack.includes(keyword)),
    )?.[0] || ''
  );
}

export async function lookupBarcode(ean) {
  const fields = [
    'product_name_it',
    'product_name',
    'brands',
    'quantity',
    'categories_tags',
    'image_front_url',
  ].join(',');
  const response = await fetch(
    `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(ean)}?fields=${encodeURIComponent(fields)}&lc=it`,
    {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(12_000),
    },
  );
  if (!response.ok) throw new Error(`openfoodfacts_${response.status}`);
  const payload = await response.json();
  return payload?.product || null;
}

function parsedFromProduct(ean, product) {
  if (!product) {
    return {
      parsed: { barcode: ean, price: null, unit_type: 'piece' },
      confidence: { barcode: 1, price: 0 },
    };
  }

  const name = normalizeName(product.product_name_it || product.product_name || '');
  const grams = parseWeightGrams(product.quantity || '');
  const categorySlug = inferCategory(product);
  const description = [product.brands, product.quantity].filter(Boolean).join(' · ');

  return {
    parsed: {
      name,
      description,
      price: null,
      unit_type: grams ? 'weight' : 'piece',
      weights: grams ? [{ grams, qty: 0 }] : [],
      num_items: 0,
      category_slug: categorySlug,
      product_type: productTypeForCategory(categorySlug),
      images: product.image_front_url ? [product.image_front_url] : [],
      barcode: ean,
    },
    confidence: {
      barcode: 1,
      name: name ? 0.8 : 0,
      price: 0,
      category_slug: categorySlug ? 0.55 : 0,
    },
  };
}

export function renderBarcode(container) {
  let stream = null;
  let scannerControls = null;
  let nativeScanFrame = null;
  let resolved = false;

  container.innerHTML = `
    <div class="focused-view barcode-view">
      ${renderFocusedHeader('Scansiona barcode')}
      <main class="focused-content">
        <div class="scanner-frame">
          <video id="barcode-video" muted playsinline></video>
          <div class="scanner-guides" aria-hidden="true"></div>
          <div class="scanner-placeholder" id="scanner-placeholder">
            ${icon('barcode', 'scanner-placeholder-icon')}
            <span>Inquadra il codice a barre</span>
          </div>
        </div>
        <button class="btn btn-primary" id="start-scanner" type="button">
          ${icon('camera')} Avvia fotocamera
        </button>
        <div class="manual-code">
          <span>oppure</span>
          <form class="form-grid" id="barcode-form">
            <div class="field">
              <label for="barcode-input">Inserisci il codice</label>
              <input
                id="barcode-input"
                name="barcode"
                inputmode="numeric"
                pattern="[0-9]*"
                minlength="8"
                maxlength="13"
                autocomplete="off"
                placeholder="EAN-8 o EAN-13"
                required
              />
            </div>
            <button class="btn" type="submit">Cerca prodotto</button>
          </form>
        </div>
        <p class="form-error visually-stable" id="barcode-error" role="alert"></p>
      </main>
    </div>
  `;

  const video = container.querySelector('#barcode-video');
  const placeholder = container.querySelector('#scanner-placeholder');
  const startButton = container.querySelector('#start-scanner');
  const form = container.querySelector('#barcode-form');
  const errorElement = container.querySelector('#barcode-error');

  function stopScanner() {
    if (nativeScanFrame) cancelAnimationFrame(nativeScanFrame);
    nativeScanFrame = null;
    scannerControls?.stop?.();
    scannerControls = null;
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    video.srcObject = null;
  }

  async function acceptCode(rawCode) {
    if (resolved) return;
    const ean = normalizeEan(rawCode);
    if (!ean) {
      errorElement.textContent = 'Il codice EAN non è valido.';
      return;
    }

    resolved = true;
    stopScanner();
    errorElement.textContent = '';
    startButton.disabled = true;
    startButton.textContent = 'Ricerca prodotto…';

    let product = null;
    try {
      product = await lookupBarcode(ean);
    } catch {
      toast('Open Food Facts non risponde: creo comunque la bozza.', 'warn');
    }

    const { parsed, confidence } = parsedFromProduct(ean, product);
    const draft = newDraft('barcode', { ean, provider: 'openfoodfacts' }, parsed, confidence);
    await saveDraft(draft);

    if (!product) {
      toast('Prodotto non trovato: completa i campi in revisione.', 'warn');
    }
    window.location.hash = `#/review/${draft.id}`;
  }

  async function nativeLoop(detector) {
    if (!stream || resolved) return;
    try {
      const barcodes = await detector.detect(video);
      const candidate = barcodes.find((barcode) =>
        ['ean_13', 'ean_8'].includes(barcode.format),
      );
      if (candidate?.rawValue) {
        await acceptCode(candidate.rawValue);
        return;
      }
    } catch {
      // A frame can be undecodable while the camera is moving.
    }
    nativeScanFrame = requestAnimationFrame(() => nativeLoop(detector));
  }

  async function startNativeScanner() {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    const detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8'] });
    nativeLoop(detector);
  }

  async function startZxingScanner() {
    const reader = new BrowserMultiFormatReader(undefined, {
      delayBetweenScanAttempts: 160,
      delayBetweenScanSuccess: 500,
    });
    scannerControls = await reader.decodeFromConstraints(
      {
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      },
      video,
      (result) => {
        if (result?.getText()) acceptCode(result.getText());
      },
    );
  }

  startButton.addEventListener('click', async () => {
    errorElement.textContent = '';
    startButton.disabled = true;
    startButton.textContent = 'Avvio fotocamera…';
    try {
      placeholder.hidden = true;
      if ('BarcodeDetector' in window) {
        await startNativeScanner();
      } else {
        await startZxingScanner();
      }
      startButton.textContent = 'Fotocamera attiva';
    } catch {
      placeholder.hidden = false;
      errorElement.textContent =
        'Fotocamera non disponibile. Inserisci il codice qui sotto.';
      startButton.disabled = false;
      startButton.textContent = 'Riprova fotocamera';
      stopScanner();
    }
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    acceptCode(new FormData(form).get('barcode'));
  });

  window.addEventListener(
    'hashchange',
    () => {
      stopScanner();
    },
    { once: true },
  );
}
