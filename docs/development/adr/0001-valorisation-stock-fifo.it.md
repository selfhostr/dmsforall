# ADR 0001: Valutazione del magazzino con FIFO

Questa decisione è stata accettata il 27.08.2026 da @laupernoe. Stabilisce come viene valutato il magazzino.

## Contesto

Nessun metodo di valutazione del magazzino era stato scelto. Di conseguenza, nessun margine poteva essere calcolato in modo affidabile, per un ricambio, un ordine di riparazione o una vendita.

Questo è l'unico punto aperto del piano di avvio la cui chiave di costo cresce con il tempo. Ogni mese senza un metodo aggiunge movimenti di magazzino che non potranno più essere valorizzati, perché il prezzo d'acquisto di ogni entrata non viene conservato in una forma che un metodo futuro possa usare. Gli altri punti (prezzi senza IVA, il tetto delle note di credito, le esportazioni verso altri software contabili) hanno un costo fisso e possono attendere che un cliente ne abbia bisogno.

## Decisione

FIFO, first in, first out, per lotto.

Ogni entrata di magazzino crea un lotto con la sua quantità e il suo prezzo d'acquisto. Un movimento in uscita consuma i lotti nell'ordine di entrata. Il valore di un movimento in uscita è il valore dei lotti effettivamente consumati, non una media.

## Motivazione

Il metodo FIFO è il più accurato dal punto di vista contabile. Rende un margine difendibile riga per riga: il ricambio venduto e il prezzo al quale è stato acquistato sono entrambi noti. Per i ricambi auto i cui prezzi dei fornitori cambiano spesso, una media ponderata appiattisce proprio le variazioni che devono restare visibili.

## Costi

Il FIFO è il più esigente dei tre metodi considerati. Ogni lotto e il suo prezzo devono essere tracciati, e un movimento in uscita può coprire più lotti. Il magazzino negativo, che il prodotto già consente, richiede una regola esplicita: a quale prezzo viene valorizzato un movimento in uscita che consuma un lotto non ancora ricevuto?

## Scartati

- **Prezzo medio ponderato.** Più semplice, e comune in Svizzera. È accettato da tutte le fiduciarie, ma appiattisce le variazioni che il metodo deve mostrare.
- **Ultimo prezzo d'acquisto.** Il più semplice da implementare. Il margine cambia ogni volta che un fornitore modifica i suoi prezzi, il che contrasta con l'obiettivo di margini affidabili.

## Ambito

L'implementazione è prevista in una fase avanzata del piano di avvio. La decisione viene presa ora perché non sia presa troppo tardi. Dalla data di questa scheda, ogni movimento di magazzino deve conservare ciò che serve per applicare il FIFO retroattivamente, anche se il calcolo non esiste ancora.

:::note
Nella versione attuale il calcolo non è implementato. Vedere [Gestire ricambi e magazzino](../../using/parts-and-stock.md).
:::
