---
title: Configurare la prima autorimessa
description: Creare il primo account dell'autorimessa, poi le sedi, gli utenti e le impostazioni di fatturazione necessarie prima della prima fattura.
---

Alla fine di questa pagina, l'autorimessa avrà il primo account, le sue sedi, gli account del personale e le impostazioni di fatturazione necessarie per emettere una prima fattura.

## 1. Creare l'autorimessa

Una nuova installazione non ha ancora nessun account. Al primo avvio l'API genera un codice di installazione monouso e lo scrive nei suoi log. L'interfaccia web lo chiede già nella prima schermata.

1. Legga il codice di installazione nei log dell'API:

   ```sh
   docker compose logs api
   ```

   Cerchi il blocco con `Codice d'installazione` (o `Installation code`), seguito da un codice come `K7QM-3XRB-9TNA`.

2. Apra `https://<indirizzo del server>:8443` (l'indirizzo della Sua installazione, oppure `DFA_PUBLIC_URL` dietro un reverse proxy). Su una nuova installazione il browser mostra **Crea la sua autorimessa** al posto della pagina di accesso. Inserisca il nome dell'autorimessa, nome e cognome, l'indirizzo e-mail, una password digitata due volte (almeno 12 caratteri) e il codice di installazione.

3. Scelga **Crea la mia autorimessa**. Lei è connesso con l'account `direction` e si apre l'assistente di configurazione.

Risultato: l'autorimessa esiste, con la sua sede (con lo stesso nome), l'account `direction` e una riga di audit. Riceve anche le impostazioni dell'officina, una tariffa oraria `ATELIER` (CHF 140.00) e otto motivi di appuntamento (tagliando, pneumatici, collaudo MFK, freni, diagnosi, carrozzeria, climatizzazione, altro), così può prendere appuntamenti già dal primo giorno. Tutto può essere modificato nelle impostazioni. L'assistente di configurazione La guida attraverso indirizzo, coordinate bancarie, IVA, tariffa oraria e personale dell'autorimessa, con valori predefiniti.

Il codice di installazione protegge una nuova installazione raggiungibile da internet prima che arrivi il suo proprietario: solo chi può leggere i log del server può creare la prima autorimessa. Il codice vale una sola volta. Un nuovo codice viene generato a ogni avvio dell'API finché non esiste alcuna autorimessa, e smette di funzionare non appena ne esiste una. Nel database resta solo un hash con sale. Se l'ha perso, esegua `docker compose restart api` e rilegga i log. La schermata rifiuta con questi codici:

- `INSTALLATION_CODE_INVALIDE` (403): il codice è errato o scaduto;
- `INSTALLATION_DEJA_FAITE` (409): su questa installazione esiste già un'autorimessa. Acceda invece;
- `AUTH_TROP_DE_TENTATIVES` (429): troppi tentativi. Attenda e riprovi;
- `MOT_DE_PASSE_FAIBLE` (all'interno di un 400 `VALIDATION_ECHOUEE`): la password è troppo debole, troppo comune, troppo prevedibile o contiene l'indirizzo e-mail.

### In alternativa: la riga di comando

Per creare l'autorimessa senza il browser, esegua un comando. Fa esattamente lo stesso della schermata (stessa sede, stessa tariffa oraria, stessi motivi di appuntamento) e non richiede il codice di installazione, perché gira sul server:

```sh
docker compose exec api node dist/cli/creer-garage.js --garage "Garage Exemple" --email direction@example.ch
```

Opzionale: `--first-name X` e `--last-name Y`. Esegua con `--help` per l'uso completo.

In sviluppo, esegua lo stesso comando dalla radice del repository. Legge `DATABASE_URL_MIGRATION` dal `.env` della radice, come l'API:

```sh
pnpm --filter @dfa/api exec tsx src/cli/creer-garage.ts --garage "Garage Exemple" --email direction@example.ch
```

La password viene letta dalla variabile `DFA_PREMIER_MOT_DE_PASSE`. Se non è impostata, il comando la chiede senza mostrarla. La richiesta interattiva non è ancora stata testata.

Il comando termina con stato 1 e uno di questi codici:

- `MOT_DE_PASSE_FAIBLE`: la password è troppo debole. Il messaggio spiega perché: troppo comune, troppo prevedibile, oppure contiene l'indirizzo e-mail;
- `GARAGE_EXISTANT`: esiste già un'autorimessa con questo nome;
- `COURRIEL_EXISTANT`: l'indirizzo e-mail è già usato.

Risultato: l'account può accedere all'interfaccia web all'indirizzo della Sua installazione (`https://<indirizzo del server>:8443`, oppure `DFA_PUBLIC_URL` dietro un reverse proxy). Un accesso da un indirizzo diverso da `DFA_PUBLIC_URL` restituisce `AUTH_ORIGINE_REFUSEE`. Dopo il primo accesso, l'assistente di configurazione La guida attraverso indirizzo, coordinate bancarie, IVA, tariffa oraria e personale dell'autorimessa, con valori predefiniti.

Il seed demo (`pnpm db:seed`) non viene eseguito con `NODE_ENV=production`. Non lo usi su un server che contiene dati reali.

## 2. Creare le sedi

Apra le impostazioni delle sedi e crei una voce per ogni officina, postazione di cassa o showroom. Ogni dato (clienti, veicoli, ordini, magazzino) appartiene a una sede.

## 3. Invitare il personale

Apra le impostazioni degli utenti e crei un account per ogni persona. Scelga il ruolo che corrisponde al lavoro della persona. Vedere [ruoli e diritti](../reference/roles-and-rights.md).

Per un terminale condiviso in officina, crei un account con il ruolo `poste_atelier` e lo colleghi a una sola sede.

## 4. Completare le impostazioni di fatturazione

Compili la ragione sociale e l'indirizzo, il numero IVA e il regime IVA, le coordinate bancarie e il blocco creditore. Il blocco creditore viene copiato su ogni fattura al momento dell'emissione.

Una fattura può essere emessa senza un blocco creditore completo, per esempio quando viene pagata in contanti. In tal caso non ha QR-fattura, e l'applicazione la segnala. Completi il blocco creditore prima di inviare fatture che devono essere pagate con bonifico.

## 5. Emettere un documento di prova

Crei un cliente di prova e un preventivo, lo emetta e controlli il PDF.

:::caution
Un documento emesso è bloccato. Lo si corregge solo con una nota di credito. Usi un cliente di prova per questo passaggio.
:::
