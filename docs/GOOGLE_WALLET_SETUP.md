# Configurazione Google Wallet per Gift Card - Mimmo Fratelli

## Prerequisiti

1. Account Google Cloud Platform
2. Account Google Pay & Wallet Console

## Step 1: Configurazione Google Cloud

1. Vai su [Google Cloud Console](https://console.cloud.google.com)
2. Crea un nuovo progetto o seleziona uno esistente
3. Abilita la **Google Wallet API**:
   - Vai su "APIs & Services" > "Library"
   - Cerca "Google Wallet API"
   - Clicca "Enable"

## Step 2: Crea Service Account

1. Vai su "IAM & Admin" > "Service Accounts"
2. Clicca "Create Service Account"
3. Nome: `wallet-service` (o simile)
4. Clicca "Create and Continue"
5. Salta i ruoli (li configureremo su Google Wallet Console)
6. Clicca "Done"
7. Clicca sul service account creato
8. Vai su "Keys" > "Add Key" > "Create new key"
9. Seleziona "JSON" e scarica il file

## Step 3: Configurazione Google Wallet Console

1. Vai su [Google Pay & Wallet Console](https://pay.google.com/business/console)
2. Crea un nuovo account issuer (se non ne hai uno)
3. Prendi nota del tuo **Issuer ID** (es: `3388000000022195000`)
4. Vai su "Users" e aggiungi l'email del service account con ruolo "Developer"

## Step 4: Configura le variabili d'ambiente Supabase

Aggiungi queste variabili ai secrets di Supabase:

```bash
# Dalla console Supabase > Project Settings > Edge Functions > Secrets

GOOGLE_WALLET_ISSUER_ID=<il-tuo-issuer-id>
GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL=<email-service-account>@<project>.iam.gserviceaccount.com
GOOGLE_WALLET_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
SITE_URL=https://mimmofratelli.it
```

**Nota sulla Private Key**: Copia la chiave dal file JSON scaricato, campo `private_key`. Mantieni i `\n` come sono.

## Step 5: Crea la Pass Class

Esegui una volta la funzione `setup-wallet-class` per creare la classe:

```bash
curl -X POST https://xvbwooqkaznaoemsntqp.supabase.co/functions/v1/setup-wallet-class \
  -H "Authorization: Bearer <ANON_KEY>" \
  -H "Content-Type: application/json"
```

## Step 6: Deploy delle funzioni

```bash
supabase functions deploy add-to-wallet
supabase functions deploy setup-wallet-class
```

## Test

1. Crea una gift card di test
2. Clicca sul bottone "Google Wallet" 
3. Dovresti essere reindirizzato a Google Wallet per salvare il pass

## Struttura del Pass

Il pass Google Wallet mostrerà:
- **Header**: "Gift Card €XX"
- **Subheader**: "Per: [Nome Destinatario]"
- **Logo**: Logo Mimmo Fratelli
- **Hero Image**: Immagine promozionale
- **Campi**:
  - Saldo disponibile
  - Codice gift card
  - Destinatario
  - Mittente
  - Messaggio (se presente)
  - Data scadenza
- **QR Code**: Link per riscattare la gift card
- **Link**: Sito web e pagina riscatto

## Troubleshooting

### Errore "Google Wallet credentials not configured"
Verifica che tutte le variabili d'ambiente siano configurate correttamente nei secrets di Supabase.

### Errore "Failed to create class"
- Verifica che l'Issuer ID sia corretto
- Verifica che il service account abbia i permessi corretti su Google Wallet Console

### Il pass non si salva
- Verifica che la Pass Class sia stata creata correttamente
- Controlla i log della funzione Edge su Supabase Dashboard

## Riferimenti

- [Google Wallet API Documentation](https://developers.google.com/wallet)
- [Generic Pass Reference](https://developers.google.com/wallet/generic/rest/v1/genericobject)
- [JWT Signing Guide](https://developers.google.com/wallet/generic/web/prerequisites)
