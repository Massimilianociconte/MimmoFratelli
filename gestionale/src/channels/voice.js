import { aiParse } from '../ai/client.js';
import { newDraft } from '../core/draft.js';
import { normalizeName, parsePriceCents } from '../core/normalize.js';
import { saveDraft, syncDrafts } from '../lib/store.js';
import { icon } from '../ui/icons.js';
import { renderFocusedHeader, toast } from '../ui/shell.js';

function localFallback(text) {
  const price = parsePriceCents(text);
  const withoutPrice = text
    .replace(/\d+(?:[.,]\d+)?\s*(?:€|euro|al\s+kg|\/\s*kg).*/i, '')
    .trim();
  return {
    parsed: {
      name: normalizeName(withoutPrice),
      description: '',
      price: price?.value ?? null,
      unit_type: price?.per ? 'weight' : 'piece',
    },
    confidence: {
      name: withoutPrice ? 0.45 : 0,
      price: price ? 0.9 : 0,
    },
  };
}

export function renderVoice(container) {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;
  let listening = false;
  let finalTranscript = '';
  let processing = false;

  container.innerHTML = `
    <div class="focused-view voice-view">
      ${renderFocusedHeader('Detta prodotti')}
      <main class="focused-content voice-content">
        <section class="voice-intro">
          <h1>Detta il tuo listino</h1>
          <p class="muted">Puoi nominare più prodotti e prezzi nella stessa dettatura.</p>
        </section>
        <button
          class="voice-button"
          id="voice-toggle"
          type="button"
          aria-pressed="false"
          ${Recognition ? '' : 'hidden'}
        >
          ${icon('mic', 'voice-button-icon')}
          <span>Inizia dettatura</span>
        </button>
        <div class="voice-wave" id="voice-wave" aria-hidden="true" hidden>
          <i></i><i></i><i></i><i></i><i></i>
        </div>
        <div class="field transcript-field">
          <label for="voice-transcript">
            ${Recognition ? 'Trascrizione' : 'Scrivi ciò che avresti dettato'}
          </label>
          <textarea
            id="voice-transcript"
            placeholder="Esempio: pomodori 3 euro al chilo e arance 2 euro e 50"
          ></textarea>
        </div>
        <p class="field-hint" id="voice-support-note">
          ${
            Recognition
              ? 'Controlla il testo, poi crea le bozze.'
              : 'La dettatura non è supportata da questo browser: usa il campo di testo.'
          }
        </p>
        <p class="form-error visually-stable" id="voice-error" role="alert"></p>
        <button class="btn btn-primary" id="create-voice-drafts" type="button">
          Crea bozze
        </button>
      </main>
    </div>
  `;

  const toggle = container.querySelector('#voice-toggle');
  const transcript = container.querySelector('#voice-transcript');
  const wave = container.querySelector('#voice-wave');
  const createButton = container.querySelector('#create-voice-drafts');
  const errorElement = container.querySelector('#voice-error');

  function setListening(value) {
    listening = value;
    toggle?.setAttribute('aria-pressed', String(value));
    toggle?.classList.toggle('listening', value);
    toggle?.querySelector('span').replaceChildren(
      value ? 'Termina dettatura' : 'Inizia dettatura',
    );
    wave.hidden = !value;
  }

  if (Recognition) {
    recognition = new Recognition();
    recognition.lang = 'it-IT';
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.addEventListener('result', (event) => {
      let interim = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const text = event.results[index][0].transcript;
        if (event.results[index].isFinal) finalTranscript += `${text} `;
        else interim += text;
      }
      transcript.value = `${finalTranscript}${interim}`.trim();
    });

    recognition.addEventListener('end', () => setListening(false));
    recognition.addEventListener('error', (event) => {
      setListening(false);
      if (event.error !== 'no-speech' && event.error !== 'aborted') {
        errorElement.textContent =
          'Microfono non disponibile. Puoi scrivere nel campo di testo.';
      }
    });

    toggle.addEventListener('click', () => {
      errorElement.textContent = '';
      if (listening) {
        recognition.stop();
      } else {
        finalTranscript = transcript.value ? `${transcript.value.trim()} ` : '';
        recognition.start();
        setListening(true);
      }
    });
  }

  createButton.addEventListener('click', async () => {
    if (processing) return;
    const text = transcript.value.trim();
    if (!text) {
      errorElement.textContent = 'Detta o scrivi almeno un prodotto.';
      transcript.focus();
      return;
    }

    processing = true;
    recognition?.stop();
    createButton.disabled = true;
    createButton.textContent = 'Creo le bozze…';
    errorElement.textContent = '';

    let result = null;
    try {
      result = await aiParse('text', { text });
    } catch {
      // Local fallback below.
    }
    const items = result?.items?.length ? result.items : [localFallback(text)];

    try {
      const drafts = items.slice(0, 50).map((item) =>
        newDraft(
          'voice',
          { text },
          item.parsed || {},
          item.confidence || {},
        ),
      );
      await Promise.all(drafts.map((draft) => saveDraft(draft, { sync: false })));
      syncDrafts().catch(() => {});
      if (!result) {
        toast('AI non disponibile: ho preparato una bozza da completare.', 'warn');
      }
      window.location.hash =
        drafts.length === 1 ? `#/review/${drafts[0].id}` : '#/drafts';
    } catch {
      errorElement.textContent = 'Non riesco a salvare le bozze. Riprova.';
      createButton.disabled = false;
      createButton.textContent = 'Crea bozze';
      processing = false;
    }
  });

  window.addEventListener(
    'hashchange',
    () => {
      recognition?.abort();
    },
    { once: true },
  );
}
