---
title: Manage repair orders
description: Open a repair order, add labour and parts, follow its statuses and close it.
---

A repair order (OR, _ordre de réparation_) is the central document of the workshop. It records the work done on one vehicle for one client.

At the end of this page, you can open an order, add its lines, follow it through the workshop, and close it.

## Statuses of an order

| Status     | Meaning                                   |
| ---------- | ----------------------------------------- |
| `planifie` | Planned, not yet started.                 |
| `ouvert`   | Opened. The work can start.               |
| `en_cours` | Work in progress.                         |
| `controle` | Work done, waiting for the quality check. |
| `termine`  | Finished, ready to be invoiced.           |
| `facture`  | Invoiced.                                 |
| `restitue` | Vehicle handed back to the client.        |
| `cloture`  | Closed.                                   |
| `annule`   | Cancelled.                                |

Waiting flags, such as waiting for parts, are kept separately from the status.

## Open an order

1. Open the client, then the vehicle. If the vehicle is not in the system, create it first.
2. Choose **New repair order** and select the site.
3. Describe the complaint and add the mileage.

Result: the order appears in the list of repair orders with the status `ouvert`.

## Add lines

Each line is one of these types:

- labour, either at a flat-rate time (_barème_), at the real time, or as a fixed package (_forfait_);
- a part, from the parts catalogue, which reserves stock on the order;
- a supply, a subcontracted job, or a workshop product;
- a tax line, a discount, or a text line.

Each line has its own status: proposed, to be validated, validated, in progress, done, invoiced, refused or cancelled.

### Attach photos to a line

Use **Photo** on a line, or in the dialog that adds a job, to photograph the fault on a tablet or phone. Each line takes up to 20 photos, in JPEG or PNG, and the browser shrinks each one before sending it. Select a thumbnail to see the photo full screen with its caption. The person who took a photo, or a manager, can delete it until the order is invoiced. Anyone who can read the order sees the thumbnails.

## Quotes for extra work

When the workshop finds extra work, it creates a supplementary quote on the order. The client decides for the whole quote, or line by line: accept, refuse, or partial. The decision is recorded on the order.

## Close an order

1. Check that every line is done, refused or cancelled.
2. Issue the invoice from the order. See [Quotes and invoices](quotes-and-invoices.md).
3. When the vehicle is handed back, set the status to `restitue`. Set it to `cloture` once the file is complete.

The system accepts only the status changes that the workflow allows for the current status.

:::caution
Each action on an order depends on the role of the person who does it. A technician can clock time and read the order, but cannot issue an invoice. See [roles and rights](../reference/roles-and-rights.md).
:::
