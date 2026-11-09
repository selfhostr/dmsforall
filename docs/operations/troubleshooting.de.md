---
title: Fehlerbehebung
description: Die häufigsten Probleme einer dmsforall-Installation diagnostizieren, von Startfehlern bis zu Problemen mit E-Mail, OCR und Datenimport.
---

Beginnen Sie mit den Logs des Dienstes, der fehlschlägt:

```sh
docker compose logs api --tail 100
docker compose ps
```

## Die API startet nicht

**Meldung: `Configuration invalide`.** Das Log nennt jede fehlerhafte Variable mit dem Grund. Korrigieren Sie jede in `.env` und starten Sie danach mit `docker compose up -d` neu. Mit der Standard-Compose-Datei tritt dieser Fehler selten auf, weil Datenbankverbindung und Schlüssel für Sie gesetzt sind.

**Die Meldung lautet `COOKIE_SECURE doit être true en production`.** Entfernen Sie die Zeile `COOKIE_SECURE=false` aus `.env`. Das Sitzungs-Cookie muss über HTTPS übertragen werden.

**Die Meldung besagt, dass ein Entwicklungs-Passwort verwendet wird.** Die Datenbank-URL enthält `dfa_app_dev` oder `dfa_migrator_dev`. Sie haben `DATABASE_URL` selbst mit den Entwicklungs-Passwörtern gesetzt. Entfernen Sie `DATABASE_URL` und `DATABASE_URL_MIGRATION` aus `.env`: Der Stack baut sie aus den erzeugten Passwörtern.

**Die Meldung nennt `DATABASE_POOL_MIN`.** Ein Wert über `DATABASE_POOL_MAX` wird abgelehnt. Senken Sie das Minimum oder erhöhen Sie das Maximum.

## Die Anmeldung schlägt fehl

**Der Webzugriff wird mit `AUTH_ORIGINE_REFUSEE` abgelehnt.** Die Adresse in Ihrem Browser stimmt nicht mit `DFA_PUBLIC_URL` überein (Standard `http://localhost:8080`). Öffnen Sie die Website unter dieser Adresse oder ändern Sie `DFA_PUBLIC_URL` und starten Sie den Stack neu.

**Das Passwort wird abgelehnt, und das Konto ist gesperrt.** Warten Sie, bis die Sperre abläuft. Wiederholte Fehlversuche sperren das Konto für eine Weile. Die Schwelle legt `SEUIL_VERROUILLAGE_COMPTE` fest.

**Die Anmeldung liefert `429`.** Es gab zu viele Versuche von einer Adresse oder auf einem Konto. Warten Sie, bis das Zeitfenster abgelaufen ist. Sind alle Benutzer gleichzeitig gesperrt, ist `TRUST_PROXY_HOPS` wahrscheinlich falsch, und alle Benutzer teilen sich eine Adresse.

**Die Seite lädt, aber Sie bleiben abgemeldet.** Prüfen Sie, dass `WEB_URL_PUBLIQUE` und `API_URL_PUBLIQUE` HTTPS verwenden und mit den Adressen in Ihrem Browser übereinstimmen. Prüfen Sie `COOKIE_DOMAINE`, falls Sie die Variable gesetzt haben.

## Die Datenbank ist ausgelastet

**Meldung: `timeout exceeded when trying to connect`.** Alle Verbindungen des Pools sind belegt. Suchen Sie in den Logs nach einer langsamen Abfrage, oder erhöhen Sie `DATABASE_POOL_MAX`, wenn der Server Reserven hat. Prüfen Sie auch die Grenze `max_connections` von PostgreSQL.

## E-Mails kommen nicht an

Jede Garage kann unter **Einstellungen > E-Mail-Versand** einen eigenen Postausgangsserver festlegen. Er wird zuerst verwendet, und der Bildschirm hat die Schaltfläche «Testnachricht senden». Ohne ihn werden Nachrichten nur dann wirklich versendet, wenn `NODE_ENV=production`, `COURRIEL_ENVOI_REEL=true` und die Variablen `SMTP_*` gesetzt sind. Andernfalls werden die Nachrichten abgefangen und nicht zugestellt. Prüfen Sie zuerst diese Variablen, dann die Logs des Dienstes `api` auf den SMTP-Fehler.

## Die Fahrzeug-OCR liest das Dokument nicht

Der OCR-Dienst muss laufen und von der API unter `OCR_SERVICE_URL` erreichbar sein. Ist der Dienst langsam, erhöhen Sie `OCR_SERVICE_TIMEOUT_MS`. Ein Fehler, der besagt, dass der Dienst nicht verfügbar ist, bedeutet, dass die Anfrage nicht verarbeitet wurde: Versuchen Sie es erneut.

## Der Datenimport bricht ab

**Der Import bricht mit einem Fehler ab, dass die Access-Werkzeuge nicht verfügbar sind.** Ein Access-Archiv braucht die Programme aus `mdbtools`. Der API-Container enthält sie. Betreiben Sie die API ausserhalb des Containers, installieren Sie `mdbtools` auf dem Server.

**Der Import meldet übersprungene Datensätze.** Lesen Sie den Grund, der für jeden übersprungenen Datensatz im Plan oder im Bericht angegeben ist.

## Die Seite ist nach einer Aktualisierung leer

Prüfen Sie, dass der Web-Container läuft und dass seine Version mit der Version der API übereinstimmt. Leeren Sie den Cache des Browsers und laden Sie die Seite neu. Prüfen Sie die Logs des Dienstes `web`.

## Die Migration ist fehlgeschlagen

Die API startet nicht in der neuen Version, und die bisherige Version läuft weiter. Lesen Sie die Logs des Dienstes `migrate`, beheben Sie die Ursache in einem neuen Release und führen Sie die Aktualisierung erneut aus. Bearbeiten Sie keine Migrationsdatei, die bereits angewendet wurde.

## Weitere Hilfe

Eröffnen Sie ein Issue im [GitHub-Repository](https://github.com/selfhostr/dmsforall/issues) mit der Version, den relevanten Logzeilen und den Schritten zur Reproduktion. Entfernen Sie personenbezogene Daten und jedes Geheimnis, bevor Sie ein Log einfügen.
