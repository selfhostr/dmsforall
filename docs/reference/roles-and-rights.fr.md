---
title: Rôles et droits
description: Comment fonctionnent les droits dans dmsforall - une grille par personne, des rôles comme préréglages, et l'endroit où les droits sont définis.
---

Chaque personne dispose d'une **grille** de droits, et non d'un rôle unique et exclusif. La grille définit, pour six domaines, si la personne ne voit rien, peut consulter, ou peut agir. Un rôle (`direction`, `vendeur`...) n'est qu'un **préréglage** : la grille de départ donnée à une nouvelle personne, que le responsable peut ensuite ajuster. Les droits sont vérifiés par l'API à chaque requête, à partir de la grille de la personne lue dans la base. L'interface web masque les actions qu'une personne ne peut pas effectuer, mais c'est l'API qui fait autorité.

## La grille

| Domaine       | Rien        | Voir                              | Faire                                              |
| ------------- | ----------- | --------------------------------- | -------------------------------------------------- |
| `atelier`     | aucun accès | ordres de réparation, journal     | démarrer, contrôler, pointer, lignes               |
| `accueil`     | aucun accès | clients, véhicules, rendez-vous   | accueil, devis, rendez-vous                        |
| `facturation` | aucun accès | documents, paiements              | brouillon, émission, encaissements                 |
| `pieces`      | aucun accès | articles, stock, réservations     | mouvements de stock, commandes, réception          |
| `ventes`      | aucun accès | véhicules en stock, dossiers      | dossiers de vente de véhicules neufs et d'occasion |
| `finances`    | aucun accès | tableau de bord, export comptable | remboursements, corrections, export                |

« Faire » inclut « Voir ». Trois autres interrupteurs se trouvent en dehors de la grille :

- `encadrer` : corriger les heures d'autres personnes, rouvrir un ordre de réparation, lever un blocage, réglages de l'atelier.
- `gererEmployes` (« Employés et réglages ») : comptes et terminaux d'atelier. Suit le préréglage ; ne se modifie pas interrupteur par interrupteur.
- `patron` : actes irréversibles : IBAN créancier, lancement d'une reprise de données, sortie du garage. Suit le préréglage (`direction` uniquement).

Trois options par personne :

- `voitMontants` : voit les prix, les totaux et les montants. Sans elle, une personne ne peut pas utiliser Facturation : Faire, Ventes : Faire ni aucun niveau de Finances, et le PDF de facture (qui contient le montant) est refusé.
- `voitPrixAchat` : voit les prix d'achat et les marges sur les pièces.
- `avoirsPlafonnes` : les avoirs sont plafonnés au montant défini dans les réglages de l'atelier. C'est une contrainte, et non un pouvoir.

Les montants sont retirés des réponses **par le serveur** ; l'interrupteur est lu dans la grille de la personne à chaque requête.

## Préréglages

| Préréglage       | Rôle enregistré  | Résumé                                                                                                         |
| ---------------- | ---------------- | -------------------------------------------------------------------------------------------------------------- |
| `direction`      | `direction`      | Tout, y compris `encadrer`, `gererEmployes`, `patron`.                                                         |
| `admin`          | `admin`          | Administrateur technique : atelier, accueil, comptes. Aucun droit sur l'argent, le stock ni les ventes.        |
| `comptable`      | `comptable`      | Facturation et finances ; consulte le reste. Lit le bloc créancier, mais ne peut pas changer l'IBAN.           |
| `fiduciaire`     | `comptable`      | Comptable externe : Facturation et Finances en Voir uniquement, rien d'autre. Voit les montants, n'écrit rien. |
| `receptionnaire` | `receptionnaire` | Comptoir : accueil, devis, factures, paiements. Avoirs plafonnés.                                              |
| `vendeur`        | `vendeur`        | Ventes et facturation. Avoirs plafonnés.                                                                       |
| `chef_atelier`   | `chef_atelier`   | Chef d'atelier : `encadrer`, pièces, facturation. Avoirs plafonnés.                                            |
| `technicien`     | `technicien`     | Atelier uniquement, sans montants.                                                                             |
| `magasinier`     | `magasinier`     | Pièces et facturation au comptoir, et pointage du temps. Avoirs plafonnés.                                     |

`fiduciaire` n'a pas de valeur propre dans l'énumération `role_utilisateur` : il est enregistré avec `role = comptable` et reconnu par sa grille.

`poste_atelier` n'est pas un préréglage : c'est un **profil d'appareil fixe** pour un terminal d'atelier (lecture des ordres de réparation, pointage, identification par code PIN). Sa grille est ignorée.

Aucune personne ne perd un droit lors du passage des rôles aux préréglages. Un test (`apps/api/src/auth/matrice-droits.spec.ts`) vérifie, pour chaque action et chaque rôle, que le préréglage conserve au moins les anciens droits, et fixe chaque droit ajouté.

## Comment une action correspond à la grille

Chacune des quelque 170 actions (`apps/api/src/auth/matrice-droits.ts`, les libellés des routes) est rattachée à une ou deux capacités internes dans `apps/api/src/auth/capacites-actions.ts`. Une personne détient l'action lorsque sa grille accorde l'une de ces capacités. La table est typée `Record<Action, ...>` : une action non classée ne compile pas. `MATRICE_DROITS[role]` n'est plus que la liste des actions du préréglage de ce rôle.

## Séparation des tâches

Le niveau « Faire » seul ne donne pas toutes les actions de son domaine. Une personne qui tient le stock de pièces (Pièces : Faire) sans aucune autorité commerciale (ni Ventes : Faire, ni Finances : Faire) ne peut pas contrôler son propre travail sur un ordre de réparation, émettre des devis, des factures ou des avoirs, ni valider des factures fournisseurs ; un chef d'atelier (`encadrer`) dans cette situation peut émettre des devis et contrôler des ordres, mais ne peut ni encaisser, ni émettre de factures ou d'avoirs, ni tenir les mouvements de stock, ni valider des factures fournisseurs. Ces règles sont définies dans `capacitesDeLaGrille` (`packages/shared/src/contrats/capacites.ts`).

## Qui peut modifier une grille

`PATCH /api/v1/utilisateurs/{id}/capacites` et le changement de rôle demandent le droit `socle.utilisateur.modifier` (Employés et réglages). En plus :

- vous ne pouvez pas modifier votre propre grille ou rôle, ni réinitialiser ou réactiver votre propre compte par les routes des employés ;
- désactiver, réactiver et réinitialiser l'accès de quelqu'un suivent les mêmes règles que la modification de sa grille (une personne moins élevée ne peut pas prendre le contrôle, ni suspendre, une personne plus élevée) ;
- vous ne pouvez pas accorder ce que vous ne détenez pas vous-même (l'API indique le champ en cause) ;
- vous ne pouvez pas modifier une personne qui détient plus de droits que vous ; seul un `admin` peut modifier un `admin` ;
- `admin` (l'intégrateur) peut attribuer n'importe quel préréglage métier, afin de créer le premier responsable d'un garage ;
- le dernier `patron` actif ne peut pas être rétrogradé ni désactivé (vérifié sous un verrou par garage, afin que deux rétrogradations simultanées ne suppriment pas les deux) ;
- les modifications sont auditées (avant et après) ; les sessions d'une personne dont les droits baissent sont révoquées.

## Plafond des avoirs

Une personne disposant de l'option `avoirsPlafonnes` ne peut émettre des avoirs que jusqu'au plafond défini dans les réglages de l'atelier.

## Terminaux d'atelier

Les personnes ayant `gererEmployes` créent, désactivent et réinitialisent les terminaux d'atelier (`socle.borne.*`, `POST /api/v1/bornes`). Le serveur génère l'identifiant et le mot de passe du terminal, et n'affiche le mot de passe qu'une seule fois. Les codes PIN sont propres à chaque technicien et sont gérés séparément.

## Ce que reçoit l'interface web

`GET /api/v1/auth/moi` renvoie la liste triée des actions détenues par la personne (`actions`) et sa grille (`capacites`, avec `prereglage` et `personnalisee`). `GET /api/v1/capacites/modele` renvoie les domaines, niveaux, options et préréglages avec leurs clés i18n, pour dessiner l'écran « qui peut faire quoi ».

## Sites

Un utilisateur peut avoir accès à tous les sites du garage, ou à un seul site. Le terminal d'atelier n'a toujours qu'un seul site.

## Changer de rôle

Changer le rôle d'une personne applique le préréglage du nouveau rôle et remplace sa grille (l'audit conserve l'ancienne). Pour réinitialiser une grille personnalisée, réappliquez le préréglage. Lorsqu'une personne quitte le garage, désactivez son compte plutôt que de le supprimer. La trace d'audit renvoie au compte : il doit rester en place.
