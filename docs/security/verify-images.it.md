---
title: Verificare le immagini
description: Come controllare le immagini dei container di dmsforall e i file di rilascio, e quali controlli sono configurati ma non sono ancora stati eseguiti.
---

Alla fine di questa pagina potrà verificare un'immagine o un file di rilascio con i comandi sotto indicati, e saprà quali controlli non sono ancora stati eseguiti.

:::caution
Il flusso di rilascio è configurato per firmare le immagini, allegare una distinta base del software (SBOM) e pubblicare le attestazioni di build. Nessuno di questi passaggi è ancora stato eseguito, perché non è stata pubblicata alcuna release. Fino alla prima release, non c'è nulla da verificare con i comandi seguenti. Nel frattempo usi il digest e la build dal sorgente.
:::

## Flusso di rilascio, quando esiste una release

Ogni immagine è costruita con una SBOM (SPDX), un'attestazione di provenienza di build SLSA e una firma Sigstore senza chiavi. Per verificare un'immagine con la GitHub CLI:

```sh
gh attestation verify oci://ghcr.io/selfhostr/dmsforall:<tag> -R selfhostr/dmsforall
```

Per verificare la firma Sigstore con cosign:

```sh
cosign verify ghcr.io/selfhostr/dmsforall:<tag> \
  --certificate-identity-regexp 'https://github.com/selfhostr/dmsforall/.*' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

I file di rilascio includono un checksum `.sha256` e un bundle `.sigstore.json`. Controlli un file con `sha256sum -c` e verifichi il suo bundle con `cosign verify-blob`.

Ripeta i comandi per `ghcr.io/selfhostr/dmsforall-web:<tag>`.

## Fissare le immagini tramite digest

Usi un tag per la versione, e un digest per l'immagine esatta che ha testato:

```sh
docker image inspect --format '{{index .RepoDigests 0}}' ghcr.io/selfhostr/dmsforall:<tag>
```

Imposti il digest nel `.env` come `DFA_VERSION` o nel proprio file di deployment, e conservi una registrazione scritta dei digest testati.

## Costruire le immagini da un tag

Estragga un tag, poi costruisca le immagini dal repository:

```sh
git clone --branch <tag> https://github.com/selfhostr/dmsforall.git && cd dmsforall
docker compose -f docker-compose.yml -f docker-compose.build.yml build
```

La build le dà il codice del tag, ma non una firma. Confronti il risultato con il sorgente che ha estratto.

## Stato

| Controllo                             | Stato                             |
| ------------------------------------- | --------------------------------- |
| Firma dell'immagine (cosign)          | Configurata, non ancora eseguita. |
| Attestazione di provenienza di build  | Configurata, non ancora eseguita. |
| SBOM (SPDX)                           | Configurata, non ancora eseguita. |
| Checksum e firme dei file di rilascio | Configurati, non ancora eseguiti. |
| Fissaggio tramite digest              | Disponibile ora.                  |
| Build da un tag                       | Disponibile ora.                  |

Questa pagina sarà aggiornata dopo la verifica della prima release.
