---
title: Zeit auf Reparaturaufträgen erfassen
description: Mechaniker erfassen ihre Zeit auf Reparaturaufträgen über das Werkstatt-Terminal, und Sie schliessen und sperren den Tag ab.
---

Die Zeiterfassung hält fest, wie lange jeder Mechaniker an jedem Reparaturauftrag (RA) arbeitet. Die Daten stützen die Kennzahlen zur Produktivität der Werkstatt.

Am Ende dieser Seite kann ein Mechaniker sich am Werkstatt-Terminal auf einem Auftrag ein- und ausstempeln, und Sie wissen, wie der Tag abgeschlossen wird.

## Das Werkstatt-Terminal einrichten

1. Legen Sie ein Konto mit der Rolle `poste_atelier` für den Standort an. Dieses Konto ist das Terminal, nicht eine Person.
2. Öffnen Sie das Konto des Terminals auf dem Bildschirm in der Werkstatt. Es zeigt die Liste der offenen Aufträge.
3. Jeder Mechaniker identifiziert sich mit seiner PIN.

Ergebnis: Das Terminal zeigt, wer eingestempelt ist, und an welchem Auftrag.

## Ein- und Ausstempeln

1. Der Mechaniker gibt seine PIN ein.
2. Der Mechaniker wählt den Auftrag.
3. Stempeln Sie ein, wenn die Arbeit beginnt, und aus, wenn sie endet.

Ein Mechaniker kann seine Zeit auch über sein eigenes Konto erfassen, am Computer oder auf dem Smartphone, wenn seine Rolle es erlaubt.

## Status

Ein Zeiteintrag ist `en_cours` (Läuft), während er läuft, danach `termine` (Beendet). Die Einträge eines Tages sind `valide` (Bestätigt), sobald die Werkstattleitung sie geprüft hat, und `verrouille` (Gesperrt), wenn die Periode gesperrt ist. Ein gesperrter Eintrag lässt sich nicht mehr ändern.

## Den Tag abschliessen

Jeder Standort hat eine Schlusszeit. Ist sie überschritten, werden offene Einträge automatisch geschlossen, sofern der automatische Abschluss-Auftrag aktiv ist. Der Auftrag läuft standardmässig jede Nacht um 00:30 UTC. Danach prüft die Werkstattleitung die Einträge des Tages.

:::caution
Die PIN identifiziert den Mechaniker hinter einem Zeiteintrag. Halten Sie die PINs geheim und schreiben Sie sie nicht auf das Terminal.
:::

:::caution
Das Terminal-Konto hat keine Rechte auf Geld. Es kann keine Beträge sehen und keine Dokumente ausstellen.
:::
