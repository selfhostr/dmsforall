---
title: Porte e percorsi
description: Porte di rete, percorsi di archiviazione e volumi Docker usati da dmsforall nello stack predefinito e in sviluppo.
---

## Porte di rete

### Stack predefinito (`docker-compose.yml`)

| Servizio               | Porta dell'host           | Note                                                                                                  |
| ---------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------- |
| `proxy` (Caddy) HTTP   | `8080` (`DFA_HTTP_PORT`)  | Corrisponde alla porta 80 del container.                                                              |
| `proxy` (Caddy) HTTPS  | `8443` (`DFA_HTTPS_PORT`) | Corrisponde alla porta 443 del container. Con un dominio in `DFA_SITE_ADDRESS` usi le porte 80 e 443. |
| `web`, `api`, `worker` | nessuna                   | Raggiunti solo tramite il proxy.                                                                      |
| `postgres`, `redis`    | nessuna                   | Mai pubblicati.                                                                                       |
| `ocr-permis`           | nessuna                   | Profilo `ocr`, raggiunto dall'API all'interno della rete Docker.                                      |

Solo il proxy pubblica una porta. Tenga chiuse le altre porte sul firewall.

### Sviluppo (`docker/compose.dev.yml`)

| Servizio        | Porta | Note                                                       |
| --------------- | ----- | ---------------------------------------------------------- |
| API             | 3000  | `PORT` in `.env`. Viene eseguita sull'host con `pnpm dev`. |
| Interfaccia web | 5173  | Server di sviluppo Vite.                                   |
| PostgreSQL      | 5432  | Pubblicata perché gli strumenti possano connettersi.       |
| Valkey          | 6379  | Pubblicata perché gli strumenti possano connettersi.       |

## Percorsi di archiviazione

| Percorso o volume                   | Contenuto                                                    | Salvato dal backup notturno                |
| ----------------------------------- | ------------------------------------------------------------ | ------------------------------------------ |
| `dmsforall_dfa_postgres_data`       | Dati di PostgreSQL.                                          | Sì, tramite il dump.                       |
| `dmsforall_dfa_postgres_backups`    | Backup notturni cifrati (profilo `backup`).                  | Solo copia locale.                         |
| `dmsforall_dfa_api_uploads`         | Documenti PDF caricati e generati.                           | Sì, nell'archivio dei file.                |
| `dmsforall_dfa_exports_resiliation` | Esportazioni fatte quando un'autorimessa lascia il servizio. | Sì, nell'archivio dei file.                |
| `dmsforall_dfa_photos_or`           | Foto degli ordini di riparazione e miniature.                | Sì, nell'archivio dei file.                |
| `dmsforall_dfa_reprise`             | Archivi caricati per la ripresa dei dati.                    | Sì, nell'archivio dei file.                |
| `dmsforall_dfa_secrets`             | Password del database generate e chiave di cifratura.        | No. Conservi una copia in un luogo sicuro. |
| `dmsforall_dfa_redis_data`          | Dati di Valkey.                                              | No.                                        |
| `dmsforall_dfa_caddy_data`          | Certificati TLS ottenuti da Caddy.                           | No.                                        |

L'archivio dei file (`dfa_<timestamp>.uploads.tar.gz.age`) copre tutto ciò che è montato sotto `/uploads` nel servizio `backup`. Vedere [Eseguire il backup e il ripristino](../get-started/backup-and-restore.md).

In sviluppo, i file PDF vengono scritti in `apps/api/uploads/documents-pdf/<tenant>/<document>.pdf`.

:::caution
I volumi con nome di Docker non sono cifrati da Docker. Per i dati a riposo, usi un disco o una partizione cifrata sotto la directory dei dati di Docker. Vedere [Che cosa è protetto](../security/what-is-protected.md).
:::
