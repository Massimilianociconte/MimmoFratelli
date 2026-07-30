# CaricoFacile — Piano di Implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PWA standalone multi-tenant con cui un negoziante carica prodotti via foto/dettatura/CSV/barcode/manuale, con auto-compilazione AI a 3 livelli e pubblicazione diretta nel Supabase del suo e-commerce.

**Architecture:** PWA vanilla JS+Vite in `gestionale/` che parla direttamente col Supabase del tenant (auth+RLS) per i dati, e con un micro-Worker Cloudflare per AI free-tier (proxy Gemini + quota KV) e registro tenant. Bozze in tabella `product_drafts`, pubblicazione via RPC transazionale `publish_draft`.

**Tech Stack:** Vite (vanilla JS), @supabase/supabase-js, PapaParse + SheetJS, BarcodeDetector API (+ @zxing/browser fallback), Web Speech API, IndexedDB (idb-keyval), Cloudflare Workers + KV (wrangler.jsonc, compatibility_date 2026-07-28), Gemini 2.5 Flash, Vitest.

**Spec di riferimento:** `docs/specs/2026-07-28-caricofacile-design.md`

---

## Mappa dei file

```
gestionale/
├── package.json / vite.config.js / index.html
├── public/manifest.webmanifest, icons/
├── src/
│   ├── main.js                  # bootstrap + router hash-based
│   ├── config/tenant.js         # carica config tenant (Worker → cache locale)
│   ├── lib/supabase.js          # client Supabase del tenant
│   ├── lib/store.js             # bozze offline (IndexedDB) + sync
│   ├── core/normalize.js        # prezzi/pesi/unità (pure functions)
│   ├── core/draft.js            # modello bozza + confidence + validazione
│   ├── channels/manual.js       # form manuale + template categoria
│   ├── channels/csv.js          # parsing CSV/XLSX + mapping colonne
│   ├── channels/barcode.js      # scanner + OpenFoodFacts
│   ├── channels/photo.js        # camera + compress WebP + AI vision
│   ├── channels/voice.js        # Web Speech API + AI parse
│   ├── ai/client.js             # catena L1→L0, chiamate al Worker
│   ├── ui/shell.js              # app shell, bottom-nav, toast
│   ├── ui/views/home.js         # 5 tile canali
│   ├── ui/views/review.js       # card revisione + Pubblica
│   ├── ui/views/drafts.js       # elenco bozze
│   ├── ui/views/products.js     # elenco prodotti pubblicati
│   ├── ui/views/login.js        # login admin
│   └── styles/tokens.css, base.css, components.css
├── worker/
│   ├── wrangler.jsonc
│   └── src/index.js             # router: GET /tenants/:slug/config, POST /ai/parse
│   └── src/jwt.js               # verifica JWT Supabase via JWKS
│   └── src/quota.js             # contatore giornaliero KV
├── tests/normalize.test.js, csv.test.js, draft.test.js
supabase/migrations/025_product_drafts.sql   # per il tenant Mimmo
```

Regole trasversali: ogni stringa resa in HTML passa da `esc()` (definita in `ui/shell.js`, pattern textContent); prezzi sempre in centesimi interni; nessuna chiave privilegiata nel client.

---

### Task 1: Scaffold PWA + design system B2B

**Files:** Create `gestionale/package.json`, `gestionale/vite.config.js`, `gestionale/index.html`, `gestionale/src/main.js`, `gestionale/src/styles/{tokens,base,components}.css`, `gestionale/public/manifest.webmanifest`

- [ ] **Step 1: package.json e vite**

```json
{
  "name": "caricofacile",
  "private": true,
  "type": "module",
  "scripts": { "dev": "vite", "build": "vite build", "preview": "vite preview", "test": "vitest run" },
  "dependencies": {
    "@supabase/supabase-js": "^2",
    "papaparse": "^5",
    "xlsx": "^0.18",
    "@zxing/browser": "^0.1",
    "idb-keyval": "^6"
  },
  "devDependencies": { "vite": "^6", "vitest": "^3" }
}
```

`vite.config.js`: `export default { base: './', build: { target: 'es2022' } }`

- [ ] **Step 2: index.html** — shell minima: `<div id="app">`, font Inter via `<link>` Google Fonts (`display=swap`), meta viewport, theme-color, link manifest. Lingua `it`.

- [ ] **Step 3: tokens.css** — design system B2B (riferimenti Linear/Stripe/Shopify POS):

```css
:root {
  --accent: #1a7f4e;            /* verde brand, sovrascrivibile da config tenant */
  --bg: #fafaf9; --surface: #ffffff; --border: #e7e5e4;
  --text: #1c1917; --text-2: #78716c;
  --ok: #16a34a; --warn: #d97706; --err: #dc2626;
  --radius: 12px; --shadow: 0 1px 3px rgb(0 0 0 / .08);
  --font: 'Inter', system-ui, sans-serif;
  --tap: 48px; --t: 180ms ease;
}
@media (prefers-color-scheme: dark) {
  :root { --bg:#0c0a09; --surface:#1c1917; --border:#292524; --text:#fafaf9; --text-2:#a8a29e; }
}
```

`base.css`: reset, tipografia (h1 22/700, h2 17/600, body 15/400), focus-visible ring accent.
`components.css`: `.btn-primary` (full-width, min-height var(--tap), radius, transizione ≤200ms), `.card`, `.tile` (grid 2 colonne, icona 32px + label), `.badge-confidence.ok/.warn`, `.bottom-nav` (3 voci fisse, safe-area-inset), `.toast`, `.skeleton`, `.empty-state`, `.field` (label sempre visibile sopra input, input min-height 48px).

- [ ] **Step 4: main.js** — router hash (`#/login`, `#/home`, `#/review/:id`, `#/drafts`, `#/products`, `#/channel/:name`): mappa route→funzione `render(el, params)`, guard auth (redirect a `#/login` se non autenticato), monta shell + view.

- [ ] **Step 5: verifica** — `cd gestionale && npm install && npm run dev` → apre shell vuota con bottom-nav, nessun errore console.

### Task 2: Migrazione Supabase 025 (product_drafts + publish_draft)

**Files:** Create `supabase/migrations/025_product_drafts.sql`

- [ ] **Step 1: scrivere la migrazione** (completa, per il tenant Mimmo):

```sql
-- 025: bozze prodotto + pubblicazione transazionale (CaricoFacile)
CREATE TABLE IF NOT EXISTS product_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('photo','voice','file','barcode','manual')),
  raw_input JSONB,
  parsed JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','discarded')),
  published_product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_product_drafts_status ON product_drafts(status, created_at DESC);

ALTER TABLE product_drafts ENABLE ROW LEVEL SECURITY;
-- Solo admin del tenant (pattern user_roles esistente)
CREATE POLICY drafts_admin_all ON product_drafts FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin'));

CREATE OR REPLACE FUNCTION publish_draft(p_draft_id UUID)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_draft product_drafts%ROWTYPE;
  v_parsed JSONB; v_product_id UUID; v_category_id UUID;
  v_slug TEXT; v_base_slug TEXT; v_n INT := 1; v_w JSONB;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin') THEN
    RETURN json_build_object('success', false, 'error', 'not_admin');
  END IF;

  SELECT * INTO v_draft FROM product_drafts WHERE id = p_draft_id FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('success', false, 'error', 'not_found'); END IF;
  IF v_draft.status = 'published' THEN
    RETURN json_build_object('success', true, 'skipped', true, 'product_id', v_draft.published_product_id);
  END IF;

  v_parsed := v_draft.parsed;
  IF coalesce(v_parsed->>'name','') = '' OR (v_parsed->>'price') IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'missing_required_fields');
  END IF;

  SELECT id INTO v_category_id FROM categories WHERE slug = v_parsed->>'category_slug';

  -- slug univoco
  v_base_slug := regexp_replace(lower(unaccent(v_parsed->>'name')), '[^a-z0-9]+', '-', 'g');
  v_base_slug := trim(both '-' from v_base_slug);
  v_slug := v_base_slug;
  WHILE EXISTS (SELECT 1 FROM products WHERE slug = v_slug) LOOP
    v_n := v_n + 1; v_slug := v_base_slug || '-' || v_n;
  END LOOP;

  INSERT INTO products (name, slug, description, price, sale_price, gender, category_id,
                        images, is_active, num_items, search_keywords)
  VALUES (
    v_parsed->>'name', v_slug, v_parsed->>'description',
    (v_parsed->>'price')::numeric, NULLIF(v_parsed->>'sale_price','')::numeric,
    coalesce(v_parsed->>'product_type','altro'), v_category_id,
    coalesce((SELECT array_agg(x) FROM jsonb_array_elements_text(v_parsed->'images') x), '{}'),
    true,
    CASE WHEN v_parsed->>'unit_type' = 'piece' THEN coalesce((v_parsed->>'num_items')::int, 0) END,
    coalesce((SELECT array_agg(x) FROM jsonb_array_elements_text(v_parsed->'keywords') x), '{}')
  ) RETURNING id INTO v_product_id;

  IF v_parsed->>'unit_type' = 'weight' THEN
    FOR v_w IN SELECT * FROM jsonb_array_elements(coalesce(v_parsed->'weights','[]'::jsonb)) LOOP
      INSERT INTO weight_inventory (product_id, weight_grams, quantity)
      VALUES (v_product_id, (v_w->>'grams')::int, coalesce((v_w->>'qty')::int, 0))
      ON CONFLICT (product_id, weight_grams) DO UPDATE SET quantity = EXCLUDED.quantity;
    END LOOP;
  END IF;

  UPDATE product_drafts SET status = 'published', published_product_id = v_product_id,
    updated_at = now() WHERE id = p_draft_id;

  RETURN json_build_object('success', true, 'product_id', v_product_id, 'slug', v_slug);
END $$;

GRANT EXECUTE ON FUNCTION publish_draft(UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION publish_draft(UUID) FROM anon, PUBLIC;

CREATE EXTENSION IF NOT EXISTS unaccent;

-- Bucket foto prodotti (idempotente)
INSERT INTO storage.buckets (id, name, public) VALUES ('product-photos','product-photos', true)
ON CONFLICT (id) DO NOTHING;
CREATE POLICY "admin upload product photos" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'product-photos' AND EXISTS
    (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin'));
```

- [ ] **Step 2: verificare colonne reali** — prima di applicare, confrontare i nomi colonna di `products` con `supabase/migrations/002_ecommerce_tables.sql` e correggere l'INSERT se necessario (es. presenza di `is_featured`, default). NON applicare la migrazione in produzione senza ok dell'utente.

### Task 3: Config tenant + client Supabase + login

**Files:** Create `gestionale/src/config/tenant.js`, `gestionale/src/lib/supabase.js`, `gestionale/src/ui/views/login.js`

- [ ] **Step 1: tenant.js** — `loadTenantConfig()`: legge `?t=<slug>` o localStorage; fetch `${WORKER_URL}/tenants/<slug>/config` con cache localStorage (TTL 24h) e fallback alla cache se offline. In dev, fallback a config statica Mimmo importata da `src/config/tenants.dev.js` (slug `mimmo`, supabaseUrl, anonKey, `accentColor`, `categories` [{slug,name,emoji}], `productTypes`, `aiLevel: 'free'`). Applica `--accent` da config.
- [ ] **Step 2: supabase.js** — `getClient()` singleton `createClient(cfg.supabaseUrl, cfg.anonKey)`.
- [ ] **Step 3: login.js** — form email+password (`signInWithPassword`), verifica ruolo admin (`from('user_roles').select('role').eq('user_id', uid)`); se non admin → signOut + errore. Guard in `main.js` su `onAuthStateChange`.
- [ ] **Step 4: verifica** — login con account admin Mimmo in dev → atterra su `#/home`.

### Task 4: Normalizzatore core (TDD)

**Files:** Create `gestionale/src/core/normalize.js`, `gestionale/tests/normalize.test.js`

- [ ] **Step 1: test falliti prima**

```js
import { describe, it, expect } from 'vitest';
import { parsePrice, parseWeightGrams, normalizeName } from '../src/core/normalize.js';

describe('parsePrice', () => {
  it('gestisce €/kg', () => expect(parsePrice('3€/kg')).toEqual({ value: 3, per: 'kg' }));
  it('gestisce virgola italiana', () => expect(parsePrice('2,50 €')).toEqual({ value: 2.5, per: null }));
  it('gestisce "al kg"', () => expect(parsePrice('4.90 al kg')).toEqual({ value: 4.9, per: 'kg' }));
  it('ritorna null se assente', () => expect(parsePrice('pomodori buoni')).toBeNull());
});
describe('parseWeightGrams', () => {
  it('500g → 500', () => expect(parseWeightGrams('500g')).toBe(500));
  it('1kg → 1000', () => expect(parseWeightGrams('1kg')).toBe(1000));
  it('1,5 kg → 1500', () => expect(parseWeightGrams('1,5 kg')).toBe(1500));
});
describe('normalizeName', () => {
  it('capitalizza e pulisce', () => expect(normalizeName('  pomodori CILIEGINO ')).toBe('Pomodori Ciliegino'));
});
```

- [ ] **Step 2:** `npm test` → FAIL (funzioni non definite)
- [ ] **Step 3: implementare** — regex: prezzo `/(\d+(?:[.,]\d{1,2})?)\s*€?\s*(?:\/|al\s+|all')?\s*(kg|hg|etto|g)?/i` con virgola→punto; peso `/(\d+(?:[.,]\d+)?)\s*(kg|g)/i` con conversione kg→g; nome: trim, collapse spazi, Title Case. Nessuna dipendenza esterna, pure functions.
- [ ] **Step 4:** `npm test` → PASS

### Task 5: Modello bozza + store offline

**Files:** Create `gestionale/src/core/draft.js`, `gestionale/src/lib/store.js`, `gestionale/tests/draft.test.js`

- [ ] **Step 1: draft.js** — shape canonica:

```js
// parsed: { name, description, price, sale_price, unit_type:'weight'|'piece',
//           weights:[{grams,qty}], num_items, category_slug, product_type,
//           images:[], keywords:[], barcode }
// confidence: { name:0..1, price:0..1, category_slug:0..1, ... }
export function newDraft(source, rawInput, parsed = {}, confidence = {}) { ... }
export function validateDraft(parsed) { /* → { ok, missing: ['price', ...] } */ }
export function lowConfidenceFields(confidence, threshold = 0.7) { ... }
```

Test: `validateDraft` richiede `name` e `price`; `lowConfidenceFields({name:.9, price:.4})` → `['price']`.

- [ ] **Step 2: store.js** — su `idb-keyval`: `saveDraftLocal`, `listLocalDrafts`, `syncDrafts()` (upsert verso `product_drafts` quando online, poi rimozione locale; ascolta `window online`). Le bozze remote si leggono con `from('product_drafts').select().eq('status','draft')`.
- [ ] **Step 3:** test unit su validate/confidence → PASS.

### Task 6: Canale Manuale + Review + Pubblica (primo E2E, livello L0)

**Files:** Create `gestionale/src/channels/manual.js`, `gestionale/src/ui/views/review.js`, `gestionale/src/ui/views/home.js`, `gestionale/src/ui/shell.js`

- [ ] **Step 1: shell.js** — `esc()` (textContent-based), `toast(msg, type)`, bottom-nav (Carica · Bozze · Prodotti), header col nome negozio da config.
- [ ] **Step 2: home.js** — 5 tile: 📸 Foto · 🎤 Detta · 📄 File · ⬛ Barcode · ✏️ A mano (grid 2 col, ultima full-width). Tile disabilitate con badge "richiede AI" se `aiLevel==='none'` (foto/detta).
- [ ] **Step 3: manual.js** — form: nome, prezzo, tipo vendita (peso→righe pezzature grams/qty | pezzo→num_items), categoria (select da config), descrizione, foto (input file → `compressImage()` condivisa). Submit → `newDraft('manual', ...)` → salva → `#/review/:id`.
- [ ] **Step 4: review.js** — card prodotto: foto, campi editabili inline, badge confidenza giallo su `lowConfidenceFields`, prezzo obbligatorio evidenziato se mancante. Azioni: **Pubblica** (btn-primary fisso in basso → upload foto su bucket → `rpc('publish_draft', {p_draft_id})` → toast ✅ → `#/home`), Scarta. Errori RPC mostrati con recupero suggerito, mai bloccanti.
- [ ] **Step 5: verifica E2E manuale** — creare un prodotto di prova da `#/channel/manual`, pubblicarlo, verificarlo su collection del sito, poi eliminarlo dall'admin.

### Task 7: Viste Bozze e Prodotti

**Files:** Create `gestionale/src/ui/views/drafts.js`, `gestionale/src/ui/views/products.js`

- [ ] drafts.js: lista card compatte (nome, fonte, data, badge campi mancanti) → tap = `#/review/:id`; empty-state con CTA "Carica il primo prodotto". Revisione a scorrimento: da una bozza, pulsante "Prossima" per la successiva.
- [ ] products.js: elenco `products` (nome, prezzo, attivo) sola lettura + link "modifica sull'admin" (URL admin del tenant da config).

### Task 8: Canale CSV/Excel (L0) — TDD sul mapping

**Files:** Create `gestionale/src/channels/csv.js`, `gestionale/tests/csv.test.js`

- [ ] **Step 1: test** — `guessColumnMapping(['Prodotto','Prezzo €/kg','Note'])` → `{ name: 0, price: 1, description: 2 }`; sinonimi: nome/prodotto/articolo/descrizione breve; prezzo/costo/€; categoria/reparto; peso/pezzatura/formato. `rowToDraftParsed(row, mapping)` usa `parsePrice`/`parseWeightGrams`; header non riconosciuti → mapping manuale.
- [ ] **Step 2:** implementare: PapaParse per .csv, SheetJS (`XLSX.read` + `sheet_to_json`) per .xlsx. UI: dropzone → anteprima prime 5 righe con select per colonna (pre-compilate dal guess) → "Importa N prodotti" → N bozze → redirect `#/drafts`.
- [ ] **Step 3:** `npm test` → PASS. Prova con listino reale di esempio (creare `gestionale/tests/fixtures/listino.csv`).

### Task 9: Canale Barcode (L0)

**Files:** Create `gestionale/src/channels/barcode.js`

- [ ] Scanner: `BarcodeDetector` nativo se disponibile (`'BarcodeDetector' in window`, formati ean_13/ean_8), altrimenti `@zxing/browser` su `<video>` (getUserMedia environment).
- [ ] Lookup: `GET https://world.openfoodfacts.org/api/v2/product/{ean}.json?fields=product_name_it,product_name,brands,quantity,categories_tags,image_front_url` → `parsed` con confidence 0.8 su name, 0 su price (mai inventato). Prodotto non trovato → bozza vuota con solo barcode + toast informativo.
- [ ] Verifica su smartphone reale (la camera richiede HTTPS o localhost).

### Task 10: Micro-Worker Cloudflare

**Files:** Create `gestionale/worker/wrangler.jsonc`, `gestionale/worker/src/{index,jwt,quota}.js`

- [ ] **Step 1: wrangler.jsonc** (sintassi verificata sui docs 2026):

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "caricofacile-api",
  "main": "src/index.js",
  "compatibility_date": "2026-07-28",
  "kv_namespaces": [{ "binding": "KV", "id": "<da creare: wrangler kv namespace create KV>" }],
  "secrets": { "required": ["GEMINI_API_KEY"] },
  "observability": { "enabled": true }
}
```

- [ ] **Step 2: index.js** — router su `fetch(request, env)`:
  - CORS: origin whitelist da config tenant; `OPTIONS` → 204.
  - `GET /tenants/:slug/config` → `env.KV.get('tenant:'+slug, 'json')` → risponde solo la parte `public` (supabaseUrl, anonKey, categorie, accentColor, aiLevel, adminUrl). 404 se assente.
  - `POST /ai/parse` → body `{ tenant, kind: 'text'|'image'|'csv-headers', payload, imageBase64? }`:
    1. `verifySupabaseJwt(request, tenantCfg)` (jwt.js) — 401 se invalido
    2. `checkQuota(env.KV, tenant)` (quota.js) — 429 con `{error:'quota_exceeded'}` se oltre
    3. chiama Gemini `POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GEMINI_API_KEY}` con `generationConfig: { responseMimeType: 'application/json' }` e prompt di sistema che impone lo schema `parsed` + `confidence` e VIETA di inventare il prezzo (price solo se presente nell'input, altrimenti null)
    4. valida il JSON di risposta contro i campi ammessi (whitelist) e risponde `{ parsed, confidence }`
- [ ] **Step 3: jwt.js** — fetch `${supabaseUrl}/auth/v1/.well-known/jwks.json` (cache in memoria 1h), verifica firma con WebCrypto (`crypto.subtle.importKey('jwk')` + `verify`), controlla `exp` e `aud === 'authenticated'`.
- [ ] **Step 4: quota.js** — chiave `quota:${tenant}:${YYYY-MM-DD}` in KV, `expirationTtl: 172800`, limite da config tenant (default 100/giorno). Get→incr→put (race accettabile per questo caso d'uso).
- [ ] **Step 5: seed registro** — `wrangler kv key put 'tenant:mimmo' '<json config>' --binding KV` con la config Mimmo (senza alcun secret).
- [ ] **Step 6: verifica** — `wrangler dev` + curl: config 200, /ai/parse senza JWT → 401, con JWT valido → JSON parsed.

### Task 11: AI client + canale Foto + canale Dettatura (L1)

**Files:** Create `gestionale/src/ai/client.js`, `gestionale/src/channels/photo.js`, `gestionale/src/channels/voice.js`

- [ ] **Step 1: ai/client.js** — `aiParse(kind, payload)`: se `aiLevel==='none'` → `null` subito; altrimenti POST al Worker con `Authorization: Bearer ${session.access_token}`, timeout 20s (`AbortSignal.timeout`), 1 retry; su 429 → toast "Quota AI esaurita, riprova domani"; su errore → `null` (la UI degrada a campi vuoti). Predisposizione L2: se `cfg.aiLevel==='byok'` chiama `functions.invoke('ai-byok')` (v1.1).
- [ ] **Step 2: photo.js** — `<input type="file" accept="image/*" capture="environment">`; `compressImage(file)`: canvas → crop quadrato centrale → max 1200px → WebP q0.8 (condivisa con manual.js, metterla in `core/image.js`); poi `aiParse('image', {imageBase64})` → bozza con foto già allegata → `#/review/:id`. Skeleton durante l'attesa.
- [ ] **Step 3: voice.js** — `webkitSpeechRecognition || SpeechRecognition`, `lang='it-IT'`, `continuous=true`: UI con pulsante mic gigante, trascrizione live visibile; stop → `aiParse('text', {text})`. Il testo può contenere PIÙ prodotti ("pomodori 3 euro al chilo e arance 2 e 50") → il Worker risponde un array → N bozze. Browser senza speech API → fallback textarea.
- [ ] **Step 4: verifica** — foto di un frutto → bozza con nome/categoria compilati e prezzo vuoto obbligatorio; dettatura di 2 prodotti → 2 bozze.

### Task 12: PWA + deploy

**Files:** Create `gestionale/public/manifest.webmanifest`, `gestionale/src/sw.js`; Modify `gestionale/index.html`, `gestionale/vite.config.js`

- [ ] manifest: name "CaricoFacile", display standalone, theme_color accent, icone 192/512 (generarle dal logo con ImageGen o dal negozio).
- [ ] Service worker essenziale: precache shell (cache-first per asset build, network-first per resto); registrazione in main.js.
- [ ] Deploy PWA su Cloudflare Pages (progetto dedicato, root `gestionale/`, build `npm run build`, output `dist/`); deploy Worker con `wrangler deploy` + `wrangler secret put GEMINI_API_KEY`. Aggiornare `WORKER_URL` in tenant.js.

### Task 13: QA finale

- [ ] `npm test` verde (normalize, csv, draft).
- [ ] Percorso completo su smartphone reale per ognuno dei 5 canali: input → bozza → revisione → pubblica → prodotto visibile sul sito Mimmo (poi rimuovere i prodotti di prova).
- [ ] Test offline: creare bozza in aereo-mode → torna online → sync.
- [ ] Test quota: forzare limite a 1 in KV e verificare il banner 429.
- [ ] Verifica escape XSS: creare bozza con nome `<img src=x onerror=alert(1)>` → deve apparire come testo ovunque.

---

## Fuori perimetro v1 (già deciso in spec)
BYOK (edge function `ai-byok`), miglioramento foto AI, import PDF, dashboard statistiche, onboarding self-service tenant.

## Conformità AI Act (vincolante — vedi sezione dedicata nella spec)
- **Task 5**: il modello bozza include `parsed.ai_generated: boolean` (true quando i campi provengono da `aiParse`, false per L0/manuale) — si propaga a `products` in `publish_draft`.
- **Task 6 (review UI)**: badge "✨ Compilato con AI" sui campi provenienti dall'AI, accanto ai confidence badge (art. 50.1 — disclosure interazione AI).
- **Task 11**: ogni bozza creata via `aiParse` porta `ai_generated: true`; la revisione umana obbligatoria prima del publish resta il presidio di supervisione (documentata da `raw_input`/`parsed` in `product_drafts`).
- **v1.1 (foto migliorata con AI)**: obbligo marcatura machine-readable + didascalia "Immagine migliorata con AI" sul sito consumer (art. 50.2) — requisito da inserire nel piano v1.1 prima di implementare.

## Note per l'esecutore
- La migrazione 025 va applicata solo dopo verifica colonne (Task 2 Step 2) e con ok esplicito dell'utente; idem `wrangler deploy`.
- Non toccare i file del sito Mimmo salvo la sola migrazione; il gestionale non deve importare nulla da `js/` del sito.
- Commit frequenti per task SOLO se l'utente ha autorizzato i commit.
