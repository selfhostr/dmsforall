---
title: Import data from an existing system
description: Move the clients, vehicles, documents and open work of a garage from an existing database archive into dmsforall, with a plan to review first.
---

The import brings the data of a garage from its existing software into dmsforall. It works in steps, and nothing is written before you have reviewed the plan.

At the end of this page, you know the steps of an import and what to check before you confirm it.

## What the import reads

The import reads database archives. The file type is detected from the content of the file, not from its name:

- Microsoft Access databases (`.mdb`, `.accdb`), or an archive that contains them;
- dBase and FoxPro tables (`.dbf`).

The import has been tested with archives exported from Auto-i. Not affiliated with Auto-i.

:::caution
Access archives are read with the `mdbtools` programs. The API container includes them. If you run the API outside the container, install `mdbtools` first, or the import stops with an error that says the tool is missing.
:::

## The steps

1. **Upload.** Upload the archive. The system checks that it is a supported type.
2. **Analysis.** The system reads the tables and counts the records.
3. **Plan.** The system proposes what it will import, and what it will leave out, with the reason for each choice.
4. **Import.** After you confirm the plan, the records are written to the garage's database.
5. **Report.** The report lists what was imported, what was skipped, and what needs a person to decide.

Result after the report: the imported clients and vehicles appear in the search, and the open documents appear in their lists.

## Review the plan

Before you confirm, check:

- the number of clients and vehicles against what you expect;
- the open invoices and their amounts;
- the open repair orders and their status;
- the items the plan leaves out, and the reason.

An import can be cancelled from the import screen. Check the report of the cancelled import before you start another one.

:::caution
Keep the original archive until the report is reviewed and the garage has used the new system for at least one full cycle of invoicing.
:::

:::caution
The import writes to the database of the garage. Make a backup before you start. See [Back up and restore](../get-started/backup-and-restore.md).
:::
