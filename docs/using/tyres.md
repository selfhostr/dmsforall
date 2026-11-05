---
title: Store and change tyre sets
description: Record tyre sets in storage, track their status and release them when the client collects them.
---

The tyre module keeps the seasonal tyre sets of clients who leave their tyres in storage with the garage.

At the end of this page, you can record a set in storage, move it, and release it to the client.

## Record a set in storage

1. Open the client and the vehicle.
2. Choose **New storage** and enter the season, summer or winter, and the location in the hangar.

Result: the set appears as `en_depot`.

A vehicle can have only one active set in storage for each season.

## Statuses

| Status       | Meaning                                                       |
| ------------ | ------------------------------------------------------------- |
| `en_depot`   | In storage, waiting.                                          |
| `monte`      | Fitted on the vehicle, for example during a change of season. |
| `a_relancer` | No movement for a while. The client should be contacted.      |
| `sorti`      | Released. The reason is required.                             |

When a set stays too long without movement, its status becomes `a_relancer` automatically.

## Release a set

Choose **Release** and give the reason: returned to the client, vehicle sold, scrapped, or other. The status becomes `sorti`. A released set cannot be reopened. Create a new storage record instead.

:::caution
Do not delete a storage record to release it. Use the release action, so that the history stays complete.
:::
