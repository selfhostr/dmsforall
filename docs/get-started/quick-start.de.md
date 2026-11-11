---
title: Schnellstart
description: Den dmsforall-Stack mit einer einzigen Docker-Compose-Datei starten und die Web-Oberfläche öffnen.
---

Am Ende dieser Seite läuft der dmsforall-Stack auf Ihrem Rechner oder Server, und Sie können die Web-Oberfläche im Browser öffnen.

Sie brauchen Docker Engine und Docker Compose 2.24 oder neuer. Die [Installationsseite](installation.md) nennt die übrigen Voraussetzungen.

## Schritte

1. Erstellen Sie einen leeren Ordner und laden Sie die Compose-Datei hinein. Sie ist die einzige Datei, die Sie brauchen.

   ```sh
   mkdir dmsforall && cd dmsforall
   curl -LO https://github.com/selfhostr/dmsforall/releases/latest/download/docker-compose.yml
   ```

2. Starten Sie den Stack. Die Images werden von `ghcr.io/selfhostr` geladen. Es ist nichts zu konfigurieren und kein Ordner anzulegen.

   ```sh
   docker compose up -d
   ```

3. Lesen Sie den einmaligen Installationscode, den die API beim ersten Start ausgibt:

   ```sh
   docker compose logs api
   ```

   Er sieht aus wie `K7QM-3XRB-9TNA`.

4. Öffnen Sie `https://<Serveradresse>:8443` im Browser. Das Zertifikat ist selbstsigniert: Akzeptieren Sie es einmalig. Die Seite **Garage erstellen** öffnet sich: Geben Sie den Namen der Garage, Ihren Namen, Ihre E-Mail-Adresse, ein Passwort und den Installationscode ein. Sie sind angemeldet, und der Einrichtungsassistent öffnet sich. Siehe [Ihre erste Garage einrichten](first-garage.md).

Ergebnis: Die Seite zum Erstellen Ihrer Garage wird geladen. Beim ersten Start werden die Passwörter und der Verschlüsselungsschlüssel erzeugt, die Datenbank angelegt und die Migrationen angewendet. Ihre Daten liegen im Ordner `./data` und Ihre Sicherungen in `./backups`, neben der Compose-Datei.

## Nächste Schritte

- Für einen Domainnamen mit echtem Zertifikat setzen Sie Ihren eigenen Reverse Proxy davor: siehe [dmsforall auf einem Server installieren](installation.md).
- Legen Sie die erste Garage stattdessen über die Befehlszeile an: siehe [Ihre erste Garage einrichten](first-garage.md).
- Die tägliche Sicherung ist bereits aktiv. Kopieren Sie `./backups` auf einen anderen Rechner und testen Sie eine Wiederherstellung: siehe [Sichern und wiederherstellen](backup-and-restore.md).
