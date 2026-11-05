---
title: Clock time on repair orders
description: Let technicians clock their time on repair orders from the workshop terminal, and close and lock the day.
---

Time clocking records how long each technician works on each repair order. The data supports the workshop productivity figures.

At the end of this page, a technician can clock in and out on an order from the workshop terminal, and you know how the day is closed.

## Set up the workshop terminal

1. Create an account with the role `poste_atelier` for the site. This account is the terminal, not a person.
2. Open the terminal account on the screen at the workshop. It shows the list of open orders.
3. Each technician identifies themselves with their PIN.

Result: the terminal shows who is clocked in, and on which order.

## Clock in and out

1. The technician enters their PIN.
2. The technician chooses the order.
3. Clock in when the work starts, and clock out when it stops.

A technician can also clock time from their own account, on the computer or on a phone, if the role allows it.

## Statuses

A time entry is `en_cours` while it runs, then `termine`. The entries of a day are `valide` once the workshop manager has checked them, and `verrouille` when the period is locked. A locked entry cannot be changed.

## Close the day

Each site has a closing time. When the time is passed, open entries are closed automatically if the automatic closing job is active. The job runs every night at 00:30 UTC by default. The workshop manager then checks the entries of the day.

:::caution
The PIN identifies the technician behind a clock entry. Keep PINs private, and do not write them on the terminal.
:::

:::caution
The terminal account has no rights on money. It cannot see amounts or issue documents.
:::
