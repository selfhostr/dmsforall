---
title: Zu dmsforall beitragen
description: Wie Sie eine Entwicklungsumgebung einrichten, die Prüfungen ausführen und eine Änderung zur Prüfung einreichen.
---

Den vollständigen Leitfaden finden Sie im Repository in [CONTRIBUTING.md](https://github.com/selfhostr/dmsforall/blob/main/CONTRIBUTING.md). Diese Seite gibt die Kurzfassung und die Links, die für die Dokumentation wichtig sind.

## Entwicklungsumgebung einrichten

```sh
cp .env.example .env
pnpm install
pnpm docker:up
pnpm db:migrate
pnpm db:seed
pnpm dev
```

`pnpm docker:*` steuert `docker-compose.dev.yml` mit dem Compose-Projektnamen `dmsforall-dev`. Dabei starten nur PostgreSQL und Valkey. Mit `--profile containers` läuft der gesamte Entwicklungsstack in Containern.

Die API läuft auf Port 3000, die Web-Oberfläche auf Port 5173. Die Demo-Konten sind im Leitfaden zur Mitarbeit aufgeführt.

## Vor dem Öffnen eines Pull Requests

Führen Sie diese Prüfungen in dieser Reihenfolge aus:

```sh
pnpm --filter @dfa/shared build
pnpm typecheck
pnpm lint
pnpm format:check
pnpm --filter @dfa/web i18n:check
pnpm test
```

## Änderung einreichen

1. Erstellen Sie einen Branch von `dev` mit einem Namen wie `feat/name`, `fix/name` oder `docs/name`.
2. Schreiben Sie Conventional Commits und signieren Sie jeden Commit mit `git commit -s`.
3. Öffnen Sie einen Pull Request gegen `dev`. Behandeln Sie pro Pull Request ein einziges Thema.

## Dokumentation aktuell halten

Die Dokumentation gehört zur Änderung. Wenn Sie ein Verhalten ändern, aktualisieren Sie die Seite, die es beschreibt, und lesen Sie die ganze Seite noch einmal, nicht nur den geänderten Absatz.

Die Dokumentationsseiten sind auf Englisch verfasst. Die Texte der Oberfläche werden zuerst auf Französisch geschrieben, danach auf Deutsch und Italienisch übersetzt.

## Architektur und Entscheidungen

- [Architektur](https://github.com/selfhostr/dmsforall/blob/main/ARCHITECTURE.md): Komponenten, Fachbereiche und Konventionen.
- [Design](https://github.com/selfhostr/dmsforall/blob/main/DESIGN.md): Farben, Typografie, Dichte und Regeln zur Barrierefreiheit. Auf Französisch.
- [Entscheidungsprotokolle](adr/): die Entscheidungen, die den Code prägen.
