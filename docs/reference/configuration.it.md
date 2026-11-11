---
title: Riferimento della configurazione
description: Ogni variabile d'ambiente letta da dmsforall, con il suo valore predefinito e il suo effetto.
---

dmsforall legge la sua configurazione dalle variabili d'ambiente. L'API le valida all'avvio con zod e rifiuta di partire se una non è valida. Il messaggio di errore elenca ogni variabile non valida.

Raramente ha bisogno di questa pagina: lo stack predefinito parte senza alcuna impostazione, e `.env.example` elenca le poche che potrebbe voler modificare (indirizzo pubblico, e-mail, versione, backup). Tutto il resto è qui, per un uso avanzato.

Nello stack predefinito, `docker-compose.yml` imposta le variabili dell'API a partire dai valori `DFA_*` del file `.env` accanto ad esso. I servizi dell'API leggono anche da soli quel file `.env`, quindi può aggiungervi qualsiasi variabile di questa pagina con il suo nome, per esempio `LIMITE_CONNEXION_IP=30`. Il file Compose prevale per le variabili che imposta da solo: per quelle usi i nomi `DFA_*` della sezione [Distribuzione](#distribuzione).

In sviluppo, le variabili vengono lette dal file `.env` alla radice del repository, creato a partire da `docker/dev.env.example`.

I booleani accettano i valori `true` o `false`. Le durate sono espresse in minuti, secondi o millisecondi, come indicato in ogni nome.

## Base

| Variabile              | Predefinito   | Effetto                                                                                                         |
| ---------------------- | ------------- | --------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`             | `development` | `development`, `test` o `production`. In produzione attiva i controlli più severi e l'invio reale delle e-mail. |
| `MODE_PROCESSUS`       | `combine`     | `api` serve solo HTTP. `worker` esegue solo i lavori in background. `combine` fa entrambe le cose.              |
| `PORT`                 | `3000`        | Porta su cui ascolta l'API, da 1 a 65535.                                                                       |
| `API_URL_PUBLIQUE`     | obbligatoria  | URL pubblico dell'API, per esempio `https://api.garage.example.org`.                                            |
| `WEB_URL_PUBLIQUE`     | obbligatoria  | URL pubblico dell'interfaccia web.                                                                              |
| `LOG_NIVEAU`           | `info`        | Livello dei log: `fatal`, `error`, `warn`, `info`, `debug` o `trace`.                                           |
| `OPENAPI_EXPOSER_DOCS` | `false`       | Pubblica la documentazione dell'API su `/api/docs`. Lasci `false` in produzione.                                |

## Database

Nello stack predefinito non imposta nessuna di queste variabili. L'entrypoint dell'immagine dell'API genera le password al primo avvio (in `./data/secrets`), crea i due ruoli `dfa_app` e `dfa_migrator` e costruisce a partire da esse `DATABASE_URL` e `DATABASE_URL_MIGRATION`. Contano se usa un PostgreSQL proprio: in quel caso imposti `DATABASE_URL` e `DATABASE_URL_MIGRATION` in `.env`, e crei i ruoli con i grant di `docker/postgres/init/01-roles.sql`. Le migrazioni vengono applicate dal container `api` all'avvio.

| Variabile                       | Predefinito                 | Effetto                                                                                                                                |
| ------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                  | obbligatoria                | URL PostgreSQL per il ruolo `dfa_app`. È il ruolo usato dall'API, ed è soggetto alla row-level security. Deve iniziare con `postgres`. |
| `DATABASE_URL_MIGRATION`        | obbligatoria                | URL PostgreSQL per il ruolo `dfa_migrator`, usato solo per applicare le migrazioni. Deve essere diverso da `DATABASE_URL`.             |
| `DATABASE_POOL_MAX`             | `10`                        | Numero massimo di connessioni nel pool, da 1 a 50.                                                                                     |
| `DATABASE_POOL_MIN`             | `min(2, DATABASE_POOL_MAX)` | Connessioni mantenute aperte anche quando sono inattive. Non può superare `DATABASE_POOL_MAX`.                                         |
| `DATABASE_TIMEOUT_REQUETE_MS`   | `10000`                     | Tempo massimo per una query, in millisecondi.                                                                                          |
| `DATABASE_TIMEOUT_CONNEXION_MS` | `5000`                      | Tempo massimo per aprire una connessione, in millisecondi.                                                                             |
| `DATABASE_TIMEOUT_IDLE_MS`      | `30000`                     | Tempo prima che una connessione inattiva sopra il minimo venga chiusa, in millisecondi.                                                |

## Valkey

| Variabile   | Predefinito  | Effetto                                                                                                                            |
| ----------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `REDIS_URL` | obbligatoria | URL di Valkey (protocollo Redis, quindi inizia con `redis`). Usato per le code, gli eventi in tempo reale e i limiti di frequenza. |

## Sessioni e accesso

| Variabile                           | Predefinito   | Effetto                                                                                                                                                                                                                   |
| ----------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SESSION_COOKIE_NOM`                | `dfa_session` | Nome del cookie di sessione. Solo lettere, cifre, `_` e `-`.                                                                                                                                                              |
| `SESSION_DUREE_MINUTES`             | `480`         | Durata massima della sessione, da 5 a 43200 minuti.                                                                                                                                                                       |
| `SESSION_INACTIVITE_MINUTES`        | `120`         | La sessione si chiude dopo questo tempo di inattività, da 5 a 1440 minuti.                                                                                                                                                |
| `COOKIE_DOMAINE`                    | nessuno       | Dominio del cookie di sessione. Lasci vuoto per usare l'host dell'API.                                                                                                                                                    |
| `COOKIE_SECURE`                     | `true`        | Marca il cookie come `Secure`. Deve essere `true` in produzione.                                                                                                                                                          |
| `TRUST_PROXY_HOPS`                  | `0`           | Numero di reverse proxy davanti all'API, da 0 a 10. Lo imposti con il numero esatto. Lo stack predefinito lo imposta a 1, o a 2 quando `DFA_PUBLIC_URL` è impostata.                                                      |
| `ORIGINE_ACCEPTER_HOTE`             | `false`       | Accetta un `Origin` del browser uguale all'intestazione `Host` della richiesta, invece di `WEB_URL_PUBLIQUE`. Lo stack predefinito lo attiva quando `DFA_PUBLIC_URL` non è impostata (accesso diretto tramite indirizzo). |
| `ARGON2_MEMOIRE_KIB`                | `19456`       | Costo di memoria dell'hash della password, in KiB. Minimo 19456.                                                                                                                                                          |
| `ARGON2_ITERATIONS`                 | `2`           | Costo in tempo dell'hash della password. Minimo 2.                                                                                                                                                                        |
| `ARGON2_PARALLELISME`               | `1`           | Parallelismo dell'hash della password.                                                                                                                                                                                    |
| `LIMITE_CONNEXION_IP`               | `20`          | Tentativi di accesso consentiti per indirizzo IP nella finestra.                                                                                                                                                          |
| `LIMITE_CONNEXION_COMPTE`           | `15`          | Tentativi di accesso consentiti per account nella finestra. Deve essere maggiore di `SEUIL_VERROUILLAGE_COMPTE`.                                                                                                          |
| `LIMITE_FENETRE_SECONDES`           | `900`         | Durata della finestra di accesso, in secondi. Minimo 30.                                                                                                                                                                  |
| `SEUIL_VERROUILLAGE_COMPTE`         | `5`           | Password errate consecutive prima che l'account venga bloccato per un certo tempo.                                                                                                                                        |
| `LIMITE_RECHERCHE_UTILISATEUR`      | `40`          | Richieste di ricerca consentite per utente nella finestra.                                                                                                                                                                |
| `LIMITE_RECHERCHE_FENETRE_SECONDES` | `30`          | Durata della finestra di ricerca, in secondi.                                                                                                                                                                             |

## Posta elettronica in uscita

Le e-mail vengono inviate davvero solo quando `NODE_ENV=production` **e** `COURRIEL_ENVOI_REEL=true`. In ogni altro caso i messaggi vengono catturati e non consegnati. Nello stack predefinito `NODE_ENV` vale `production`, e l'entrypoint imposta `COURRIEL_ENVOI_REEL=true` non appena è impostato `DFA_SMTP_HOST`.

| Variabile             | Predefinito | Effetto                                                               |
| --------------------- | ----------- | --------------------------------------------------------------------- |
| `COURRIEL_ENVOI_REEL` | `false`     | Consente l'invio reale, insieme a `NODE_ENV=production`.              |
| `SMTP_HOTE`           | nessuno     | Nome dell'host del server SMTP.                                       |
| `SMTP_PORT`           | `587`       | Porta SMTP, da 1 a 65535.                                             |
| `SMTP_SECURISE`       | `false`     | `true` per TLS implicito. Lasci `false` per STARTTLS sulla porta 587. |
| `SMTP_UTILISATEUR`    | nessuno     | Nome utente SMTP.                                                     |
| `SMTP_MOT_DE_PASSE`   | nessuno     | Password SMTP.                                                        |
| `SMTP_EXPEDITEUR`     | nessuno     | Indirizzo del mittente. Deve essere un indirizzo e-mail valido.       |

Ogni autorimessa può impostare il proprio server di invio nell'app (**Impostazioni > Invio delle e-mail**). Ordine di utilizzo: l'impostazione dell'autorimessa, poi le variabili `SMTP_*` qui sopra, poi nulla: senza l'una né le altre, l'e-mail non viene inviata e la schermata mostra «Non configurato». Fuori dalla produzione, le e-mail ordinarie restano catturate qualunque sia l'impostazione dell'autorimessa; viene inviata davvero solo l'e-mail di prova di quella schermata.

| Variabile                        | Predefinito | Effetto                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLE_CHIFFREMENT_SECRETS`        | nessuna     | Chiave di 32 byte (base64 o 64 caratteri esadecimali) che cifra le password SMTP delle autorimesse. Senza di essa, il salvataggio di una password viene rifiutato. Nello stack predefinito viene generata al primo avvio e conservata in `./data/secrets`. Altrove, la generi con `openssl rand -base64 32`. Cambiarla significa dover digitare di nuovo le password. |
| `COURRIEL_RESEAU_PRIVE_AUTORISE` | `false`     | Consente, in produzione, un server di invio di un'autorimessa su una rete privata (192.168.x, 10.x, localhost). Disattivato per impostazione predefinita, così il pulsante di prova non può sondare la rete interna. Sempre consentito fuori dalla produzione.                                                                                                        |

## Supervisione

| Variabile                            | Predefinito | Effetto                                                                                        |
| ------------------------------------ | ----------- | ---------------------------------------------------------------------------------------------- |
| `SENTRY_DSN`                         | nessuno     | DSN di un server compatibile con Sentry. Se vuoto, la segnalazione degli errori è disattivata. |
| `SENTRY_ENVIRONMENT`                 | `NODE_ENV`  | Nome dell'ambiente mostrato nelle segnalazioni di errore.                                      |
| `SENTRY_TAUX_ECHANTILLONNAGE_TRACES` | `0`         | Quota delle richieste tracciate per le prestazioni, da 0 a 1.                                  |
| `VERSION_APP`                        | calcolata   | Versione mostrata nell'endpoint di stato e nei log. Calcolata dal tag Git se vuota.            |
| `VERSION_APP_BRANCHE`                | calcolata   | Ramo o tag che ha prodotto la build. Calcolato se vuoto.                                       |

## Console operatore

La console è disattivata finché non è impostato `DATABASE_URL_CONSOLE`.

| Variabile                            | Predefinito           | Effetto                                                                  |
| ------------------------------------ | --------------------- | ------------------------------------------------------------------------ |
| `DATABASE_URL_CONSOLE`               | nessuno               | URL PostgreSQL per il ruolo `dfa_console`. Impostarlo attiva la console. |
| `CONSOLE_COOKIE_NOM`                 | `dfa_console_session` | Nome del cookie di sessione della console.                               |
| `CONSOLE_SESSION_DUREE_MINUTES`      | `60`                  | Durata massima della sessione di console, da 5 a 240 minuti.             |
| `CONSOLE_SESSION_INACTIVITE_MINUTES` | `15`                  | Timeout di inattività della console, da 1 a 120 minuti.                  |
| `CONSOLE_POOL_MAX`                   | `2`                   | Connessioni nel pool della console, da 1 a 10.                           |

## Lavori in background

Ogni lavoro pianificato ha un interruttore on/off e un'espressione cron. Le espressioni cron usano UTC.

L'interruttore accetta tre stati. Quando la variabile è vuota, il lavoro è attivo in produzione e inattivo negli altri ambienti. `true` lo forza attivo, `false` lo forza inattivo.

| Variabile                                 | Predefinito  | Lavoro                                                                          |
| ----------------------------------------- | ------------ | ------------------------------------------------------------------------------- |
| `REFERENTIEL_VEHICULES_CH_JOB_ACTIF`      | vuota        | Aggiornamento quotidiano dei dati di riferimento svizzeri sui veicoli.          |
| `REFERENTIEL_VEHICULES_CH_JOB_CRON`       | `17 4 * * *` | Pianificazione dell'aggiornamento dei dati di riferimento sui veicoli.          |
| `POINTAGE_CLOTURE_AUTOMATIQUE_JOB_ACTIF`  | vuota        | Chiusura automatica della giornata di rilevamento delle ore.                    |
| `POINTAGE_CLOTURE_AUTOMATIQUE_JOB_CRON`   | `30 0 * * *` | Pianificazione del lavoro di chiusura.                                          |
| `RELANCES_FACTURE_JOB_ACTIF`              | vuota        | Pianificazione e invio dei solleciti di fattura.                                |
| `RELANCES_FACTURE_JOB_CRON`               | `12 * * * *` | Pianificazione del lavoro di sollecito.                                         |
| `RESILIATION_PURGE_AUTOMATIQUE_JOB_ACTIF` | vuota        | Eliminazione automatica dei dati di un tenant dopo che ha lasciato il servizio. |
| `RESILIATION_PURGE_AUTOMATIQUE_JOB_CRON`  | `17 3 * * *` | Pianificazione del lavoro di eliminazione.                                      |

## Servizi documentali

| Variabile                              | Predefinito              | Effetto                                                                                                   |
| -------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------- |
| `OCR_SERVICE_URL`                      | `http://ocr-permis:8092` | URL del servizio OCR che legge i documenti di immatricolazione dei veicoli.                               |
| `OCR_SERVICE_TIMEOUT_MS`               | `20000`                  | Tempo di attesa per il servizio OCR dei veicoli, in millisecondi. Minimo 1000.                            |
| `LIMITE_OCR_PERMIS_UTILISATEUR`        | `15`                     | Scansioni OCR dei veicoli consentite per utente nella finestra.                                           |
| `LIMITE_OCR_PERMIS_FENETRE_SECONDES`   | `300`                    | Durata della finestra OCR dei veicoli, in secondi.                                                        |
| `FACTURES_FOURNISSEUR_OCR_SERVICE_URL` | nessuno                  | URL del servizio OCR che legge le fatture dei fornitori. Se non impostato, la funzione non è disponibile. |
| `FACTURES_FOURNISSEUR_OCR_TIMEOUT_MS`  | `20000`                  | Tempo di attesa per il servizio OCR delle fatture dei fornitori, in millisecondi. Minimo 1000.            |

## Interfaccia web

| Variabile               | Predefinito | Effetto                                                                                                                               |
| ----------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_DFA_VERSION_INFO` | nessuno     | Testo impostato in fase di build, mostrato nel piè di pagina della versione dell'interfaccia. Si imposta in build, non in esecuzione. |

## Distribuzione

Queste variabili vengono lette dal file Compose, non dall'API. Le imposti in `.env`. Nessuna è obbligatoria.

| Variabile                                                                                                  | Predefinito           | Effetto                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DFA_VERSION`                                                                                              | `latest`              | Tag dell'immagine da eseguire: `X.Y.Z`, `X.Y`, `latest` o `edge`.                                                                                                                                                                                 |
| `DFA_PORT`                                                                                                 | `8443`                | Porta dell'host per HTTPS. L'unica porta pubblicata.                                                                                                                                                                                              |
| `DFA_PUBLIC_URL`                                                                                           | nessuno               | Indirizzo pubblico dietro il Suo reverse proxy, per esempio `https://dmsforall.example.ch`. Usato come `API_URL_PUBLIQUE` e `WEB_URL_PUBLIQUE`, e per il nome del certificato. Senza di essa, il sito è raggiunto direttamente tramite indirizzo. |
| `DFA_EXPOSE_API_DOCS`                                                                                      | `false`               | Passata come `OPENAPI_EXPOSER_DOCS`.                                                                                                                                                                                                              |
| `DFA_SMTP_HOST`, `DFA_SMTP_PORT`, `DFA_SMTP_SECURE`, `DFA_SMTP_USER`, `DFA_SMTP_PASSWORD`, `DFA_SMTP_FROM` | vuote, `587`, `false` | Passate come `SMTP_HOTE`, `SMTP_PORT`, `SMTP_SECURISE`, `SMTP_UTILISATEUR`, `SMTP_MOT_DE_PASSE` e `SMTP_EXPEDITEUR`, nello stesso ordine. Impostare l'host attiva l'invio reale.                                                                  |
| `DFA_TIMEZONE`                                                                                             | `Europe/Zurich`       | Fuso orario del servizio di backup.                                                                                                                                                                                                               |
| `DFA_BACKUP_TIME`                                                                                          | `02:30`               | Ora del backup giornaliero.                                                                                                                                                                                                                       |
| `DFA_BACKUP_KEEP_DAYS`                                                                                     | `14`                  | Giorni di backup conservati.                                                                                                                                                                                                                      |
| `DFA_BACKUP_AGE_PUBLIC_KEY`                                                                                | vuota                 | Chiave pubblica `age`. Quando è impostata, i backup sono cifrati.                                                                                                                                                                                 |

Qualsiasi altra impostazione dell'API di questa pagina può essere aggiunta a `.env` con il proprio nome: i servizi `api` e `worker` leggono anch'essi quel file.

:::caution
Verifichi le variabili su questa pagina per la release che esegue. Le variabili possono cambiare da una release all'altra. Legga il [changelog](https://github.com/selfhostr/dmsforall/blob/main/CHANGELOG.md) prima di aggiornare.
:::
