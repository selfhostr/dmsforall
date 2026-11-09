---
title: Reparaturaufträge verwalten
description: Einen Reparaturauftrag eröffnen, Arbeit und Teile erfassen, seine Status verfolgen und ihn abschliessen.
---

Ein Reparaturauftrag (RA, _ordre de réparation_) ist das zentrale Dokument der Werkstatt. Er hält die Arbeit fest, die an einem Fahrzeug für einen Kunden ausgeführt wurde.

Am Ende dieser Seite können Sie einen Auftrag eröffnen, seine Positionen erfassen, ihn durch die Werkstatt verfolgen und ihn abschliessen.

## Status eines Auftrags

| Status     | Bedeutung                                           |
| ---------- | --------------------------------------------------- |
| `planifie` | Geplant, noch nicht begonnen.                       |
| `ouvert`   | Eröffnet, die Arbeit kann beginnen.                 |
| `en_cours` | Arbeit läuft.                                       |
| `controle` | Arbeit erledigt, wartet auf die Qualitätskontrolle. |
| `termine`  | Fertig, bereit zur Verrechnung.                     |
| `facture`  | Verrechnet.                                         |
| `restitue` | Fahrzeug dem Kunden übergeben.                      |
| `cloture`  | Die Akte ist vollständig abgeschlossen.             |
| `annule`   | Storniert.                                          |

Wartezustände, etwa Wartet auf Teile, werden getrennt vom Status geführt.

## Einen Auftrag eröffnen

1. Öffnen Sie den Kunden, dann das Fahrzeug. Ist das Fahrzeug nicht im System, legen Sie es zuerst an.
2. Wählen Sie **RA erstellen** und wählen Sie den Standort.
3. Beschreiben Sie die Beanstandung und erfassen Sie den Kilometerstand.

Ergebnis: Der Auftrag erscheint mit dem Status `ouvert` (Offen) in der Liste der Reparaturaufträge.

## Positionen erfassen

Jede Position ist einer dieser Arten zugeordnet:

- Arbeit, entweder nach Vorgabezeit (_barème_), nach tatsächlicher Zeit oder als feste Pauschale (_forfait_);
- ein Teil aus dem Ersatzteilkatalog, das den Bestand auf dem Auftrag reserviert;
- eine Materiallieferung, eine Fremdarbeit oder ein Werkstattprodukt;
- eine MWST-Zeile, ein Rabatt oder eine Textzeile.

Jede Position hat einen eigenen Status: vorgeschlagen, zu bestätigen, bestätigt, in Arbeit, erledigt, fakturiert, abgelehnt oder storniert.

### Fotos an eine Position anhängen

Verwenden Sie **Foto** bei einer Position oder im Dialog, der eine Arbeit hinzufügt, um den Schaden mit Tablet oder Smartphone zu fotografieren. Jede Position nimmt bis zu 20 Fotos auf, im Format JPEG oder PNG. Der Browser verkleinert jedes Foto, bevor es gesendet wird. Wählen Sie eine Vorschau, um das Foto mit seiner Beschriftung im Vollbild zu sehen. Die Person, die das Foto aufgenommen hat, oder eine Leitungsperson kann es bis zur Verrechnung des Auftrags löschen. Wer den Auftrag lesen kann, sieht die Vorschaubilder.

## Offerten für Zusatzarbeiten

Findet die Werkstatt Zusatzarbeiten, erstellt sie auf dem Auftrag eine Zusatzofferte. Der Kunde entscheidet für die ganze Offerte oder Position für Position: annehmen, ablehnen oder teilweise annehmen. Die Entscheidung wird auf dem Auftrag festgehalten.

## Einen Auftrag abschliessen

1. Prüfen Sie, dass jede Position erledigt, abgelehnt oder storniert ist.
2. Stellen Sie die Rechnung aus dem Auftrag aus. Siehe [Offerten und Rechnungen](quotes-and-invoices.md).
3. Wenn das Fahrzeug übergeben wird, setzen Sie den Status auf `restitue` (Zurückgegeben). Setzen Sie ihn auf `cloture` (Geschlossen), sobald die Akte vollständig ist.

Das System akzeptiert nur die Statuswechsel, die der Ablauf für den aktuellen Status erlaubt.

:::caution
Jede Aktion auf einem Auftrag hängt von der Rolle der Person ab, die sie ausführt. Ein Mechaniker kann Zeit erfassen und den Auftrag lesen, aber keine Rechnung ausstellen. Siehe [Rollen und Rechte](../reference/roles-and-rights.md).
:::
