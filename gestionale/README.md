# CaricoFacile · Mimmo Fratelli

Istanza PWA di CaricoFacile collegata al Supabase reale di Mimmo Fratelli.
La base riutilizzabile e neutra si trova fuori da questo progetto in:

`/Users/massimilianociconte/Documents/Progetti/Carico Facile gestionale`

## Stato live

- PWA: <https://caricofacile-mimmo.pages.dev/>
- Worker produzione: <https://caricofacile-api.nexify-api.workers.dev/>
- Worker staging:
  <https://caricofacile-api-staging.nexify-api.workers.dev/>
- tenant predefinito: `mimmo`
- Supabase: progetto Mimmo già collegato
- migrazioni CaricoFacile: `027_product_drafts.sql` e
  `20260729002257_restrict_caricofacile_photo_listing.sql`

Login, bozze, foto e pubblicazione usano direttamente il Supabase di Mimmo.
La RPC `publish_draft` scrive nella stessa tabella `products` letta dal sito e
dall'amministrazione esistente.

## Stato AI

Il Worker è online e il tenant è registrato, ma la chiave
`GEMINI_API_KEY` non è presente. I canali L0 (manuale, CSV/Excel e barcode)
restano disponibili; fotografia e dettatura degradano alla revisione senza
compilazione AI.

Per attivare Gemini, senza salvare la chiave in file:

```bash
cd gestionale/worker
npx wrangler secret put GEMINI_API_KEY --env staging
npm run deploy:staging
npx wrangler secret put GEMINI_API_KEY --env production
npm run deploy
```

La verifica finale deve restituire `aiConfigured: true`:

```bash
curl https://caricofacile-api.nexify-api.workers.dev/health
```

## Sviluppo locale

Requisiti: Node.js 20 o successivo e npm.

```bash
cd gestionale
cp .env.example .env.local
npm install
npm run dev
```

Senza URL e chiave pubblica Supabase in sviluppo, l'app entra
automaticamente in anteprima locale. La build di produzione usa invece
`.env.production` e carica la configurazione Supabase dal Worker.

Verifiche:

```bash
npm test
npm run build
npm audit --audit-level=high

cd worker
npm install
npm test
npm run types
npm run check
npm audit --audit-level=high
```

## Configurazione Mimmo

La sorgente pubblica del tenant è:

`worker/config/tenant.mimmo.example.json`

Il comando seguente legge URL e chiave pubblica dal `js/config.js` del sito,
ne verifica progetto e ruolo, quindi genera un file locale ignorato da Git:

```bash
cd gestionale/worker
npm run tenant:mimmo:render
```

Il file risultante non contiene service-role key, password, chiave Gemini o
altri segreti. Viene caricato nei namespace KV con la chiave
`tenant:mimmo`.

## Contratto dati

- Le bozze usano un modello canonico indipendente dal database.
- I prezzi delle bozze sono interi in centesimi.
- `publish_draft` converte i prezzi in euro, crea `products` e
  `weight_inventory`, poi marca la bozza pubblicata.
- La funzione è transazionale, idempotente, admin-only e revocata ad `anon`.
- Il bucket `product-photos` è pubblico per gli URL oggetto, ma non è
  enumerabile anonimamente.
- Nessuna chiave privilegiata viene inviata al browser o salvata nel Worker.

## Collaudo eseguito

- test app: 44/44;
- test Worker: 12/12;
- build app e dry-run Worker;
- configurazione tenant e CORS su staging/produzione;
- migrazioni presenti sul database remoto;
- prova RPC con ruolo admin e pulizia automatica;
- prodotto tecnico letto dall'API pubblica e dalla pagina prodotto live;
- zero prodotti, bozze o immagini di prova residui;
- rendering della schermata login pubblica senza errori console.

Restano manuali perché richiedono credenziali o dispositivo fisico:

- login con password dell'amministratore;
- foto, fotocamera, barcode e dettatura su smartphone reale;
- installazione PWA e sincronizzazione dopo modalità aereo;
- chiamata AI reale dopo l'impostazione della chiave Gemini.

## Sicurezza operativa

- non inserire mai service-role key o provider secret in variabili `VITE_*`;
- mantenere le origin Worker ristrette alle PWA autorizzate;
- aggiungere i clienti tramite un nuovo record `tenant:<slug>` e una RPC
  adapter verificata sul loro schema;
- eseguire sempre una prova pubblicazione/rimozione prima del go-live.
