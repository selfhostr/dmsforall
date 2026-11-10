---
title: Porte e percorsi
description: Porte di rete e percorsi di archiviazione usati da dmsforall nello stack predefinito e in sviluppo.
---

## Porte di rete

### Stack predefinito (`docker-compose.yml`)

| Servizio                       | Porta dell'host     | Note                                                                           |
| ------------------------------ | ------------------- | ------------------------------------------------------------------------------ |
| `web`                          | `8443` (`DFA_PORT`) | Solo HTTPS, corrisponde alla porta 8443 del container. Inoltra `/api` a `api`. |
| `api`, `worker`                | nessuna             | Raggiunti solo tramite `web`.                                                  |
| `postgres`, `valkey`, `backup` | nessuna             | Mai pubblicati.                                                                |
| `ocr-permis`                   | nessuna             | Profilo `ocr`, raggiunto dall'API all'interno della rete Docker.               |

Solo `web` pubblica una porta, e non esiste alcuna porta HTTP. Tenga chiuse le altre porte sul firewall.

### Sviluppo (`docker/compose.dev.yml`)

| Servizio        | Porta | Note                                                       |
| --------------- | ----- | ---------------------------------------------------------- |
| API             | 3000  | `PORT` in `.env`. Viene eseguita sull'host con `pnpm dev`. |
| Interfaccia web | 5173  | Server di sviluppo Vite.                                   |
| PostgreSQL      | 5432  | Pubblicata perché gli strumenti possano connettersi.       |
| Valkey          | 6379  | Pubblicata perché gli strumenti possano connettersi.       |

## Percorsi di archiviazione

Lo stack predefinito usa semplici cartelle accanto a `docker-compose.yml` (bind mount), nessun volume Docker.

| Cartella          | Contenuto                                                   | Salvato dal backup giornaliero             |
| ----------------- | ----------------------------------------------------------- | ------------------------------------------ |
| `./data/postgres` | Dati di PostgreSQL.                                         | Sì, tramite il dump.                       |
| `./data/fichiers` | Documenti caricati e generati, foto, esportazioni.          | Sì, nell'archivio dei file.                |
| `./data/secrets`  | Password del database generate e chiave di cifratura.       | No. Conservi una copia in un luogo sicuro. |
| `./data/valkey`   | Dati di Valkey (code dei lavori).                           | No.                                        |
| `./data/certs`    | Certificato HTTPS: `cert.pem` e `key.pem`.                  | No. Rigenerato se manca.                   |
| `./backups`       | I backup giornalieri (`dfa-*.sql.gz`, `fichiers-*.tar.gz`). | Solo copia locale.                         |

L'archivio dei file copre tutto ciò che si trova sotto `./data/fichiers`. Vedere [Eseguire il backup e il ripristino](../get-started/backup-and-restore.md).

In sviluppo, i file PDF vengono scritti in `apps/api/uploads/documents-pdf/<tenant>/<document>.pdf`.

:::caution
Le cartelle non sono cifrate da Docker. Per i dati a riposo, usi un disco o una partizione cifrata sotto la cartella che contiene `docker-compose.yml`. Vedere [Che cosa è protetto](../security/what-is-protected.md).
:::
