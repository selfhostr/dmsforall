# ADR 0001 — Valorisation du stock : FIFO

Date : 27.08.2026 · Statut : accepté · Tranché par : @laupernoe

## Contexte

Aucune méthode de valorisation n'était choisie. Conséquence directe : **aucune marge n'est
calculable de façon fiable**, ni sur une pièce, ni sur un ordre de réparation, ni sur une vente.

C'est le seul point du dossier de mise en production dont le coût **augmente avec le temps**.
Chaque mois sans méthode ajoute des mouvements de stock qu'on ne pourra pas revaloriser
rétroactivement : le prix d'achat de chaque entrée n'est pas conservé sous une forme exploitable
par une méthode qu'on n'a pas encore définie. Les autres manques (mode HT, plafond des avoirs,
exports Bexio) sont à coût constant — on peut les traiter quand un client les exige.

## Décision

**FIFO — premier entré, premier sorti, par lot.**

Chaque entrée en stock constitue un lot portant sa quantité et son prix d'achat. Une sortie
consomme les lots dans l'ordre d'entrée. La valeur d'une sortie est celle des lots réellement
consommés, pas une moyenne.

## Pourquoi

C'est la méthode la plus juste comptablement, et celle qui rend une marge **défendable ligne par
ligne** : on sait exactement quelle pièce, achetée à quel prix, a été vendue. Sur des pièces
automobiles dont les tarifs fournisseur bougent régulièrement, une moyenne pondérée lisse
justement ce qu'on veut voir.

## Ce que ça coûte

La méthode la plus exigeante des trois envisagées. Il faut tracer chaque lot et son prix, et
gérer le cas d'une sortie qui traverse plusieurs lots. Le stock négatif — déjà possible dans le
produit — demande une règle explicite : à quel prix valoriser une sortie qui consomme un lot qui
n'existe pas encore.

## Écarté

- **Prix moyen pondéré** — plus simple, standard en Suisse, accepté par toutes les fiduciaires,
  mais lisse les variations qu'on cherche précisément à voir.
- **Dernier prix d'achat** — le plus simple à implémenter ; la marge saute dès qu'un fournisseur
  change ses tarifs. Incompatible avec l'objectif de marges crédibles.

## Portée

Implémentation prévue tardivement dans le parcours de mise en production (jalon J5). **La décision
est prise maintenant précisément pour qu'elle ne le soit pas trop tard** : à partir d'aujourd'hui,
tout mouvement de stock doit conserver de quoi appliquer FIFO rétroactivement, même si le calcul
n'existe pas encore.
