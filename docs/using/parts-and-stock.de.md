---
title: Ersatzteile und Lager verwalten
description: Den Ersatzteilkatalog führen, das Lager je Standort nachverfolgen, Teile auf Reparaturaufträgen reservieren und bei Lieferanten bestellen.
---

Das Ersatzteil-Modul führt den Ersatzteilkatalog, das Lager jedes Standorts und die Bewegungen, die es verändern. Teile können auf einem Reparaturauftrag reserviert, bei Lieferanten bestellt und über Lieferantenrechnungen verbucht werden.

Am Ende dieser Seite können Sie einen Artikel anlegen, eine Lagerbewegung erfassen und ein Teil auf einem Auftrag reservieren.

## Artikel

Ein Artikel hat eine Referenz, eine Bezeichnung, einen Einkaufspreis, einen Verkaufspreis, einen MWST-Satz und einen Lagerplatz. Geben Sie jedem Artikel eine klare Referenz, denn nach dieser Referenz sucht der Schalter.

## Lagerbewegungen

Jede Änderung des Lagers wird als Bewegung erfasst. Die Arten sind:

- Wareneingang aus einer Lieferung des Lieferanten (`Eingang - Lieferung`);
- Ausgang für einen Reparaturauftrag (`Ausgang - RA`);
- Verkauf am Schalter (`Ausgang - Theke`);
- Rückgabe an den Lieferanten oder Rückgabe vom Kunden (`Rückgabe Lieferant`, `Rückgabe Kunde`);
- Umlagerung zwischen Standorten (`Umlagerung`);
- Bestandskorrektur bei der Inventur;
- Bruch oder Verlust;
- Rückgabe eines Pfands (_consigne_).

Jede Bewegung hält fest, wer sie gemacht hat und wann.

## Reservierungen

Wenn ein Teil einem Reparaturauftrag hinzugefügt wird, wird es reserviert. Als verfügbar gilt der Bestand minus die Reservierungen. Eine Reservierung wird aufgehoben, wenn das Teil eingebaut oder die Position storniert wird.

## Lieferantenbestellungen

Erstellen Sie eine Lieferantenbestellung aus der Liste der Lieferanten. Wenn die Lieferung eintrifft, erfassen Sie den Wareneingang. Der Bestand steigt, sobald der Wareneingang erfasst ist, nicht, wenn die Bestellung abgeschickt wird.

## Lieferantenrechnungen

Eine Lieferantenrechnung können Sie von Hand erfassen oder aus einem PDF lesen, sofern der optionale OCR-Dienst eingerichtet ist. Prüfen Sie die Beträge, bevor Sie die Rechnung freigeben.

:::caution
Die Bewertung des Lagers nach FIFO (first in, first out) ist beschlossen, aber noch nicht umgesetzt. Margen je Teil oder je Auftrag lassen sich in dieser Version nicht verlässlich nutzen.
:::
