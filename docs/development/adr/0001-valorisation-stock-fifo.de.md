# ADR 0001: Bewertung des Lagers nach FIFO

Diese Entscheidung wurde am 27.08.2026 von @laupernoe angenommen. Sie legt fest, wie das Lager bewertet wird.

## Ausgangslage

Es war noch keine Methode zur Bewertung des Lagers gewählt. Deshalb liess sich weder die Marge eines Teils, eines Reparaturauftrags noch eines Verkaufs zuverlässig berechnen.

Dies ist der einzige offene Punkt des Einführungsplans, dessen Kosten mit der Zeit wachsen. Jeder Monat ohne Methode bringt Lagerbewegungen hervor, die sich später nicht mehr bewerten lassen, weil der Einkaufspreis jedes Eingangs nicht in einer Form gespeichert wird, die eine künftige Methode nutzen kann. Die übrigen Lücken (Preise ohne MWST, die Obergrenze für Gutschriften, die Exporte in andere Buchhaltungssoftware) haben feste Kosten und können warten, bis ein Kunde sie braucht.

## Entscheidung

FIFO, first in, first out, pro Charge.

Jeder Lagereingang erzeugt eine Charge mit Menge und Einkaufspreis. Eine Ausgangsbewegung verbraucht die Chargen in der Reihenfolge des Eingangs. Der Wert einer Ausgangsbewegung ist der Wert der tatsächlich verbrauchten Chargen, kein Durchschnitt.

## Begründung

FIFO ist aus buchhalterischer Sicht die genaueste Methode. Sie macht eine Marge Position für Position nachvollziehbar: Das verkaufte Teil und der Preis, zu dem es eingekauft wurde, sind beide bekannt. Bei Autoteilen, deren Lieferantenpreise oft ändern, würde ein gewichteter Durchschnitt genau die Schwankungen glätten, die sichtbar sein müssen.

## Kosten

FIFO ist die anspruchsvollste der drei geprüften Methoden. Jede Charge und ihr Preis müssen nachverfolgt werden, und eine Ausgangsbewegung kann mehrere Chargen umfassen. Ein negativer Lagerbestand, den das Produkt bereits zulässt, braucht eine ausdrückliche Regel: Zu welchem Preis wird eine Ausgangsbewegung bewertet, die eine Charge verbraucht, die noch nicht eingegangen ist?

## Verworfen

- **Gewichteter Durchschnittspreis.** Einfacher und in der Schweiz verbreitet. Alle Treuhänder akzeptieren ihn, aber er glättet genau die Schwankungen, die die Methode sichtbar machen soll.
- **Letzter Einkaufspreis.** Am einfachsten umzusetzen. Die Marge ändert sich, sobald ein Lieferant seine Preise ändert. Das widerspricht dem Ziel verlässlicher Margen.

## Geltungsbereich

Die Umsetzung ist spät im Einführungsplan vorgesehen. Die Entscheidung fällt jetzt, damit sie nicht zu spät fällt. Ab dem Datum dieses Protokolls muss jede Lagerbewegung alles speichern, was für eine nachträgliche Anwendung von FIFO nötig ist, auch wenn die Berechnung noch nicht existiert.

:::note
In der aktuellen Version ist die Berechnung nicht umgesetzt. Siehe [Ersatzteile und Lager verwalten](../../using/parts-and-stock.md).
:::
