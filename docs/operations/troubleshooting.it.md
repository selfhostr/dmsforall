---
title: Risoluzione dei problemi
description: Diagnosticare i problemi più comuni di un'installazione di dmsforall, dagli errori di avvio ai guasti di posta elettronica, OCR e importazione.
---

Cominci dai log del servizio che non funziona:

```sh
docker compose logs api --tail 100
docker compose ps
```

## L'API non si avvia

**Messaggio: `Invalid configuration`.** Il log elenca ogni variabile non valida, con il motivo. Corregga ciascuna in `.env`, poi esegua di nuovo `docker compose up -d`. Con il file Compose standard incontra raramente questo errore, perché la connessione al database e le chiavi sono già impostate.

**Il messaggio dice `COOKIE_SECURE must be true in production`.** Rimuova la riga `COOKIE_SECURE=false` da `.env`. Il cookie di sessione deve essere inviato tramite HTTPS.

**Il messaggio dice che viene usata una password di sviluppo.** L'URL del database contiene `dfa_app_dev` o `dfa_migrator_dev`. Ha impostato lei stesso `DATABASE_URL` con le password di sviluppo. Rimuova `DATABASE_URL` e `DATABASE_URL_MIGRATION` da `.env`: lo stack le costruisce a partire dalle password generate.

**Il messaggio riguarda `DATABASE_POOL_MIN`.** Un valore superiore a `DATABASE_POOL_MAX` viene rifiutato. Abbassi il minimo o alzi il massimo.

## L'accesso non riesce

**L'accesso web viene rifiutato con `AUTH_ORIGINE_REFUSEE`.** L'indirizzo nel browser non corrisponde a `DFA_PUBLIC_URL` (predefinito `http://localhost:8080`). Apra il sito a quell'indirizzo, oppure modifichi `DFA_PUBLIC_URL` e riavvii lo stack.

**La password viene rifiutata e l'account è bloccato.** Attenda la scadenza del blocco. I tentativi ripetuti falliti bloccano l'account per un certo tempo. Il limite è definito da `SEUIL_VERROUILLAGE_COMPTE`.

**L'accesso restituisce `429`.** Troppi tentativi da un indirizzo, oppure troppi tentativi su un account. Attenda la fine della finestra. Se tutti gli utenti risultano bloccati contemporaneamente, probabilmente `TRUST_PROXY_HOPS` è errato e tutti gli utenti condividono un unico indirizzo.

**La pagina si carica, ma Lei resta disconnesso.** Verifichi che `WEB_URL_PUBLIQUE` e `API_URL_PUBLIQUE` usino HTTPS e corrispondano agli indirizzi nel browser. Verifichi `COOKIE_DOMAINE`, se l'ha impostato.

## Il database è occupato

**Messaggio: `timeout exceeded when trying to connect`.** Tutte le connessioni del pool sono in uso. Cerchi nei log una query lenta, oppure alzi `DATABASE_POOL_MAX` se il server ha margine. Controlli anche il limite `max_connections` di PostgreSQL.

## Le e-mail non arrivano

Ogni autorimessa può impostare il proprio server di invio in **Impostazioni > Invio delle e-mail**; viene usato per primo, e la schermata ha un pulsante di prova. Senza di esso, i messaggi vengono inviati davvero solo quando `NODE_ENV=production`, `COURRIEL_ENVOI_REEL=true` e le variabili `SMTP_*` sono impostate. Altrimenti i messaggi vengono catturati e non consegnati. Verifichi prima queste variabili, poi i log del servizio `api` per l'errore SMTP.

## L'OCR del veicolo non legge il documento

Il servizio OCR deve essere in esecuzione e raggiungibile dall'API all'indirizzo `OCR_SERVICE_URL`. Se il servizio è lento, alzi `OCR_SERVICE_TIMEOUT_MS`. Un errore che indica che il servizio non è disponibile significa che la richiesta non è stata elaborata: riprovi.

## L'importazione dei dati si interrompe

**L'importazione si interrompe con un errore che indica che gli strumenti di Access non sono disponibili.** Un archivio Access richiede i programmi di `mdbtools`. Il container dell'API li include. Se esegue l'API fuori dal container, installi `mdbtools` sul server.

**L'importazione segnala record saltati.** Legga il motivo indicato per ogni record saltato nel piano o nel rapporto.

## La pagina è vuota dopo un aggiornamento

Verifichi che il container web sia in esecuzione e che la sua versione corrisponda a quella dell'API. Svuoti la cache del browser, poi ricarichi la pagina. Controlli i log del servizio `web`.

## La migrazione è fallita

L'API non si avvia con la nuova versione, e la versione precedente resta in esecuzione. Legga i log del servizio `migrate`, risolva la causa in una nuova release e ripeta l'aggiornamento. Non modifichi un file di migrazione già applicato.

## Dove ottenere altro aiuto

Apra una segnalazione nel [repository GitHub](https://github.com/selfhostr/dmsforall/issues) con la versione, le righe di log pertinenti e i passi per riprodurre il problema. Rimuova i dati personali e ogni segreto prima di incollare un log.
