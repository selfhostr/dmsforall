---
title: Ihre erste Garage einrichten
description: Das erste Garagenkonto anlegen, danach die Standorte, Mitarbeitenden und Einstellungen zur Fakturierung, die eine Garage vor der ersten Rechnung braucht.
---

Am Ende dieser Seite hat die Garage ihr erstes Konto, ihre Standorte, ihre Mitarbeitenden-Konten und die Einstellungen zur Fakturierung, die für eine erste Rechnung nötig sind.

## 1. Die Garage anlegen

Eine neue Installation hat noch kein Konto. Beim ersten Start erzeugt die API einen einmaligen Installationscode und gibt ihn in ihren Protokollen aus. Die Web-Oberfläche fragt ihn auf dem ersten Bildschirm ab.

1. Lesen Sie den Installationscode in den Protokollen der API:

   ```sh
   docker compose logs api
   ```

   Suchen Sie den Block mit `Installationscode` bzw. `Installation code`, gefolgt von einem Code wie `K7QM-3XRB-9TNA`.

2. Öffnen Sie `https://<Serveradresse>:8443` (die Adresse Ihrer Installation, oder `DFA_PUBLIC_URL` hinter einem Reverse Proxy). Bei einer neuen Installation zeigt der Browser **Garage erstellen** statt der Anmeldeseite. Geben Sie den Namen der Garage, Ihren Vor- und Nachnamen, Ihre E-Mail-Adresse, ein zweimal eingegebenes Passwort (mindestens 12 Zeichen) und den Installationscode ein.

3. Wählen Sie **Meine Garage erstellen**. Sie sind mit dem Konto `direction` angemeldet, und der Einrichtungsassistent öffnet sich.

Ergebnis: Die Garage besteht mit ihrem Standort (er trägt den Namen der Garage), dem Konto `direction` und einer Zeile im Prüfprotokoll. Sie erhält ausserdem ihre Werkstatt-Einstellungen, einen Stundenansatz `ATELIER` (CHF 140.00) und acht Terminmotive (Service, Reifen, MFK-Kontrolle, Bremsen, Diagnose, Karosserie, Klimaanlage, Sonstiges). So kann sie vom ersten Tag an Termine vereinbaren. Alles lässt sich in den Einstellungen ändern. Der Einrichtungsassistent führt mit Standardwerten durch Adresse, Bankverbindung, MWST, Stundenansatz und Mitarbeitende der Garage.

Der Installationscode schützt eine neue, aus dem Internet erreichbare Installation, bevor ihr Eigentümer eintrifft: Nur wer die Protokolle des Servers lesen kann, kann die erste Garage anlegen. Der Code gilt einmal. Bei jedem Start der API wird ein neuer Code erzeugt, solange keine Garage existiert, und er wird ungültig, sobald eine Garage existiert. In der Datenbank liegt nur ein gesalzener Hash. Haben Sie ihn verloren, führen Sie `docker compose restart api` aus und lesen Sie die Protokolle erneut. Der Bildschirm lehnt mit diesen Codes ab:

- `INSTALLATION_CODE_INVALIDE` (403): Der Code ist falsch oder abgelaufen;
- `INSTALLATION_DEJA_FAITE` (409): Auf dieser Installation existiert bereits eine Garage. Melden Sie sich stattdessen an;
- `AUTH_TROP_DE_TENTATIVES` (429): Zu viele Versuche. Warten Sie und versuchen Sie es erneut;
- `MOT_DE_PASSE_FAIBLE` (innerhalb eines 400 `VALIDATION_ECHOUEE`): Das Passwort ist zu schwach, zu verbreitet, zu vorhersehbar oder enthält die E-Mail-Adresse.

### Alternative: die Befehlszeile

Um die Garage ohne Browser anzulegen, führen Sie einen Befehl aus. Er tut genau dasselbe wie der Bildschirm (derselbe Standort, derselbe Stundenansatz, dieselben Terminmotive) und braucht den Installationscode nicht, weil er auf dem Server läuft:

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

Ergebnis: Das Konto kann sich auf der Web-Oberfläche unter der Adresse Ihrer Installation anmelden (`https://<Serveradresse>:8443`, oder `DFA_PUBLIC_URL` hinter einem Reverse Proxy). Eine Anmeldung von einer anderen Adresse als `DFA_PUBLIC_URL` wird mit `AUTH_ORIGINE_REFUSEE` abgelehnt. Nach der ersten Anmeldung führt der Einrichtungsassistent mit Standardwerten durch Adresse, Bankverbindung, MWST, Stundenansatz und Mitarbeitende der Garage.

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
