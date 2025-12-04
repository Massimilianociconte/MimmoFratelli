# 📋 PREVENTIVO PROFESSIONALE

## Sviluppo Piattaforma E-commerce "Mimmo Fratelli"
**Negozio Online di Frutta, Verdura e Prodotti Alimentari**

---

| | |
|---|---|
| **Cliente** | Mimmo Fratelli |
| **Data Emissione** | 3 Dicembre 2025 |
| **Validità** | 30 giorni |
| **Importo Totale** | **€1.600,00** |

---

## 🎯 SINTESI PROGETTO

Sviluppo completo di una piattaforma e-commerce moderna per la vendita online di prodotti alimentari freschi: frutta, verdura, prodotti tipici e specialità gastronomiche. Il progetto include:

- Sito web responsive con design fresco e accattivante
- Sistema di autenticazione e profili utente
- Catalogo prodotti con filtri per categoria e stagionalità
- Carrello e checkout multi-payment
- Pannello amministrazione completo
- Sistema promozioni e gift card
- Notifiche push per prodotti stagionali
- Sistema referral "Invita un amico"
- Integrazione Google Wallet

---

## 📦 DETTAGLIO FUNZIONALITÀ

### 1. FRONTEND E DESIGN | €280

| Elemento | Dettaglio |
|----------|-----------|
| Homepage | Hero con prodotti di stagione, categorie in evidenza, offerte |
| Catalogo | Griglia prodotti, filtri laterali, ordinamento, vista griglia/lista |
| Pagina Prodotto | Galleria immagini, info nutrizionali, origine, prodotti correlati |
| Pagine Istituzionali | Chi Siamo, Contatti con mappa, Termini e Condizioni |
| Design Responsive | Ottimizzato per desktop, tablet e mobile |
| Animazioni | Transizioni fluide, effetti hover, skeleton loading |
| CSS Custom | ~3000 righe di stile personalizzato |

---

### 2. AUTENTICAZIONE E PROFILO | €150

| Funzionalità | Dettaglio |
|--------------|-----------|
| Registrazione | Form con validazione, conferma email |
| Login | Accesso sicuro con rate limiting (blocco dopo 5 tentativi) |
| Profilo Utente | Gestione dati personali, indirizzi di consegna, preferenze |
| Drawer Profilo | Pannello laterale con accesso rapido a tutte le sezioni |
| Recupero Password | Reset via email con link sicuro |
| Eliminazione Account | Procedura GDPR-compliant con conferma |

---

### 3. CATALOGO E RICERCA | €120

| Funzionalità | Dettaglio |
|--------------|-----------|
| Visualizzazione Prodotti | Card con immagine, nome, prezzo al kg/unità, badge sconto |
| Filtri Avanzati | Categoria, prezzo (slider), stagionalità, solo promozioni |
| Ordinamento | Prezzo crescente/decrescente, novità, popolarità |
| Ricerca | Barra con suggerimenti real-time |
| Quick View | Anteprima rapida prodotto senza cambiare pagina |
| Prodotti Correlati | Sezione "Potrebbe piacerti anche" |

---

### 4. WISHLIST E CARRELLO | €130

| Funzionalità | Dettaglio |
|--------------|-----------|
| Lista Desideri | Salvataggio preferiti con sincronizzazione cross-device |
| Funziona Offline | Preferiti salvati anche senza account |
| Carrello Drawer | Pannello laterale con riepilogo spesa |
| Gestione Quantità | Modifica quantità, rimozione articoli |
| Persistenza | Carrello mantenuto tra sessioni |
| Calcolo Automatico | Subtotale, sconti, spedizione, totale |

---

### 5. CHECKOUT E PAGAMENTI | €200

| Funzionalità | Dettaglio |
|--------------|-----------|
| Pagina Checkout | Form indirizzo consegna con validazione, riepilogo ordine |
| Autofill CAP | Autocompletamento città/provincia da database 8000+ comuni italiani |
| Stripe | Carte di credito/debito (Visa, Mastercard, Amex) |
| PayPal | Pagamento con conto PayPal |
| Klarna | Pagamento a rate (3 rate senza interessi) |
| Applicazione Sconti | Codici promo e crediti gift card |
| Sicurezza PCI-DSS | Nessun dato carta salvato (gestito da Stripe) |
| Pagine Conferma | Success page e gestione errori/cancellazioni |

---

### 6. GESTIONE ORDINI | €140

| Funzionalità | Dettaglio |
|--------------|-----------|
| Creazione Automatica | Ordine generato dopo pagamento riuscito |
| Codice Ordine | Formato univoco MF-YYYYMMDD-XXXX |
| Stati Ordine | Pending → Confirmed → Processing → Shipped → Delivered |
| Storico Ordini | Pagina "I miei ordini" con filtri e dettagli |
| Tracking Spedizioni | Integrazione corrieri (BRT/DHL/GLS) |
| Email Transazionali | Conferma ordine, spedizione, consegna |

---

### 7. PANNELLO AMMINISTRAZIONE | €180

| Funzionalità | Dettaglio |
|--------------|-----------|
| Dashboard | KPI vendite, ordini recenti, grafici statistiche |
| Gestione Prodotti | CRUD completo con upload immagini, prezzi, disponibilità |
| Gestione Ordini | Lista ordini, cambio stato, note interne |
| Gestione Promozioni | Creazione/modifica coupon e sconti |
| Gestione Gift Card | Visualizzazione vendute, saldi, utilizzi |
| Gestione Utenti | Lista clienti, dettagli, statistiche acquisti |
| PWA | Installabile come app su mobile/desktop |
| Service Worker | Funzionamento offline per consultazione |

---

### 8. SISTEMA PROMOZIONI | €100

| Funzionalità | Dettaglio |
|--------------|-----------|
| Codici Sconto | Percentuale o importo fisso |
| Validità Temporale | Date inizio/fine automatiche |
| Limiti Utilizzo | Max utilizzi totali e per utente |
| Minimo Acquisto | Soglia minima per attivazione |
| Categorie Specifiche | Sconto su categorie selezionate (es. solo frutta) |
| Pagina Promozioni | Vetrina offerte attive |

---

### 9. GIFT CARD INTERATTIVE | €120

| Funzionalità | Dettaglio |
|--------------|-----------|
| Creatore Gift Card | Interfaccia per personalizzazione |
| Template Grafici | 4+ design a tema food tra cui scegliere |
| Importi | €25, €50, €100, €200 o personalizzato |
| Messaggio Personale | Testo dedicato al destinatario |
| Anteprima Live | Visualizzazione real-time modifiche |
| Codice Univoco | Formato XXXX-XXXX-XXXX con blacklist anti-frode |
| Email Automatica | Invio al destinatario con design HTML |
| Riscatto | Campo dedicato al checkout |
| Saldo Parziale | Utilizzo credito residuo |
| **Google Wallet** | Salvataggio gift card nel wallet digitale |

---

### 10. NOTIFICHE PUSH | €80

| Funzionalità | Dettaglio |
|--------------|-----------|
| Firebase Cloud Messaging | Integrazione FCM per notifiche push |
| Opt-in Utente | Richiesta permesso con UI dedicata |
| Notifiche Foreground | Toast in-app quando sito aperto |
| Notifiche Background | Push anche a browser chiuso |
| Prodotti Stagionali | Avvisi arrivo nuovi prodotti di stagione |
| Gestione Token | Salvataggio e refresh automatico |
| Preferenze Utente | Attivazione/disattivazione da impostazioni |

---

### 11. SISTEMA REFERRAL | €60

| Funzionalità | Dettaglio |
|--------------|-----------|
| Codice Personale | 8 caratteri univoci per ogni utente |
| Link Condivisione | URL con parametro ?ref=CODICE |
| Condivisione Social | WhatsApp, Email, Copia link |
| Sconto Invitato | 15% sul primo ordine |
| Credito Referrer | €5 per ogni conversione |
| Statistiche | Inviti, conversioni, guadagni |
| Storico | Lista referral con stato |

---

### 12. INFRASTRUTTURA E SICUREZZA | €40

| Elemento | Dettaglio |
|----------|-----------|
| Database | Supabase PostgreSQL con 13 migrazioni |
| Row Level Security | Politiche RLS per ogni tabella |
| Edge Functions | 14 funzioni serverless (Deno) |
| Validazione Input | Sanitizzazione tutti i dati utente |
| Rate Limiting | Protezione brute force |
| CORS | Configurazione sicura cross-origin |
| Audit Trail | Log operazioni sensibili |
| Test Automatizzati | Unit test e property-based testing |

---

## 💰 RIEPILOGO ECONOMICO

| Area | Importo |
|------|---------|
| Frontend e Design | €280 |
| Autenticazione e Profilo | €150 |
| Catalogo e Ricerca | €120 |
| Wishlist e Carrello | €130 |
| Checkout e Pagamenti | €200 |
| Gestione Ordini | €140 |
| Pannello Amministrazione | €180 |
| Sistema Promozioni | €100 |
| Gift Card + Google Wallet | €120 |
| Notifiche Push Firebase | €80 |
| Sistema Referral | €60 |
| Infrastruttura e Sicurezza | €40 |
| | |
| **TOTALE** | **€1.600,00** |

---

## 🛠️ STACK TECNOLOGICO

| Tecnologia | Utilizzo |
|------------|----------|
| HTML5 / CSS3 / JavaScript ES6+ | Frontend |
| Supabase (PostgreSQL) | Database, Auth, Storage |
| Supabase Edge Functions (Deno) | Backend serverless |
| Stripe | Pagamenti carta |
| PayPal | Pagamenti alternativi |
| Klarna | Buy now, pay later |
| Firebase Cloud Messaging | Notifiche push |
| Google Wallet API | Pass digitali |

---

## 📊 METRICHE PROGETTO

| Metrica | Valore |
|---------|--------|
| Pagine HTML | 12 |
| File JavaScript | 25+ |
| Righe CSS | ~3.000 |
| Edge Functions | 14 |
| Migrazioni Database | 13 |
| Tabelle Database | 15+ |

---

## ✅ INCLUSO NEL PREZZO

- Sviluppo completo di tutte le funzionalità elencate
- Design responsive (mobile-first)
- Integrazione completa Supabase
- Integrazione gateway pagamento (Stripe, PayPal, Klarna)
- Integrazione Firebase per notifiche push
- Integrazione Google Wallet per gift card
- Pannello admin PWA installabile
- Test di funzionamento
- Documentazione tecnica
- **30 giorni di supporto post-lancio**

---

## ❌ NON INCLUSO

| Voce | Note |
|------|------|
| Hosting Supabase | Gratuito fino a 50.000 utenti/mese |
| Commissioni Stripe | ~1.4% + €0.25 per transazione |
| Commissioni PayPal | ~2.9% + €0.35 per transazione |
| Hosting sito | Netlify/Vercel gratuito per siti statici |
| Dominio | Se non già posseduto (~€10-15/anno) |
| Contenuti | Testi e foto prodotti |
| Manutenzione | Oltre i 30 giorni inclusi |

---

## 💳 MODALITÀ DI PAGAMENTO

| Fase | Importo | Quando |
|------|---------|--------|
| Acconto | €500 (31%) | Alla conferma |
| SAL | €500 (31%) | Completamento pagamenti |
| Saldo | €600 (38%) | Consegna finale |

---

## 📞 CONTATTI

Per procedere:
1. Conferma del preventivo
2. Pagamento acconto
3. Kick-off meeting
4. Inizio sviluppo

---

*Preventivo valido 30 giorni dalla data di emissione.*
*Il codice sorgente sarà di proprietà del cliente al saldo finale.*
