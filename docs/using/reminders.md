---
title: Send payment reminders
description: Configure the delays for overdue invoice reminders, and understand when a reminder is sent or stopped.
---

Reminders chase unpaid invoices. A reminder is planned for each delay that you set, counted from the due date of the invoice, and sent by e-mail to the client.

At the end of this page, you know how to set the delays and when a reminder stops.

## Set the delays

1. Open the reminder settings.
2. Choose the reminder rule for overdue invoices.
3. Enter the delays, in days after the due date, for example `10` and `30`.
4. Save the rule.

Result: each delay creates one planned reminder for each overdue invoice.

## When a reminder is sent

The job that prepares and sends reminders runs every hour, at minute 12 by default. A reminder is sent by e-mail to the client's address.

## When a reminder stops

A planned reminder stops automatically in these cases:

- the invoice is paid, or the object is handled otherwise;
- the client has withdrawn consent to reminders;
- there is no valid e-mail address for the client.

The reason is recorded on the reminder.

:::caution
In this version, reminders are sent by e-mail only. A reminder planned for SMS is not sent. Reminders are delivered only when the server runs in production and the garage has a working sending server (Réglages › Envoi des e-mails), or the installation has one. Without either, the reminder is not sent and the reason is recorded. See the [configuration reference](../reference/configuration.md).
:::
