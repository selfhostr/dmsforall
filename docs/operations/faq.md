---
title: Frequently asked questions
description: Answers to the questions people ask most often about dmsforall, its licence, its features and its limits.
---

## Is there a hosted version?

No. dmsforall is software that you run on your own server. The project offers no hosted service and no paid edition. The licence is MIT.

## What does it cost?

The software is free under the MIT licence. Your costs are the server, the domain name, the TLS certificate, the backups and your time.

## Which languages does the interface use?

French, German and Italian. The documentation is in English.

## Can several garages use one installation?

Yes. Each garage is a tenant, with its own data, separated by row-level security. Each garage has its own users and sites.

## Does it support my accounting software?

The accounting export is available for WinBIZ only. Other formats, such as Bexio, Abacus, Banana and generic CSV, are not available in this version.

## Does it send SMS?

No. SMS is defined in the data model, but no SMS provider is connected in this version. Reminders are sent by e-mail.

## Does it read bank statements?

No. Bank statement reconciliation (camt.054) is not available in this version.

## Can I see the margin on each part?

Not reliably. Stock valuation by FIFO is decided but not yet implemented.

## Can I import the data of my current software?

Yes, from Microsoft Access and dBase/FoxPro archives. The import has been tested with archives exported from Auto-i. Not affiliated with Auto-i. See [Import data](../using/data-import.md).

## Is it legally compliant in Switzerland?

dmsforall is built for Swiss law and VAT, with QR-bill invoices and amounts in centimes. The project gives no legal or tax guarantee. Have a fiduciary check your invoices, your VAT and your exports before you rely on them.

## Where are my data stored?

On the server that you run. dmsforall does not send data to the project or to a third party. Where that server is located is your choice.

## Is there a demo?

For a developer, `pnpm db:seed` loads a demo garage on a development database. See [Contributing](../development/contributing.md). The demo accounts are not created in production.

## Does it work on a tablet or a phone?

The interface runs in a browser. It has density settings for office screens, tablets and the appointment and time clocking screens.

## Can I change the theme?

Yes. The light and dark themes are available in the interface. The choice is stored in the browser of each device.

## How do I update to a new version?

Follow [Upgrade dmsforall](upgrading.md).
