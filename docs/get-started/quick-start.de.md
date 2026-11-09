---
title: Schnellstart
description: Den dmsforall-Stack mit Docker Compose starten und die Web-Oberfläche öffnen.
---

Am Ende dieser Seite läuft der dmsforall-Stack auf Ihrem Rechner oder Server, und Sie können die Web-Oberfläche im Browser öffnen.

## Schritte

1. Laden Sie die Compose-Datei herunter. Sie ist die einzige Datei, die Sie brauchen.

   ```sh
   curl -LO https://github.com/selfhostr/dmsforall/releases/latest/download/docker-compose.yml
   ```

2. Starten Sie den Stack. Die Images werden von `ghcr.io/selfhostr` geladen. Für einen ersten Versuch auf `localhost` ist nichts zu konfigurieren.

   ```sh
   docker compose up -d
   ```

3. Legen Sie das erste Garagenkonto an (siehe [Ihre erste Garage einrichten](first-garage.md)) und öffnen Sie dann http://localhost:8080 im Browser.

Ergebnis: Die Anmeldeseite wird geladen. Beim ersten Start erzeugt der Stack einmalig die Datenbank-Passwörter und den Verschlüsselungsschlüssel, führt die Migrationen aus und startet danach die API und den Worker.

## Nächste Schritte

- Für einen Server, der aus dem Internet erreichbar ist, legen Sie einen Domainnamen und HTTPS fest (eine `.env`-Datei mit wenigen Zeilen): siehe [dmsforall auf einem Server installieren](installation.md).
- Legen Sie das erste Garagenkonto mit `creer-garage.js` an: siehe [Ihre erste Garage einrichten](first-garage.md).
- Richten Sie Sicherungen ein, bevor Sie echte Daten erfassen: siehe [Sichern und wiederherstellen](backup-and-restore.md).

:::caution
Der Stack ist definiert und seine Dateien sind geprüft. Die vollständige Installation wurde aber noch nicht von Anfang bis Ende auf einem sauberen Rechner mit einer echten Domain ausgeführt. Melden Sie jede Abweichung, die Sie feststellen.
:::
