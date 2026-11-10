---
title: dmsforall aktualisieren
description: Eine Produktionsinstallation sicher aktualisieren, mit Sicherung, Migrationen, Gesundheitsprüfung und einem Rückfallplan.
---

Am Ende dieser Seite läuft Ihre Installation mit der neuen Version, und Sie wissen, wie Sie zurückkehren, falls etwas fehlschlägt.

## Vor der Aktualisierung

1. Lesen Sie das [Änderungsprotokoll](https://github.com/selfhostr/dmsforall/blob/main/CHANGELOG.md) für jede Version zwischen Ihrer und der neuen. Notieren Sie jede Änderung an den Konfigurationsvariablen.
2. Erstellen Sie eine Sicherung und prüfen Sie, dass sie vollständig ist. Siehe [Sichern und wiederherstellen](../get-started/backup-and-restore.md).
3. Prüfen Sie den freien Speicherplatz. Die Migrationen und die Sicherungen brauchen Platz.
4. Planen Sie ein kurzes Zeitfenster und informieren Sie Ihr Team. Die Mitarbeitenden dürfen während der Aktualisierung nicht arbeiten.

## Aktualisierung

1. Setzen Sie `DFA_VERSION` in `.env` auf den neuen Tag (fügen Sie die Zeile hinzu, falls die Datei keine hat). Nennen die Versionshinweise eine Änderung an `docker-compose.yml`, laden Sie die neue Datei zuerst aus dem Release herunter. Siehe [Images verifizieren](../security/verify-images.md).
2. Holen Sie die neuen Images und starten Sie den Stack neu:

   ```sh
   docker compose pull
   docker compose up -d
   ```

3. Der Dienst `api` wendet die Datenbankmigrationen beim Start an, und der `worker` wartet auf ihn. Prüfen Sie, dass die API gesund ist:

   ```sh
   docker compose ps api
   docker compose logs api
   ```

4. Prüfen Sie den Gesundheitsendpunkt:

   ```sh
   curl -s https://dmsforall.example.ch/api/v1/sante
   ```

5. Melden Sie sich an und prüfen Sie ein Dokument jedes Bereichs, den Sie nutzen.

## Wenn etwas fehlschlägt

- **Die Migration ist fehlgeschlagen.** Die API startet nicht in der neuen Version, und die bisherige Version läuft weiter. Lesen Sie die Logs des Dienstes `api`, beheben Sie die Ursache und starten Sie den Stack erneut.
- **Die API startet nicht.** Lesen Sie die Logs. Ein Konfigurationsfehler nennt jede fehlerhafte Variable. Korrigieren Sie die Variable und starten Sie neu.
- **Die neue Version verhält sich falsch.** Stellen Sie die Sicherung wieder her, die vor der Aktualisierung erstellt wurde. Das ist der unterstützte Weg zurück zum vorherigen Zustand.

:::caution
Führen Sie die Rückwärts-Skripte der Migrationen nicht auf einer Datenbank aus, die seit der Aktualisierung echte Daten erhalten hat. Jedes Rückwärts-Skript ist in der Entwicklung getestet, kann aber Daten löschen, die nach der Aktualisierung geschrieben wurden. Stellen Sie stattdessen die Sicherung wieder her.
:::

:::caution
Bearbeiten Sie nie eine Migrationsdatei, die bereits angewendet wurde. Der Migrator prüft eine Prüfsumme jeder Datei und verweigert den Lauf, sobald eine geändert wurde.
:::
