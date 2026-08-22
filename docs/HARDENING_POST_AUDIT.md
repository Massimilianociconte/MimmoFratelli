# Hardening post-audit — Azioni di deploy e configurazione

Questa guida copre le correzioni **non eseguibili via codice** emerse
dall'audit E2E (agosto 2026) e i passi di rilascio delle fix già implementate.

---

## 1. Security headers (CRITICO — sito principale)

Il dominio `www.mimmofratelli.com` è servito da **GitHub Pages** dietro proxy
**Cloudflare**. GitHub Pages **non permette header HTTP custom**: la sola via è
Cloudflare.

### Opzione A — Transform Rules (consigliata, 5 minuti)

Dashboard Cloudflare → dominio `mimmofratelli.com` → **Rules → Transform Rules
→ Modify Response Header**, crea una regola "Security Headers" con match:
`Hostname eq www.mimmofratelli.com` e questi header *Set static*:

| Header | Valore |
|---|---|
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=(self "https://js.stripe.com")` |
| `Content-Security-Policy` | vedi sotto |

CSP di partenza (il sito usa script inline e onclick: serve `'unsafe-inline'`
fino a refactoring; Stripe.js e Supabase sono i soli domini script/connect):

```
default-src 'self'; script-src 'self' 'unsafe-inline' https://js.stripe.com https://apis.google.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: https:; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.stripe.com https://fcmregistrations.googleapis.com https://firebaseinstallations.googleapis.com https://firebaseremoteconfig.googleapis.com; frame-src https://js.stripe.com https://hooks.stripe.com; base-uri 'self'; object-src 'none'
```

⚠️ Dopo l'attivazione, testare subito checkout e login: un CSP troppo stretto
si manifesta come pagina bianca o richieste bloccate (console del browser).

### Opzione B — migrazione hosting

Se si migra su Cloudflare Pages/Netlify/Vercel, usare il file `_headers`
(gestionale lo fa già). Il `serve.json` rimosso dal repo era un tentativo
inerte di questa strada.

---

## 2. Riconciliazione pagamenti orfani (già implementata — attivazione)

Nuova Edge Function `supabase/functions/reconcile-stripe-checkouts/` che
recupera sessioni Stripe pagate rimaste senza ordine (webhook perso + cliente
mai tornato sulla success page).

Passi di attivazione:

1. **Deploy funzione**:
   ```bash
   supabase functions deploy reconcile-stripe-checkouts --no-verify-jwt
   ```
2. **Secret condiviso** (stesso valore su entrambi):
   ```bash
   supabase secrets set RECONCILE_SECRET_KEY="$(openssl rand -hex 32)"
   ```
   ```sql
   ALTER DATABASE postgres SET app.reconcile_secret_key = '<stesso valore>';
   ```
3. **Migration** `029_post_audit_hardening.sql`: pianifica il job pg_cron
   (`17 * * * *`) se `pg_cron`+`pg_net` sono attivi; altrimenti schedulare
   esternamente (GitHub Actions `schedule` ogni ora):
   ```
   POST https://onvufwqybriaoadsdjyk.supabase.co/functions/v1/reconcile-stripe-checkouts
   x-reconcile-key: <RECONCILE_SECRET_KEY>
   ```
4. **Verifica manuale**: chiamare l'endpoint e controllare la risposta JSON
   `{ inspected, ordersRecovered, released }` e l'alert Telegram.

---

## 3. Compliance etichettatura alimentare (già implementata — rilascio)

La migration `029_post_audit_hardening.sql`:

- `publish_draft` ora pubblica `conserve`, `secchi-estratti` **e** `altro` con
  `food_information_required = true`: restano visibili ma il checkout li blocca
  finché un admin non compila ingredienti/allergeni/q.tà netta/operatore dal CMS.
  *(Fix anche del bug per cui quei draft non erano pubblicabili affatto.)*
- Mette in sicurezza i prodotti preimballati già pubblicati senza flag.

Dopo il deploy verificare in **Supabase → Database → Lint** che nessun prodotto
risulti `food_information_required AND verified_at IS NULL` a lungo (coda di
revisione = lavoro admin).

---

## 4. Webhook: dispute e rimborsi parziali (già implementato)

`stripe-webhook` ora gestisce `charge.dispute.created/updated/closed` (stato
ordine `disputed` + alert Telegram; dispute persa → riconciliazione completa)
e i rimborsi parziali (stato `partially_refunded` + alert).

**Da fare nel dashboard Stripe** → Developers → Webhooks → endpoint esistente:
aggiungere gli eventi `charge.dispute.created`, `charge.dispute.updated`,
`charge.dispute.closed` agli eventi inviati (gli altri sono già tracciati).

---

## 5. Azioni sui dashboard (non automatizzabili dal repo)

1. **Supabase → Auth → Rate Limits**: alzare protezioni su
   `signInWithPassword` (es. 10/min per IP) — il rate-limit client-side resta
   solo UX.
2. **Supabase → Auth → JWT keys**: revocare l'**anon key vecchia**
   (iat 2024-12) rimasta in codice fino ad oggi; dopo il deploy della fix
   profile-drawer non è più referenziata.
3. **Stripe dashboard**: aggiungere eventi dispute (§4); valutare Radar rules
   sui codici primo-ordine.
4. **Cloudflare**: regola headers (§1).
5. **Google Business / corriere**: confermare il numero WhatsApp reale in
   `js/config.js → WHATSAPP_RIDER_NUMBER` (ora impostato col numero del negozio;
   se il corriere ha un numero dedicato, aggiornarlo).

---

## 6. Checklist rilascio fix

```bash
# 1. Test suite
npm test                                   # 115+ test devono passare

# 2. Sitemap rigenerabile dopo variazioni catalogo
npm run build:sitemap

# 3. Deploy statico (GitHub Pages) — push su main

# 4. Deploy Edge Functions modificate
supabase functions deploy stripe-webhook
supabase functions deploy complete-order-purchase
supabase functions deploy complete-giftcard-purchase
supabase functions deploy create-checkout-session
supabase functions deploy reconcile-stripe-checkouts --no-verify-jwt

# 5. Applicare migration
supabase db push        # oppure supabase migration up
```

### Test di regressione mirati sulle fix

| Fix | Verifica |
|---|---|
| Riconciliatore | sessione pagata simulata senza webhook → ordine creato entro 1h + Telegram |
| publish_draft | publish di draft conserve → `food_information_required=true`, checkout bloccato |
| Dispute/partial refund | evento test da Stripe CLI → stato ordine aggiornato + alert |
| XSS search | query `<img src=x onerror=alert(1)>` → resa come testo |
| Add-to-cart guard | doppio click rapido → qty+1, toast su stock esaurito |
| Pay button | click durante redirect → nessun secondo submit |
| SW cache | visita orders.html offline-safe → nessuna voce in Cache Storage |
