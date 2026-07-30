# CaricoFacile — Mini-gestionale di caricamento prodotti

**Data**: 2026-07-28 · **Stato**: Approvato (design) · **Versione**: 1.0

## Obiettivo

Permettere a commercianti non tecnici (a partire da Mimmo Fratelli) di caricare i prodotti
del proprio e-commerce in modo semplicissimo — foto, dettatura, file, barcode o a mano —
con compilazione automatica di tutti i campi e pubblicazione diretta sul sito.

## Decisioni approvate

| Ambito | Decisione |
|---|---|
| Destinatari | Multi-tenant, si parte da Mimmo Fratelli |
| Forma | PWA standalone mobile-first, repo indipendente |
| Architettura | Approccio C "ibrido leggero": PWA ↔ Supabase del tenant (dati) + micro-Worker Cloudflare (AI free-tier + registro tenant) |
| Input | Ibrido: foto, dettatura, CSV/Excel/PDF, barcode, manuale |
| Motore AI | 3 livelli: L0 senza AI (gratis), L1 free-tier (Gemini via Worker), L2 BYOK (chiave del cliente, edge function nel suo Supabase) |
| Integrazione | Scrittura diretta nel DB Supabase del tenant (products/weight_inventory) via RPC transazionale |
| Flusso | Revisione rapida per prodotto prima della pubblicazione (max 3 tocchi) |
| Foto | Ritaglio+compressione client-side sempre; miglioramento AI opzionale (L1/L2) |
| UI | Standard B2B best-in-class: pulizia estrema, gerarchia chiara, tocchi grandi (riferimenti: Linear, Stripe Dashboard, Shopify POS) |

## Architettura

```
┌─────────────────┐     dati (auth+RLS)      ┌──────────────────────┐
│   PWA mobile     │ ───────────────────────► │ Supabase del tenant  │
│  (vanilla JS +   │                          │  products, drafts,   │
│   Vite, PWA)     │ ◄─── AI BYOK (edge fn) ──│  storage foto        │
└────────┬────────┘                          └──────────────────────┘
         │ solo AI free-tier + config tenant
         ▼
┌─────────────────┐
│  Micro-Worker    │  proxy Gemini free-tier + quota/tenant (KV)
│  (Cloudflare)    │  + registro config tenant
└─────────────────┘
```

### Componenti

1. **PWA** — vanilla JS + Vite, installabile, hosting Cloudflare Pages.
   Multi-tenant: all'avvio carica la config del tenant (URL/anon key Supabase,
   categorie, mapping campi, lingua) dal registro del Worker; cache locale.
   Sviluppata nella cartella `gestionale/` di questo workspace, progettata per
   essere estratta in repo indipendente (nessun import dal sito Mimmo).
2. **Micro-Worker Cloudflare** (~200 righe) — due soli compiti:
   - `POST /ai/parse`: proxy verso Gemini Flash con chiave nostra; quota
     giornaliera per tenant (contatore in Workers KV); verifica JWT Supabase
     del tenant (firma JWKS registrata in config).
   - `GET /tenants/:slug/config`: config pubblica del tenant.
   Nessuna service key dei clienti nel Worker.
3. **Nel Supabase di ogni tenant** (pacchetto di onboarding):
   - Tabella `product_drafts` + RLS admin-only
   - RPC `publish_draft(draft_id)` transazionale
   - Bucket storage `product-photos`
   - (v1.1) Edge function `ai-byok` con chiave del cliente nei secrets

## Canali di ingresso × livelli AI

Home = 5 pulsanti giganti: 📸 Foto · 🎤 Detta · 📄 File · ⬛ Barcode · ✏️ A mano

| Canale | L0 (gratis, no AI) | L1 (free tier) | L2 (BYOK, v1.1) |
|---|---|---|---|
| 📸 Foto | — | Gemini Flash vision | modello a scelta |
| 🎤 Dettatura | — | Web Speech API (browser) → testo → Gemini | idem, modello migliore |
| 📄 CSV/Excel | PapaParse/SheetJS + mapping colonne guidato | AI mappa colonne e arricchisce | idem |
| 📄 PDF listino (v1.1) | — | Gemini legge il PDF | idem |
| ⬛ Barcode | scanner browser (BarcodeDetector + fallback lib) + OpenFoodFacts | + descrizione AI | idem |
| ✏️ Manuale | form con template per categoria | suggerimenti AI | idem |

**Fallback a catena**: L2 → L1 → L0 → campo vuoto evidenziato in revisione.
Se il Worker è irraggiungibile o la quota è esaurita, CSV/barcode/manuale
funzionano comunque (la PWA non ha dipendenze bloccanti dal Worker).

**Regola prezzo**: mai inventato dall'AI. O presente nell'input, o campo
vuoto obbligatorio in revisione.

**Pipeline foto**: sempre client-side ritaglio quadrato + compressione WebP
(canvas). Passo opzionale "✨ Migliora foto" (sfondo/luce) solo L1/L2 — v1.1.

## Flusso del negoziante (max 3 tocchi)

1. Tocca un canale → fornisce input (scatta, detta, carica file, scansiona)
2. Il sistema crea una **bozza** con campi compilati + confidenza per campo →
   schermata revisione: foto, nome, prezzo, categoria, peso/pezzo.
   Campi incerti evidenziati in giallo.
3. Tocca **Pubblica** → prodotto online sul suo sito.

Import in blocco (es. CSV 50 righe) = 50 bozze → revisione a scorrimento,
una card alla volta, swipe/tap per confermare.

**Offline-first**: bozze salvate anche in IndexedDB, sincronizzazione al
ritorno della connessione.

## Modello dati (nel Supabase del tenant)

```sql
CREATE TABLE product_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by UUID NOT NULL REFERENCES auth.users(id),
  source TEXT NOT NULL CHECK (source IN ('photo','voice','file','barcode','manual')),
  raw_input JSONB,                 -- input originale (testo dettato, riga CSV, EAN…)
  parsed JSONB NOT NULL DEFAULT '{}', -- campi + confidence per campo
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','discarded')),
  published_product_id UUID REFERENCES products(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- RLS: solo utenti admin del tenant (pattern user_roles esistente)
```

`publish_draft(p_draft_id UUID)`: SECURITY DEFINER, admin-only; in un'unica
transazione crea `products` (+ slug univoco) e `weight_inventory` (se vendita
a peso) e marca la bozza `published`. Idempotente (bozza già pubblicata → no-op).

## Sicurezza

- PWA autenticata con **l'auth Supabase del tenant** (login admin, pattern
  `user_roles` esistente). Nessuna chiave privilegiata nel client.
- Worker verifica il **JWT Supabase** (JWKS per tenant) prima di consumare
  quota free-tier → nessun abuso della chiave Gemini.
- BYOK: chiave mai nel browser; nei secrets del Supabase del cliente,
  usata solo dall'edge function `ai-byok`.
- Escape/sanitizzazione sistematica di ogni dato reso in HTML (lezione XSS
  del sito Mimmo applicata dal giorno 1).
- Onboarding tenant = 1 record registro + 1 migrazione SQL + bucket.

## Design UI (standard B2B best-in-class)

Riferimenti: Linear, Stripe Dashboard, Shopify POS.

- **Principi**: una sola azione primaria per schermata; gerarchia tipografica
  netta; spazio bianco generoso; zero decorazioni superflue; feedback
  immediato (skeleton, toast, micro-transizioni ≤200 ms).
- **Layout mobile-first**: header minimale, contenuto a card, bottom-nav a 3
  voci (Carica · Bozze · Prodotti). Su desktop: sidebar sottile.
- **Tocchi**: target ≥48 px; i 5 pulsanti canale come grandi tile con icona
  e label; pulsante Pubblica full-width fisso in basso nella revisione.
- **Sistema visivo**: font Inter; un solo colore accento (verde brand
  configurabile per tenant); neutri caldi per superfici; dark mode auto;
  radius 12 px; ombre soft a un livello.
- **Stati**: empty state illustrati con call-to-action; errori mai bloccanti
  con recupero suggerito; badge di confidenza (verde/giallo) sui campi.
- **Accessibilità**: contrasto AA, focus visibile, label sempre esplicite.

## Gestione errori

- Chiamate AI: timeout 20 s + 1 retry + fallback di livello; si atterra
  sempre sulla revisione, al peggio con campi vuoti.
- Quota esaurita → banner: "Riprova domani o configura la tua chiave" (v1.1 BYOK).
- Pubblicazione: RPC transazionale idempotente; rete assente → coda offline.

## Conformità AI Act (Reg. UE 2024/1689, art. 50 — applicabile dal 2/8/2026)

Requisiti vincolanti per ogni implementazione, verificati sulle linee guida
ufficiali della Commissione UE sugli obblighi di trasparenza:

1. **Disclosure interazione AI (art. 50.1)**: la UI dichiara esplicitamente
   quando un campo è compilato dall'AI — badge "✨ Compilato con AI" accanto
   ai confidence badge nella schermata di revisione. La scelta del livello
   AI (L0/L1/L2) resta sempre visibile e modificabile dal merchant.
2. **Marcatura contenuti sintetici (art. 50.2)**: le foto migliorate/generate
   con AI vengono salvate con metadato `ai_enhanced: true` in `product_drafts.parsed`
   e propagate a `products` alla pubblicazione; sul sito consumer l'immagine
   espone l'attributo `data-ai-enhanced` e una didascalia "Immagine migliorata
   con AI". Le descrizioni generate da AI e pubblicate senza modifiche
   sostanziali del merchant mantengono il flag `ai_generated: true`.
3. **Supervisione umana documentata**: la pubblicazione passa SEMPRE dalla
   revisione del merchant (già nel design: nessun publish automatico);
   `product_drafts` conserva `raw_input` e `parsed` come audit trail di cosa
   ha prodotto l'AI e cosa ha corretto l'umano.
4. **Nessun prezzo inventato dall'AI**: regola già in vigore (prezzo null se
   assente dall'input) — rilevante anche come mitigazione consumer protection.
5. **Fuori perimetro**: nessun riconoscimento emozioni, biometria o
   categorizzazione biometrica (Web Speech = solo trascrizione speech-to-text);
   nessun sistema alto rischio Annex III.
6. **Trasparenza sito consumer**: la pagina `trasparenza-ai.html` su
   www.mimmofratelli.com va tenuta aggiornata quando CaricoFacile pubblica i
   primi contenuti AI sul catalogo.

## Testing

Vitest (come repo Mimmo): unit sui parser (CSV mapping, normalizzazione
"3€/kg" → cents+grams, EAN), property test sulla normalizzazione, mock API
AI, integration test su `publish_draft`.

## Perimetro v1 (MVP per Mimmo)

**Dentro**: PWA (Carica/Bozze/Prodotti) + login + canali L0/L1 (foto,
dettatura, CSV/Excel, barcode, manuale) + revisione + pubblicazione +
Worker con quota + migrazione `product_drafts`/`publish_draft` per Mimmo.

**v1.1**: BYOK, miglioramento foto AI, import PDF, dashboard statistiche,
onboarding self-service tenant.

## Assunzioni

- La chiave Gemini free-tier è intestata allo sviluppatore; i limiti free
  bastano per l'uso quotidiano di un singolo negozio (quota/tenant nel Worker).
- Lo schema prodotti dei futuri tenant sarà compatibile con il pattern
  Mimmo (products + categories + weight_inventory); differenze gestite dal
  mapping campi nella config tenant.
- Il codice vive in `gestionale/` in questo workspace finché non verrà
  estratto in repo dedicato.
