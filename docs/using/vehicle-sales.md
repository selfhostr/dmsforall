---
title: Sell new and used cars
description: Manage the stock of new and used cars, sales files, trade-ins and financing or leasing confirmations.
---

The sales module covers new cars (VN, _véhicules neufs_) and used cars (VO, _véhicules d'occasion_). It tracks the vehicle from order to delivery, the sales file that goes with it, the trade-in of the client's car, and the financing.

At the end of this page, you can put a car in stock, open a sales file, and follow it to delivery.

## Vehicle statuses

| Status        | Meaning                          |
| ------------- | -------------------------------- |
| `en_commande` | Ordered, not yet in stock.       |
| `disponible`  | In stock and available for sale. |
| `reserve`     | Reserved for a client.           |
| `vendu`       | Sold.                            |
| `livre`       | Delivered to the client.         |

## Sales file statuses

A sales file goes from `prospection` (first contact) to `engage` (the client has committed), then `en_preparation`, `pret_a_livrer`, `livre` and `clos`. A file can also be `annule` or `abandonne`.

## Trade-in

The client's car can be taken in part payment. The trade-in goes from `estimee` to `negociee`, then `confirmee` or `refusee`.

## Financing

A sale can be paid in cash (`comptant`), with a bank credit (`credit`), or with leasing (`leasing`).

- For cash, the financing is confirmed at once.
- For a credit or a leasing, the confirmation starts as `en_attente`. The financing company then confirms or refuses it. Record the answer on the sales file.

:::caution
With leasing, the vehicle is sold to the leasing company, not to the client. The invoice must follow that structure. Check it with your accountant.
:::
