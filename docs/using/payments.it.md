---
title: Registrare i pagamenti
description: Registrare pagamenti in contanti, con carta, bonifico, QR-fattura, TWINT, compensazione e leasing sui documenti.
---

Un pagamento viene registrato su una fattura. La fattura mostra cosa è stato pagato e cosa resta da pagare.

Alla fine di questa pagina potrà registrare un pagamento e controllare il saldo di una fattura.

## Modalità di pagamento

| Modalità       | Da usare per                                  |
| -------------- | --------------------------------------------- |
| `especes`      | Contanti.                                     |
| `carte`        | Pagamento con carta.                          |
| `virement`     | Bonifico bancario.                            |
| `qr`           | Pagamento con QR-fattura.                     |
| `twint`        | TWINT.                                        |
| `compensation` | Un importo compensato con un altro importo.   |
| `leasing`      | Pagamento da parte di una società di leasing. |

## Registrare un pagamento

1. Apra la fattura.
2. Scelga **Incassa**.
3. Scelga la modalità e inserisca l'importo. È ammesso un pagamento parziale.

Risultato: il saldo della fattura diminuisce. Quando il saldo è zero, la fattura è pagata.

## Controllare i pagamenti

La fattura conserva l'elenco dei suoi pagamenti, così può vedere ogni importo e la sua modalità.

:::caution
La riconciliazione degli estratti conto bancari (camt.054) non è disponibile in questa versione. I pagamenti vengono registrati a mano e abbinati alle fatture dalla persona che li registra.
:::

:::caution
Solo i ruoli `direction`, `comptable`, `receptionnaire`, `vendeur` e `magasinier` possono registrare pagamenti. Vedere [ruoli e diritti](../reference/roles-and-rights.md).
:::
