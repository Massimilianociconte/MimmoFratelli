# CMS Audit Report — Mimmo Fratelli
**Data:** 13 Febbraio 2026  
**Scope:** `admin/admin.js` (3785 righe), `admin/index.html` (1013 righe), `admin/admin.css`, relazioni con DB Supabase, edge functions, e frontend cliente.

---

## 1. ARCHITETTURA GENERALE

Il CMS è una Single-Page Application (SPA) vanilla JS con 7 sezioni:
- **Dashboard** — statistiche aggregate
- **Prodotti** — CRUD completo con filtri, upload immagini, varianti inventario
- **Categorie** — CRUD base
- **Sconti** — bulk discount per tipo/categoria/singolo prodotto
- **Ordini** — visualizzazione, filtri avanzati, cambio stato
- **Gift Card** — ricerca e dettaglio (sola lettura)
- **Analytics** — utenti attivi real-time, statistiche nuovi utenti/ordini/fatturato

**Tabelle DB coinvolte:** `products`, `categories`, `weight_inventory`, `orders`, `order_items`, `gift_cards`, `user_credits`, `user_roles`, `profiles`, `user_presence`, `cart_items`

---

## 2. BUG CERTI (da correggere)

### 2.1 🔴 ID duplicato `resetFiltersBtn`
**File:** `admin/index.html` righe 245 e 530  
Due elementi hanno lo stesso `id="resetFiltersBtn"` — uno nella sezione Prodotti, l'altro nella sezione Ordini. `document.getElementById` restituisce sempre il primo, quindi il pulsante "Reset filtri" degli Ordini **non funziona**.

**Fix:** Rinominare l'ID nella sezione ordini in `resetOrderFiltersBtn` e aggiornare il listener in `setupOrdersEventListeners()`.

### 2.2 🔴 Handler `modal.onclick` sovrascritto (ordini)
**File:** `admin/admin.js` righe 3262-3294  
`viewOrderDetails()` assegna `modal.onclick` tre volte in sequenza. Il terzo handler (riga 3289) sovrascrive il secondo (riga 3282), eliminando la chiamata a `clearModalState()`. Risultato: chiudendo il modal ordine cliccando fuori, lo stato del modal resta in `localStorage` e al refresh il modal si riapre.

**Fix:** Rimuovere i due handler duplicati (righe 3262-3264 e 3289-3294), mantenendo solo quello alle righe 3282-3288 che include `clearModalState()`.

### 2.3 🔴 `deleteProduct` non elimina le righe `weight_inventory` correlate
**File:** `admin/admin.js` riga 1556-1568  
Quando si elimina un prodotto, viene cancellata solo la riga in `products`. Se non c'è un `ON DELETE CASCADE` sul foreign key `weight_inventory.product_id`, le righe di inventario rimangono orfane nel database.

**Fix:** Aggiungere `await supabase.from('weight_inventory').delete().eq('product_id', id)` prima del delete del prodotto, oppure verificare che il FK abbia `ON DELETE CASCADE`.

### 2.4 🔴 `deleteCategory` non gestisce i prodotti associati
**File:** `admin/admin.js` riga 1727-1739  
Eliminare una categoria che ha prodotti associati (`products.category_id`) causerà un errore FK oppure lascerà prodotti con `category_id` nullo/orfano. Non c'è nessun controllo preventivo.

**Fix:** Prima di eliminare, controllare se esistono prodotti con quel `category_id` e mostrare un avviso, oppure settare `category_id = null` sui prodotti interessati.

### 2.5 🟡 Listener `change` su `productSeasonal` duplicato ad ogni apertura modal
**File:** `admin/admin.js` riga 707  
Ogni chiamata a `openProductModal()` aggiunge un nuovo `addEventListener('change', updateSeasonalNotificationPanel)` senza rimuovere il precedente. Dopo N aperture, la funzione viene chiamata N volte.

**Fix:** Usare `{ once: true }`, oppure rimuovere il listener prima di riaggiungelo, oppure spostarlo in `setupEventListeners()`.

---

## 3. PROBLEMI POTENZIALI (rischio medio-alto)

### 3.1 🟠 XSS nelle template literals HTML
**File:** `admin/admin.js` — praticamente ovunque si genera HTML  
I valori da DB (`p.name`, `c.name`, `gc.recipient_name`, `gc.message`, `addr.firstName`, ecc.) vengono interpolati direttamente in template literals HTML senza escaping. Solo `renderKeywordTags()` usa `escapeHtml()`.

**Esempio critico:** Un nome prodotto come `<img src=x onerror=alert(1)>` verrebbe eseguito. In un contesto admin-only il rischio è mitigato, ma non nullo (un utente potrebbe iniettare dati tramite gift card o ordini).

**Raccomandazione:** Creare una funzione `esc(text)` e usarla in tutti gli `innerHTML` dinamici.

### 3.2 🟠 Nessuna validazione lato client prima del salvataggio prodotto
**File:** `admin/admin.js` riga 1344-1432  
Non c'è validazione su:
- `sale_price >= price` (lo sconto sarebbe un aumento)
- `price <= 0`
- Slug con caratteri non validi (spazi, maiuscole)
- Immagini con URL malformati

Il DB probabilmente previene alcuni casi, ma l'utente non riceve feedback chiaro.

### 3.3 🟠 `display_order` delle categorie non gestito nel CMS
**File:** `js/services/products.js` riga 198 ordina le categorie per `display_order`, ma il CMS (`admin/admin.js`) non permette di impostare questo campo. Le categorie nel frontend appariranno nell'ordine di default (probabilmente NULL per tutte).

**Fix:** Aggiungere un campo `display_order` nel form categoria o un sistema drag-and-drop per riordinarle.

### 3.4 🟠 Bulk discount con Promise.all senza rate limiting
**File:** `admin/admin.js` righe 2583-2602 e 2700-2714  
Le operazioni batch (`applyDiscount`, `removeAllDiscounts`) lanciano fino a 50 query parallele per batch. Con cataloghi grandi, questo potrebbe saturare i rate limit di Supabase o causare timeout.

**Raccomandazione:** Ridurre il parallelismo a 10-20 e aggiungere gestione errori per retry.

### 3.5 🟠 `getProducts()` nel frontend non filtra `is_active`
**File:** `js/services/products.js` riga 42-45  
Il commento dice "Load all products (including inactive ones to show as unavailable)" — questo è intenzionale per mostrare prodotti esauriti, ma significa che prodotti **disattivati dall'admin** (es. nascosti dal catalogo) appaiono comunque nel frontend. Verificare che la logica di rendering nel frontend gestisca correttamente `is_active: false`.

---

## 4. INCONSISTENZE CMS ↔ FRONTEND

### 4.1 Campo `gender` vs tipo prodotto
Il campo si chiama `gender` nel DB e nel codice, ma rappresenta il tipo di prodotto (frutta, verdura, conserve, secchi-estratti, altro). Questo è legacy e potenzialmente confuso per chi mantiene il codice.

### 4.2 `weight_inventory` non letto dal frontend
Il CMS gestisce varianti con peso netto, lordo, nome variante e quantità per variante nella tabella `weight_inventory`. Ma il frontend (`js/services/products.js`) **non fa mai una query a `weight_inventory`**. Il carrello usa solo `weight_grams` da `cart_items`, che viene settato lato client nella pagina prodotto. Non c'è sincronizzazione delle varianti disponibili tra CMS e frontend.

**Impatto:** Se l'admin crea una variante "Cassetta 5kg" con 10 pezzi, il frontend non sa che questa variante esiste. Il peso viene scelto dal cliente indipendentemente dalle varianti definite nel CMS.

### 4.3 `inventory` del prodotto vs somma `weight_inventory.quantity`
Il campo `products.inventory` viene calcolato dal CMS come somma totale delle quantità delle varianti (`totalQty`). Ma il frontend non decrementa `weight_inventory.quantity` quando un ordine viene completato — presumibilmente l'edge function `complete-order-purchase` aggiorna `products.inventory`, ma potrebbe non aggiornare le singole righe `weight_inventory`.

### 4.4 Campo `colors` non utilizzato dal frontend
Il CMS permette di inserire colori (es. "Nero, Bianco, Blu"), ma per un e-commerce di frutta e verdura questo campo sembra vestigiale. Il carrello usa `color` come identificatore (default "Fresco"), non come scelta utente reale.

### 4.5 Campo `page_type` non consumato dal frontend
Il CMS permette di assegnare un prodotto a "Home Page", "Offerte", "Evidenza", "Stagione" tramite `page_type`. Ma il frontend `products.js` non filtra mai per `page_type`. La pagina promos usa `getDiscountedProducts()` (filtra per `sale_price != null`), non per `page_type = 'promos'`.

---

## 5. SICUREZZA

### 5.1 Autenticazione admin
L'accesso è protetto da `checkAdminRole()` che verifica la tabella `user_roles`. La logica è corretta: login → verifica ruolo → sign out se non admin.

### 5.2 RLS (Row Level Security)
Non verificabile dal codice client. **Verificare** che le policy RLS su `products`, `categories`, `orders`, `gift_cards`, `weight_inventory` permettano INSERT/UPDATE/DELETE solo per utenti con ruolo admin. Senza RLS, qualsiasi utente autenticato potrebbe manipolare i dati direttamente.

### 5.3 Storage bucket `product-images`
Le immagini vengono caricate in un bucket Supabase con URL pubblici. Verificare che il bucket abbia policy di upload restrittive (solo utenti admin) per evitare che utenti normali carichino file arbitrari.

### 5.4 Edge functions CORS
Le edge functions usano `getCorsHeaders()` con origin dinamico. Verificare che il set di origin ammessi sia limitato ai domini autorizzati (produzione + localhost dev).

---

## 6. PERFORMANCE

### 6.1 Query N+1 nella dashboard
`loadDashboardData()` esegue 5 query separate (products count, categories count, orders count, users count, recent products). Potrebbe essere consolidato in una singola RPC.

### 6.2 `loadOrders()` carica tutti gli ordini
La query ordini non ha limite — con migliaia di ordini, la risposta sarà lenta e il rendering pesante. Aggiungere paginazione server-side.

### 6.3 `loadGiftCardStats()` scarica tutte le gift card
`loadGiftCardStats()` fa `select('amount, is_redeemed, is_active, remaining_balance, expires_at')` senza `.limit()`, calcolando le statistiche client-side. Con migliaia di gift card, sarebbe meglio usare una query aggregata o una RPC.

### 6.4 Analytics polling ogni 30 secondi
`startActiveUsersPolling()` fa polling ogni 30s con 2 query (`user_presence` count + lista). Considerare l'uso di Supabase Realtime per un approccio event-driven.

### 6.5 Prodotti caricati interamente in memoria
`loadProducts()` carica tutti i prodotti senza paginazione. Con centinaia di prodotti è accettabile, ma con migliaia potrebbe rallentare.

---

## 7. UX / USABILITÀ

### 7.1 Nessun feedback di salvataggio in corso
Durante `handleProductSubmit()`, non c'è indicatore di caricamento. Il bottone "Salva Prodotto" resta attivo e cliccabile, permettendo doppi submit.

### 7.2 Gift Card: solo lettura
Il CMS non permette di modificare, disattivare o prolungare gift card. L'admin può solo visualizzare. Per gestire dispute o errori, l'admin deve intervenire direttamente nel DB.

### 7.3 Ordini: nessun campo note admin
Non c'è possibilità di aggiungere note interne a un ordine (es. "Cliente contattato per indirizzo errato"). Il campo `notes` esiste nel DB ma è usato solo per info automatiche (es. gift card).

### 7.4 Nessun log delle modifiche
Non esiste un audit trail. Se un prodotto viene modificato o un ordine cambia stato, non c'è registro di chi ha fatto cosa e quando.

### 7.5 Mancanza di conferma sugli sconti bulk
`applyDiscount()` non chiede conferma prima di applicare sconti a potenzialmente tutti i prodotti. Solo `removeAllDiscounts()` ha un `confirm()`.

---

## 8. REAL-TIME & SINCRONIZZAZIONE

### 8.1 Realtime channel per prodotti
Il CMS sottoscrive `postgres_changes` su INSERT e UPDATE della tabella `products`. Questo è positivo per notifiche interne, ma genera notifiche anche per le modifiche fatte dall'admin stesso (self-notifications).

### 8.2 Nessun realtime sugli ordini
Nuovi ordini non generano notifiche real-time nel CMS. L'admin deve refreshare o navigare alla sezione ordini per vedere nuovi ordini.

### 8.3 Nessun realtime sulle gift card
Stesso problema: nessuna notifica quando una nuova gift card viene acquistata.

---

## 9. RIEPILOGO PRIORITÀ

| # | Problema | Severità | Effort |
|---|---------|----------|--------|
| 2.1 | ID duplicato `resetFiltersBtn` | 🔴 Bug | 5 min |
| 2.2 | Handler `onclick` sovrascritto | 🔴 Bug | 5 min |
| 2.3 | Delete prodotto senza cascade inventory | 🔴 Bug | 10 min |
| 2.4 | Delete categoria senza check prodotti | 🔴 Bug | 15 min |
| 2.5 | Listener duplicato seasonal checkbox | 🟡 Minor | 5 min |
| 3.1 | XSS nelle template literals | 🟠 Sicurezza | 30 min |
| 3.2 | Mancanza validazione form prodotto | 🟠 UX | 20 min |
| 3.3 | `display_order` categorie non gestito | 🟠 Funzionalità | 30 min |
| 3.5 | Prodotti inattivi visibili nel frontend | 🟠 Logica | 15 min |
| 4.2 | `weight_inventory` non letto dal frontend | 🟠 Architettura | 2-4 ore |
| 4.3 | Inventory non decrementato per variante | 🟠 Logica | 1-2 ore |
| 4.5 | `page_type` non consumato dal frontend | 🟡 Dead code | 15 min |
| 6.2 | Ordini senza paginazione | 🟡 Performance | 1 ora |
| 7.1 | Nessun loading state al salvataggio | 🟡 UX | 10 min |
| 7.5 | Nessuna conferma su sconti bulk | 🟡 UX | 5 min |
| 8.2 | Nessun realtime su nuovi ordini | 🟡 Feature | 30 min |

---

*Report generato da audit manuale del codice sorgente. Si consiglia di verificare anche le RLS policies e i trigger lato Supabase per completare l'analisi di sicurezza.*
