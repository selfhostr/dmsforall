---
title: Offerten und Rechnungen mit QR-Rechnung ausstellen
description: Offerten, Bestellungen, Rechnungen und Gutschriften erstellen und Rechnungen mit der Schweizer QR-Rechnung ausstellen.
---

dmsforall führt vier Arten von Verkaufsdokumenten: Offerten (_devis_), Bestellungen (_bons de commande_), Rechnungen (_factures_) und Gutschriften (_avoirs_). Akontorechnungen (_factures d'acompte_) sind Rechnungen einer besonderen Art.

Am Ende dieser Seite können Sie eine Rechnung mit Schweizer QR-Rechnung ausstellen und sie mit einer Gutschrift korrigieren.

## Vor der ersten Rechnung

Vervollständigen Sie in den Einstellungen zur Fakturierung den Gläubigerblock (Zahlungsempfänger). Er enthält die Bankverbindung, die auf der QR-Rechnung erscheint. Eine Rechnung, die eine QR-Rechnung braucht, lässt sich ohne vollständigen Gläubigerblock nicht ausstellen. Siehe [Ihre erste Garage](../get-started/first-garage.md).

## Ein Dokument erstellen

1. Wählen Sie beim Reparaturauftrag oder beim Verkaufsdossier **Neue Offerte** oder **Neue Rechnung**.
2. Prüfen Sie den Kunden, die Positionen, den MWST-Satz jeder Position und die Summen.
3. Speichern Sie es als **Entwurf**. Ein Entwurf lässt sich noch ändern.

Die MWST wird Position für Position berechnet und dann für das Dokument summiert. Die Summen werden in CHF mit Rappen angezeigt.

## Ein Dokument ausstellen

1. Wählen Sie **Ausstellen**.
2. Prüfen Sie das Dokument noch einmal: Nach diesem Schritt ist es gesperrt.
3. Laden Sie das PDF herunter oder drucken Sie es aus.

Ausgestellte Dokumente erhalten eine Nummer aus einer fortlaufenden Reihe für jedes Jahr. Eine Nummer wird nie wiederverwendet.

## Die Referenz der QR-Rechnung

Rechnungen tragen eine von drei Referenzen:

- eine QR-Referenz (QRR), für ein QR-IBAN-Konto;
- eine Creditor-Referenz (SCOR), für ein gewöhnliches IBAN-Konto;
- keine Referenz.

Die Wahl hängt vom Bankkonto im Gläubigerblock ab.

## Akontorechnungen

Eine Akontorechnung ist eine Rechnung mit der Art _Akonto_. Sie teilt sich dieselbe Nummernreihe wie die anderen Rechnungen.

## Gutschriften

Eine Gutschrift korrigiert eine ausgestellte Rechnung. Eine ausgestellte Rechnung ändern Sie nie. Wählen Sie den Grund und den Umfang:

- ganz: Die Gutschrift hebt die ganze Rechnung auf;
- teilweise: Sie hebt einen Teil der Rechnung auf.

:::caution
Gutschriften können je nach Rolle begrenzt sein. Eine Person am Empfang kann eine Gutschrift nur bis zu einer Obergrenze ausstellen, die die Geschäftsleitung festlegt. Oberhalb der Obergrenze lehnt das System die Gutschrift ab und behält sie als Entwurf ohne Nummer. Die Geschäftsleitung und die Buchhaltung haben keine Obergrenze. Siehe [Rollen und Rechte](../reference/roles-and-rights.md).
:::

:::caution
dmsforall ist kein Steuerberater. Lassen Sie Ihre Rechnungen und MWST-Angaben von einem Treuhänder prüfen, bevor Sie sich für Ihre Buchhaltung darauf verlassen.
:::
