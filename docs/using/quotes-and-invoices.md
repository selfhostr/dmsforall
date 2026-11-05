---
title: Issue quotes and invoices with a QR-bill
description: Create quotes, orders, invoices and credit notes, and issue invoices with a Swiss QR-bill.
---

dmsforall keeps four kinds of sales document: quotes (_devis_), purchase orders (_bons de commande_), invoices (_factures_) and credit notes (_avoirs_). Down-payment invoices (_factures d'acompte_) are invoices of a special kind.

At the end of this page, you can issue an invoice with a Swiss QR-bill and correct it with a credit note.

## Before the first invoice

Complete the creditor block in the invoicing settings. It holds the bank details that appear on the QR-bill. An invoice that needs a QR-bill cannot be issued without a complete creditor block. See [Your first garage](../get-started/first-garage.md).

## Create a document

1. From the repair order or the sales file, choose **New quote** or **New invoice**.
2. Check the client, the lines, the VAT rate of each line and the totals.
3. Save it as a draft. A draft can still be changed.

VAT is calculated line by line, then added up for the document. The totals are shown in CHF, with centimes.

## Issue a document

1. Choose **Issue**.
2. Check the document once more: after this step it is locked.
3. Download or print the PDF.

Issued documents receive a number from a continuous series for each year. A number is not reused.

## The QR-bill reference

Invoices carry one of three references:

- a QR reference (QRR), for a QR-IBAN account;
- a creditor reference (SCOR), for a normal IBAN account;
- no reference.

The choice depends on the bank account in the creditor block.

## Down-payment invoices

A down-payment invoice is an invoice with the nature _acompte_. It shares the same numbering series as the other invoices.

## Credit notes

A credit note corrects an issued invoice. You never edit an issued invoice. Choose the reason and the scope:

- total: the credit note cancels the whole invoice;
- partial: it cancels part of the invoice.

:::caution
Credit notes can be limited by role. A receptionist can issue a credit note only up to a ceiling set by management. Above the ceiling, the system refuses the credit note and keeps it as a draft, without a number. Management and accounting have no ceiling. See [roles and rights](../reference/roles-and-rights.md).
:::

:::caution
dmsforall is not a tax advisor. Have your invoices and VAT figures checked by a fiduciary before you rely on them for your accounts.
:::
