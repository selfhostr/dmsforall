---
title: Envoyer des rappels de paiement
description: Régler les délais des rappels pour les factures échues, et comprendre quand un rappel est envoyé ou arrêté.
---

Les rappels relancent les factures impayées. Un rappel est planifié pour chaque délai que vous fixez, compté à partir de la date d'échéance de la facture, et envoyé par e-mail au client.

À la fin de cette page, vous savez régler les délais et comprendre quand un rappel s'arrête.

## Régler les délais

1. Ouvrez les réglages des rappels de paiement (**Rappels de paiement**).
2. Choisissez la règle de rappel pour les factures échues.
3. Saisissez les délais, en jours après la date d'échéance, par exemple `10` et `30`.
4. Enregistrez la règle.

Résultat : chaque délai crée un rappel planifié pour chaque facture échue.

## Quand un rappel est envoyé

La tâche qui prépare et envoie les rappels s'exécute toutes les heures, à la minute 12 par défaut. Un rappel est envoyé par e-mail à l'adresse du client.

## Quand un rappel s'arrête

Un rappel planifié s'arrête automatiquement dans ces cas :

- la facture est payée, ou le dossier est traité autrement ;
- le client a retiré son consentement aux rappels ;
- le client n'a pas d'adresse e-mail valide.

Le motif est enregistré sur le rappel.

:::caution
Dans cette version, les rappels ne sont envoyés que par e-mail. Un rappel planifié pour un SMS n'est pas envoyé. Les rappels ne sont remis que si le serveur fonctionne en production et que le garage dispose d'un serveur d'envoi opérationnel (Réglages › Envoi des e-mails), ou que l'installation en dispose un. Sans l'un ou l'autre, le rappel n'est pas envoyé et le motif est enregistré. Voir la [référence de configuration](../reference/configuration.md).
:::
