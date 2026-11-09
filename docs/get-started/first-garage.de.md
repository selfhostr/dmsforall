---
title: Ihre erste Garage einrichten
description: Das erste Garagenkonto anlegen, danach die Standorte, Mitarbeitenden und Einstellungen zur Fakturierung, die eine Garage vor der ersten Rechnung braucht.
---

Am Ende dieser Seite hat die Garage ihr erstes Konto, ihre Standorte, ihre Mitarbeitenden-Konten und die Einstellungen zur Fakturierung, die für eine erste Rechnung nötig sind.

Mit einem einzigen Befehl legen Sie die Garage, ihren Standort (er trägt den Namen der Garage), das erste Konto mit der Rolle `direction` und eine Zeile im Prüfprotokoll an. Die Garage erhält ausserdem ihre Werkstatt-Einstellungen, einen Stundenansatz `ATELIER` (CHF 140.00) und acht Terminmotive (Service, Reifen, MFK-Kontrolle, Bremsen, Diagnose, Karosserie, Klimaanlage, Sonstiges). So kann sie vom ersten Tag an Termine vereinbaren. Alles lässt sich in den Einstellungen ändern:

```sh
docker compose exec api node dist/cli/creer-garage.js --garage "Garage Exemple" --email direction@example.ch
```

Optional: `--first-name X` und `--last-name Y`. Mit `--help` erhalten Sie die vollständige Verwendung.

In der Entwicklung führen Sie denselben Befehl aus dem Wurzelverzeichnis des Repositorys aus. Er liest `DATABASE_URL_MIGRATION` aus der `.env` im Wurzelverzeichnis, wie die API:

```sh
pnpm --filter @dfa/api exec tsx src/cli/creer-garage.ts --garage "Garage Exemple" --email direction@example.ch
```

Das Passwort wird aus der Variable `DFA_PREMIER_MOT_DE_PASSE` gelesen. Ist sie nicht gesetzt, fragt der Befehl ohne Echo danach. Die interaktive Abfrage ist noch nicht getestet.

Der Befehl endet mit dem Status 1 und einem dieser Codes:

- `MOT_DE_PASSE_FAIBLE`: Das Passwort ist zu schwach. Die Meldung sagt, warum: zu verbreitet, zu vorhersehbar, oder es enthält die E-Mail-Adresse;
- `GARAGE_EXISTANT`: Eine Garage mit diesem Namen existiert bereits;
- `COURRIEL_EXISTANT`: Die E-Mail-Adresse wird bereits verwendet.

Ergebnis: Das Konto kann sich auf der Web-Oberfläche unter `DFA_PUBLIC_URL` anmelden (Standard `http://localhost:8080`). Eine Anmeldung von einer anderen Adresse wird mit `AUTH_ORIGINE_REFUSEE` abgelehnt.

Der Demo-Seed (`pnpm db:seed`) läuft nicht mit `NODE_ENV=production`. Verwenden Sie ihn nicht auf einem Server mit echten Daten.

## 2. Standorte anlegen

Öffnen Sie die Einstellungen für Standorte und legen Sie je einen Eintrag pro Werkstatt, Schalter oder Ausstellungsraum an. Jeder Datensatz (Kunden, Fahrzeuge, Aufträge, Lager) gehört zu einem Standort.

## 3. Mitarbeitende einladen

Öffnen Sie die Einstellungen für Mitarbeitende und legen Sie je Person ein Konto an. Wählen Sie die Rolle, die zur Arbeit der Person passt. Siehe [Rollen und Rechte](../reference/roles-and-rights.md).

Für ein gemeinsames Werkstatt-Terminal legen Sie ein Konto mit der Rolle `poste_atelier` an und ordnen es einem Standort zu.

## 4. Einstellungen zur Fakturierung vervollständigen

Tragen Sie den Firmennamen und die Adresse ein, die MWST-Nummer und das Verfahren, die Bankverbindung und den Gläubigerblock (Zahlungsempfänger). Der Gläubigerblock wird bei der Ausstellung auf jede Rechnung kopiert.

Eine Rechnung kann auch ohne vollständigen Gläubigerblock ausgestellt werden, etwa wenn sie bar bezahlt wird. Sie erhält dann keine QR-Rechnung, und die Anwendung warnt Sie. Vervollständigen Sie den Gläubigerblock, bevor Sie Rechnungen versenden, die per Überweisung bezahlt werden sollen.

## 5. Ein Testdokument ausstellen

Erfassen Sie einen Testkunden und eine Offerte, stellen Sie diese aus und prüfen Sie das PDF.

:::caution
Ein ausgestelltes Dokument ist gesperrt. Korrigieren Sie es nur mit einer Gutschrift. Verwenden Sie für diesen Schritt einen Testkunden.
:::
