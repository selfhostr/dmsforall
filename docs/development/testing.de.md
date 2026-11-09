---
title: dmsforall testen
description: Die Unit-Tests, die Integrationstests, eine einzelne Testdatei und die Prüfung der Umkehrbarkeit der Migrationen ausführen.
---

Am Ende dieser Seite können Sie die gesamte Testsuite, eine einzelne Testdatei und die Integrationstests auf einer Wegwerf-Datenbank ausführen.

## Unit-Tests

```sh
pnpm test
```

Dieser Befehl führt die Unit-Tests aller Pakete aus. Vitest prüft keine Typen. Führen Sie deshalb zusätzlich `pnpm typecheck` aus.

## Eine Testdatei

```sh
pnpm --filter @dfa/api exec vitest run --project unitaire apps/api/src/facturation/documents/numerotation.spec.ts
```

Um einen einzelnen Test anhand seines Namens auszuführen, ergänzen Sie `-t` um einen Teil des Namens:

```sh
pnpm --filter @dfa/api exec vitest run --project unitaire -t "Teil des Namens" apps/api/src/facturation/documents/numerotation.spec.ts
```

Das Web-Paket kennt die Option `--project` nicht:

```sh
pnpm --filter @dfa/web exec vitest run apps/web/src/test/accessibilite/contraste-jetons.spec.ts
```

## Integrationstests

```sh
pnpm test:integration
```

Die Integrationstests starten mit testcontainers eine Wegwerf-Datenbank für PostgreSQL. Docker muss laufen. Sie verwenden nie Ihre Entwicklungsdatenbank.

Für die Access-Archivtests benötigen die Integrationstests die Programme `mdbtools`. Die CI installiert sie. Installieren Sie sie lokal, um den vollständigen Satz auszuführen.

## Umkehrbarkeit der Migrationen

```sh
scripts/verifier-reversibilite-migrations.sh
```

Das Skript wendet jede Migration an, macht sie mit dem Rückwärtsskript rückgängig und wendet sie erneut an. Die CI führt es bei jeder Änderung aus. Eine Migration, die sich nicht zurücknehmen lässt, lässt die Prüfung fehlschlagen.

## Regeln für Tests

- Die Isolation der Mandanten, die Berechnung von Geldbeträgen, die Zustandsautomaten und die Matrix Rolle × Aktion müssen getestet sein.
- Tests für Geldbeträge prüfen exakte Werte, nie Näherungen.
- Ein Integrationstest prüft die echte Abfrage, nicht eine Attrappe der Datenbankschicht.
- Schwächen Sie einen Test nie ab, nur damit er besteht. Korrigieren Sie den Code, oder ändern Sie den Test aus einem Grund, den die Prüfung akzeptiert.
