---
title: Zahlungserinnerungen versenden
description: Die Fristen für Mahnungen zu überfälligen Rechnungen festlegen und verstehen, wann eine Mahnung versendet oder gestoppt wird.
---

Mahnungen betreffen unbezahlte Rechnungen. Für jede Frist, die Sie festlegen, ist eine Mahnung geplant. Die Frist wird ab dem Fälligkeitsdatum der Rechnung gezählt, und die Mahnung wird per E-Mail an den Kunden gesendet.

Am Ende dieser Seite wissen Sie, wie Sie die Fristen festlegen und wann eine Mahnung stoppt.

## Die Fristen festlegen

1. Öffnen Sie die Einstellungen für Zahlungserinnerungen.
2. Wählen Sie die Mahnregel für überfällige Rechnungen (**Mahnregel — fällige Rechnung**).
3. Geben Sie die Fristen in Tagen nach dem Fälligkeitsdatum ein, zum Beispiel `10` und `30`.
4. Speichern Sie die Regel.

Ergebnis: Jede Frist erzeugt für jede überfällige Rechnung eine geplante Mahnung.

## Wann eine Mahnung versendet wird

Der Auftrag, der Mahnungen vorbereitet und versendet, läuft stündlich, standardmässig zur Minute 12. Eine Mahnung wird per E-Mail an die Adresse des Kunden gesendet.

## Wann eine Mahnung stoppt

Eine geplante Mahnung stoppt automatisch in diesen Fällen:

- die Rechnung ist bezahlt, oder der Vorgang wird anders erledigt;
- der Kunde hat seine Einwilligung zu Mahnungen widerrufen;
- für den Kunden gibt es keine gültige E-Mail-Adresse.

Der Grund wird bei der Mahnung vermerkt.

:::caution
In dieser Version werden Mahnungen nur per E-Mail versendet. Eine für SMS geplante Mahnung wird nicht versendet. Mahnungen werden nur zugestellt, wenn der Server im Produktionsbetrieb läuft und die Garage einen funktionierenden Postausgangsserver hat (Einstellungen › E-Mail-Versand), oder wenn die Installation einen solchen hat. Ohne eines von beiden wird die Mahnung nicht versendet, und der Grund wird vermerkt. Siehe die [Konfigurationsreferenz](../reference/configuration.md).
:::
