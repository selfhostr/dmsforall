---
title: Vendere auto nuove e d'occasione
description: Gestire il magazzino di auto nuove e d'occasione, le pratiche di vendita, le permute e le conferme di finanziamento o leasing.
---

Il modulo vendite copre i veicoli nuovi (VN) e i veicoli usati (VO). Segue il veicolo dall'ordine alla consegna, la pratica di vendita che lo accompagna, la permuta dell'auto del cliente e il finanziamento.

Alla fine di questa pagina potrà mettere un'auto in stock, aprire una pratica di vendita e seguirla fino alla consegna.

## Stati del veicolo

| Stato         | Significato                            |
| ------------- | -------------------------------------- |
| `en_commande` | Ordinato, non ancora in stock.         |
| `disponible`  | In stock e disponibile per la vendita. |
| `reserve`     | Riservato per un cliente.              |
| `vendu`       | Venduto.                               |
| `livre`       | Consegnato al cliente.                 |

## Stati della pratica di vendita

Una pratica di vendita passa da `prospection` (primo contatto) a `engage` (il cliente si è impegnato), poi `en_preparation`, `pret_a_livrer`, `livre` e `clos`. Una pratica può anche essere `annule` o `abandonne`.

## Permuta

L'auto del cliente può essere ritirata come parte del pagamento. La permuta passa da `estimee` a `negociee`, poi `confirmee` o `refusee`.

## Finanziamento

Una vendita può essere pagata in contanti (`comptant`), con un credito bancario (`credit`), oppure con leasing (`leasing`).

- Per il contante, il finanziamento viene confermato subito.
- Per un credito o un leasing, la conferma inizia come `en_attente`. L'ente di finanziamento la conferma o la rifiuta. Registri la risposta nella pratica di vendita.

:::caution
Con il leasing, il veicolo viene venduto alla società di leasing, non al cliente. La fattura deve seguire questa struttura. La verifichi con la Sua fiduciaria.
:::
