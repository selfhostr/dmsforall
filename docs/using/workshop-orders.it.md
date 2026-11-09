---
title: Gestire gli ordini di riparazione
description: Aprire un ordine di riparazione, aggiungere manodopera e ricambi, seguire i suoi stati e chiuderlo.
---

Un ordine di riparazione (OR, _ordine di riparazione_) è il documento centrale dell'officina. Registra il lavoro svolto su un veicolo per un cliente.

Alla fine di questa pagina potrà aprire un ordine, aggiungerne le righe, seguirlo nell'officina e chiuderlo.

## Stati di un ordine

| Stato      | Significato                                       |
| ---------- | ------------------------------------------------- |
| `planifie` | Programmato, non ancora iniziato.                 |
| `ouvert`   | Aperto. Il lavoro può iniziare.                   |
| `en_cours` | Lavoro in corso.                                  |
| `controle` | Lavoro eseguito, in attesa del controllo qualità. |
| `termine`  | Concluso, pronto per la fatturazione.             |
| `facture`  | Fatturato.                                        |
| `restitue` | Veicolo riconsegnato al cliente.                  |
| `cloture`  | Chiuso.                                           |
| `annule`   | Annullato.                                        |

Le segnalazioni di attesa, per esempio l'attesa dei ricambi, sono gestite separatamente dallo stato.

## Aprire un ordine

1. Apra il cliente, poi il veicolo. Se il veicolo non è nel sistema, lo crei prima.
2. Scelga **Crea un OR** e selezioni la sede.
3. Descriva il problema lamentato dal cliente e inserisca il chilometraggio.

Risultato: l'ordine compare nell'elenco degli ordini di riparazione con lo stato `ouvert`.

## Aggiungere righe

Ogni riga è di uno di questi tipi:

- manodopera, a tempo tariffario (_tariffa_), a tempo reale, oppure come pacchetto fisso (_forfait_);
- un ricambio, dal catalogo dei ricambi, che prenota il magazzino sull'ordine;
- una fornitura, un lavoro in subappalto o un prodotto d'officina;
- una riga di imposta, uno sconto o una riga di testo.

Ogni riga ha un proprio stato: proposta, da convalidare, convalidata, in corso, eseguita, fatturata, rifiutata o annullata.

### Allegare foto a una riga

Usi **Foto** su una riga, oppure nella finestra che aggiunge un lavoro, per fotografare il guasto con un tablet o un telefono. Ogni riga accetta fino a 20 foto, in JPEG o PNG, e il browser le riduce prima dell'invio. Selezioni una miniatura per vedere la foto a schermo intero con la sua didascalia. La persona che ha scattato la foto, oppure un responsabile, può eliminarla fino alla fatturazione dell'ordine. Chiunque possa leggere l'ordine vede le miniature.

## Preventivi per lavori extra

Quando l'officina trova lavori aggiuntivi, crea un preventivo supplementare sull'ordine. Il cliente decide per l'intero preventivo, oppure riga per riga: accetta, rifiuta o accetta in parte. La decisione viene registrata sull'ordine.

## Chiudere un ordine

1. Verifichi che ogni riga sia eseguita, rifiutata o annullata.
2. Emetta la fattura dall'ordine. Vedere [Preventivi e fatture](quotes-and-invoices.md).
3. Quando il veicolo viene riconsegnato, imposti lo stato `restitue`. Lo imposti su `cloture` quando la pratica è completa.

Il sistema accetta solo i cambi di stato che il flusso di lavoro consente per lo stato attuale.

:::caution
Ogni azione su un ordine dipende dal ruolo della persona che la compie. Un tecnico può timbrare il tempo e leggere l'ordine, ma non può emettere una fattura. Vedere [ruoli e diritti](../reference/roles-and-rights.md).
:::
