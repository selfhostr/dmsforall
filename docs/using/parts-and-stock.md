---
title: Manage parts and stock
description: Keep the parts catalogue, track stock per site, reserve parts on repair orders and order from suppliers.
---

The parts module holds the parts catalogue, the stock of each site and the movements that change it. Parts can be reserved on a repair order, ordered from suppliers, and invoiced through supplier invoices.

At the end of this page, you can add an article, record a stock movement, and reserve a part on an order.

## Articles

An article has a reference, a description, a supplier price, a sales price, a VAT rate and a storage location. Give each article a clear reference, because the reference is what the counter searches for.

## Stock movements

Each change of stock is recorded as a movement. The types are:

- goods receipt from a supplier delivery;
- outgoing for a repair order;
- sale at the counter;
- return to a supplier, or return from a client;
- transfer between sites;
- inventory adjustment;
- breakage or loss;
- return of a core (_consigne_).

Every movement keeps who did it and when.

## Reservations

When a part is added to a repair order, it is reserved. The stock shown as available is the stock minus the reservations. A reservation is released when the part is fitted, or when the line is cancelled.

## Supplier orders

Create a supplier order from the list of suppliers. When the delivery arrives, record the receipt. The stock goes up when the receipt is recorded, not when the order is sent.

## Supplier invoices

A supplier invoice can be entered by hand, or read from a PDF if the optional OCR service is configured. Check the amounts before you approve the invoice.

:::caution
Stock valuation by FIFO (first in, first out) is decided but not yet implemented. Margins per part or per order cannot be relied on in this version.
:::
