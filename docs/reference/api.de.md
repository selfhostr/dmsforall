---
title: API-Referenz
description: Wie Sie die dmsforall-API aufrufen, sich anmelden, Listen seitenweise abrufen und Fehler lesen, und wo Sie die OpenAPI-Beschreibung finden.
---

Die Web-Oberfläche ist ein Client der öffentlichen API. Alles, was Sie in der Oberfläche tun können, können Sie auch mit der API tun.

## Basisadresse und Versionen

Alle Endpunkte liegen unter `/api/v1/`, zum Beispiel `https://garage.example.org/api/v1/sante`. Die Version ist Teil des Pfads.

## OpenAPI-Beschreibung

Die API veröffentlicht eine OpenAPI-Beschreibung, die aus dem Code erzeugt wird. Sie wird nur bereitgestellt, wenn `OPENAPI_EXPOSER_DOCS=true` gesetzt ist:

- `/api/docs`: interaktive Dokumentation;
- `/api/docs.json`: das OpenAPI-Dokument, zur Codeerzeugung.

Lassen Sie sie auf einem Produktionsserver, der aus dem Internet erreichbar ist, deaktiviert, sofern Sie sie nicht brauchen. Um das Dokument aus einem Quell-Checkout zu erzeugen, führen Sie `pnpm api:openapi` aus.

## Anmelden

Die Anmeldung erzeugt ein Sitzungs-Cookie. Senden Sie das Cookie mit jeder Anfrage. Der Name des Cookies ist standardmässig `dfa_session`.

| Endpunkt                                     | Methode | Verwendung                                            |
| -------------------------------------------- | ------- | ----------------------------------------------------- |
| `/api/v1/auth/connexion`                     | `POST`  | Anmelden mit E-Mail-Adresse und Passwort.             |
| `/api/v1/auth/deconnexion`                   | `POST`  | Abmelden und die Sitzung beenden.                     |
| `/api/v1/auth/moi`                           | `GET`   | Die angemeldete Person und ihre Rechte zurückgeben.   |
| `/api/v1/auth/mot-de-passe/oubli`            | `POST`  | Eine E-Mail zum Zurücksetzen des Passworts anfordern. |
| `/api/v1/auth/mot-de-passe/reinitialisation` | `POST`  | Ein neues Passwort mit dem Rücksetz-Token setzen.     |

Beispiel mit `curl`. Der Header `Origin` ist für den CSRF-Schutz erforderlich.

```sh
curl -c cookies.txt \
  -H "Origin: https://garage.example.org" \
  -H "Content-Type: application/json" \
  -d '{"email":"direction@garage.example.org","motDePasse":"replace-me"}' \
  https://garage.example.org/api/v1/auth/connexion
```

Den genauen Inhalt der Anmeldeanfrage finden Sie in der OpenAPI-Beschreibung, sie ist die Referenz.

## Listen und Seitenaufteilung

Listen verwenden die Pagination mit Cursor:

- `limite`: Anzahl der Einträge, die zurückgegeben werden.
- `curseur`: der Cursor für die nächste Seite. Nehmen Sie ihn aus dem Feld `curseurSuivant` der vorherigen Antwort. Bauen Sie Cursor nie selbst.

Eine Listenantwort hat drei Felder: `donnees` (die Einträge), `curseurSuivant` (der nächste Cursor oder `null` auf der letzten Seite) und `limite`.

## Fehler

Fehler verwenden das Format `application/problem+json`. Lesen Sie zuerst die Felder `status` und `type`. Eine Anfrage, die die Rolle nicht erlaubt, liefert `403` mit dem Code `DROIT_INSUFFISANT`.

## Weitere Konventionen

- Beträge sind ganze Zahlen in Rappen. `CHF 1'234.50` wird als `123450` gesendet.
- Sensible Neuanlagen akzeptieren einen Idempotenz-Schlüssel, damit ein erneuter Versuch keinen doppelten Eintrag erzeugt.
- Datums- und Zeitangaben folgen ISO 8601.

:::caution
Die API ersetzt nicht die Rechte der Web-Oberfläche. Eine Anfrage, die die Rolle nicht erlaubt, liefert `403`, unabhängig vom Client. Siehe [Rollen und Rechte](roles-and-rights.md).
:::
