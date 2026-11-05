---
title: Record payments
description: Record cash, card, bank transfer, QR-bill, TWINT, compensation and leasing payments against documents.
---

A payment is recorded against an invoice. The invoice shows what has been paid and what remains due.

At the end of this page, you can record a payment and check the balance of an invoice.

## Payment means

| Means          | Use it for                               |
| -------------- | ---------------------------------------- |
| `especes`      | Cash.                                    |
| `carte`        | Card payment.                            |
| `virement`     | Bank transfer.                           |
| `qr`           | QR-bill payment.                         |
| `twint`        | TWINT.                                   |
| `compensation` | An amount offset against another amount. |
| `leasing`      | Payment by a leasing company.            |

## Record a payment

1. Open the invoice.
2. Choose **Record a payment**.
3. Choose the means and enter the amount. A partial payment is allowed.

Result: the balance of the invoice goes down. When the balance is zero, the invoice is paid.

## Check the payments

The invoice keeps the list of its payments, so you can see each amount and its means.

:::caution
Bank statement reconciliation (camt.054) is not available in this version. Payments are recorded by hand and matched to invoices by the person who records them.
:::

:::caution
Only the roles `direction`, `comptable`, `receptionnaire`, `vendeur` and `magasinier` can record payments. See [roles and rights](../reference/roles-and-rights.md).
:::
