---
title: Zahlungen erfassen
description: Barzahlung, Kartenzahlung, Banküberweisung, QR-Rechnung, TWINT, Verrechnung und Leasingzahlungen zu Dokumenten erfassen.
---

Eine Zahlung wird zu einer Rechnung erfasst. Die Rechnung zeigt, was bezahlt wurde und was noch offen ist.

Am Ende dieser Seite können Sie eine Zahlung erfassen und den Saldo einer Rechnung prüfen.

## Zahlungsarten

| Art            | Verwendung für                                            |
| -------------- | --------------------------------------------------------- |
| `especes`      | Barzahlung (Bargeld).                                     |
| `carte`        | Kartenzahlung.                                            |
| `virement`     | Banküberweisung.                                          |
| `qr`           | Zahlung mit QR-Rechnung.                                  |
| `twint`        | TWINT.                                                    |
| `compensation` | Ein Betrag, der mit einem anderen Betrag verrechnet wird. |
| `leasing`      | Zahlung durch eine Leasinggesellschaft.                   |

## Eine Zahlung erfassen

1. Öffnen Sie die Rechnung.
2. Wählen Sie **Inkassieren**.
3. Wählen Sie die Zahlungsart und geben Sie den Betrag ein. Eine Teilzahlung ist zulässig.

Ergebnis: Der Saldo der Rechnung sinkt. Ist der Saldo null, ist die Rechnung bezahlt.

## Zahlungen prüfen

Die Rechnung führt die Liste ihrer Zahlungen, sodass Sie jeden Betrag und seine Zahlungsart sehen.

:::caution
Der Abgleich von Kontoauszügen (camt.054) ist in dieser Version nicht verfügbar. Zahlungen werden von Hand erfasst und von der Person, die sie erfasst, den Rechnungen zugeordnet.
:::

:::caution
Nur die Rollen `direction`, `comptable`, `receptionnaire`, `vendeur` und `magasinier` können Zahlungen erfassen. Siehe [Rollen und Rechte](../reference/roles-and-rights.md).
:::
