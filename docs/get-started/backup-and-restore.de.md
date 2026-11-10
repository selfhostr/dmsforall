---
title: Sichern und wiederherstellen
description: Die tägliche Sicherung, die von selbst läuft, wie Sie eine von Hand erstellen und wiederherstellen und was nicht abgedeckt ist.
---

Am Ende dieser Seite wissen Sie, wo die täglichen Sicherungen liegen, wie Sie eine von Hand erstellen, wie Sie eine wiederherstellen und was Sie selbst noch kopieren müssen.

## Die tägliche Sicherung

Der Dienst `backup` läuft mit dem Stack. Jeden Tag um 02:30 (Serverzeit, Europe/Zurich) schreibt er zwei Dateien in den Ordner `./backups`, neben der Compose-Datei:

| Datei                           | Inhalt                                                                                         |
| ------------------------------- | ---------------------------------------------------------------------------------------------- |
| `dfa-<date>_<time>.sql.gz`      | Die ganze Datenbank: Schema und Daten.                                                         |
| `fichiers-<date>_<time>.tar.gz` | Die hochgeladenen und erzeugten Dateien: Rechnungs-PDFs, Fotos zu Reparaturaufträgen, Exporte. |

Sicherungen, die älter als 14 Tage sind, werden gelöscht. Uhrzeit und Anzahl Tage ändern Sie mit `DFA_BACKUP_TIME` und `DFA_BACKUP_KEEP_DAYS` in `.env`. Das Dateiarchiv ist jede Nacht vollständig, nicht inkrementell: Dimensionieren Sie den Datenträger für 14 Kopien Ihrer Dokumente.

Um jetzt eine Sicherung zu erstellen:

```sh
docker compose exec -u dfa backup /scripts/sauvegarder.sh
```

:::caution
`./backups` liegt auf demselben Rechner wie die Daten. Ein Plattendefekt oder ein gestohlener Server verliert beides. Kopieren Sie den Ordner jeden Tag auf einen anderen Rechner (`rsync`, `rclone`, ein NAS) und bewahren Sie dort auch eine Kopie von `./data/secrets` auf.
:::

Um die Sicherungen zu verschlüsseln, setzen Sie `DFA_BACKUP_AGE_PUBLIC_KEY` in `.env` auf einen öffentlichen [age](https://age-encryption.org)-Schlüssel. Die Dateien enden dann auf `.age`. Bewahren Sie den privaten Schlüssel nicht auf dem Server auf: Ohne ihn lassen sich die Sicherungen nicht lesen.

## Was eine Sicherung enthält und was nicht

Der Datenbank-Dump und das Dateiarchiv decken alles ab, was die Anwendung speichert: Dokumente, Fotos, die Exporte, die einer Garage beim Austritt übergeben werden, und die Archive, die für die Übernahme der Daten aus der bisherigen Software hochgeladen wurden.

Nicht abgedeckt:

- `./data/secrets`, die erzeugten Passwörter und der Verschlüsselungsschlüssel. Der Schlüssel schützt die Versand-Passwörter, die Garagen in der Anwendung gespeichert haben: Ohne ihn müssen sie neu eingegeben werden. Kopieren Sie diesen kleinen Ordner einmalig an einen sicheren Ort.
- `./data/valkey`. Die Warteschlangen und kurzlebigen Zustände werden neu erzeugt.
- `./data/certs`, das HTTPS-Zertifikat. Es wird neu erzeugt, wenn es fehlt.

## Wiederherstellen

Eine Wiederherstellung bringt die Datenbank auf den Stand der Sicherung zurück. Alles, was danach geschrieben wurde, geht verloren. Führen Sie diese Befehle im Ordner der Compose-Datei aus.

1. Stoppen Sie die Dienste, die in die Datenbank schreiben:

   ```sh
   docker compose stop api worker
   ```

2. Stellen Sie die Datenbank aus einer Sicherungsdatei wieder her (der Name einer Datei in `./backups`):

   ```sh
   docker compose exec -u dfa backup /scripts/restaurer.sh dfa-2026-11-10_023000.sql.gz
   ```

   Das Skript lädt die Sicherung zuerst in eine neue Datenbank und ersetzt die aktuelle erst, wenn das gelingt. Die aktuelle Datenbank bleibt unter dem Namen `dfa_avant_restauration_<time>` erhalten, und das Skript gibt den Befehl aus, der sie löscht, sobald Sie zufrieden sind. Eine beschädigte Sicherung zerstört nie Ihre aktuellen Daten. Eine verschlüsselte Sicherung entschlüsseln Sie zuerst (`age -d -i age.key -o backups/restore.sql.gz backups/dfa-....sql.gz.age`) und übergeben dann diese Datei.

3. Stellen Sie die Dateien wieder her (optional, wenn Dokumente verloren sind):

   ```sh
   sudo tar -xzf backups/fichiers-2026-11-10_023000.tar.gz -C data/fichiers
   ```

4. Starten Sie die Dienste wieder:

   ```sh
   docker compose start api worker
   ```

Um auf einem neuen Server wiederherzustellen, kopieren Sie die Compose-Datei, `./data/secrets` und die beiden Sicherungsdateien dorthin, starten den Stack einmal (`docker compose up -d`, dann `docker compose stop api worker`) und führen die Schritte 2 bis 4 aus.

:::caution
Eine Sicherung, die Sie nie wiederhergestellt haben, ist keine Sicherung. Stellen Sie jetzt auf einem separaten Rechner eine wieder her, melden Sie sich an und öffnen Sie ein Dokument, bevor Sie echte Daten erfassen.
:::
