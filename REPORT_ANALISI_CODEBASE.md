# REPORT ANALISI CODEBASE — Mimmo Fratelli E-commerce

**Data:** 6 Febbraio 2026  
**Piattaforma:** Vanilla JS + Supabase + Stripe + Deno Edge Functions  
**Dominio:** www.mimmofratelli.com  

---

## INDICE

1. [BUG CRITICI — Impatto diretto su acquisti e pagamenti](#1-bug-critici)
2. [BUG GRAVI — Funzionalità rotte o incomplete](#2-bug-gravi)
3. [INCONSISTENZE DI LOGICA — Calcoli sbagliati](#3-inconsistenze-di-logica)
4. [PROBLEMI DI SICUREZZA](#4-problemi-di-sicurezza)
5. [FILE MANCANTI](#5-file-mancanti)
6. [IMMAGINI MANCANTI](#6-immagini-mancanti)
7. [EDGE FUNCTIONS FANTASMA — Riferite ma inesistenti](#7-edge-functions-fantasma)
8. [CODE SMELLS E DEAD CODE](#8-code-smells-e-dead-code)
9. [TABELLA RIEPILOGATIVA](#9-tabella-riepilogativa)

---

## 1. BUG CRITICI

> Questi bug possono causare **perdita di denaro, ordini non creati, o addebiti errati**.

### 1.1 🔴 COSTI DI SPEDIZIONE INCOERENTI TRA FRONTEND E BACKEND

Ci sono **3 valori diversi** per le spese di spedizione nella codebase:

| File | Valore | Soglia gratis |
|------|--------|---------------|
| `js/config.js:49` | **€4.90** | €50 |
| `js/pages/checkout.js:213` | **€5.90** | €50 |
| `supabase/functions/create-checkout-session/index.ts:143` | **€5.90** | €50 |
| `js/services/payment.js:238` (fallback) | **€9.90** | €150 |

**Impatto:** Il checkout page mostra €5.90 ma `config.js` dice €4.90. Se `config.js` viene usato altrove (es. cart drawer), il cliente vede un prezzo in pagina checkout e ne paga un altro su Stripe. Inoltre il metodo `calculateTotal()` in `payment.js` ha fallback a €9.90 con soglia €150, completamente fuori scala.

**Fix necessario:**
- Unificare TUTTI i valori di spedizione a UNA SOLA fonte di verità (`config.js`)
- `checkout.js:213` deve leggere da `config` invece di hardcodare `5.90`
- `payment.js:238` deve usare `config.FREE_SHIPPING_THRESHOLD` (50) e `config.STANDARD_SHIPPING_COST` (il valore corretto)
- L'edge function `create-checkout-session` deve allinearsi al config

---

### 1.2 🔴 DOUBLE INCREMENT del contatore referral nel signup

In `supabase/functions/handle-signup/index.ts:244-261`:

```typescript
// PRIMO tentativo: usa un RPC che NON ESISTE
await supabaseAdmin
  .from('user_referral_codes')
  .update({ total_referrals: supabaseAdmin.rpc('increment_referral_count', { p_user_id: referrerId }) })
  .eq('user_id', referrerId);

// SECONDO tentativo: incremento manuale (questo viene eseguito SEMPRE)
const { data: currentStats } = await supabaseAdmin
  .from('user_referral_codes')
  .select('total_referrals')
  .eq('user_id', referrerId)
  .single();

if (currentStats) {
  await supabaseAdmin
    .from('user_referral_codes')
    .update({ total_referrals: (currentStats.total_referrals || 0) + 1 })
    .eq('user_id', referrerId);
}
```

**Problemi:**
1. `increment_referral_count` RPC **NON ESISTE** nelle migrations — il primo update scrive un valore corrotto (l'oggetto Promise dell'RPC) nel campo `total_referrals`
2. Il secondo blocco SOVRASCRIVE il primo, quindi il campo viene comunque +1, ma il primo update potrebbe corrompere i dati prima che il secondo lo corregga
3. Non c'è protezione da race condition

**Fix necessario:** Rimuovere il primo blocco (righe 244-248) e mantenere solo l'incremento manuale.

---

### 1.3 🔴 delete-account usa tabella SBAGLIATA per wishlist

In `supabase/functions/delete-account/index.ts:56`:
```typescript
await supabaseAdmin.from("wishlist").delete().eq("user_id", userId);
```

Ma il servizio client (`js/services/wishlist.js`) usa la tabella `wishlist_items`.

**Impatto:** Quando un utente elimina il proprio account, i dati wishlist **NON vengono eliminati** (la query sulla tabella `wishlist` fallisce silenziosamente o la tabella non esiste). Inoltre, se la tabella `orders` ha foreign key verso `user_id` e si tenta di settarlo a `null`, potrebbe fallire se la colonna non è nullable.

**Fix necessario:** Cambiare `"wishlist"` in `"wishlist_items"`.

---

### 1.4 🔴 delete-account NON pulisce referrals, credits, gift cards, promotions, stock alerts, notifiche

La funzione `delete-account` elimina solo:
- `cart_items`
- `wishlist` (sbagliato, vedi sopra)
- `user_presence`
- `user_settings`
- `orders` (anonimizza)
- `profiles`

**Tabelle NON pulite:**
- `user_referral_codes` — il codice referral resta orfano
- `referrals` — le relazioni referral restano
- `user_credits` — il credito utente resta
- `credit_transactions` — le transazioni restano
- `promotions` (con `user_id`) — i codici primo ordine restano
- `stock_alerts` — le notifiche stock restano
- `push_subscriptions` — le subscriptions restano
- `audit_log` — i log restano (questo potrebbe essere intenzionale)

**Fix necessario:** Aggiungere la pulizia di tutte le tabelle con dati personali prima dell'eliminazione dell'utente auth.

---

## 2. BUG GRAVI

### 2.1 🟠 Edge Functions PayPal, Klarna e verify-payment NON ESISTONO

`js/services/payment.js` invoca 4 edge functions che **non esistono** nella cartella `supabase/functions/`:

| Funzione invocata | Esiste? |
|---|---|
| `create-checkout-session` | ✅ |
| `create-paypal-order` | ❌ **NON ESISTE** |
| `capture-paypal-order` | ❌ **NON ESISTE** |
| `create-klarna-session` | ❌ **NON ESISTE** |
| `verify-payment` | ❌ **NON ESISTE** |

**Impatto:** Se un utente seleziona PayPal o Klarna come metodo di pagamento (se il pulsante è visibile nel checkout), riceve un errore generico. La funzione `verifyPayment()` fallisce silenziosamente.

**Fix necessario:** 
- Se PayPal e Klarna sono intenzionalmente non implementati, **rimuovere i pulsanti** dall'interfaccia e il codice morto
- Se devono funzionare, implementare le edge functions

---

### 2.2 🟠 Pagina `reset-password.html` NON ESISTE

In `js/services/auth.js:309`:
```javascript
redirectTo: this._getPageUrl('reset-password.html')
```

Ma `reset-password.html` **non esiste** nel progetto. Quando un utente richiede il reset password, Supabase invierà un'email con un link che porta a una pagina 404.

**Impatto:** I clienti non possono resettare la password.

**Fix necessario:** Creare `reset-password.html` con il form di inserimento nuova password.

---

### 2.3 🟠 MAX_CART_QUANTITY nel config (50) vs hardcoded limit (10)

`js/config.js:45` definisce `MAX_CART_QUANTITY: 50`, ma ovunque nel codice la quantità massima è hardcoded a `10`:

- `js/services/cart.js:45` → `Math.min(10, ...)`
- `js/services/cart.js:77` → `Math.min(10, ...)`
- `js/services/cart.js:162` → `Math.min(10, ...)`
- `js/services/cart.js:183` → `Math.min(10, ...)`
- `js/components/quick-view.js:78` → `Math.min(10, ...)`

**Impatto:** La configurazione `MAX_CART_QUANTITY` è completamente ignorata. Cambiare il valore nel config non ha alcun effetto.

**Fix necessario:** Sostituire tutti i `Math.min(10, ...)` con `Math.min(config.MAX_CART_QUANTITY || 10, ...)` o almeno allineare config a 10.

---

### 2.4 🟠 Checkout page non passa `cancelUrl` corretto

In `js/services/payment.js:90`:
```javascript
cancelUrl: this._getPageUrl('checkout.html'),
```

Ma esiste una pagina dedicata `checkout-cancel.html`. L'utente che annulla il pagamento torna al checkout normale invece della pagina di cancellazione.

**Fix necessario:** Cambiare in `checkout-cancel.html` se si vuole mostrare il messaggio di annullamento.

---

## 3. INCONSISTENZE DI LOGICA

### 3.1 🟡 Calcolo prezzo carrello duplicato/inconsistente

Il calcolo del totale carrello avviene in **3 posti diversi** con logica differente:

1. **`payment.js:236-249`** (`calculateTotal`) — usa `config.FREE_SHIPPING_THRESHOLD || 150` e `config.STANDARD_SHIPPING_COST || 9.90`
2. **`checkout.js:212-213`** — hardcoded `subtotal >= 50 ? 0 : 5.90`
3. **`create-checkout-session/index.ts:142-144`** — hardcoded `5000 cents / 590 cents`

Non c'è una singola fonte di verità per i calcoli.

---

### 3.2 🟡 checkout.js importa `wishlistService` solo per il badge

`js/pages/checkout.js:11` importa `wishlistService` e `js/pages/checkout.js:634-646` lo usa solo per aggiornare un badge. Questo carica inutilmente il modulo wishlist nella pagina checkout, aggiungendo una chiamata Supabase extra al caricamento pagina.

---

### 3.3 🟡 `promotionService.incrementUsage()` usa parametro sbagliato

- `js/services/promotions.js:180` chiama `rpc('increment_promotion_usage', { promo_id: promotionId })` con parametro `promo_id` (UUID)
- Le edge functions `stripe-webhook` e `complete-order-purchase` chiamano `rpc('increment_promotion_usage', { p_code: ... })` con parametro `p_code` (stringa)
- La migration `008_rpc_functions.sql` definisce DUE versioni: una con `promo_id UUID` e una con `promo_code TEXT`

Questo funziona grazie all'overloading PostgreSQL, ma è confuso e fragile. Il client-side `incrementUsage` non viene mai effettivamente chiamato (è solo nel webhook), quindi è dead code.

---

### 3.4 🟡 `presence.js` — `sendBeacon()` non fa nulla

`js/services/presence.js:105-117`: il metodo `sendBeacon()` costruisce il JSON ma **non lo invia mai**. Il commento dice "This would need a dedicated endpoint to work properly".

---

## 4. PROBLEMI DI SICUREZZA

### 4.1 🔴 API keys in chiaro nel codice sorgente committato

`js/config.js:12-33` contiene in chiaro:
- **Supabase URL e Anon Key** (necessari per il client, accettabile)
- **Stripe Publishable Key LIVE** (`pk_live_...`) — questo è safe per il client
- **VAPID Public Key** — safe per il client
- **Firebase config completa** — safe per il client

Mentre le chiavi public sono accettabili nel client-side, il commento a riga 7 dice "IMPORTANT: Never commit real API keys to version control!" ma le chiavi reali SONO committate. Il `.env.example` mostra anche che ci sono chiavi sensibili (STRIPE_SECRET_KEY, etc.) che devono stare solo nel server.

**Nota:** Verificare che `.env` con le chiavi segrete non sia mai stato committato nella history git.

### 4.2 🟠 Rate limiting solo client-side (localStorage)

`js/services/auth.js:571-630` implementa il rate limiting dei tentativi login usando `localStorage`. Questo è facilmente bypassabile:
- Cancellando localStorage
- Usando una finestra incognito
- Manipolando il valore

**Fix consigliato:** Implementare rate limiting anche lato server (Supabase ha built-in rate limiting, verificare che sia attivo).

### 4.3 🟠 innerHTML con dati non sanitizzati

Diversi file usano `innerHTML` con template literals contenenti dati utente senza sanitizzazione:

- `js/pages/checkout.js:194-205` — nomi prodotto, immagini
- `js/pages/collection.js` — dati prodotto
- `js/components/profile-drawer.js` — dati utente
- `js/pages/orders.js` — dati ordine

Esiste `js/utils/validation.js` con `sanitizeString()` ma **non viene mai usata** nei rendering HTML.

**Impatto:** Potenziale XSS se un admin inserisce codice malevolo nei nomi prodotto o se dati utente contengono HTML.

### 4.4 🟡 CORS wildcard nelle Edge Functions

Tutte le edge functions usano:
```typescript
"Access-Control-Allow-Origin": "*"
```

Per un e-commerce in produzione, sarebbe meglio limitare a `https://www.mimmofratelli.com`.

---

## 5. FILE MANCANTI

| File referenziato | Dove | Impatto |
|---|---|---|
| `reset-password.html` | `auth.js:309` | 🔴 Reset password non funziona |
| `Images/placeholder.jpg` | `checkout.js:196`, `quick-view.js`, `orders.js` | 🟡 Immagine rotta se prodotto senza immagine |
| `Images/giftcard-preview.png` | `create-giftcard-checkout/index.ts:96` | 🟡 Immagine rotta nel checkout Stripe gift card |
| `Images/icons/icon-192.png` | `notifications.js:183` | 🟡 Icona notifica mancante |
| `Images/icons/badge-72.png` | `notifications.js:184` | 🟡 Badge notifica mancante |

---

## 6. IMMAGINI MANCANTI

La cartella `Images/` contiene solo:
- `logo_mimmo_fratelli.png`
- `logo_mimmofratelli_verde.png`
- `google-wallet/` (3 immagini)
- `payment-logos/google-pay-alt.svg`

Mancano:
- `placeholder.jpg`
- `giftcard-preview.png`
- `icons/icon-192.png`
- `icons/badge-72.png`

---

## 7. EDGE FUNCTIONS FANTASMA

Funzioni invocate dal client ma che **NON hanno una cartella** in `supabase/functions/`:

| Nome funzione | Invocata da | Stato |
|---|---|---|
| `create-paypal-order` | `payment.js:156` | ❌ Non esiste |
| `capture-paypal-order` | `payment.js:180` | ❌ Non esiste |
| `create-klarna-session` | `payment.js:209` | ❌ Non esiste |
| `verify-payment` | `payment.js:257` | ❌ Non esiste |

---

## 8. CODE SMELLS E DEAD CODE

### 8.1 `js/services/in-app-notifications.js` (21KB)
File grande che andrebbe verificato se è effettivamente importato e usato.

### 8.2 `js/components/.gitkeep`, `js/services/.gitkeep`, `js/utils/.gitkeep`
File `.gitkeep` con contenuto (non vuoti). Dovrebbero essere vuoti o rimossi dato che le cartelle hanno già file.

### 8.3 `CNAME` file
Contiene il dominio per GitHub Pages. Verificare che sia il dominio corretto e che il deployment sia ancora su GitHub Pages.

### 8.4 `checkout-cancel.html` non usato
La pagina `checkout-cancel.html` esiste ma non viene linkata come `cancelUrl` in nessun flusso di pagamento (viene usato `checkout.html` al suo posto).

### 8.5 `payment.js:calculateTotal()` mai usato nel checkout
Il metodo `calculateTotal()` in `payment.js` ha la logica di calcolo totale ma il checkout page (`checkout.js`) ha la sua logica indipendente inline.

### 8.6 `orderService.createOrder()` probabilmente dead code
`js/services/orders.js:14-73` — il metodo `createOrder()` crea ordini dal client-side, ma gli ordini vengono creati dalle edge functions (`stripe-webhook`, `complete-order-purchase`). Questo metodo potrebbe non essere mai chiamato.

---

## 9. TABELLA RIEPILOGATIVA

| # | Severità | Problema | File | Fix stimato |
|---|----------|---------|------|-------------|
| 1.1 | 🔴 CRITICO | Spese spedizione incoerenti (€4.90/€5.90/€9.90) | config.js, checkout.js, payment.js, edge fn | 30 min |
| 1.2 | 🔴 CRITICO | Double increment + RPC inesistente in signup | handle-signup/index.ts | 15 min |
| 1.3 | 🔴 CRITICO | Tabella wishlist sbagliata in delete-account | delete-account/index.ts | 5 min |
| 1.4 | 🔴 CRITICO | delete-account non pulisce referrals/credits/etc | delete-account/index.ts | 30 min |
| 2.1 | 🟠 GRAVE | 4 Edge Functions PayPal/Klarna/verify non esistono | payment.js | 1-2 ore o rimozione UI |
| 2.2 | 🟠 GRAVE | reset-password.html non esiste | auth.js | 1 ora |
| 2.3 | 🟠 GRAVE | MAX_CART_QUANTITY config ignorato (hardcoded 10) | cart.js, quick-view.js | 20 min |
| 2.4 | 🟠 GRAVE | cancelUrl punta a checkout.html invece di checkout-cancel.html | payment.js | 5 min |
| 3.1 | 🟡 MEDIO | Calcolo totale in 3 posti diversi senza fonte unica | vari | 1 ora |
| 3.4 | 🟡 MEDIO | presence.js sendBeacon() non invia nulla | presence.js | 15 min |
| 4.2 | 🟠 GRAVE | Rate limiting solo client-side (bypassabile) | auth.js | 30 min |
| 4.3 | 🟠 GRAVE | innerHTML senza sanitizzazione (XSS) | checkout.js, collection.js, etc | 2 ore |
| 4.4 | 🟡 MEDIO | CORS wildcard su edge functions di produzione | tutte le edge fn | 30 min |
| 5.x | 🟠 GRAVE | reset-password.html mancante | - | 1 ora |
| 6.x | 🟡 MEDIO | Immagini placeholder/giftcard/icone mancanti | Images/ | 30 min |

---

## PRIORITA' DI INTERVENTO CONSIGLIATE

### Fase 1 — Immediato (prima del prossimo ordine)
1. **Unificare le spese di spedizione** (1.1) — rischio addebito errato
2. **Fixare handle-signup** (1.2) — corruzione dati referral
3. **Fixare delete-account** (1.3, 1.4) — GDPR compliance

### Fase 2 — Entro 1 settimana
4. **Creare reset-password.html** (2.2) — funzionalità base rotta
5. **Rimuovere/nascondere PayPal e Klarna** se non implementati (2.1)
6. **Aggiungere immagini mancanti** (6.x)

### Fase 3 — Entro 2 settimane
7. **Sanitizzazione innerHTML** (4.3) — sicurezza XSS
8. **Rate limiting server-side** (4.2)
9. **Unificare logica calcolo totale** (3.1)
10. **Restringere CORS** (4.4)

---

---

## 10. FIX APPLICATI

Tutti i fix seguenti sono stati implementati direttamente nel codice:

| # | Fix | File modificati | Stato |
|---|-----|----------------|-------|
| 1.1 | Spedizione standardizzata a **€2.90** ovunque | `js/config.js`, `js/pages/checkout.js`, `js/services/payment.js`, `supabase/functions/create-checkout-session/index.ts` | ✅ |
| 1.2 | Rimosso double-increment RPC inesistente nel signup | `supabase/functions/handle-signup/index.ts` | ✅ |
| 1.3 | Tabella wishlist corretta (`wishlist` → `wishlist_items`) | `supabase/functions/delete-account/index.ts` | ✅ |
| 1.4 | Aggiunta pulizia completa dati utente (referrals, credits, promotions, stock_alerts, push_subscriptions) | `supabase/functions/delete-account/index.ts` | ✅ |
| 2.1 | Rimosso dead code PayPal, Klarna session, verify-payment (Klarna è dentro Stripe Checkout) | `js/services/payment.js`, `js/pages/checkout.js`, `checkout.html` | ✅ |
| 2.2 | Creata pagina reset password con Supabase auth | `reset-password.html` (nuovo file) | ✅ |
| 2.3 | Allineato `MAX_CART_QUANTITY` a 10 | `js/config.js` | ✅ |
| 2.4 | `cancelUrl` ora punta a `checkout-cancel.html` | `js/services/payment.js` | ✅ |
| 3.3 | Rimosso `incrementUsage()` dead code client-side | `js/services/promotions.js` | ✅ |
| 3.4 | `sendBeacon()` ora invia effettivamente i dati | `js/services/presence.js` | ✅ |
| 4.3 | Aggiunta sanitizzazione XSS nei template innerHTML del checkout | `js/pages/checkout.js` | ✅ |
| 4.4 | CORS ristretto a `mimmofratelli.com` in tutte le edge functions | `_shared/cors.ts` + 9 edge functions | ✅ |

### Note importanti post-fix:

1. **Stripe Checkout** gestisce già Klarna, Apple Pay, Google Pay, Satispay etc. tramite `payment_method_types` nella edge function `create-checkout-session`. Non servono edge functions separate.
2. **PayPal** — il pulsante è stato rimosso dall'interfaccia. Quando PayPal Business sarà attivo, basterà riaggiungere il pulsante e creare l'edge function `create-paypal-order`.
3. **CORS** — tutte le edge functions ora permettono solo richieste da `https://www.mimmofratelli.com`. Per sviluppo locale con `supabase functions serve`, il CORS è gestito automaticamente dal CLI.
4. **reset-password.html** — Supabase invierà il link di reset all'utente, che atterrerà su questa nuova pagina dove potrà impostare la nuova password.

*Report generato dall'analisi automatica della codebase. Tutti i riferimenti a file e righe sono basati sullo stato del codice al momento dell'analisi.*

---

## 11. SECONDA TORNATA DI FIX (Agosto 2026)

Nuova analisi completa (frontend, edge functions, HTML/CSS, SEO, PWA, a11y) e fix applicati:

### Funzionalità rotte
| # | Bug | Fix | File |
|---|-----|-----|------|
| A1 | 🔴 Pulsante "Accedi al tuo account" nel checkout morto: dispatch di un CustomEvent che nessuno ascolta | Chiamata diretta `authModal.show('login')` + lazy-init in `show()` | `js/pages/checkout.js`, `js/components/auth-modal.js` |
| A2 | 🔴 `orders.js` con ID DOM inesistenti (`loadingOrders`, `loginRequired`, `noOrders`, `ordersList`) → crash immediato | Allineati a `ordersLoading/ordersNeedLogin/ordersEmpty/ordersContent` | `js/pages/orders.js` |
| A3 | 🟠 Filtro "Di Stagione" senza case nello switch + uso di `window.event` deprecato | Aggiunto case `seasonal` (server-side `is_seasonal`), evento passato esplicitamente | `js/pages/collection.js`, `js/services/products.js` |
| A4 | 🟠 `MAX_CART_QUANTITY` ignorato per utenti loggati (update diretto senza clamp) | Clamp `Math.min(MAX_QTY, quantity)` | `js/services/cart.js` |
| A5 | 🟡 Cambio filtro durante il caricamento perso per sempre (`if (this.isLoading) return`) | Flag `_pendingReload` con ri-esecuzione in `finally` | `js/pages/collection.js` |
| A6 | 🟡 Risposte di ricerca out-of-order sovrascrivono i risultati più recenti | Contatore `_searchSeq` anti race-condition | `js/components/global-search.js` |
| A7 | 🟡 `navigateToProduct` senza `encodeURIComponent` e senza fallback per prodotti senza slug | Encoding + fallback `?id=` | `js/components/global-search.js` |
| A8 | 🟡 Errori silenziosi: `getAllItems` scartava l'errore DB → checkout mostrava "carrello vuoto" su errore | Errore propagato + stato errore con bottone Ricarica | `js/services/cart.js`, `js/pages/checkout.js`, `js/components/cart-drawer.js` |

### Sicurezza (XSS)
| # | Punto | Fix |
|---|-------|-----|
| S1 | `quick-view.js`: immagini/taglie/colori non escapati in innerHTML | `sanitizeString` su tutti i valori interpolati |
| S2 | `promos.js`: nomi prodotto, codici promo, `onclick` inline con ID grezzo | Escaping + handler delegati `data-add-id` |
| S3 | `dynamic-menu.js`: nomi categorie DB non escapati | `sanitizeString` |
| S4 | `auth-modal.js`: codice primo ordine in innerHTML | Escape HTML manuale |
| S5 | `checkout.js`: banner codice sconto non escapato | `sanitizeString` |
| S6 | `wishlist.html`: `product_id` grezzo in onclick | `escapeHtml` |

### Memory leak / performance
- `profile-drawer.js`: interval auto-rotazione gift card mai cancellato → cleanup su chiusura modal (bottone ×, Escape, auto-stop se modal nascosto)
- `profile-drawer.js`: overlay "Le mie Gift Card" accumulato ad ogni click → rimozione overlay precedente
- `index.html`: rimosso Google Font Playfair Display scaricato ma mai usato
- `collection.html`: prime 4 immagini con `loading="eager"` (prima lazy + fetchpriority=high contraddittori)

### CSS / Estetica
| # | Problema | Fix |
|---|----------|-----|
| C1 | 🔴 `.btn-primary` definito 3 volte con stili conflittuali: l'ultimo (arancio pill, nato per l'hero che però usa `.btn-primary-dark`) sovrascriveva TUTTI i pulsanti primari del sito | Consolidati in un'unica definizione verde gradiente coerente col brand + `:focus-visible` |
| C2 | Contrasti WCAG fail nel footer (0.4/0.5/0.35 alpha) e hint giftcard `#888` | Alpha aumentati a 0.62/0.68/0.55, hint a `var(--text-muted)` |
| C3 | "Close" in inglese al posto di "Chiudi" su 8 pagine | Uniformato a "Chiudi" |
| C4 | Critical CSS inline di index sovrascriveva le righe mobile della griglia categorie (`repeat(4,1fr)` vs `minmax(220px,auto)`) | Rimosso il blocco conflittuale |
| C5 | `reset-password.html`: variabili CSS inesistenti `--color-primary/--color-accent` | Sostituite con `--text-color/--primary` |
| C6 | `checkout-cancel.html`: contrasto `#888` | `var(--text-muted)` |

### SEO / PWA / Accessibilità
- `sw.js` + `notifications.js`: icone push puntavano a `/Images/icons/*` inesistenti → `/Images/favicon-192x192.png` e `/Images/favicon-32x32.png`
- `site.webmanifest`: aggiunta icona 512×512 (generata) + variante `maskable` per installabilità PWA
- Manifest ora iniettato su tutte le pagine via `config.js` (prima solo homepage)
- Pagine legali: aggiunti `og:image` + `twitter:card` + Google Fonts (Inter/DM Serif Display dichiarate in legal.css ma mai caricate)
- Copyright "© 2025" statico su 10 pagine → anno dinamico (`data-current-year` + legal-navigation)
- Menu hamburger: `div` cliccabile → `<button>` con `aria-expanded`/`aria-controls` su 9 pagine, con reset CSS
- `aria-label` su bottoni icona: toggle vista griglia/elenco (+`aria-pressed`), chiusura quick-view, chiusura modale ordini, cuori wishlist, input codice sconto/gift card
- Form contatti: label associate con `for`/`id` su tutti i campi
- `product.html`: alt in inglese → italiano dinamico col nome prodotto + dimensioni intrinseche
- `settings.html`: theme-color allineato a `#f8fdf5`
- `promos.js`: selettori sezioni null-safe in `switchTab`

### Edge Functions
| # | Bug | Fix |
|---|-----|-----|
| E1 | 🟠 `handle-signup`: incremento `total_referrals` read-modify-write → lost update su signup concorrenti | Nuova RPC atomica `increment_referral_count(UUID)` (migration `20260824000000`) con grant a `service_role` |
| E2 | 🔴 `setup-wallet-class`: nessun controllo admin — qualsiasi utente autenticato poteva alterare la classe Google Wallet condivisa | Verifica ruolo admin (pattern delle altre funzioni) + solo POST + fix type error `error.message` |
| E3 | 🟠 `delete-account`: errori dei 13 step ignorati → utente eliminato con PII residue e risposta success | Ogni step verificato; abort PRIMA di `deleteUser` se la pulizia fallisce |
| E4 | 🟡 `complete-order-purchase`: email conferma inviata a ogni chiamata anche se l'ordine esisteva già (webhook) | Email inviata solo quando `result.created === true` |

### Verifica
- 115/115 test unitari/property/integration superati
- `deno check` OK su handle-signup e setup-wallet-class
- Tutti i file JS modificati validati con `node --check`
- 17/17 pagine HTTP 200 su server locale, zero errori JS runtime in headless Chrome, zero 404 su risorse locali

---

## 12. TERZA TORNATA — FLUSSI, UX, ADMIN, SERVICE LAYER (Agosto 2026)

Analisi approfondita con 6 agenti paralleli: flussi di navigazione, flussi transazionali, auth/account, admin+gestionale, service layer, UX mobile. Fix applicati:

### 🔴 Funnel di conversione (critici)
| # | Bug | Fix |
|---|-----|-----|
| F1 | Login dal checkout: pagina congelata su "Devi effettuare il login", carrello guest MAI mergiato (perdita carrello nel momento di massima intenzione d'acquisto) | `onAuthStateChange` su SIGNED_IN → merge carrello+wishlist → reload; `openAuthModal` con `onSuccess` che mergea e ricarica |
| F2 | Scoping promo calcolato su colonne INESISTENTI (`applicable_categories/products`): il client mostrava lo sconto sull'intero carrello, il server lo ristringe → totale mostrato ≠ totale addebitato | `_getApplicableItems` riscritto su `applies_to`/`applies_to_ids` (schema reale), replica della logica server; `categoryId` aggiunto agli item carrello; `ensureCategoryIds` per carrello guest |
| F3 | `min_purchase` non validato in UI: "✓ Sconto applicato!" anche con sconto azzerato; errore emergeva solo su Stripe dopo compilazione indirizzo | `validatePromotion()` con errori allineati al server in checkout e drawer |
| F4 | Drawer: sconto stantio dopo modifica quantità → totale anche NEGATIVO | Ricalcolo sconto in ogni `updateCart` + clamp `Math.max(0, …)` |
| F5 | Prodotto/categoria inesistenti → render di prodotti MOCK "acquistabili" (fallimento solo su Stripe) | Con Supabase configurato: stato "Prodotto non disponibile" con CTA al catalogo; mock solo senza backend |
| F6 | Parametro `?category=` generato da mega-menu e ricerca ma IGNORATO dalla query: clic su "Agrumi" mostrava tutta la frutta | Risoluzione slug→category_id + filtro applicato + select sincronizzata |

### 🟠 Flussi e auth
- **Quick-add in collection**: segnava successo (animazione verde) anche su errore stock → ora mostra errore
- **checkout-success senza sessione**: dead-end di una frase → conferma base + bottone Accedi + link ordini
- **`settings.html?tab=giftcards`**: link morto (sezione inesistente) → apre direttamente il drawer profilo sulla vista Gift Card
- **Race promo vs click su Paga**: bottone disabilitato finché i codici salvati non sono risolti
- **Banner primo ordine**: assumeva sempre "%" — ora usa `discount_type` reale
- **Doppio init authModal** su `collection.html?ref=` (doppio submit, rate-limit consumato 2×) → guardia `_initialized`
- **Reset password**: nessun pre-check sessione + errori inglesi raw → pre-check con messaggio "link scaduto" + mappatura errori italiani
- **Sessione scaduta durante pagamento**: alert generico → rilevamento 401 con ri-login e reload
- **Referral**: logout puliva sessionStorage invece di localStorage (codice mai rimosso) + nessuna scadenza → storage unificato con TTL 30 giorni
- **Race creazione codice referral** (23505): ora re-select invece di "Non disponibile"
- **Contatore "Ordini" nel drawer profilo**: sempre 0 → query count reale (payment_status='completed')

### 🛠 Admin panel (15 fix)
- **Perdita silenziosa varianti inventario peso** (unique violation su insert multi-riga, solo console.error): dedup per weight_grams + errori propagati all'utente
- **Inventario svuotato** non cancellava le righe DB → save sempre chiamato
- **Stati `partially_refunded`/`disputed`** sconosciuti (display errato, rischio sovrascrittura stati webhook) → aggiunti a colori, select e filtri
- **"Rimborsato" senza refund reale** → rinominato "(contabilità)" + confirm() per stati distruttivi
- **Analytics revenue** conteggiava dispute/parziali come fatturato pieno → esclusi
- **Listener Ordini accumulati** ad ogni visita sezione (sort invertito) → bind una sola volta
- **Gift card esaurita mostrava credito pieno** (`0 || amount`) → nullish coalescing
- **Ricerca gift card** rompeva il filtro PostgREST con virgole/parentesi → sanitizzazione
- **Etichette legacy "Unisex"** nei preview sconti → gender reali del sito
- **6 punti XSS attributo** senza attrEsc (variant_name, URL immagini, nomi categorie, title ordini)
- **Unità 'g'**: header "(g)" ma etichette riga "Kg" (errori ×1000) → pipeline unificata in grammi
- **Filtro pagamenti senza Klarna** → aggiunto
- **Schema drift**: `is_seasonal/is_new/page_type/search_keywords` usate ma senza migration → migration con ADD COLUMN IF NOT EXISTS

### 🌱 Gestionale (CaricoFacile)
- **Bypass compliance alimentare**: `publish_draft` pubblicava conserve/secchi-estratti ATTIVI senza info alimentari (aggirando il blocco Reg. UE 1169/2011 del CMS) → migration: forzati `food_information_required=true` e `is_active=false` fino a verifica admin

### 📱 UX mobile e consistenza
- **Tap target**: quick-add 30px, cuore 36px, qty-btn 28-36px → aree tocco ≥44px
- **Toast sovrapposti**: cart-toast (z 1200) sotto il banner notifiche (z 9999) → feedback d'acquisto invisibile → z-index 10001
- **Sticky hover su touch**: transform "incollati" dopo il tap → reset con `@media (hover:none)`
- **Zoom iOS**: campi auth/checkout < 16px tra 601-768px → font-size 16px
- **Autocomplete/inputmode**: form checkout e contatti senza attributi (CAP su tastiera QWERTY) → autocomplete standard + inputmode numeric + pattern CAP
- **Inter 700**: faux-bold su 9 pagine → peso aggiunto alle URL fonts
- **Menu settings**: mancavano Conserve e Secchi/Estratti (con sottocategorie dinamiche) → struttura completa
- **Logo invisibile con menu aperto** su product/settings (logo verde su nav verde scuro) → dual-logo
- **Breadcrumb prodotto**: aggiunto Home / Categoria / Nome
- **checkout-cancel**: countdown non fermabile → bottone "Annulla reindirizzamento" + link home
- **Banner notifiche dark-mode isolato** (sito è light-only) → rimosso
- **theme-color legali** allineato all'header crema

### 🔧 Service layer
- `firebase-notifications`: `onTokenRefresh` assegnato come proprietà (no-op, API rimossa in Firebase v9+) → rimosso, rotazione gestita da getToken
- `presence.js`: listener visibilitychange mai rimosso da stopTracking + ping dopo stop → named handler + gate isTracking
- `supabase.js`: import CDN non pinnato (`@2` = breaking change a distanza, SPOF) → pinnato a 2.111.0 (versione testata)
- `giftcard.getUserCredits`: errore DB indistinguibile da "credito 0" → campo error propagato
- Arrotondamento prezzi a peso allineato al server (centesimi per riga) → totale mostrato = totale addebitato
- `quick-view`/`promos.js` (moduli non attivi): item carrello senza `weight_grams: null` (righe duplicate nel guest cart) e chiave `id` invece di `productId` → corretti
- Email gift card: aggiunto link diretto a redeem.html (prima raggiungibile solo scannerizzando il QR)
- `submit-to-courier`: non sovrascrive più `orders.notes` (append)

### ✅ Verifica
- 115/115 test · `node --check` su tutti i JS · migration SQL validate su Postgres 16 (transazione con rollback)
- 15/15 pagine pulite in headless Chrome (zero errori runtime)
- Layout mobile 390px verificato via CDP (nessun overflow, media query applicate)
