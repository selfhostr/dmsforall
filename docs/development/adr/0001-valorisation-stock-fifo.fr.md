# ADR 0001 : valorisation du stock selon la méthode FIFO

Cette décision a été acceptée le 27.08.2026 par @laupernoe. Elle fixe la manière dont le stock est valorisé.

## Contexte

Aucune méthode de valorisation du stock n'avait été choisie. Par conséquent, aucune marge ne pouvait être calculée de façon fiable, pour une pièce, un ordre de réparation ou une vente.

C'est le seul point ouvert du plan de mise en service dont le coût augmente avec le temps. Chaque mois sans méthode ajoute des mouvements de stock qui ne pourront plus être valorisés, parce que le prix d'achat de chaque réception n'est pas conservé sous une forme qu'une méthode future pourra utiliser. Les autres lacunes (prix hors TVA, plafond des avoirs, exports vers d'autres logiciels comptables) ont un coût fixe et peuvent attendre qu'un client en ait besoin.

## Décision

FIFO (premier entré, premier sorti), par lot.

Chaque réception de stock crée un lot avec sa quantité et son prix d'achat. Un mouvement de sortie consomme les lots dans l'ordre de réception. La valeur d'un mouvement de sortie est celle des lots effectivement consommés, et non une moyenne.

## Pourquoi

FIFO est, d'un point de vue comptable, la méthode la plus exacte. Elle rend une marge défendable ligne par ligne : la pièce vendue et le prix auquel elle a été achetée sont tous deux connus. Pour les pièces automobiles dont les prix d'achat changent souvent, une moyenne pondérée lisse précisément les variations qu'il faut pouvoir voir.

## Coûts

FIFO est la plus exigeante des trois méthodes étudiées. Chaque lot et son prix doivent être suivis, et un mouvement de sortie peut porter sur plusieurs lots. Le stock négatif, que le produit autorise déjà, demande une règle explicite : à quel prix valoriser un mouvement de sortie qui consomme un lot pas encore reçu ?

## Écartées

- **Prix moyen pondéré.** Plus simple, et courant en Suisse. Il est accepté par toutes les fiduciaires, mais il lisse les variations que la méthode doit rendre visibles.
- **Dernier prix d'achat.** Le plus simple à implémenter. La marge change chaque fois qu'un fournisseur modifie ses prix, ce qui contredit l'objectif de marges fiables.

## Périmètre

L'implémentation est prévue tard dans le plan de mise en service. La décision est prise maintenant pour ne pas être prise trop tard. À partir de la date de cet enregistrement, chaque mouvement de stock doit conserver ce qui est nécessaire pour appliquer FIFO rétroactivement, même si le calcul n'existe pas encore.

:::note
Dans la version actuelle, le calcul n'est pas implémenté. Voir [Gérer les pièces et le stock](../../using/parts-and-stock.md).
:::
