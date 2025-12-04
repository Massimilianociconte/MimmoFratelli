# Requirements Document

## Introduction

Questo documento definisce i requisiti per un sistema integrato di codici sconto automatici per il primo ordine e un programma referral "invita un amico". Le due funzionalità condividono l'infrastruttura esistente delle promozioni (`promotions` table) e dei crediti utente (`user_credits` table), estendendola con logiche specifiche per tracciare nuovi utenti e relazioni di referral.

Il sistema deve incentivare sia l'acquisizione di nuovi clienti (primo ordine) che la crescita organica tramite passaparola (referral), mantenendo la semplicità d'uso e prevenendo abusi.

## Glossary

- **Sistema**: L'applicazione e-commerce Mimmo Fratelli
- **Nuovo Utente**: Un utente registrato che non ha mai completato un ordine con pagamento andato a buon fine
- **Codice Primo Ordine**: Un codice sconto generato automaticamente e assegnato a ogni nuovo utente alla registrazione
- **Referrer**: L'utente esistente che invita un amico tramite il proprio link/codice referral
- **Referee**: Il nuovo utente che si registra utilizzando un link/codice referral
- **Codice Referral**: Un codice univoco e permanente assegnato a ogni utente per invitare amici
- **Link Referral**: URL contenente il codice referral che traccia la provenienza del nuovo utente
- **Credito Store**: Saldo virtuale dell'utente utilizzabile per acquisti futuri (già esistente in `user_credits` per le gift card riscattate accreditate nel profilo). Crea un credito distinto solo per i referall oltre a quello delle gift card.
- **Conversione Referral**: Il momento in cui un referee completa il suo primo ordine, attivando i reward per entrambe le parti

## Requirements

### Requirement 1: Generazione Automatica Codice Primo Ordine

**User Story:** As a nuovo utente, I want to ricevere automaticamente un codice sconto alla registrazione, so that I can avere un incentivo immediato per completare il mio primo acquisto.

#### Acceptance Criteria

1. WHEN un utente completa la registrazione THEN il Sistema SHALL generare un codice sconto univoco con prefisso "BENVENUTO" e assegnarlo all'utente
2. WHEN il codice primo ordine viene generato THEN il Sistema SHALL configurarlo con sconto del 10% e validità di 30 giorni dalla creazione
3. WHEN un utente accede alla pagina checkout o al proprio profilo THEN il Sistema SHALL mostrare il codice primo ordine disponibile se non ancora utilizzato
4. WHEN un utente tenta di applicare il codice primo ordine avendo già completato un ordine THEN il Sistema SHALL rifiutare l'applicazione e mostrare un messaggio di errore appropriato
5. WHEN il codice primo ordine viene applicato con successo THEN il Sistema SHALL calcolare lo sconto sul totale del carrello escludendo le spese di spedizione

### Requirement 2: Gestione Codice Referral Utente

**User Story:** As a utente registrato, I want to avere un codice referral personale permanente, so that I can condividerlo facilmente con amici e familiari.

#### Acceptance Criteria

1. WHEN un utente completa la registrazione THEN il Sistema SHALL generare un codice referral univoco di 8 caratteri alfanumerici associato permanentemente all'utente
2. WHEN un utente accede alla sezione referral nel proprio profilo THEN il Sistema SHALL mostrare il codice referral, il link di condivisione e le statistiche degli inviti
3. WHEN un utente richiede di condividere il proprio link referral THEN il Sistema SHALL fornire opzioni di condivisione per WhatsApp, email e copia negli appunti
4. WHEN il Sistema genera un link referral THEN il Sistema SHALL includere il codice referral come parametro URL nel formato `?ref=CODICE`

### Requirement 3: Registrazione Tramite Referral

**User Story:** As a potenziale cliente, I want to registrarmi tramite un link referral di un amico, so that I can ricevere uno sconto aggiuntivo sul mio primo ordine.

#### Acceptance Criteria

1. WHEN un visitatore accede al sito tramite un link referral valido THEN il Sistema SHALL memorizzare il codice referral nella sessione/localStorage
2. WHEN un visitatore con codice referral memorizzato completa la registrazione THEN il Sistema SHALL creare una relazione referral tra il nuovo utente (referee) e l'utente esistente (referrer)
3. WHEN viene creata una relazione referral THEN il Sistema SHALL assegnare al referee un codice primo ordine con sconto maggiorato del 15% invece del 10% standard
4. WHEN un visitatore tenta di registrarsi con un codice referral non valido o scaduto THEN il Sistema SHALL procedere con la registrazione normale senza bonus referral

### Requirement 4: Reward Sistema Referral

**User Story:** As a referrer, I want to ricevere un reward quando il mio amico completa il primo ordine, so that I can essere incentivato a continuare a invitare nuovi clienti.

#### Acceptance Criteria

1. WHEN un referee completa il suo primo ordine con pagamento confermato THEN il Sistema SHALL accreditare €5 di credito store al referrer
2. WHEN un referee completa il suo primo ordine THEN il Sistema SHALL aggiornare lo stato della relazione referral a "convertito" con timestamp
3. WHEN un referrer riceve credito da un referral THEN il Sistema SHALL inviare una notifica push e/o email al referrer con i dettagli del reward
4. WHEN un referrer visualizza le statistiche referral THEN il Sistema SHALL mostrare il numero di inviti inviati, conversioni completate e credito totale guadagnato

### Requirement 5: Prevenzione Abusi

**User Story:** As a amministratore del sistema, I want to prevenire abusi del sistema referral, so that I can mantenere la sostenibilità economica del programma.

#### Acceptance Criteria

1. WHEN un utente tenta di usare il proprio codice referral per auto-referral THEN il Sistema SHALL rifiutare la registrazione del referral e procedere con registrazione normale
2. WHEN vengono rilevate multiple registrazioni dallo stesso indirizzo IP in 24 ore con lo stesso codice referral THEN il Sistema SHALL limitare i reward a massimo 3 conversioni per IP al giorno
3. WHEN un ordine viene rimborsato o annullato entro 14 giorni THEN il Sistema SHALL revocare il credito referral assegnato al referrer
4. WHEN un referrer raggiunge 50 conversioni totali THEN il Sistema SHALL continuare ad accettare referral ma notificare l'admin per review manuale

### Requirement 6: Interfaccia Admin per Gestione Promozioni

**User Story:** As a amministratore, I want to monitorare e gestire il sistema di sconti e referral, so that I can ottimizzare le campagne e identificare eventuali problemi.

#### Acceptance Criteria

1. WHEN un admin accede al pannello promozioni THEN il Sistema SHALL mostrare statistiche aggregate su codici primo ordine utilizzati, tasso di conversione e valore medio ordini con sconto
2. WHEN un admin accede al pannello referral THEN il Sistema SHALL mostrare la lista dei top referrer, conversioni totali, crediti erogati e trend temporali
3. WHEN un admin modifica i parametri del sistema (percentuale sconto, importo reward, durata validità) THEN il Sistema SHALL applicare le modifiche solo ai nuovi codici generati, mantenendo invariati quelli esistenti
4. WHEN un admin sospende un utente per abuso THEN il Sistema SHALL invalidare tutti i codici referral associati e bloccare futuri reward

