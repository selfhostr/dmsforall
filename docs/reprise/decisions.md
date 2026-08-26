Reprise de données — décisions actées (pièces, pneus, ventes VN/VO, relances)
==============================================================================

Contexte : la spécification de reprise (wiki, `Specifications-specification-reprise-donnees`)
a été écrite quand le schéma s'arrêtait à la migration `0033`. Il est aujourd'hui à `0068`.
Quatre domaines mis en base depuis cette date n'avaient aucune décision `D-xx` : pièces, pneus,
ventes VN/VO, relances. Ce document les couvre, à la suite de `D-34` (dernière décision tranchée
avant celles-ci, le 24.08.2026 — le paquet d'archive de conservation).

Onze décisions ont été posées, `D-35` à `D-45`. Le 25.08.2026, @laupernoe a tranché lui-même cinq
d'entre elles : `D-35`, `D-40`, `D-41`, `D-42`, `D-45`. Les six autres (`D-36`, `D-37`, `D-38`,
`D-39`, `D-43`, `D-44`) n'ont pas été soumises à arbitrage, parce que la base ou l'absence
d'enjeu réel tranchait déjà la réponse : elles sont **retenues par défaut**, avec la
recommandation appliquée telle quelle. Chaque décision ci-dessous précise laquelle des deux
situations s'applique — une décision retenue par défaut n'a jamais reçu l'accord explicite de
@laupernoe et se rouvre sur simple demande.

Chaque décision a été mesurée dans le code réel (`apps/api/src/db/migrations/`), jamais
supposée. Les options écartées restent listées : une décision dont on ne voit plus ce qui a été
refusé se rouvre tous les six mois pour les mêmes raisons.

**Deux domaines sont déjà réglés, sans nouvelle décision à prendre :**

- Le catalogue pièces (référence, désignation, prix de vente, TVA) se reprend — `D-02`,
  confirmé en base (`0022_pieces_referentiel.sql`).
- Les quantités en stock ne se reprennent jamais, inventaire physique le jour de la bascule —
  `D-14`. Les mouvements de stock soldés et les commandes fournisseur soldées vont en archive
  froide — `D-15`. Les décisions ci-dessous en tiennent compte : plusieurs questions qui
  semblaient ouvertes se réduisent, une fois la base lue, à une confirmation de `D-14`/`D-15`
  plutôt qu'à un nouvel arbitrage.
- Les factures fournisseur (dépôt de PDF, lecture automatique) : fonctionnalité neuve de DFA,
  sans équivalent structurel dans un DMS existant (`0059_factures_fournisseur.sql` exige un
  fichier déposé, une empreinte, un utilisateur qui dépose — rien de tout cela n'existe dans un
  export). Démarre à zéro, comme un paramétrage neuf. Pas de décision à prendre.
- Le module relances lui-même (règles, planification) : personne, dans aucun système source, ne
  tient un tableau de règles de relance au sens DFA. Le paramétrage se ressaisit à neuf, comme le
  reste (`D-13`). La seule vraie question relances est `D-45` ci-dessous : que faire d'une
  relance **déjà en cours** dans l'ancien système.

Pièces (`article`, `stock_article`, `fournisseur`, `commande_fournisseur`)
----------------------------------------------------------------------------

### D-35 — Valorisation du stock : FIFO

**Décision : premier entré, premier sorti (FIFO).** Tranchée par @laupernoe le 25.08.2026, à
l'encontre de la recommandation (qui proposait de garder le dernier prix connu, déjà le
comportement du logiciel).

_Rappel de la question_ : quand une pièce a été achetée plusieurs fois à des prix différents,
quel prix affiche-t-on sur sa fiche — le dernier prix payé, une moyenne, ou le prix du lot le
plus ancien encore en rayon ?

_Ce qui a été écarté, et pourquoi ça restait sur la table_ :

- **Dernier prix connu** — déjà le comportement du logiciel, mais fausse la marge affichée sur
  une pièce dont le prix a beaucoup bougé (métaux, composants électroniques).
- **Prix moyen pondéré (PMP)** — plus juste sur la durée, mais suppose un historique d'achats
  souvent absent des vieux exports. Écarté aussi : le choix de @laupernoe va directement au plus précis.

_Conséquence directe_ : ce choix ne se limite pas à un mapping de reprise, il change une règle de
gestion déjà en production. Elle est traitée à part, juste après cette décision (« Ce que D-35
déclenche : le chantier de valorisation FIFO »), parce qu'elle déborde largement le périmètre
d'une reprise de données.

_Ce que ça implique le jour de la bascule_ : pour une pièce reprise, la question ne se pose pas
tout de suite. `D-36` (ci-dessous) confirme que le prix d'achat d'une pièce reprise reste vide
au départ, quelle que soit la méthode retenue — FIFO ne change rien à ce point précis. Ce que
FIFO change, c'est le comportement futur : à partir du jour où le chantier ci-dessous sera livré,
chaque nouvelle entrée de livraison ouvrira un lot distinct au lieu d'écraser un chiffre unique.

### Ce que D-35 déclenche : le chantier de valorisation FIFO

Ce paragraphe ne conçoit pas la solution. Il établit, mesuré dans le code, ce que FIFO exige et
ce qui manque aujourd'hui pour l'offrir — de quoi décider quand lancer le chantier, pas comment
l'écrire.

**Ce que FIFO exige structurellement.** FIFO répond à la question « à quel prix est sortie
CETTE pièce » en suivant des lots : pour chaque entrée de stock, une quantité, un prix d'achat,
une date ; à chaque sortie, on consomme le lot le plus ancien encore non épuisé, et si ce lot ne
suffit pas, on continue sur le suivant. Ça suppose deux choses qu'un simple chiffre par pièce ne
peut pas porter : la mémoire de chaque lot d'entrée séparément, et un lien entre chaque sortie et
le ou les lots qu'elle a consommés.

**Ce que le schéma actuel offre, mesuré table par table.**

- `article.prix_achat_centimes` (`apps/api/src/db/schema/pieces/article.ts:76`) est une colonne
  unique par pièce. Le trigger qui l'écrit le dit dans son propre commentaire : « dernier prix
  connu — QP-04 laisse ouverte la méthode de valorisation » (migration
  `0025_pieces_stock_mouvements.sql:282-283`, fonction `mouvement_stock_appliquer_physique()`
  démarrée ligne 256). Une pièce n'a jamais deux prix en même temps dans ce schéma.
- `mouvement_stock` (`apps/api/src/db/schema/pieces/stock.ts:109-130`) est un journal complet de
  tous les mouvements — entrées, sorties, transferts, ajustements — et conserve bien le prix payé
  ligne par ligne pour une entrée de livraison (`prix_achat_reel_centimes`). Ce prix n'est
  cependant jamais lu que pour écraser la colonne unique de `article` ; aucune colonne ne retient
  la quantité restante d'un lot, et une contrainte de la même migration
  (`0025_pieces_stock_mouvements.sql:188`) interdit même à une sortie de porter un prix — une
  sortie ne peut structurellement pas dire de quel lot, ni de quel prix, elle provient.
- `stock_article` (`apps/api/src/db/schema/pieces/stock.ts:38-56`) ne garde qu'une quantité
  physique unique par pièce et par site (`quantite_physique_millieme`), jamais une ventilation
  par lot.
- Le paramétrage lui-même anticipe la question, mais pas cette réponse : `parametre_pieces`
  porte déjà une colonne `methode_prix_achat` (migration `0028_pieces_parametrage.sql:24,37`),
  aujourd'hui toujours `null` en attendant l'arbitrage — mais l'énumération qui la contraint,
  `METHODES_PRIX_ACHAT` (`packages/shared/src/contrats/pieces/parametrage.ts:18`), ne connaît que
  `dernier_prix` et `moyenne_ponderee`. FIFO n'a même pas encore de valeur réservée dans ce type.

Il manque donc structurellement : une table de lots (quantité entrée, quantité restante, prix,
date, pièce, site) et une règle de consommation qui va chercher, dans l'ordre d'entrée, un ou
plusieurs lots pour couvrir une sortie.

**Où le code utilise aujourd'hui ce prix unique — mesuré par recherche des usages réels de
`prixAchatCentimes`, pas extrapolé :**

- `apps/api/src/pieces/service-mouvement.ts:479-481` — le seuil d'écart significatif à
  l'inventaire : `valeurEcart = |delta| × prixAchatCentimes`, un calcul qui suppose un seul prix
  pour toute la quantité en écart.
- `apps/api/src/pieces/mappers.ts:94` et `:226`, `apps/api/src/pieces/service-article.ts:92` —
  l'affichage du prix d'achat sur la fiche pièce et sur la liste des mouvements, masqué pour
  certains rôles (`RF-115`/`RF-116` : technicien et admin ne le voient jamais, direction et
  gérant oui).
- `apps/api/src/pieces/dto/article.dto.ts:103-110` — le contrat d'API documente lui-même le champ
  comme « dernier prix d'achat connu », donc une valeur unique, pas une donnée calculée.
- `apps/api/src/pieces/service-commande-fournisseur.ts:143-147` — commentaire qui rappelle que ce
  service ne fixe jamais lui-même le prix d'achat, et cite explicitement `QP-04` comme non
  tranchée au moment où ce commentaire a été écrit.
- Deux zones **vérifiées absentes** plutôt que supposées : aucun calcul de marge sur une pièce
  vendue sur un ordre de réparation ne lit ce champ (`apps/api/src/atelier/service-ligne-or.ts`
  facture une pièce à son prix de vente, jamais contre son prix d'achat) ; aucun rapport de
  valeur de stock n'existe encore côté tableau de bord ou exploitation. Le terrain à modifier est
  donc plus étroit qu'on pourrait le craindre : un avertissement d'inventaire et deux points
  d'affichage, pas une dizaine de rapports financiers.

**Ampleur du chantier, honnêtement.** Ce n'est pas l'ajout d'une colonne. C'est : une nouvelle
table de lots avec sa propre logique de consommation ordonnée (une seule sortie peut vider un lot
et entamer le suivant) ; une réécriture du trigger `mouvement_stock_appliquer_physique()` et de
la couche service qui l'entoure (`service-mouvement.ts`, `service-commande-fournisseur.ts`) pour
créer un lot à chaque entrée et consommer les bons lots à chaque sortie ; une extension de
`methode_prix_achat` pour accueillir FIFO ; et une décision produit encore non posée — que montrer
sur la fiche d'une pièce dont plusieurs lots coexistent à des prix différents ? Un seul chiffre ne
suffit plus, donc l'écran change aussi, pas seulement le service qui l'alimente.

**Le stock déjà en base est-il convertible ?** Partiellement, et seulement dans un sens. Le prix
de chaque entrée de livraison passée est conservé (`prix_achat_reel_centimes` par mouvement), donc
rien n'est perdu côté entrées. Mais aucune sortie déjà enregistrée ne porte de lien vers le lot
qu'elle a consommé — cette information n'a jamais existé dans ce schéma. Pour un article ayant
connu plusieurs entrées à des prix différents et déjà des sorties, il est impossible de
reconstituer après coup quelle unité vendue provenait de quel lot : rejouer l'historique
produirait un résultat inventé, présenté comme mesuré — exactement ce que `D-10` interdit déjà
pour les relances. Point à vérifier avant de trancher la suite : si un garage tourne déjà en
production sur DFA avec un historique de mouvements mixte, son passif connaît la même limite ; à
confirmer, ce dépôt ne porte aucune preuve qu'un tenant réel en soit là aujourd'hui.

**Recommandation de séquencement.** Ce chantier peut suivre la première reprise réelle plutôt que
la précéder, sans coût caché — grâce à une décision déjà actée ailleurs : `D-14` a fixé que
**la quantité en stock ne traverse jamais la bascule**, chaque garage repart d'un inventaire
physique à zéro. Le stock d'un garage repris ne porte donc, dès le premier jour, aucun passif à
reconvertir en lots : le premier lot FIFO de chaque pièce sera simplement sa première entrée de
livraison après la bascule, que le chantier soit prêt ce jour-là ou six mois plus tard. Faire
précéder la bascule par ce chantier retarderait la mise en route de garages en attente pour un
bénéfice qui ne se voit de toute façon qu'après plusieurs semaines de nouvelles livraisons — le
temps que des lots FIFO significatifs existent.

Le prix à payer pour cet ordre : tant que le chantier n'est pas livré, le système continue de
fonctionner en dernier prix connu, malgré la décision. Ce n'est pas un défaut de la reprise, c'est
un écart assumé entre la décision produit et l'état du code — à afficher quelque part
(paramétrage pièces, ou note de version) plutôt qu'à laisser un garagiste le découvrir seul.

### D-36 — Prix d'achat d'une pièce reprise : laissé vide

**Décision : laissé vide.** Retenue par défaut, recommandation appliquée telle quelle — la base
ne laisse pas d'autre choix cohérent, ce n'était pas un vrai arbitrage.

_Ce que la base exige_ : `article.prix_achat_centimes` ne se remplit **jamais** à la création
d'une pièce — le service qui crée un article force `prixAchatCentimes: null`
(`apps/api/src/pieces/service-article.ts:355`) ; ce champ n'est écrit que par une vraie entrée de
livraison. Une entrée de livraison exige une quantité non nulle
(`mouvement_stock_quantite_non_nulle_chk`), or `D-14` a déjà tranché que les quantités ne se
reprennent pas. Par le chemin normal du logiciel, une pièce reprise ne peut donc pas recevoir de
prix d'achat avant sa première commande après la bascule.

_Ce qui a été écarté_ :

- **Forcer le prix d'achat connu à l'import**, en contournant la règle du logiciel — casse la
  garantie que ce champ ne reflète qu'un vrai achat enregistré.
- **Créer un mouvement de stock d'ouverture** rien que pour porter ce prix — reviendrait de fait
  à annuler `D-14` pour les pièces dont on connaît le prix, contradictoire avec l'inventaire
  physique déjà décidé.

_Ce que ça implique à la bascule_ : une pièce à rotation lente, jamais recommandée après la
bascule, reste sans prix d'achat indéfiniment. La marge sur cette référence n'est pas calculable
tant qu'elle n'a pas été recommandée — même limite déjà acceptée pour les quantités, appliquée au
prix d'achat, pas une perte supplémentaire. Le choix FIFO de `D-35` ne change rien ici : vide
reste vide, quelle que soit la méthode de valorisation qui s'appliquera à la première entrée
suivante.

### D-37 — Emplacement de rangement : repris séparément du comptage, si la source le permet

**Décision : reprendre l'emplacement seul, si l'ancien système en tient un exploitable.**
Retenue par défaut, recommandation appliquée telle quelle.

_Ce que la base exige_ : `stock_article.rayon` et `stock_article.tiroir` sont des colonnes
distinctes de la quantité (`0056_stock_article_rayon_tiroir.sql`) — rien n'empêche de les remplir
sans toucher à `quantite_physique_millieme`, qui reste à 0 jusqu'au comptage.

_Ce qui a été écarté_ : ne rien reprendre et tout redécouvrir pendant l'inventaire — plus simple
côté reprise, mais l'inventaire du samedi prend plus de temps et certaines pièces n'ont encore
aucun emplacement enregistré le lundi matin.

_Ce que ça implique à la bascule_ : à vérifier garage par garage, à l'inventaire (`Z-01`/`Z-06` de
la spec), si l'ancien système tient une notion d'emplacement exploitable. Si oui, reprise sans
risque puisque le champ est un simple texte, sans dépendance sur la quantité.

### D-38 — Réservations de pièces sur un OR ouvert : aucune ne traverse la bascule

**Décision : aucune réservation active reprise.** Retenue par défaut — la base ne laisse
structurellement pas d'autre option tant que `D-14` tient.

_Ce que la base exige_ : une réservation de pièce (`reservation_piece`,
`0026_pieces_reservation.sql`) exige que la quantité réservée n'excède jamais la quantité
physique en stock. Comme `D-14` fixe cette quantité à 0 tant que l'inventaire n'a pas eu lieu, il
est structurellement impossible d'insérer une réservation active avant l'inventaire — pas un
choix, une contrainte de la base.

_Ce qui a été écarté_ : reprendre les réservations en levant `D-14` pour les pièces concernées —
recréerait deux règles différentes dans le même inventaire du samedi (les pièces réservées
auraient une quantité connue, les autres non).

_Ce que ça implique à la bascule_ : l'OR repris reste ouvert, avec une note lisible sur la ligne
indiquant quelle pièce était prévue (texte libre, pas une vraie réservation). Le mécanicien qui
reprend un dossier en cours doit revérifier lui-même la pièce, une fois, le premier lundi.

### D-39 — Fournisseurs : fiche d'identité seule, sans historique de commandes soldées

**Décision : fiche d'identité seule (nom, coordonnées).** Retenue par défaut — prérequis
technique plus que véritable arbitrage.

_Ce que la base exige_ : `article_reference` et `commande_fournisseur` référencent `fournisseur`
par une clé étrangère obligatoire — sans fiche fournisseur, aucune commande ouverte ni aucune
référence croisée ne peut être reprise. Le téléphone, si renseigné, doit être au format
international (`+41...`) — un numéro suisse local classique d'un vieil export ne rentrera pas tel
quel.

_Ce qui a été écarté_ : ne rien reprendre du tout — bloque `D-40` (commandes fournisseur
ouvertes) et toute référence croisée article/fournisseur, impossible en pratique.

_Ce que ça implique à la bascule_ : la seule vraie question opérationnelle est la qualité du
nettoyage des doublons fournisseur — souvent quelques dizaines par garage, faisable à la main.

### D-40 — Commandes fournisseur en cours : reprises

**Décision : reprendre les commandes encore ouvertes** (`brouillon`, `envoyee`,
`partiellement_recue`). Tranchée par @laupernoe le 25.08.2026, conforme à la recommandation.

_Ce que la base exige_ : `statut_commande_fournisseur` est une machine à six états. Une commande
`recue` ou `cloturee` est déjà soldée, couverte par `D-15` (non reprise). Le reste est de l'ouvert
au sens de `D-29`, et dépend de `D-39` (la fiche fournisseur doit exister avant).

_Ce qui a été écarté_ : ne rien reprendre et laisser le garage ressaisir à la main — le volume
mesuré est faible dans les deux garages observés, mais le risque de rupture ou de double commande
était jugé réel.

_Ce que ça implique à la bascule_ : dans l'esprit de `D-29`, une pièce déjà commandée avant la
bascule ne se retrouve pas recommandée en double le mardi suivant.

---

Pneus (`depot_pneus`)
------------------------

### D-41 — Dépôts pneus en cours : repris, sans usure ni emplacement

**Décision : reprendre les dépôts en cours** (`en_depot`, `monte`), **jamais les dépôts déjà
sortis.** Tranchée par @laupernoe le 25.08.2026. Un point proposé séparément n'a **pas** été retenu :
l'état d'usure et l'emplacement de stockage ne se reprennent pas.

_Ce que la base exige_ : `depot_pneus` (`0043_pneus_depot_pneus.sql`) exige un véhicule
(`vehicule_id not null`, donc déjà repris) et un site (`site_id not null`) ; un jeu `sorti`
(rendu, véhicule vendu, mis au rebut) est terminal et ne peut plus jamais être supprimé ni
modifié. L'état d'usure et la dimension sont de simples champs texte libres, sans contrainte de
forme — rien d'un point de vue base n'empêchait de les reprendre, ce point était une vraie
option, pas une contrainte technique.

_Ce qui a été écarté_ :

- Ne rien reprendre du tout, et laisser le garage redemander à chaque client — intenable : perte
  de trace de biens appartenant à des clients, risque de réclamation concret.
- Reprendre l'état d'usure et l'emplacement de stockage en plus du dépôt lui-même — proposé,
  non retenu par @laupernoe. Le dépôt est retrouvable ; son état d'usure au moment de la bascule et
  l'endroit précis où il est rangé ne le sont pas.

_Ce que ça implique à la bascule_ : un client qui vient chercher son train de pneus est retrouvé,
avec son véhicule et la date de dépôt. Le magasinier ne sait en revanche pas, sans redemander ou
revérifier physiquement, dans quel état ces pneus ont été déposés ni où ils sont rangés — à
traiter comme n'importe quel jeu déposé après la bascule, sans historique d'usure. Point
d'attention déjà connu : la qualité de cette reprise dépend entièrement de la reprise des
véhicules — un dépôt dont le véhicule n'est pas repris (hors horizon, doublon non résolu) ne peut
techniquement pas être inséré.

---

Ventes VN/VO (`dossier_vente`, `vehicule_stock`, `reprise`, `financement_vente`)
-----------------------------------------------------------------------------------

### D-42 — Dossiers de vente ouverts : tous repris, organisme de financement en nom libre

**Décision : reprendre tous les dossiers ouverts** (tout sauf `livre`, `clos`, `annule`,
`abandonne`), avec le véhicule client et le financement associés. L'organisme de financement est
repris **en nom libre par défaut**, sans résolution forcée vers une fiche client à l'import — la
résolution en fiche se fait après coup, à la main, sans bloquer la bascule. Tranchée par @laupernoe le
25.08.2026, conforme à la recommandation.

_Ce que la base exige_ : un dossier `engage` ou au-delà exige un véhicule associé. Fait mesuré et
surprenant : l'organisme de financement (banque, société de leasing) n'est pas une table à part —
`financement_vente.organisme_id` et `reprise.dette_financement_organisme_id` pointent tous les
deux vers la table `client`. Reprendre un dossier avec financement en cours suppose donc que la
banque existe déjà comme fiche client bien dédupliquée, sans quoi elle se retrouve créée en double
à chaque dossier — sauf que le nom de l'organisme peut aussi être saisi en texte libre si son
identité n'est pas résolue (`reprise_dette_organisme_coherent_chk` accepte un nom seul), ce qui a
permis de retenir « nom libre par défaut » sans bloquer sur une résolution parfaite.

_Ce qui a été écarté_ :

- Ne reprendre que les dossiers avec acompte réellement encaissé — réduirait le risque de
  reprendre une négociation en réalité déjà abandonnée, mais exige un champ « acompte » qui
  n'existe peut-être pas de façon fiable dans la source.
- Ne rien reprendre, le vendeur ressaisit — inacceptable commercialement, un client qui a déjà
  dit oui ne doit pas revivre la démarche au moment précis de la bascule.

_Ce que ça implique à la bascule_ : un client en cours de négociation, réservation faite ou
financement en cours de validation, retrouve son dossier dès le lendemain. L'organisme de
financement apparaît d'abord comme un nom sans fiche associée — le vendeur ou l'administratif le
rattache à une vraie fiche client plus tard, à son rythme.

### D-43 — Véhicules VN/VO en stock : seulement ceux encore à vendre

**Décision : reprendre uniquement `en_commande`, `disponible`, `reserve`.** Retenue par défaut,
recommandation appliquée telle quelle — c'est le périmètre déjà nommé par `D-29`.

_Ce que la base exige_ : `prix_achat_centimes` est **obligatoire** sur chaque véhicule en stock,
sans échappatoire comparable à celle des pièces (`D-36`) : un véhicule sans prix d'achat connu ne
peut pas être inséré tel quel.

_Ce qui a été écarté_ : reprendre aussi les véhicules vendus non livrés récemment — inutile, ce
cas est déjà couvert par `D-42` via le dossier de vente associé, pas besoin de le dupliquer côté
stock.

_Ce que ça implique à la bascule_ : pour un véhicule sans prix d'achat connu dans une source
ancienne mal documentée, un prix estimé à dire d'expert évite d'échouer l'import — à trancher
garage par garage, pas en général.

### D-44 — Dossier repris déjà « engagé » : aucune vérification d'identité reconstituée

**Décision : laissé vide, assumé explicitement.** Retenue par défaut, recommandation appliquée
telle quelle — comme `D-04`/`D-24` pour les autres pertes de reprise, ne pas inventer une donnée
qui n'a peut-être jamais existé.

_Ce que la base exige_ : `dossier_vente.identite_piece_type`/`identite_verifiee_le` sont
nullables en base, mais obligatoires **applicativement** quand un vendeur engage un dossier via
l'écran normal. Un dossier repris directement en statut `engage` contourne cette exigence sans
qu'aucune contrainte de base ne le bloque.

_Ce qui a été écarté_ : demander au vendeur de revérifier l'identité au premier contact après la
bascule — plus rigoureux, mais ajoute une tâche pour un client qui a déjà montré ses papiers une
fois, pour une information que peu de DMS sources gardaient de toute façon.

_Ce que ça implique à la bascule_ : un dossier repris s'affiche comme engagé sans preuve
d'identité enregistrée. Un contrôle futur (audit interne) pourrait s'étonner de dossiers engagés
« incomplets » sur cette seule dimension — à documenter comme limite connue de la reprise, pas
comme anomalie.

---

Relances (`regle_relance`, `relance_planifiee`, `relance_envoi`)
---------------------------------------------------------------------

### D-45 — Relance déjà engagée : rien de réactivé, mais signalé

**Décision : ne rien recréer comme relance active, mais signaler visiblement les créances déjà
relancées.** Note sur la facture (« déjà relancée N fois côté ancien système, à vérifier avant
tout nouvel envoi »), le job de relance repart au palier 1, le comptable voit l'historique avant
d'agir. Tranchée par @laupernoe le 25.08.2026, conforme à la recommandation.

_Ce que la base exige_ : `relance_planifiee.palier` et `relance_envoi.tentative`/`envoye_le`
permettraient techniquement de recréer un historique de relance. Mais rien ne garantit que les
paliers de l'ancien système correspondent aux paliers DFA (délais, canaux, seuils différents d'un
DMS à l'autre) — un mauvais mapping produirait un palier inventé, contre le principe déjà posé en
`D-10` (ne pas fabriquer une donnée comparable à partir de deux méthodes différentes).

_Ce qui a été écarté_ :

- Repartir à zéro sans rien signaler — risque concret : un client déjà relancé deux fois et
  proche d'une mise en demeure recevrait un premier rappel poli de DFA, retardant une procédure
  de recouvrement déjà engagée.
- Reconstituer le palier et la date depuis l'ancien système — évite la relance en double, mais
  exige un mapping fiable entre deux jeux de règles rarement équivalents terme à terme ; un
  mapping approximatif fabrique une fausse continuité.

_Ce que ça implique à la bascule_ : cette relance ne peut exister que si la facture ou l'OR
concerné est lui-même repris (`D-29`/`D-30`) — sans le document source, il n'y a rien à signaler.
Le comptable garde la main : il voit l'historique et peut suspendre l'envoi automatique au cas par
cas, plutôt que de laisser DFA décider seul.

---

Ordre dans lequel exécuter
------------------------------

Les décisions sont prises. Certaines en conditionnent d'autres dans leur mise en œuvre : voici
l'ordre qui évite de bloquer une étape faute d'avoir posé son préalable.

1. **`D-35`/le chantier FIFO** n'est plus un préalable à la reprise : la recommandation de
   séquencement ci-dessus le place **après** la première bascule réelle, pas avant — grâce à
   `D-14` qui vide déjà le stock repris de tout passif à convertir.
2. **`D-36` (prix d'achat vide)** ne dépend donc plus de l'avancement du chantier FIFO : la règle
   « vide » s'applique dès maintenant, quel que soit l'état du chantier.
3. **`D-39` (fiche fournisseur)** avant **`D-40` (commandes fournisseur ouvertes)** : sans fiche
   fournisseur, aucune commande ne peut techniquement être insérée (clé étrangère obligatoire).
4. **`D-37` (emplacement)** et **`D-38` (réservations)** sont indépendantes des précédentes.
5. **`D-41` (dépôts pneus)** dépend de la qualité de la reprise des véhicules — pas d'un nouvel
   arbitrage, mais de sa bonne exécution.
6. **`D-43` (véhicules VN/VO en stock)** avant **`D-42` (dossiers de vente ouverts)** : un dossier
   engagé pointe vers un véhicule de stock, l'inverse n'est pas vrai.
7. **`D-42`** avant **`D-44` (identité vérifiée)**, qui n'est qu'une nuance de la même décision.
8. **`D-45` (relances déjà engagées)** en dernier : elle ne peut porter que sur des factures ou
   des OR déjà repris.

Ce qui reste ouvert malgré ces arbitrages
--------------------------------------------

Deux travaux à faire découlent de ces décisions, distincts du chantier FIFO traité plus haut. Ce
ne sont plus des observations : ce sont des tâches, à planifier avant d'annoncer un calendrier de
bascule sur ces quatre domaines.

**Aucune des sept tables concernées ne sait retenir l'identifiant source.** La migration `0066`
a posé la colonne `origine`/`numero_origine` sur cinq tables : `client`, `vehicule`, `article`,
`fournisseur`, `paiement`. Elle s'est arrêtée là. `depot_pneus`, `commande_fournisseur`,
`dossier_vente`, `vehicule_stock`, `reprise`, `financement_vente` et `relance_planifiee` n'ont
reçu ni l'une ni l'autre. Quelle que soit la décision prise sur ce document, une reprise positive
sur l'un de ces sept objets exige d'abord la même migration d'extension sur la table concernée —
sans elle, un import ne peut pas être rejoué sans risque de doublon, et rien ne permet de
réconcilier une ligne DFA avec sa ligne d'origine dans l'ancien système.

**Le contrat de reprise ne couvre encore ni les pneus, ni les ventes VN/VO, ni les relances.**
`DOMAINES_REPRISE` (`packages/shared/src/contrats/reprise.ts:509-518`) énumère huit domaines :
`clients`, `vehicules`, `ordres_reparation`, `documents_vente`, `paiements`, `articles_stock`,
`fournisseurs`, `documents_scannes`. Les trois domaines couverts par ce document — pneus, ventes
VN/VO, relances — n'y figurent pas. Tant que ce contrat n'est pas étendu, le plan de reprise que
le garagiste valide à l'écran ne peut proposer ni inclure ni exclure ces trois domaines : ils
resteraient hors reprise de fait, quelle que soit la décision `D-41`/`D-42`/`D-45` prise
ci-dessus.
