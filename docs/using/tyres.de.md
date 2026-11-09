---
title: Reifensätze einlagern und wechseln
description: Reifensätze im Lager erfassen, ihren Status nachverfolgen und sie an den Kunden zurückgeben, wenn er sie abholt.
---

Das Reifen-Modul verwaltet die saisonalen Reifensätze von Kunden, die ihre Reifen bei der Garage einlagern.

Am Ende dieser Seite können Sie einen Satz einlagern, umlagern und an den Kunden zurückgeben.

## Einen Satz einlagern

1. Öffnen Sie den Kunden und das Fahrzeug.
2. Wählen Sie **Neue Einlagerung** und geben Sie die Saison (Sommer oder Winter) und den Lagerplatz in der Halle an.

Ergebnis: Der Satz erscheint als `en_depot` (Eingelagert).

Ein Fahrzeug kann je Saison nur einen aktiven Satz im Lager haben.

## Status

| Status       | Bedeutung                                                                           |
| ------------ | ----------------------------------------------------------------------------------- |
| `en_depot`   | Eingelagert, wartet.                                                                |
| `monte`      | Montiert am Fahrzeug, zum Beispiel beim Saisonwechsel.                              |
| `a_relancer` | Seit längerer Zeit ohne Bewegung. Der Kunde sollte kontaktiert werden (Nachfassen). |
| `sorti`      | Ausgelagert. Der Grund ist Pflicht.                                                 |

Bleibt ein Satz zu lange ohne Bewegung, wechselt sein Status automatisch zu `a_relancer` (Nachfassen).

## Einen Satz auslagern

Wählen Sie **Auslagern** und geben Sie den Grund an: dem Kunden zurückgegeben, Fahrzeug verkauft, verschrottet oder anderer Grund. Der Status wird `sorti` (Ausgelagert). Ein ausgelagerter Satz lässt sich nicht wieder öffnen. Erfassen Sie stattdessen eine neue Einlagerung.

:::caution
Löschen Sie einen Einlagerungs-Eintrag nicht, um den Satz auszulagern. Verwenden Sie die Aktion Auslagern, damit der Verlauf vollständig bleibt.
:::
