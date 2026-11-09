---
title: dmsforall bauen
description: Pakete, API und Web-Oberfläche bauen, die OpenAPI-Beschreibung exportieren, die Web-Typen erzeugen und die Container-Images bauen.
---

Am Ende dieser Seite können Sie alle Pakete bauen, den API-Vertrag exportieren und die beiden Container-Images erstellen.

## Voraussetzungen

- Node.js 22 oder neuer.
- pnpm 11, wie in `package.json` festgelegt.
- Docker mit Compose v2, für die Datenbank und die Images.

## Abhängigkeiten installieren

```sh
pnpm install --frozen-lockfile
```

Die Option `--frozen-lockfile` lässt die Installation fehlschlagen, wenn `pnpm-lock.yaml` nicht zu `package.json` passt.

## Pakete bauen

```sh
pnpm --filter @dfa/shared build
pnpm build
```

Bauen Sie zuerst `@dfa/shared`. Die API und die Web-Oberfläche verwenden dessen kompilierte Ausgabe.

## API-Vertrag exportieren und Web-Typen erzeugen

Nach einer Änderung an einem Controller oder einem DTO erzeugen Sie das OpenAPI-Dokument und die Web-Typen neu:

```sh
pnpm api:openapi
pnpm web:types
```

Führen Sie `pnpm api:openapi` nicht aus, während `pnpm dev` läuft. Beide Befehle schreiben in denselben Build-Ordner.

## Container-Images bauen

Um die Images des Stacks aus dem Quellcode zu bauen, verwenden Sie die Override-Datei:

```sh
docker compose -f docker-compose.yml -f docker-compose.build.yml build
```

Um ein einzelnes Image von Hand zu bauen, führen Sie den Befehl im Wurzelverzeichnis des Repositorys aus. Die Dockerfiles kopieren die Workspace-Pakete, deshalb muss der Kontext dort liegen:

```sh
docker build -f apps/api/Dockerfile -t dmsforall:local .
docker build -f apps/web/Dockerfile -t dmsforall-web:local .
```

Das API-Image enthält ausserdem die Programme `mdbtools`, die der Datenimport benötigt.

## Ergebnis prüfen

```sh
pnpm typecheck
pnpm lint
pnpm format:check
```

Die vollständige Liste der Prüfungen, die die CI ausführt, finden Sie unter [Tests](testing.md) und [Mitarbeit](contributing.md).
