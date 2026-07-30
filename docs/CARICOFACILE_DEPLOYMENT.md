# CaricoFacile — consegna e riuso

Data di verifica: 2026-07-29.

## Separazione

| Componente | Percorso | Scopo |
| --- | --- | --- |
| Base multi-tenant | `/Users/massimilianociconte/Documents/Progetti/Carico Facile gestionale` | sorgente neutra da adattare ai clienti |
| Istanza Mimmo | `gestionale/` | configurazione e deploy collegati a Mimmo Fratelli |
| Adapter Mimmo | `supabase/migrations/027_product_drafts.sql` | bozze, RPC e bucket |
| Hardening Storage | `supabase/migrations/20260729002257_restrict_caricofacile_photo_listing.sql` | impedisce listing anonimo delle foto |

La base esterna contiene tenant `demo`, configurazione d'esempio, contratto
canonico e template SQL. Non contiene URL, categorie, chiavi o nomi Mimmo nel
codice operativo.

## Risorse attive

| Risorsa | Valore |
| --- | --- |
| Pages produzione | `https://caricofacile-mimmo.pages.dev/` |
| Worker produzione | `https://caricofacile-api.nexify-api.workers.dev/` |
| Worker staging | `https://caricofacile-api-staging.nexify-api.workers.dev/` |
| KV produzione | `caricofacile-api-KV-production` |
| KV staging | `caricofacile-api-KV-staging` |
| chiave tenant | `tenant:mimmo` |

Supabase contiene entrambe le migrazioni CaricoFacile e il bucket
`product-photos`. Il registro Worker espone soltanto configurazione pubblica.

## Chiusure ancora necessarie

1. Fornire o creare una chiave Gemini autorizzata.
2. Inserirla interattivamente come secret in staging e produzione.
3. Verificare `aiConfigured: true` e una richiesta AI con JWT admin.
4. Eseguire login e cinque canali su smartphone dell'amministratore.

Nessuna credenziale è stata memorizzata nella documentazione o nel repository.
