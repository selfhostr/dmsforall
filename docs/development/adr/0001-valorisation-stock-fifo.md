# ADR 0001: Stock valuation by FIFO

This decision was accepted on 2026-08-27 by @laupernoe. It fixes how stock is valued.

## Context

No stock valuation method had been chosen. As a result, no margin could be calculated reliably, for a part, a repair order or a sale.

This is the only open point of the go-live plan whose cost grows with time. Each month without a method adds stock movements that cannot be valued afterwards, because the purchase price of each receipt is not kept in a form that a future method can use. The other gaps (prices excluding VAT, the ceiling on credit notes, the exports to other accounting software) have a fixed cost and can wait until a customer needs them.

## Decision

FIFO, first in, first out, by lot.

Each stock receipt creates a lot with its quantity and its purchase price. An outgoing movement consumes the lots in order of receipt. The value of an outgoing movement is the value of the lots actually consumed, not an average.

## Why

FIFO is the most accurate method from an accounting point of view. It makes a margin defensible line by line: the part sold, and the price at which it was bought, are both known. For car parts whose supplier prices change often, a weighted average smooths out exactly the variations that need to be visible.

## Costs

FIFO is the most demanding of the three methods considered. Each lot and its price must be tracked, and an outgoing movement can span several lots. Negative stock, which the product already allows, needs an explicit rule: at which price is an outgoing movement valued when it consumes a lot that has not been received yet?

## Rejected

- **Weighted average price.** Simpler, and common in Switzerland. It is accepted by all fiduciaries, but it smooths the variations that the method is meant to show.
- **Last purchase price.** The simplest to implement. The margin changes whenever a supplier changes its prices, which conflicts with the goal of reliable margins.

## Scope

The implementation is planned late in the go-live plan. The decision is taken now so that it is not taken too late. From the date of this record, each stock movement must keep what is needed to apply FIFO retroactively, even though the calculation does not exist yet.

:::note
In the current release, the calculation is not implemented. See [Manage parts and stock](../../using/parts-and-stock.md).
:::
