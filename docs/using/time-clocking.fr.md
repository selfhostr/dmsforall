---
title: Pointer le temps sur les ordres de réparation
description: Permettre aux techniciens de pointer leur temps sur les ordres de réparation depuis la borne d'atelier, puis clôturer et verrouiller la journée.
---

Le pointage enregistre le temps que chaque technicien passe sur chaque ordre de réparation. Ces données alimentent les indicateurs de productivité de l'atelier.

À la fin de cette page, un technicien peut pointer son arrivée et son départ sur un ordre depuis la borne d'atelier, et vous savez comment la journée est clôturée.

## Installer la borne d'atelier

1. Créez un compte avec le rôle `poste_atelier` pour le site. Ce compte représente la borne, pas une personne.
2. Ouvrez le compte de la borne sur l'écran de l'atelier. Il affiche la liste des ordres ouverts.
3. Chaque technicien s'identifie avec son code PIN.

Résultat : la borne affiche qui est pointé, et sur quel ordre.

## Pointer l'arrivée et le départ

1. Le technicien saisit son code PIN.
2. Le technicien choisit l'ordre.
3. Il pointe le début lorsque le travail commence, et la fin lorsqu'il s'arrête.

Un technicien peut aussi pointer depuis son propre compte, sur l'ordinateur ou sur un téléphone, si son rôle le permet.

## Statuts

Un enregistrement de pointage est `en_cours` pendant son déroulement, puis `termine`. Les pointages d'une journée passent à `valide` une fois vérifiés par le responsable de l'atelier, et à `verrouille` lorsque la période est verrouillée. Un pointage verrouillé ne peut plus être modifié.

## Clôturer la journée

Chaque site a une heure de fin de journée. Lorsque cette heure est passée, les pointages encore ouverts sont clôturés automatiquement, si la tâche de clôture automatique est active. Cette tâche s'exécute chaque nuit à 00:30 UTC par défaut. Le responsable de l'atelier vérifie ensuite les pointages de la journée.

:::caution
Le code PIN identifie le technicien derrière un pointage. Gardez les codes PIN confidentiels, et ne les notez pas sur la borne.
:::

:::caution
Le compte de la borne n'a aucun droit sur l'argent. Il ne peut pas voir les montants ni émettre de documents.
:::
