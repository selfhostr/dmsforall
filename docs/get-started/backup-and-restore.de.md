---
title: Sichern und wiederherstellen
description: Die verschlüsselte nächtliche Sicherung der Datenbank und der hochgeladenen Dateien einschalten, einen manuellen Dump erstellen und prüfen, was beim Wiederherstellen belegt ist und was nicht.
---

Am Ende dieser Seite wissen Sie, wie Sie die nächtliche Sicherung einschalten, wie Sie von Hand einen Dump erstellen und wie es um die Wiederherstellung steht.

:::caution
Die Kopie ausserhalb des Servers wurde nicht getestet. Bewahren Sie eine zweite Kopie ausserhalb des Servers auf und prüfen Sie sie selbst.
:::

## Nächtliche Sicherung einschalten

Die Sicherung läuft im Profil `backup`. Jede Nacht schreibt sie verschlüsselte Dateien in das Volume `dmsforall_dfa_postgres_backups`. Jede Nacht entstehen drei Dateien mit demselben Zeitstempel:

| Datei                                | Inhalt                                                                                         |
| ------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `dfa_<timestamp>.dump.age`           | Die Datenbank: Schema und Daten.                                                               |
| `dfa_<timestamp>.roles.sql.age`      | Die Datenbankrollen, mit ihren aktuellen Passwörtern.                                          |
| `dfa_<timestamp>.uploads.tar.gz.age` | Die hochgeladenen und erzeugten Dateien: Rechnungs-PDFs, Fotos zu Reparaturaufträgen, Exporte. |

Die drei Dateien werden mit demselben `age`-Schlüssel verschlüsselt, gemeinsam rotiert (7 tägliche, 4 wöchentliche und 12 monatliche) und gemeinsam ausserhalb des Servers kopiert, sobald `RCLONE_REMOTE` gesetzt ist. Das Dateiarchiv ist jede Nacht vollständig statt inkrementell. Komprimiert ist es etwa so gross wie die Dateien selbst (Fotos lassen sich kaum komprimieren), und das Volume behält bis zu 23 Kopien. Dimensionieren Sie das Volume entsprechend.

1. Tragen Sie einen öffentlichen `age`-Schlüssel in `.env` ein:

   ```sh
   AGE_CLE_PUBLIQUE=age1...
   ```

2. Starten Sie das Profil:

   ```sh
   docker compose --profile backup up -d
   ```

Bewahren Sie den privaten `age`-Schlüssel nicht auf diesem Server auf. Ohne ihn lassen sich die Sicherungen nicht lesen. Die Sicherung läuft aus dem veröffentlichten Image `ghcr.io/selfhostr/dmsforall-backup`, der Server braucht also keinen Klon des Repositorys. Das Wiederherstellungsskript `restaurer.sh` gehört nicht zum Image: Holen Sie es aus dem Repository oder aus einem Klon auf dem Rechner, auf dem Sie wiederherstellen.

Die Uhrzeit der Sicherung legen Sie mit `HEURE_SAUVEGARDE` fest (Standard `03:15`), die Zeitzone mit `DFA_TIMEZONE` (Standard `UTC`).

## Einen Dump von Hand erstellen

Für eine einmalige Kopie der Datenbank verwenden Sie `pg_dump` im Postgres-Container:

```sh
docker compose exec postgres pg_dump -U dfa -Fc dfa > dfa-$(date +%Y%m%d).dump
```

Speichern Sie die Datei verschlüsselt und ausserhalb des Servers.

## Was gesichert wird

Der Sicherungscontainer hängt die Upload-Volumes schreibgeschützt unter `/uploads` ein und archiviert alles, was er dort findet:

- `dmsforall_dfa_api_uploads`: Rechnungen und andere PDF-Dokumente.
- `dmsforall_dfa_photos_or`: Fotos zu Reparaturaufträgen und deren Vorschaubilder.
- `dmsforall_dfa_exports_resiliation`: die Exporte, die einer Garage beim Austritt übergeben werden. Sie können die Daten einer ganzen Garage enthalten und lassen sich nach dem Austritt der Garage nicht immer neu erzeugen.
- `dmsforall_dfa_reprise`: die Archive, die für die Übernahme der Daten aus der bisherigen Software hochgeladen wurden. Sie sind die Quelle der Übernahme und lassen sich nicht neu erzeugen.

Ein neues Upload-Volume, das im Dienst `api` der Datei `docker-compose.yml` hinzugefügt wird, ist erst gesichert, wenn Sie es ebenfalls schreibgeschützt unter `/uploads/` im Dienst `backup` einhängen.

Das Archiv wird als Strom geschrieben (`tar` in `age`): Es entsteht keine unverschlüsselte Datei auf dem Datenträger. Die Sicherung schlägt fehl, und `dernier-statut.txt` zeigt `ECHEC`, wenn das Archiv nicht geschrieben werden kann oder `/uploads` fehlt.

## Was nicht gesichert wird

- Die Valkey-Daten. Warteschlangen und kurzlebige Zustände werden neu erzeugt.
- Die erzeugten Datenbank-Passwörter und der Verschlüsselungsschlüssel (Volume `dmsforall_dfa_secrets`) sowie die TLS-Zertifikate (Volume `dmsforall_dfa_caddy_data`). Die Rollendatei der Sicherung enthält die Datenbank-Passwörter. Der Verschlüsselungsschlüssel schützt die Versand-Passwörter, die Garagen in der App gespeichert haben: Ohne ihn müssen sie neu eingegeben werden. Bewahren Sie eine Kopie des Schlüssels an einem sicheren Ort auf:

  ```sh
  docker compose run --rm --no-deps --entrypoint cat api /secrets/secrets_key
  ```

- Dateien in einem Upload-Verzeichnis, das kein eingehängtes Volume ist. Sie liegen im Container und gehen verloren, sobald dieser neu erstellt wird.

## Wiederherstellen

Eine Wiederherstellung bringt die Datenbank auf den Stand der Sicherung zurück. Alles, was nach dieser Sicherung geschrieben wurde, geht verloren.

1. Stoppen Sie die Dienste `api` und `worker`, damit nichts mehr in die Datenbank schreibt.
2. Spielen Sie den Dump zuerst auf einem separaten Rechner in eine leere Datenbank ein und prüfen Sie das Ergebnis.
3. Erst danach stellen Sie auf dem Produktionsserver wieder her. Eine vollständige Wiederherstellung auf einer frischen Installation ist belegt.

`restaurer.sh` stellt Datenbank und Dateien gemeinsam wieder her, solange die Datei `.uploads.tar.gz.age` neben der Datei `.dump.age` liegt:

```sh
AGE_CLE_PRIVEE_FICHIER=/path/to/age.key \
  docker/postgres/sauvegarde/restaurer.sh /path/to/dfa_20260101-031500.dump.age dfa --confirmer
```

- `--base-seule` stellt nur die Datenbank wieder her.
- `--fichiers-seuls` stellt nur die Dateien wieder her. Übergeben Sie `-` als Datenbankname.

Die Dateien werden in die Volumes des Dienstes `api` entpackt. Eine Datei mit gleichem Namen wird überschrieben, eine Datei, die nicht im Archiv liegt, bleibt unberührt. Die Dateien werden nur wiederhergestellt, wenn die Zieldatenbank `dfa` ist. Eine Testwiederherstellung in eine andere Datenbank lässt die laufenden Dateien unberührt.

Der monatliche Wiederherstellungstest (`restaurer-test.sh`) entschlüsselt und liest das gesamte Dateiarchiv. Er wurde in den automatisierten Tests noch nicht gegen ein echtes Archiv ausgeführt. Führen Sie ihn einmal von Hand aus, nachdem Sie die Sicherung eingeschaltet haben.

:::caution
`restaurer.sh` benötigt `age` auf dem Host, mit dem privaten Schlüssel. Der Stack muss bereits laufen, bevor Sie wiederherstellen.
:::
