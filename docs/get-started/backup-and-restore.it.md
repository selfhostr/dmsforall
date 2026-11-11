---
title: Eseguire il backup e il ripristino
description: Il backup giornaliero che si esegue da solo, come eseguirne uno a mano, come ripristinarlo e che cosa non è coperto.
---

Al termine di questa pagina, Lei sa dove si trovano i backup giornalieri, come eseguirne uno a mano, come ripristinarne uno e che cosa deve ancora copiare Lei stesso.

## Il backup giornaliero

Il servizio `backup` gira insieme allo stack. Ogni giorno alle 02:30 (ora del server, Europe/Zurich) scrive due file nella cartella `./backups`, accanto al file Compose:

| File                            | Contenuto                                                                                      |
| ------------------------------- | ---------------------------------------------------------------------------------------------- |
| `dfa-<date>_<time>.sql.gz`      | L'intero database: schema e dati.                                                              |
| `fichiers-<date>_<time>.tar.gz` | I file caricati e generati: PDF delle fatture, foto degli ordini di riparazione, esportazioni. |

I backup più vecchi di 14 giorni vengono eliminati. Cambi l'ora e il numero di giorni con `DFA_BACKUP_TIME` e `DFA_BACKUP_KEEP_DAYS` in `.env`. L'archivio dei file è completo ogni notte, non incrementale: dimensioni quindi il disco per 14 copie dei Suoi documenti.

Per eseguire un backup subito:

```sh
docker compose exec -u dfa backup /scripts/sauvegarder.sh
```

:::caution
`./backups` si trova sulla stessa macchina dei dati. Un guasto del disco o un server rubato fa perdere entrambi. Copi la cartella su un'altra macchina ogni giorno (`rsync`, `rclone`, un NAS), e conservi con essa una copia di `./data/secrets`.
:::

Per cifrare i backup, imposti `DFA_BACKUP_AGE_PUBLIC_KEY` in `.env` con una chiave pubblica [age](https://age-encryption.org). I file terminano allora con `.age`. Tenga la chiave privata lontana dal server: senza di essa, i backup non possono essere letti.

## Che cosa contiene un backup, e che cosa no

Il dump del database e l'archivio dei file coprono tutto ciò che l'applicazione conserva: documenti, foto, le esportazioni consegnate a un'autorimessa che lascia il servizio e gli archivi caricati per la ripresa dei dati dal software precedente.

Non sono coperti:

- `./data/secrets`, le password generate e la chiave di cifratura. La chiave protegge le password di invio che le autorimesse hanno salvato nell'applicazione: senza di essa, devono essere digitate di nuovo. Copi una volta questa piccola cartella in un luogo sicuro.
- `./data/valkey`. Le code e lo stato a breve termine vengono ricreati.
- `./data/certs`, il certificato HTTPS. Viene rigenerato se manca.

## Ripristino

Un ripristino riporta il database al momento del backup. Tutto ciò che è stato scritto dopo va perso. Esegua questi comandi nella cartella del file Compose.

1. Fermi i servizi che scrivono nel database:

   ```sh
   docker compose stop api worker
   ```

2. Ripristini il database da un file di backup (il nome di un file in `./backups`):

   ```sh
   docker compose exec -u dfa backup /scripts/restaurer.sh dfa-2026-11-10_023000.sql.gz
   ```

   Lo script carica prima il backup in un nuovo database e solo se riesce sostituisce quello attuale. Il database attuale viene conservato con il nome `dfa_avant_restauration_<time>`, e lo script stampa il comando che lo elimina quando Lei è soddisfatto. Un backup danneggiato non distrugge mai i Suoi dati attuali. Per un backup cifrato, lo decifri prima (`age -d -i age.key -o backups/restore.sql.gz backups/dfa-....sql.gz.age`) e indichi quel file.

3. Ripristini i file (facoltativo, quando dei documenti sono andati persi):

   ```sh
   sudo tar -xzf backups/fichiers-2026-11-10_023000.tar.gz -C data/fichiers
   ```

4. Riavvii i servizi:

   ```sh
   docker compose start api worker
   ```

Per ripristinare su un nuovo server, vi copi il file Compose, `./data/secrets` e i due file di backup, avvii lo stack una volta (`docker compose up -d`, poi `docker compose stop api worker`) ed esegua i passi da 2 a 4.

:::caution
Un backup che non è mai stato ripristinato non è un backup. Ne ripristini uno su una macchina separata adesso, acceda e apra un documento, prima di inserire dati reali.
:::
