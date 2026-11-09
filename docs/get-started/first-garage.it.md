---
title: Configurare la prima autorimessa
description: Creare il primo account dell'autorimessa, poi le sedi, gli utenti e le impostazioni di fatturazione necessarie prima della prima fattura.
---

Alla fine di questa pagina, l'autorimessa avrà il primo account, le sue sedi, gli account del personale e le impostazioni di fatturazione necessarie per emettere una prima fattura.

Con un solo comando si creano l'autorimessa, la sua sede (con lo stesso nome), il primo account `direction` e una riga di audit. L'autorimessa riceve anche le impostazioni dell'officina, una tariffa oraria `ATELIER` (CHF 140.00) e otto motivi di appuntamento (tagliando, pneumatici, collaudo MFK, freni, diagnosi, carrozzeria, climatizzazione, altro), così può prendere appuntamenti già dal primo giorno. Tutto può essere modificato nelle impostazioni:

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

Risultato: l'account può accedere all'interfaccia web su `DFA_PUBLIC_URL` (predefinito `http://localhost:8080`). Un accesso da un altro indirizzo restituisce `AUTH_ORIGINE_REFUSEE`.

Il seed demo (`pnpm db:seed`) non viene eseguito con `NODE_ENV=production`. Non lo usi su un server che contiene dati reali.

## 2. Creare le sedi

Apra **Impostazioni › Sedi** e crei una voce per ogni officina, postazione di cassa o showroom. Ogni dato (clienti, veicoli, ordini, magazzino) appartiene a una sede.

## 3. Invitare il personale

Apra **Impostazioni › Utenti** e crei un account per ogni persona. Scelga il ruolo che corrisponde al lavoro della persona. Vedere [ruoli e diritti](../reference/roles-and-rights.md).

Per un terminale condiviso in officina, crei un account con il ruolo `poste_atelier` e lo colleghi a una sola sede.

## 4. Completare le impostazioni di fatturazione

Compili la ragione sociale e l'indirizzo, il numero IVA e il regime IVA, le coordinate bancarie e il blocco creditore. Il blocco creditore viene copiato su ogni fattura al momento dell'emissione.

Una fattura può essere emessa senza un blocco creditore completo, per esempio quando viene pagata in contanti. In tal caso non ha QR-fattura, e l'applicazione la segnala. Completi il blocco creditore prima di inviare fatture che devono essere pagate con bonifico.

## 5. Emettere un documento di prova

Crei un cliente di prova e un preventivo, lo emetta e controlli il PDF.

:::caution
Un documento emesso è bloccato. Lo si corregge solo con una nota di credito. Usi un cliente di prova per questo passaggio.
:::
