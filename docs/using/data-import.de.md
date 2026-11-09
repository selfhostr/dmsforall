---
title: Daten aus einem bestehenden System übernehmen
description: Kunden, Fahrzeuge, Dokumente und offene Arbeiten einer Garage aus einem bestehenden Datenbank-Archiv in dmsforall übernehmen, mit einem Plan zur Prüfung vorab.
---

Der Import übernimmt die Daten einer Garage aus ihrer bisherigen Software in dmsforall. Er läuft in Schritten, und es wird nichts geschrieben, bevor Sie den Plan geprüft haben.

Am Ende dieser Seite kennen Sie die Schritte eines Imports und was Sie prüfen müssen, bevor Sie ihn bestätigen.

## Was der Import liest

Der Import liest Datenbank-Archive. Der Dateityp wird anhand des Inhalts erkannt, nicht anhand des Namens:

- Microsoft-Access-Datenbanken (`.mdb`, `.accdb`) oder ein Archiv, das sie enthält;
- dBase- und FoxPro-Tabellen (`.dbf`).

Der Import wurde mit Archiven getestet, die aus Auto-i exportiert wurden. Keine Verbindung zu Auto-i.

:::caution
Access-Archive werden mit den Programmen `mdbtools` gelesen. Das API-Container-Image enthält sie. Wenn Sie die API ausserhalb des Containers betreiben, installieren Sie zuerst `mdbtools`. Sonst bricht der Import mit einem Fehler ab, der sagt, dass das Werkzeug fehlt.
:::

## Die Schritte

1. **Hochladen.** Laden Sie das Archiv hoch. Das System prüft, ob es ein unterstützter Typ ist.
2. **Analyse.** Das System liest die Tabellen und zählt die Datensätze.
3. **Plan.** Das System schlägt vor, was es importiert und was es auslässt, mit dem Grund für jede Entscheidung.
4. **Import.** Nachdem Sie den Plan bestätigt haben, werden die Datensätze in die Datenbank der Garage geschrieben.
5. **Bericht.** Der Bericht listet auf, was übernommen, was übersprungen wurde und was eine Entscheidung einer Person braucht.

Ergebnis nach dem Bericht: Die übernommenen Kunden und Fahrzeuge erscheinen in der Suche, und die offenen Dokumente erscheinen in ihren Listen.

## Den Plan prüfen

Bevor Sie bestätigen, prüfen Sie:

- die Anzahl der Kunden und Fahrzeuge im Vergleich zu Ihren Erwartungen;
- die offenen Rechnungen und ihre Beträge;
- die offenen Reparaturaufträge und ihren Status;
- die Positionen, die der Plan auslässt, und den Grund dafür.

Einen Import können Sie auf der Importseite abbrechen. Prüfen Sie den Bericht des abgebrochenen Imports, bevor Sie einen neuen starten.

:::caution
Bewahren Sie das Original-Archiv auf, bis der Bericht geprüft ist und die Garage das neue System mindestens einen vollständigen Fakturierungszyklus genutzt hat.
:::

:::caution
Der Import schreibt in die Datenbank der Garage. Erstellen Sie vorher ein Backup. Siehe [Sichern und wiederherstellen](../get-started/backup-and-restore.md).
:::
