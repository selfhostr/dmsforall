---
title: Eseguire il backup e il ripristino
description: Attivare il backup notturno cifrato del database e dei file caricati, eseguire un dump manuale, e cosa è stato e cosa non è stato dimostrato sul ripristino.
---

Al termine di questa pagina, Lei sa come attivare il backup notturno, come eseguire un dump a mano e a che punto è il ripristino.

:::caution
La copia fuori sede non è stata verificata. Conservi una seconda copia al di fuori del server, e la controlli Lei stesso.
:::

## Attivare il backup notturno

Il backup viene eseguito nel profilo `backup`. Ogni notte scrive file cifrati nel volume `dmsforall_dfa_postgres_backups`. Ogni notte vengono prodotti tre file con lo stesso timestamp:

| File                                 | Contenuto                                                                                      |
| ------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `dfa_<timestamp>.dump.age`           | Il database: schema e dati.                                                                    |
| `dfa_<timestamp>.roles.sql.age`      | I ruoli del database, con le password correnti.                                                |
| `dfa_<timestamp>.uploads.tar.gz.age` | I file caricati e generati: PDF delle fatture, foto degli ordini di riparazione, esportazioni. |

I tre file sono cifrati con la stessa chiave `age`, ruotati insieme (7 giornalieri, 4 settimanali, 12 mensili) e copiati fuori sede insieme quando è impostato `RCLONE_REMOTE`. L'archivio dei file è completo ogni notte, non incrementale: una volta compresso ha circa le dimensioni dei file stessi (le foto si comprimono appena), e il volume conserva fino a 23 copie. Dimensioni il volume di conseguenza.

1. Inserisca in `.env` una chiave pubblica `age`:

   ```sh
   AGE_CLE_PUBLIQUE=age1...
   ```

2. Avvii il profilo:

   ```sh
   docker compose --profile backup up -d
   ```

Tenga la chiave privata `age` lontana da questo server. Senza di essa, i backup non possono essere letti. Il backup viene eseguito dall'immagine pubblicata `ghcr.io/selfhostr/dmsforall-backup`, quindi il server non ha bisogno di un clone del repository. Lo script di ripristino `restaurer.sh` invece sì: lo prenda dal repository, oppure da un clone sulla macchina su cui esegue il ripristino.

L'ora del backup si imposta con `HEURE_SAUVEGARDE` (predefinito `03:15`), e il fuso orario con `DFA_TIMEZONE` (predefinito `UTC`).

## Eseguire un dump a mano

Per una copia occasionale del database, usi `pg_dump` nel container di Postgres:

```sh
docker compose exec postgres pg_dump -U dfa -Fc dfa > dfa-$(date +%Y%m%d).dump
```

Conservi il file cifrato e fuori dal server.

## Che cosa viene salvato

Il container di backup monta in sola lettura i volumi di caricamento sotto `/uploads` e archivia tutto ciò che vi trova:

- `dmsforall_dfa_api_uploads`: fatture e altri documenti PDF.
- `dmsforall_dfa_photos_or`: foto degli ordini di riparazione e relative miniature.
- `dmsforall_dfa_exports_resiliation`: le esportazioni consegnate a un'autorimessa che lascia il servizio. Possono contenere tutti i dati di un'autorimessa e, una volta che l'autorimessa non è più presente, non sempre possono essere rigenerate.
- `dmsforall_dfa_reprise`: gli archivi caricati per la ripresa dei dati dal software precedente. Sono la fonte della ripresa e non possono essere rigenerati.

Un nuovo volume di caricamento aggiunto al servizio `api` in `docker-compose.yml` non viene salvato finché non lo monta anche, in sola lettura, sotto `/uploads/` nel servizio `backup`.

L'archivio viene scritto come flusso (`tar` verso `age`): non viene mai scritto su disco un file in chiaro. Il backup fallisce, e `dernier-statut.txt` riporta `ECHEC`, se l'archivio non può essere scritto o se manca `/uploads`.

## Che cosa non viene salvato

- I dati di Valkey. Le code e lo stato a breve termine vengono ricreati.
- Le password del database generate e la chiave di cifratura (volume `dmsforall_dfa_secrets`), e i certificati TLS (volume `dmsforall_dfa_caddy_data`). Il file dei ruoli del backup contiene le password del database. La chiave di cifratura protegge le password di invio che le autorimesse hanno salvato nell'app: senza di essa, devono essere digitate di nuovo. Conservi una copia della chiave in un luogo sicuro:

  ```sh
  docker compose run --rm --no-deps --entrypoint cat api /secrets/secrets_key
  ```

- I file in una cartella di caricamento che non è un volume montato. Vivono nel container e vanno persi quando il container viene ricreato.

## Ripristino

Un ripristino riporta il database al momento del backup. Tutto ciò che è stato scritto dopo quel backup va perso.

1. Fermi i servizi `api` e `worker`, così che nulla scriva nel database.
2. Ripristini il dump in un database vuoto su una macchina separata, e ne verifichi il risultato.
3. Solo dopo proceda al ripristino sul server di produzione. Un ripristino completo su un'installazione nuova è stato dimostrato.

`restaurer.sh` ripristina insieme il database e i file, purché il file `.uploads.tar.gz.age` si trovi accanto al file `.dump.age`:

```sh
AGE_CLE_PRIVEE_FICHIER=/path/to/age.key \
  docker/postgres/sauvegarde/restaurer.sh /path/to/dfa_20260101-031500.dump.age dfa --confirmer
```

- `--base-seule` ripristina solo il database.
- `--fichiers-seuls` ripristina solo i file. Passi `-` come nome del database.

I file vengono estratti nei volumi del servizio `api`. Un file con lo stesso nome viene sovrascritto, mentre un file che non è presente nell'archivio viene lasciato com'è. I file vengono ripristinati solo quando il database di destinazione è `dfa`: un ripristino di prova in un altro database lascia intatti i file in uso.

Il test di ripristino mensile (`restaurer-test.sh`) decifra e legge l'intero archivio dei file. Non è ancora stato eseguito su un archivio reale nei test automatici: lo esegua a mano una volta dopo aver attivato il backup.

:::caution
`restaurer.sh` richiede `age` sull'host, con la chiave privata. Lo stack deve essere già in esecuzione prima del ripristino.
:::
