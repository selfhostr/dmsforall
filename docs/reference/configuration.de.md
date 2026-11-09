---
title: Konfigurationsreferenz
description: Jede Umgebungsvariable, die dmsforall liest, mit ihrem Standardwert und ihrer Wirkung.
---

dmsforall liest seine Konfiguration aus Umgebungsvariablen. Die API prüft sie beim Start mit zod und weigert sich zu starten, wenn eine ungültig ist. Die Fehlermeldung nennt jede fehlerhafte Variable.

Sie brauchen diese Seite selten. Der Standard-Stack startet ohne jede Einstellung, und `.env.example` nennt die wenigen, die Sie vielleicht setzen möchten (Domainname, E-Mail, Version). Alles Übrige steht hier, für den fortgeschrittenen Einsatz.

Im Standard-Stack setzt `docker-compose.yml` die Variablen der API aus den Werten `DFA_*` der Datei `.env` daneben. Die API-Dienste lesen diese Datei `.env` auch selbst, daher können Sie jede Variable dieser Seite unter ihrem eigenen Namen hinzufügen, zum Beispiel `LIMITE_CONNEXION_IP=30`. Für die Variablen, die die Compose-Datei selbst setzt, gilt die Compose-Datei: Verwenden Sie dafür die Namen `DFA_*` aus dem Abschnitt [Bereitstellung](#bereitstellung).

In der Entwicklung werden die Variablen aus der Datei `.env` im Wurzelverzeichnis des Repositorys gelesen, die aus `docker/dev.env.example` erstellt wird.

Boolesche Werte sind `true` oder `false`. Zeitspannen stehen in Minuten, Sekunden oder Millisekunden, wie es der jeweilige Name angibt.

## Kern

| Variable               | Standard      | Wirkung                                                                                                                     |
| ---------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`             | `development` | `development`, `test` oder `production`. Der Wert `production` aktiviert strengere Prüfungen und den echten E-Mail-Versand. |
| `MODE_PROCESSUS`       | `combine`     | `api` bedient nur HTTP. `worker` führt nur die Hintergrundaufgaben aus. `combine` tut beides.                               |
| `PORT`                 | `3000`        | Port, auf dem die API lauscht, von 1 bis 65535.                                                                             |
| `API_URL_PUBLIQUE`     | erforderlich  | Öffentliche URL der API, zum Beispiel `https://api.garage.example.org`.                                                     |
| `WEB_URL_PUBLIQUE`     | erforderlich  | Öffentliche URL der Web-Oberfläche.                                                                                         |
| `LOG_NIVEAU`           | `info`        | Log-Stufe: `fatal`, `error`, `warn`, `info`, `debug` oder `trace`.                                                          |
| `OPENAPI_EXPOSER_DOCS` | `false`       | Veröffentlicht die API-Dokumentation unter `/api/docs`. In der Produktion auf `false` lassen.                               |

## Datenbank

Im Standard-Stack setzen Sie keine dieser Variablen. Der Entrypoint des API-Images baut `DATABASE_URL` und `DATABASE_URL_MIGRATION` aus den Passwörtern, die `init-secrets` erzeugt hat, und PostgreSQL legt die beiden Rollen beim ersten Start an. Sie sind wichtig, wenn Sie Ihr eigenes PostgreSQL verwenden: Dann setzen Sie `DATABASE_URL` und `DATABASE_URL_MIGRATION` in `.env` und legen die Rollen mit den Berechtigungen aus `docker/postgres/init/01-roles.sql` an.

| Variable                        | Standard                    | Wirkung                                                                                                                                                                   |
| ------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                  | erforderlich                | PostgreSQL-URL für die Rolle `dfa_app`. Das ist die Rolle, die die API verwendet; sie unterliegt der Zeilensicherheit (Row-Level Security). Muss mit `postgres` beginnen. |
| `DATABASE_URL_MIGRATION`        | erforderlich                | PostgreSQL-URL für die Rolle `dfa_migrator`, nur zum Anwenden der Migrationen. Muss sich von `DATABASE_URL` unterscheiden.                                                |
| `DATABASE_POOL_MAX`             | `10`                        | Maximale Anzahl Verbindungen im Pool, von 1 bis 50.                                                                                                                       |
| `DATABASE_POOL_MIN`             | `min(2, DATABASE_POOL_MAX)` | Verbindungen, die auch im Leerlauf offen bleiben. Darf `DATABASE_POOL_MAX` nicht überschreiten.                                                                           |
| `DATABASE_TIMEOUT_REQUETE_MS`   | `10000`                     | Maximale Dauer einer Abfrage in Millisekunden.                                                                                                                            |
| `DATABASE_TIMEOUT_CONNEXION_MS` | `5000`                      | Maximale Dauer für den Aufbau einer Verbindung in Millisekunden.                                                                                                          |
| `DATABASE_TIMEOUT_IDLE_MS`      | `30000`                     | Zeit, nach der eine ungenutzte Verbindung über dem Minimum geschlossen wird, in Millisekunden.                                                                            |

## Valkey

| Variable    | Standard     | Wirkung                                                                                                                                    |
| ----------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `REDIS_URL` | erforderlich | Valkey-URL (Redis-Protokoll, daher beginnt sie mit `redis`). Wird für Warteschlangen, Echtzeit-Ereignisse und Ratenbegrenzungen verwendet. |

## Sitzungen und Anmeldung

| Variable                            | Standard      | Wirkung                                                                                               |
| ----------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------- |
| `SESSION_COOKIE_NOM`                | `dfa_session` | Name des Sitzungs-Cookies. Nur Buchstaben, Ziffern, `_` und `-`.                                      |
| `SESSION_DUREE_MINUTES`             | `480`         | Maximale Sitzungsdauer, von 5 bis 43200 Minuten.                                                      |
| `SESSION_INACTIVITE_MINUTES`        | `120`         | Die Sitzung wird nach dieser Leerlaufzeit geschlossen, von 5 bis 1440 Minuten.                        |
| `COOKIE_DOMAINE`                    | keine         | Domain des Sitzungs-Cookies. Leer lassen, um den Host der API zu verwenden.                           |
| `COOKIE_SECURE`                     | `true`        | Markiert das Cookie als `Secure`. Muss in der Produktion `true` sein.                                 |
| `TRUST_PROXY_HOPS`                  | `0`           | Anzahl der Reverse Proxies vor der API, von 0 bis 10. Setzen Sie die genaue Anzahl.                   |
| `ARGON2_MEMOIRE_KIB`                | `19456`       | Speicherbedarf des Passwort-Hashs in KiB. Minimum 19456.                                              |
| `ARGON2_ITERATIONS`                 | `2`           | Zeitbedarf des Passwort-Hashs. Minimum 2.                                                             |
| `ARGON2_PARALLELISME`               | `1`           | Parallelität des Passwort-Hashs.                                                                      |
| `LIMITE_CONNEXION_IP`               | `20`          | Erlaubte Anmeldeversuche pro IP-Adresse im Zeitfenster.                                               |
| `LIMITE_CONNEXION_COMPTE`           | `15`          | Erlaubte Anmeldeversuche pro Konto im Zeitfenster. Muss grösser sein als `SEUIL_VERROUILLAGE_COMPTE`. |
| `LIMITE_FENETRE_SECONDES`           | `900`         | Länge des Anmeldezeitfensters in Sekunden. Minimum 30.                                                |
| `SEUIL_VERROUILLAGE_COMPTE`         | `5`           | Aufeinanderfolgende falsche Passwörter, bevor das Konto für eine Weile gesperrt wird.                 |
| `LIMITE_RECHERCHE_UTILISATEUR`      | `40`          | Erlaubte Suchanfragen pro Benutzer im Zeitfenster.                                                    |
| `LIMITE_RECHERCHE_FENETRE_SECONDES` | `30`          | Länge des Suchzeitfensters in Sekunden.                                                               |

## Ausgehende E-Mails

E-Mails werden nur dann wirklich versendet, wenn `NODE_ENV=production` **und** `COURRIEL_ENVOI_REEL=true` gilt. In allen anderen Fällen werden Nachrichten abgefangen und nicht zugestellt. Im Standard-Stack ist `NODE_ENV` gleich `production`, und der Entrypoint setzt `COURRIEL_ENVOI_REEL=true`, sobald `DFA_SMTP_HOST` gesetzt ist.

| Variable              | Standard | Wirkung                                                                  |
| --------------------- | -------- | ------------------------------------------------------------------------ |
| `COURRIEL_ENVOI_REEL` | `false`  | Erlaubt den echten Versand, zusammen mit `NODE_ENV=production`.          |
| `SMTP_HOTE`           | keine    | Host-Name des SMTP-Servers.                                              |
| `SMTP_PORT`           | `587`    | SMTP-Port, von 1 bis 65535.                                              |
| `SMTP_SECURISE`       | `false`  | `true` für implizites TLS. Auf `false` lassen für STARTTLS auf Port 587. |
| `SMTP_UTILISATEUR`    | keine    | Benutzername für SMTP.                                                   |
| `SMTP_MOT_DE_PASSE`   | keine    | Passwort für SMTP.                                                       |
| `SMTP_EXPEDITEUR`     | keine    | Absenderadresse. Muss eine gültige E-Mail-Adresse sein.                  |

Jede Garage kann in der App einen eigenen Postausgangsserver festlegen (**Einstellungen > E-Mail-Versand**). Die Reihenfolge der Verwendung: zuerst die Einstellung der Garage, dann die Variablen `SMTP_*` oben, dann nichts. Ohne beides wird keine E-Mail versendet, und der Bildschirm zeigt «Nicht eingerichtet». Ausserhalb der Produktion bleiben gewöhnliche E-Mails unabhängig von der Einstellung der Garage abgefangen; nur die Testnachricht dieses Bildschirms wird wirklich versendet.

| Variable                         | Standard | Wirkung                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLE_CHIFFREMENT_SECRETS`        | keine    | Schlüssel mit 32 Byte (base64 oder 64 Hexadezimalzeichen), der die SMTP-Passwörter der Garagen verschlüsselt. Ohne ihn wird das Speichern eines Passworts abgelehnt. Im Standard-Stack wird er beim ersten Start erzeugt und im Volume `dfa_secrets` gespeichert. Anderswo erzeugen Sie ihn mit `openssl rand -base64 32`. Wenn Sie ihn ändern, müssen die Passwörter neu eingegeben werden. |
| `COURRIEL_RESEAU_PRIVE_AUTORISE` | `false`  | Erlaubt den Postausgangsserver einer Garage in einem privaten Netz (192.168.x, 10.x, localhost) in der Produktion. Standardmässig aus, damit die Schaltfläche «Testnachricht senden» nicht das interne Netz abtasten kann. Ausserhalb der Produktion immer erlaubt.                                                                                                                          |

## Überwachung

| Variable                             | Standard   | Wirkung                                                                                                               |
| ------------------------------------ | ---------- | --------------------------------------------------------------------------------------------------------------------- |
| `SENTRY_DSN`                         | keine      | DSN eines Sentry-kompatiblen Servers. Ist er leer, ist die Fehlermeldung ausgeschaltet.                               |
| `SENTRY_ENVIRONMENT`                 | `NODE_ENV` | Name der Umgebung, der in den Fehlermeldungen angezeigt wird.                                                         |
| `SENTRY_TAUX_ECHANTILLONNAGE_TRACES` | `0`        | Anteil der Anfragen, die für die Leistungsmessung verfolgt werden, von 0 bis 1.                                       |
| `VERSION_APP`                        | berechnet  | Version, die im Gesundheitsendpunkt und in den Logs angezeigt wird. Ist sie leer, wird sie aus dem Git-Tag berechnet. |
| `VERSION_APP_BRANCHE`                | berechnet  | Branch oder Tag, aus dem das Build entstanden ist. Ist sie leer, wird sie berechnet.                                  |

## Betriebskonsole

Die Konsole ist ausgeschaltet, solange `DATABASE_URL_CONSOLE` nicht gesetzt ist.

| Variable                             | Standard              | Wirkung                                                                                          |
| ------------------------------------ | --------------------- | ------------------------------------------------------------------------------------------------ |
| `DATABASE_URL_CONSOLE`               | keine                 | PostgreSQL-URL für die Rolle `dfa_console`. Wenn Sie sie setzen, wird die Konsole eingeschaltet. |
| `CONSOLE_COOKIE_NOM`                 | `dfa_console_session` | Name des Sitzungs-Cookies der Konsole.                                                           |
| `CONSOLE_SESSION_DUREE_MINUTES`      | `60`                  | Maximale Sitzungsdauer der Konsole, von 5 bis 240 Minuten.                                       |
| `CONSOLE_SESSION_INACTIVITE_MINUTES` | `15`                  | Leerlaufzeitlimit der Konsole, von 1 bis 120 Minuten.                                            |
| `CONSOLE_POOL_MAX`                   | `2`                   | Verbindungen im Pool der Konsole, von 1 bis 10.                                                  |

## Hintergrundaufgaben

Jede geplante Aufgabe hat einen Ein-/Aus-Schalter und einen Cron-Ausdruck. Die Cron-Ausdrücke verwenden UTC.

Der Schalter kennt drei Zustände. Ist die Variable leer, ist die Aufgabe in der Produktion aktiv und in anderen Umgebungen inaktiv. `true` erzwingt die Aktivierung, `false` die Deaktivierung.

| Variable                                  | Standard     | Aufgabe                                                                                  |
| ----------------------------------------- | ------------ | ---------------------------------------------------------------------------------------- |
| `REFERENTIEL_VEHICULES_CH_JOB_ACTIF`      | leer         | Tägliche Aktualisierung der Schweizer Fahrzeug-Referenzdaten.                            |
| `REFERENTIEL_VEHICULES_CH_JOB_CRON`       | `17 4 * * *` | Zeitplan der Aktualisierung der Fahrzeug-Referenzdaten.                                  |
| `POINTAGE_CLOTURE_AUTOMATIQUE_JOB_ACTIF`  | leer         | Automatischer Abschluss des Tags der Zeiterfassung.                                      |
| `POINTAGE_CLOTURE_AUTOMATIQUE_JOB_CRON`   | `30 0 * * *` | Zeitplan des Abschlussjobs.                                                              |
| `RELANCES_FACTURE_JOB_ACTIF`              | leer         | Planung und Versand der Zahlungserinnerungen zu Rechnungen.                              |
| `RELANCES_FACTURE_JOB_CRON`               | `12 * * * *` | Zeitplan des Erinnerungsjobs.                                                            |
| `RESILIATION_PURGE_AUTOMATIQUE_JOB_ACTIF` | leer         | Automatische Bereinigung der Daten eines Mandanten, nachdem er den Dienst verlassen hat. |
| `RESILIATION_PURGE_AUTOMATIQUE_JOB_CRON`  | `17 3 * * *` | Zeitplan des Bereinigungsjobs.                                                           |

## Dokumentendienste

| Variable                               | Standard                 | Wirkung                                                                                                               |
| -------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `OCR_SERVICE_URL`                      | `http://ocr-permis:8092` | URL des OCR-Dienstes, der Fahrzeugausweise liest.                                                                     |
| `OCR_SERVICE_TIMEOUT_MS`               | `20000`                  | Wartezeit auf den OCR-Dienst für Fahrzeugausweise in Millisekunden. Minimum 1000.                                     |
| `LIMITE_OCR_PERMIS_UTILISATEUR`        | `15`                     | Erlaubte OCR-Erfassungen von Fahrzeugausweisen pro Benutzer im Zeitfenster.                                           |
| `LIMITE_OCR_PERMIS_FENETRE_SECONDES`   | `300`                    | Länge des OCR-Zeitfensters für Fahrzeugausweise in Sekunden.                                                          |
| `FACTURES_FOURNISSEUR_OCR_SERVICE_URL` | keine                    | URL des OCR-Dienstes, der Lieferantenrechnungen liest. Ist sie nicht gesetzt, steht die Funktion nicht zur Verfügung. |
| `FACTURES_FOURNISSEUR_OCR_TIMEOUT_MS`  | `20000`                  | Wartezeit auf den OCR-Dienst für Lieferantenrechnungen in Millisekunden. Minimum 1000.                                |

## Web-Oberfläche

| Variable                | Standard | Wirkung                                                                                                                                    |
| ----------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `VITE_DFA_VERSION_INFO` | keine    | Zur Build-Zeit festgelegter Text, der in der Versionsfusszeile der Oberfläche angezeigt wird. Wird beim Build gesetzt, nicht zur Laufzeit. |

## Bereitstellung

Diese Variablen liest die Compose-Datei, nicht die API. Setzen Sie sie in `.env`. Keine davon ist erforderlich.

| Variable                                                                                                   | Standard                | Wirkung                                                                                            |
| ---------------------------------------------------------------------------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------- |
| `DFA_VERSION`                                                                                              | `latest`                | Zu startender Image-Tag: `X.Y.Z`, `X.Y`, `latest` oder `edge`.                                     |
| `DFA_SITE_ADDRESS`                                                                                         | `http://localhost`      | Adresse der Website. Ein Domainname schaltet HTTPS über Caddy ein.                                 |
| `DFA_PUBLIC_URL`                                                                                           | `http://localhost:8080` | Öffentliche Adresse der Website, verwendet als `API_URL_PUBLIQUE` und `WEB_URL_PUBLIQUE`.          |
| `DFA_HTTP_PORT`                                                                                            | `8080`                  | Host-Port für HTTP.                                                                                |
| `DFA_HTTPS_PORT`                                                                                           | `8443`                  | Host-Port für HTTPS.                                                                               |
| `DFA_TRUST_PROXY_HOPS`                                                                                     | `1`                     | Wird als `TRUST_PROXY_HOPS` übergeben.                                                             |
| `DFA_LOG_LEVEL`                                                                                            | `info`                  | Wird als `LOG_NIVEAU` übergeben.                                                                   |
| `DFA_EXPOSE_API_DOCS`                                                                                      | `false`                 | Wird als `OPENAPI_EXPOSER_DOCS` übergeben.                                                         |
| `DFA_SENTRY_DSN`                                                                                           | leer                    | Wird als `SENTRY_DSN` übergeben.                                                                   |
| `DFA_SMTP_HOST`, `DFA_SMTP_PORT`, `DFA_SMTP_SECURE`, `DFA_SMTP_USER`, `DFA_SMTP_PASSWORD`, `DFA_SMTP_FROM` | leer, `587`, `false`    | Werden als die Variablen `SMTP_*` übergeben. Das Setzen des Hosts schaltet den echten Versand ein. |
| `DFA_SMTP_ALLOW_PRIVATE_NETWORK`                                                                           | `false`                 | Wird als `COURRIEL_RESEAU_PRIVE_AUTORISE` übergeben.                                               |
| `DFA_TIMEZONE`                                                                                             | `UTC`                   | Zeitzone des Sicherungsdienstes.                                                                   |
| `AGE_CLE_PUBLIQUE`                                                                                         | leer                    | Öffentlicher `age`-Schlüssel für das Sicherungsprofil.                                             |
| `HEURE_SAUVEGARDE`                                                                                         | `03:15`                 | Uhrzeit der nächtlichen Sicherung.                                                                 |
| `SEUIL_TAILLE_MIN_POURCENT`                                                                                | `50`                    | Mindestgrösse einer Sicherung in Prozent der vorherigen.                                           |

:::caution
Prüfen Sie die Variablen anhand dieser Seite für die Version, die Sie betreiben. Variablen können sich zwischen Versionen ändern. Lesen Sie das [Änderungsprotokoll](https://github.com/selfhostr/dmsforall/blob/main/CHANGELOG.md), bevor Sie aktualisieren.
:::
