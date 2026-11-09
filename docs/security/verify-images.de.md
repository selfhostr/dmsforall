---
title: Images prüfen
description: Wie Sie die Container-Images und Release-Dateien von dmsforall prüfen und welche konfigurierten Prüfungen noch nicht gelaufen sind.
---

Am Ende dieser Seite können Sie ein Image oder eine Release-Datei mit den folgenden Befehlen prüfen und wissen, welche Prüfungen noch nicht gelaufen sind.

:::caution
Der Release-Workflow ist so konfiguriert, dass er Images signiert, eine Software-Stückliste (SBOM) anhängt und Build-Attestationen veröffentlicht. Keines davon ist bisher gelaufen, weil noch kein Release veröffentlicht wurde. Bis zum ersten Release gibt es mit den folgenden Befehlen nichts zu prüfen. Verwenden Sie in der Zwischenzeit den Digest und den Build aus dem Quellcode.
:::

## Release-Workflow, sobald ein Release existiert

Jedes Image wird mit einer SBOM (SPDX), einer SLSA-Build-Provenance-Attestation und einer keyless Sigstore-Signatur gebaut. Prüfen Sie ein Image mit der GitHub CLI:

```sh
gh attestation verify oci://ghcr.io/selfhostr/dmsforall:<tag> -R selfhostr/dmsforall
```

Prüfen Sie die Sigstore-Signatur mit cosign:

```sh
cosign verify ghcr.io/selfhostr/dmsforall:<tag> \
  --certificate-identity-regexp 'https://github.com/selfhostr/dmsforall/.*' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

Release-Dateien enthalten eine Prüfsumme `.sha256` und ein Bundle `.sigstore.json`. Prüfen Sie eine Datei mit `sha256sum -c` und ihr Bundle mit `cosign verify-blob`.

Wiederholen Sie die Befehle für `ghcr.io/selfhostr/dmsforall-web:<tag>`.

## Images auf einen Digest festlegen

Verwenden Sie für die Version einen Tag und für das genau getestete Image einen Digest:

```sh
docker image inspect --format '{{index .RepoDigests 0}}' ghcr.io/selfhostr/dmsforall:<tag>
```

Setzen Sie den Digest in `.env` als `DFA_VERSION` oder in Ihrer eigenen Deployment-Datei, und bewahren Sie eine schriftliche Aufzeichnung der getesteten Digests auf.

## Images aus einem Tag bauen

Checken Sie einen Tag aus und bauen Sie die Images aus dem Repository:

```sh
git clone --branch <tag> https://github.com/selfhostr/dmsforall.git && cd dmsforall
docker compose -f docker-compose.yml -f docker-compose.build.yml build
```

Der Build liefert den Code des Tags, aber keine Signatur. Vergleichen Sie das Ergebnis mit dem Quellcode, den Sie ausgecheckt haben.

## Status

| Prüfung                               | Status                             |
| ------------------------------------- | ---------------------------------- |
| Image-Signatur (cosign)               | Konfiguriert, noch nicht gelaufen. |
| Build-Provenance-Attestation          | Konfiguriert, noch nicht gelaufen. |
| SBOM (SPDX)                           | Konfiguriert, noch nicht gelaufen. |
| Prüfsummen und Signaturen der Dateien | Konfiguriert, noch nicht gelaufen. |
| Festlegung auf den Digest             | Jetzt verfügbar.                   |
| Build aus einem Tag                   | Jetzt verfügbar.                   |

Diese Seite wird nach der Prüfung des ersten Release aktualisiert.
