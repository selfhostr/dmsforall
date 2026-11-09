---
title: Emettere preventivi e fatture con QR-fattura
description: Creare preventivi, ordini, fatture e note di credito, ed emettere fatture con una QR-fattura svizzera.
---

dmsforall gestisce quattro tipi di documenti di vendita: preventivi (_preventivi_), ordini d'acquisto (_buoni d'ordine_), fatture (_fatture_) e note di credito (_note di credito_). Le fatture d'acconto (_fatture d'acconto_) sono fatture di tipo particolare.

Alla fine di questa pagina potrà emettere una fattura con QR-fattura svizzera e correggerla con una nota di credito.

## Prima della prima fattura

Completi il blocco del creditore nelle impostazioni di fatturazione. Contiene le coordinate bancarie che compaiono sulla QR-fattura. Una fattura che richiede la QR-fattura non può essere emessa senza un blocco del creditore completo. Vedere [La prima autorimessa](../get-started/first-garage.md).

## Creare un documento

1. Dall'ordine di riparazione o dalla pratica di vendita, scelga **Nuovo preventivo** o **Nuova fattura**.
2. Controlli il cliente, le righe, l'aliquota IVA di ogni riga e i totali.
3. Lo salvi come bozza. Una bozza può ancora essere modificata.

L'IVA viene calcolata riga per riga, poi sommata per il documento. I totali sono indicati in CHF, con i centesimi.

## Emettere un documento

1. Scelga **Emetti**.
2. Controlli ancora una volta il documento: dopo questo passaggio sarà bloccato.
3. Scarichi o stampi il PDF.

I documenti emessi ricevono un numero da una serie continua per ogni anno. Un numero non viene mai riutilizzato.

## Il riferimento della QR-fattura

Le fatture riportano uno di tre riferimenti:

- un riferimento QR (QRR), per un conto con QR-IBAN;
- un riferimento creditore (SCOR), per un normale conto IBAN;
- nessun riferimento.

La scelta dipende dal conto bancario nel blocco del creditore.

## Fatture d'acconto

Una fattura d'acconto è una fattura con natura _acconto_. Condivide la stessa serie di numerazione delle altre fatture.

## Note di credito

Una nota di credito corregge una fattura emessa. Non si modifica mai una fattura emessa. Scelga il motivo e l'ambito:

- totale: la nota di credito annulla l'intera fattura;
- parziale: annulla una parte della fattura.

:::caution
Le note di credito possono essere limitate in base al ruolo. Un addetto all'accettazione può emettere una nota di credito solo fino a un tetto impostato dalla direzione. Sopra il tetto, il sistema rifiuta la nota di credito e la mantiene come bozza, senza numero. La direzione e la contabilità non hanno un tetto. Vedere [ruoli e diritti](../reference/roles-and-rights.md).
:::

:::caution
dmsforall non è un consulente fiscale. Faccia controllare le fatture e i dati IVA da una fiduciaria prima di farvi affidamento per la contabilità.
:::
