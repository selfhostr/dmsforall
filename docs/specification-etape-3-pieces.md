Spécification métier — Étape 3 : Pièces
=======================================

> Périmètre : article (référentiel pièces), stock par site, mouvements, réservation, commande
> fournisseur, consigne (échange standard), vente comptoir.
> Public : expert-database, expert-api, expert-tests, expert-facturation (pour la consigne et la
> vente comptoir).
> Statut : spécification métier de référence, à faire relire par un magasinier avant implémentation
> (voir §12). Rien n'existe encore côté code pour ce module (ni schéma, ni API, ni écran) — cette
> spécification précède toute conception technique, comme l'exige l'ordre de travail du dépôt.
> Convention : `RP-xx` = règle métier testable (« pièces »), `CP-xx` = cas de test métier,
> `PP-xx` = point de paramétrage (varie d'un garage à l'autre, ne jamais coder en dur),
> `QP-xx` = question ouverte à poser à @laupernoe / au terrain. **[À VALIDER]** marque une hypothèse que
> je pose faute de connaître la pratique exacte du parc — à distinguer du **métier établi**, que
> j'affirme sans réserve parce qu'il découle directement de ce que fait un magasinier tous les
> jours, que ce document explique et que le code existant confirme déjà.

---

Sommaire
--------

1. [Périmètre et non-périmètre](#1-périmètre-et-non-périmètre)
2. [Ce qui existe déjà et que ce module doit respecter](#2-ce-qui-existe-déjà-et-que-ce-module-doit-respecter)
3. [Vocabulaire](#3-vocabulaire)
4. [Le flux réel de bout en bout](#4-le-flux-réel-de-bout-en-bout)
5. [Règles métier](#5-règles-métier)
6. [Machines à états](#6-machines-à-états)
7. [Les cas tordus](#7-les-cas-tordus)
8. [Modèle de données métier (conceptuel)](#8-modèle-de-données-métier-conceptuel)
9. [Contexte suisse](#9-contexte-suisse)
10. [Ce qui doit être paramétrable](#10-ce-qui-doit-être-paramétrable)
11. [Matrice rôle × action](#11-matrice-rôle--action)
12. [Cas de test métier](#12-cas-de-test-métier)
13. [Questions ouvertes à poser à @laupernoe](#13-questions-ouvertes-à-poser-à-laupernoe)

---

1. Périmètre et non-périmètre

---

**Dans le périmètre** : le référentiel des pièces (article), le stock par site, les mouvements de
stock et leur traçabilité, la réservation d'une pièce pour un OR précis, la commande fournisseur
(commande, réception partielle, reliquat, retour), le prix d'achat/vente et la marge, la consigne
d'échange standard, la vente de pièce au comptoir sans OR.

**Hors périmètre étape 3** (à ne pas reconstruire ici, juste ne pas s'y fermer) :

- La **gestion des fournisseurs** en tant que fiche complète (conditions cadre, contrats de
  référencement, portails EDI constructeur) — cette spécification suppose un fournisseur minimal
  (nom, coordonnées, délai habituel) et laisse le connecteur EDI/portail marque à la feuille de
  route §5 (connecteurs).
- Les **pneus en hôtel** (dépôt saisonnier) — déjà signalé hors étape 1, touche pièces + véhicule +
  facturation récurrente ; à réserver mais pas construire ici.
- La **valorisation comptable du stock** (FIFO/PMP, écritures d'inventaire vers la fiduciaire) — DFA
  ne tient pas de comptabilité (`RF-101` de la spec étape 2) ; ce module produit les mouvements et
  les quantités, pas un bilan de stock.
- Les **pièces d'occasion démontées** (récupération sur épaves, revente) — pratique réelle dans
  certains garages mais marginale ; à confirmer en §13 avant de l'exclure définitivement.

---

2. Ce qui existe déjà et que ce module doit respecter

---

Le module atelier (étape 1) a **anticipé** l'étape 3 à plusieurs endroits précis. Ce module s'y
raccorde, il ne les réinvente pas :

- **`ligne_or.articleId`** (`apps/api/src/db/schema/atelier/ordre-reparation.ts`) existe déjà,
  commentée « Accroche étape 3 (stock pièces) : sans FK ». C'est le point d'attache entre une ligne
  d'OR de type `piece` et l'`article` créé par ce module — la FK sera posée à l'implémentation.
- **`ligne_or.quantiteMillieme`** existe déjà (quantité en millièmes, donc fractionnaire — utile pour
  l'huile en litres, le liquide de frein, la graisse au gramme). Le module pièces hérite de cette
  même unité : une réservation ou une sortie de stock se compte dans la même précision.
- **`ligne_or.type = 'piece'`** est distinct de `'fourniture'` et `'produit_atelier'` dans l'enum
  `TYPES_LIGNE_OR` (`packages/shared/src/contrats/atelier/enums.ts`). `RP-01` ci-dessous précise
  cette distinction, qui conditionne si une ligne engage ou non un mouvement de stock traçable.
- **`ordre_reparation.attentePieces`** (booléen dérivé, jamais écrit directement — maintenu par
  trigger AFTER sur `ligne_or.blocage`, `apps/api/src/db/migrations/0008_atelier.sql` §« Couche
  5 ») passe à `true` dès qu'au moins une ligne de l'OR porte `blocage = 'pieces'`. **Ce module ne
  crée pas un nouveau mécanisme d'attente** : une ligne pièce en rupture ou en commande se marque
  `blocage = 'pieces'`, le drapeau de l'OR suit automatiquement. Voir `RP-24`.
- **`parametre_atelier.attentePiecesLongueDefaut`** (`char(1)`, `'A'` ou `'B'`, `P-27` de la spec
  étape 1, §6.7) code déjà le choix entre deux pratiques observées en cas de pièce longue à
  arriver : **A** — l'OR reste ouvert en attente, le véhicule repart provisoirement ; **B** — l'OR
  en cours est clôturé/facturé, la pièce en souffrance devient un travail reporté sur un nouvel OR
  lié (`motif_lien = 'suite'`). Ce module doit produire l'information qui **déclenche** ce choix (la
  pièce est en rupture, avec un délai annoncé) mais **le choix A/B lui-même reste porté par
  l'atelier**, pas par les pièces — voir `RP-25`.
- **`ligne_or.payeur` / `ligne_or.payeurClientId`** (`AC-08`, migration `0017`) : une pièce facturée
  à une assurance, à une garantie constructeur ou à un tiers **suit ce mécanisme existant sans
  exception**. Ce module ne crée pas de second circuit de tiers payeur pour les pièces — voir
  `RP-19`.
- **`ligne_or.fourniParClient`** (booléen déjà en base) : le client apporte sa propre pièce (pneus
  achetés ailleurs, pièce de récupération). Dans ce cas, **aucun mouvement de stock n'est généré** —
  la ligne existe pour la main-d'œuvre et éventuellement une prime de montage, mais ne consomme
  jamais d'`article` du garage. Voir `RP-20`.
- **`ligne_or.aRestituer` / `ligne_or.restituee`** : déjà en base, déjà pensé pour l'échange
  standard — la vieille pièce déposée doit être rendue au client (ou constitue le retour de
  consigne). Ce module précise comment ces deux booléens s'articulent avec le mouvement de stock et
  avec `RF-100` (facturation) — voir `RP-21` à `RP-23`.
- **Le rôle `magasinier`** existe déjà dans `apps/api/src/auth/matrice-droits.ts`, avec des droits
  déjà mesurés : lecture socle/étendue/OR, écriture client/véhicule, saisie kilométrage, création de
  lignes d'OR, lecture/écriture de **brouillon** de document de vente, encaissement — mais **jamais
  l'émission** d'un devis, d'un bon de commande, d'une facture ou d'un avoir (`EMISSION_DEVIS_BC`,
  `EMISSION_FACTURE`, `EMISSION_AVOIR` l'excluent tous les trois, littéralement). §11 en tire les
  conséquences pour les actions propres aux pièces (réception, sortie, inventaire, commande).
- **`entite_auditee`** (`packages/shared/src/contrats/atelier/enums.ts`) est un enum Postgres
  **extensible** — déjà étendu plusieurs fois par migration (le commentaire du fichier cite
  « neuf valeurs » puis « quinze »). Ce module **doit** y ajouter au minimum une entité pour les
  mouvements de stock (`CONTRIBUTING.md` cite explicitement les mouvements de stock comme entité
  sensible à auditer) et une pour la commande fournisseur — voir `RP-30`. Ce n'est pas à cette
  spécification de choisir les noms exacts de colonnes, mais l'obligation d'audit est actée ici pour
  que l'expert-database ne la découvre pas en aval.

---

3. Vocabulaire

---

- **Article** — la fiche pièce elle-même, indépendante de tout stock : référence, désignation,
  marque, prix. Un article existe même à quantité zéro.
- **Référence constructeur (OEM)** — la référence donnée par le constructeur du véhicule (ex.
  Volkswagen, Renault). C'est la référence qui figure sur le catalogue électronique de la marque
  (ETKA, RenaultParts, etc.) et sur laquelle le magasinier raisonne en premier.
- **Référence équivalente / adaptable** — une référence d'un fournisseur indépendant (Bosch, Febi,
  Meyle...) reconnue équivalente à une référence OEM. Le garage peut la monter à la place de la
  pièce d'origine, souvent moins chère, parfois seule disponible en délai raisonnable.
- **Comptoir** — le point de vente physique du magasin de pièces, distinct de l'accueil atelier :
  un client (ou parfois un autre garage, un particulier bricoleur) achète une pièce sans qu'un OR
  n'existe.
- **Consigne (échange standard, cœur d'échange)** — un dépôt de garantie facturé au client à la pose
  d'une pièce reconditionnée (alternateur, démarreur, injecteur, turbo, boîte de vitesses...), rendu
  quand le client restitue la vieille pièce.
- **Reliquat** — la part d'une commande fournisseur non encore livrée après une réception partielle.
- **Réservation** — le fait qu'une pièce en stock (ou en commande) soit **affectée** à un OR précis
  et ne soit plus disponible pour un autre OR ni pour une vente comptoir, même si le compteur de
  stock physique montre encore une quantité positive.
- **Magasinier** — la personne qui tient le magasin de pièces : réceptionne les livraisons, sort les
  pièces pour l'atelier, tient le comptoir, fait l'inventaire. Rôle déjà défini dans le dépôt.

---

4. Le flux réel de bout en bout

---

Ce que fait concrètement un magasinier, dans l'ordre où ça arrive dans sa journée — pas dans l'ordre
d'un schéma de base de données :

1. **Le matin, la livraison arrive.** Un transporteur ou le représentant du fournisseur dépose un
   carton avec un bulletin de livraison. Le magasinier pointe le bulletin contre une commande
   passée (si elle existe), scanne ou saisit chaque référence, range la pièce à son emplacement.
   → entrée de stock, §5.2.
2. **Un technicien a besoin d'une pièce pour un OR en cours.** Il vient au comptoir pièces (ou
   commande depuis l'écran atelier) avec le numéro d'OR. Le magasinier vérifie la disponibilité :
   en stock et **non réservée par un autre OR** → il la sort et la remet. Pas en stock → il la
   commande, et la ligne d'OR passe `blocage = 'pieces'`.
3. **Un client se présente au comptoir sans OR** : une plaquette de frein, une ampoule, un balai
   d'essuie-glace. Le magasinier encaisse directement — pas d'atelier impliqué. → vente comptoir,
   §5.8.
4. **Une pièce commandée arrive en rupture chez le fournisseur habituel.** Le magasinier cherche une
   référence équivalente ou un autre fournisseur, et prévient l'atelier du nouveau délai — c'est ce
   délai qui déclenche potentiellement le choix A/B de `P-27` (§2 ci-dessus).
5. **Un client ramène la vieille pièce d'un échange standard posé trois semaines plus tôt.** Le
   magasinier vérifie qu'elle correspond à la consigne facturée, la retourne au fournisseur (ou la
   met de côté pour un retour groupé), et déclenche l'avoir partiel de consigne côté facturation
   (`RF-100`).
6. **Une fois par an (ou plus souvent sur les références à forte rotation), l'inventaire.** Comptage
   physique confronté au stock théorique, écarts constatés, ajustement avec motif.
7. **Une pièce montée s'avère défectueuse ou mal commandée.** Retour fournisseur avec ou sans avoir,
   ou remise en stock si elle n'a jamais quitté le garage.

---

5. Règles métier

---

**5.1 L'article et ses références (`RP-01` → `RP-08`)**

- **`RP-01`** — Un `article` porte une **désignation**, une **marque** (constructeur du véhicule ou
  équipementier), une **référence principale**, et éventuellement un **code-barres** (EAN ou
  interne). Il existe indépendamment de tout stock : un article à quantité zéro reste consultable
  (historique, prix, remplacement proposé).
- **`RP-02`** — Un article porte 0..n **références alternatives**, chacune typée : `equivalente`
  (fournisseur indépendant reconnu équivalent à l'OEM), `remplace_par` (succession : l'ancienne
  référence n'est plus produite, celle-ci la remplace — cas très courant, un constructeur change de
  référence en cours de vie d'un modèle sans changer la pièce), `fournisseur_X` (la référence propre
  au catalogue d'un fournisseur donné, utile pour reconnaître un bulletin de livraison qui n'utilise
  jamais la référence OEM). **Métier établi** : c'est exactement le problème que le magasinier
  résout à la main aujourd'hui — un carton arrivé porte la référence du fournisseur, jamais celle
  qu'il a tapée dans le DMS pour commander, et il doit deviner que c'est la bonne pièce.
- **`RP-03`** — La recherche d'article doit aboutir **quelle que soit la référence saisie** parmi
  toutes celles connues de l'article (principale ou alternative), et rediriger vers la fiche
  article unique — jamais créer un doublon d'article par référence.
- **`RP-04`** — Un article peut être marqué `obsolete` avec une référence de remplacement
  obligatoire si elle existe (`remplace_par`, `RP-02`). Un article obsolète reste consultable
  (historique) mais ne doit plus être proposé en commande neuve. **[À VALIDER — la volumétrie
  réelle de ce type de succession de références, §13]**.
- **`RP-05`** — Une même désignation physique peut être vendue sous des **conditionnements**
  différents (la pièce à l'unité, le lot de 4 plaquettes, le litre d'huile vs le bidon de 5 litres).
  **[À VALIDER]** — hypothèse posée : chaque conditionnement est un article distinct avec son propre
  prix et son propre stock, plutôt qu'un mécanisme d'unité de vente/unité de stock séparées
  (plus simple à opérer au comptoir, plus lourd à maintenir en cas de changement de conditionnement
  fournisseur). Question au magasinier plutôt qu'arbitrage de conception, voir `QP-03`.
- **`RP-06`** — Un article porte une **catégorie** (pièce mécanique, pièce carrosserie, pneu,
  lubrifiant, produit d'atelier, fourniture) qui détermine au minimum le taux de TVA applicable
  (§9) et peut déterminer une remise catégorielle du côté client (`RM-07` de la spec étape 1 : les
  conditions commerciales d'un client distinguent déjà « pièces » comme catégorie de rabais — ce
  module fournit la catégorie que ce rabais consomme).
- **`RP-07`** — Un article ne peut pas être supprimé s'il a un historique de mouvement ou une ligne
  d'OR qui le référence : il est désactivé, jamais effacé (même principe que `RM-12`/`RM-31` de
  l'étape 1 pour client/véhicule).
- **`RP-08`** — Le numéro d'article interne (distinct des références constructeur/fournisseur) est
  unique par tenant, généré automatiquement.

**5.2 Le stock (`RP-09` → `RP-15`)**

- **`RP-09`** — Le stock est tenu **par site** : `(article, site) → quantité`. Un même article peut
  avoir une quantité différente sur deux sites du même tenant.
- **`RP-10`** — **[À VALIDER — pratique à confirmer avec un magasinier multi-sites, `QP-01`]** :
  hypothèse posée — le stock d'un site est **visible en lecture** depuis les autres sites du même
  tenant (« il en reste 2 à Genève, on peut faire venir »), mais une sortie de stock ou une
  réservation ne peut porter que sur le site où la pièce est physiquement présente. Le passage
  d'une pièce d'un site à l'autre est un **mouvement de transfert** explicite (`RP-13`), jamais une
  simple lecture croisée qui déciderait toute seule.
- **`RP-11`** — Un article porte, par site, un **emplacement de rangement** en texte libre (rayon,
  casier — les garages n'ont pas d'entrepôt automatisé, la référence est humaine : « B3 », « étagère
  du fond »).
- **`RP-12`** — Un article porte, par site, un **stock minimum** (seuil de réapprovisionnement) et
  éventuellement une **quantité de commande standard** (le fournisseur vend par lot de 10, pas à
  l'unité). Passer sous le seuil minimum place l'article dans une liste de réapprovisionnement — ça
  **propose**, ça ne commande jamais automatiquement sans validation du magasinier.
- **`RP-13`** — Un **transfert entre sites** est un mouvement double : sortie du site source, entrée
  sur le site destination, les deux dans la même opération, tracés comme un mouvement unique de type
  `transfert` (pas comme une sortie et une entrée indépendantes qui perdraient le lien).
- **`RP-14`** — La quantité en stock affichée à l'atelier ou au comptoir est la quantité **physique
  moins les réservations actives** (§5.4) — jamais la quantité physique brute, qui mentirait sur ce
  qui est réellement disponible pour un nouveau besoin.
- **`RP-15`** — Un stock ne devient jamais négatif par une opération normale (sortie, vente). Une
  sortie qui dépasserait le stock disponible est **bloquée**, sauf **forçage explicite et journalisé**
  par un rôle habilité **(P)** — le cas réel existe (compteur informatique faux, pièce retrouvée
  après une casse déclarée par erreur) mais reste l'exception qui doit se voir.

**5.3 Les mouvements (`RP-16` → `RP-18`)**

- **`RP-16`** — Tout mouvement de stock est de l'un des types : `entree_livraison` (réception
  fournisseur), `sortie_or` (consommée par un OR), `sortie_comptoir` (vendue au comptoir sans OR),
  `retour_fournisseur`, `retour_client` (pièce vendue puis rapportée), `transfert` (entre sites,
  `RP-13`), `ajustement_inventaire` (écart constaté au comptage), `casse`, `perte`,
  `retour_consigne` (retour de la vieille pièce d'un échange standard, `RP-21`). Cette liste est
  **extensible** (même doctrine que `blocage_ligne_or` ou `entite_auditee` : ajouter une valeur ne
  casse rien qui lise l'enum en s'attendant à une liste fermée).
- **`RP-17`** — Chaque mouvement porte : article, site, quantité (signée : positive à l'entrée,
  négative à la sortie), date, auteur, référence de la pièce justificative si elle existe (commande
  fournisseur, OR, document de vente comptoir, inventaire), et un motif texte libre pour `casse` et
  `perte` (obligatoire, jamais une sortie de stock silencieuse sur ces deux types).
- **`RP-18`** — Chaque mouvement est **audité** au sens du dépôt (qui, quoi, quand, avant/après —
  `CONTRIBUTING.md`, entités sensibles). Un mouvement, une fois enregistré, n'est **jamais modifié ni
  supprimé** : une correction se fait par un **mouvement inverse** tracé, jamais par une édition en
  place — même doctrine que la chaîne documentaire de facturation (devis→facture→avoir immuable).

**5.4 La réservation (`RP-19` → `RP-25`)**

C'est le cœur du sujet — et ce que les DMS existants ratent le plus souvent : le lien pièce ↔ OR y
reste **physique** (une étagère, un nom écrit au marqueur), pas informatique, précisément parce que
le logiciel ne le représente pas correctement.

- **`RP-19`** — Dès qu'une ligne d'OR de type `piece` référence un `articleId` avec une quantité, une
  **réservation** est créée pour ce couple (article, OR, ligne). Cette réservation **retire** la
  quantité correspondante du stock **disponible** (`RP-14`) même si aucun mouvement physique n'a
  encore eu lieu — c'est l'écart entre stock physique et stock disponible qui rend visible « cette
  pièce existe en stock mais n'est plus libre ».
- **`RP-20`** — Une pièce fournie par le client (`ligne_or.fourniParClient = true`) ne crée
  **aucune** réservation ni mouvement de stock (§2, dernier point) : elle ne touche jamais
  l'`article` du garage, même si elle porte la même référence qu'un article existant.
- **`RP-21`** — La réservation ne devient un **mouvement de sortie réel** (`sortie_or`) qu'au moment
  où la pièce quitte physiquement le magasin — en pratique, quand le magasinier la remet au
  technicien, pas quand la ligne d'OR est créée. Entre les deux, la réservation existe sans
  mouvement : c'est l'état normal d'une pièce commandée mais pas encore posée.
- **`RP-22`** — Une réservation ne peut être satisfaite (donner lieu à une sortie) que sur le
  **même site** que l'OR, ou après un transfert explicite (`RP-13`) — jamais en piochant à distance
  sur le stock d'un autre site sans que ce transfert soit tracé.
- **`RP-23`** — Une réservation est **libérée** (rendue au stock disponible) dans exactement trois
  cas : la ligne d'OR est annulée, la ligne d'OR est refusée par le client (décision de devis
  complémentaire `refuse`, `DECISIONS_DEVIS`), ou le magasinier la libère explicitement avec un
  motif (l'OR traîne, la pièce est retenue captive pour rien, une urgence sur un autre OR justifie
  de la réaffecter). Le troisième cas est journalisé, avec avertissement si l'OR n'est ni annulé ni
  refusé — reprendre une pièce sur un OR encore actif est une décision, pas un geste anodin.
- **`RP-24`** — Une ligne pièce sans réservation possible (rupture de stock **et** pas de commande
  fournisseur en cours) doit porter `blocage = 'pieces'` sur la ligne d'OR — ce qui fait passer
  `attente_pieces` à `true` sur l'OR **via le mécanisme existant** (§2), sans code nouveau côté
  atelier. Dès qu'une commande fournisseur est passée pour couvrir cette ligne, le blocage
  **reste** actif (la pièce n'est toujours pas là) mais porte désormais une **date d'arrivée
  annoncée** consultable depuis l'OR — c'est cette date qui permet à l'atelier de décider du choix
  A/B de `P-27`.
- **`RP-25`** — Le module pièces **informe**, l'atelier **décide** : ce module ne déclenche jamais
  lui-même la fermeture d'un OR ni l'ouverture d'un OR de suite (`motif_lien = 'suite'`, `RM-57`).
  Il expose la disponibilité, le délai annoncé, et laisse le réceptionnaire ou le chef d'atelier
  choisir, comme le prévoit déjà §6.7 de la spec étape 1.

**5.5 La commande fournisseur (`RP-26` → `RP-31`)**

- **`RP-26`** — Une commande fournisseur porte un fournisseur, une date, 0..n lignes (article,
  quantité commandée, prix d'achat attendu), et un statut (§6.2). Elle peut naître de trois façons :
  manuelle (le magasinier commande ce qui manque), depuis une réservation en rupture (`RP-24`), ou
  depuis la liste de réapprovisionnement (`RP-12`, seuil franchi).
- **`RP-27`** — Une commande fournisseur peut être **reçue partiellement** : chaque réception
  enregistre les quantités effectivement livrées par ligne, génère un mouvement `entree_livraison`
  pour ces quantités, et laisse un **reliquat** (quantité commandée moins quantité déjà reçue au
  cumul) sur la ligne. La commande reste ouverte tant qu'il existe un reliquat non soldé.
- **`RP-28`** — Un reliquat peut être **soldé** de deux façons : livraison ultérieure du fournisseur
  (le cas normal), ou **annulation explicite** du reliquat avec motif (le fournisseur ne livrera
  plus, remplacé par une autre commande ou une référence équivalente) — jamais une disparition
  silencieuse du reliquat par simple clôture de la commande.
- **`RP-29`** — Le prix payé à réception peut différer du prix attendu à la commande (variation
  tarifaire fournisseur, remise appliquée au dernier moment). L'écart est enregistré sur le
  mouvement d'entrée, pas corrigé rétroactivement sur la ligne de commande d'origine — la commande
  reste la trace de ce qui a été demandé, le mouvement la trace de ce qui a été effectivement livré
  et payé.
- **`RP-30`** — Un **retour fournisseur** (pièce reçue en trop, erreur de référence, pièce
  défectueuse à réception) est un mouvement `retour_fournisseur`, lié à la commande d'origine s'il
  en existe une, avec motif. Il diminue le stock ; l'avoir fournisseur correspondant (s'il existe)
  est hors périmètre de ce module (relève de la comptabilité du garage, pas de DFA — `RF-101`).
- **`RP-31`** — La commande fournisseur et le mouvement de stock sont des entités auditées au sens
  du dépôt (`CONTRIBUTING.md`) — voir la remarque de §2 sur l'extension nécessaire de `entite_auditee`.

**5.6 Le prix (`RP-32` → `RP-36`)**

- **`RP-32`** — Tout montant est en **centimes entiers**, jamais de nombre à virgule flottante —
  aucune exception pour les pièces (règle n°1 du dépôt sur l'argent).
- **`RP-33`** — Un article porte un **prix d'achat** (dernier prix connu ou prix moyen — **[À
  VALIDER, `QP-04`]**, ce module ne tranche pas seul entre dernier prix et prix moyen pondéré, c'est
  une question de pratique comptable du garage) et un **prix de vente TTC** — cohérence stricte avec
  l'arbitrage déjà tranché en facturation : **les prix sont saisis et affichés TVA comprise**, pas
  HT + TVA ajoutée à l'écran (`RF-6`/`A1` de la spec étape 2).
- **`RP-34`** — La **marge** (prix de vente HT moins prix d'achat HT, ou en %) est une donnée de
  gestion consultable par les rôles qui voient les montants (§11) — jamais affichée au comptoir
  client, jamais imprimée sur un document remis au client.
- **`RP-35`** — Une **remise fournisseur** (rabais négocié sur le prix catalogue, ristourne de fin
  d'année) est enregistrée au niveau du fournisseur ou de la ligne de commande, et vient réduire le
  prix d'achat effectif du mouvement d'entrée (`RP-29`) — elle ne modifie jamais le prix de vente
  client, qui suit ses propres règles de rabais (`RM-07`).
- **`RP-36`** — Le taux de TVA applicable à une ligne de pièce est **figé à la création de la ligne
  d'OR ou du document de vente comptoir**, exactement comme toute autre ligne (même doctrine que
  `ligne_or.tauxTvaPourmille`, déjà `notNull` avec figeage — `RM-65` de la spec étape 1). Un
  changement de taux TVA légal ne modifie jamais une ligne déjà créée.

**5.7 La consigne — échange standard (`RP-37` → `RP-42`)**

Ce paragraphe **débloque `RF-100`** (spec étape 2, marquée non résolue sur trois questions de
terrain, §13 `QP-05` à `QP-07`) : le métier pièces sait ce qui se passe physiquement, la facturation
en découle.

- **`RP-37`** — Un article d'échange standard (alternateur, démarreur, injecteur, turbo, boîte de
  vitesses reconditionnés) porte un **montant de consigne** distinct de son prix de vente — un
  dépôt de garantie, pas un prix d'achat de pièce supplémentaire.
- **`RP-38`** — À la pose, la ligne d'OR facture **le prix de la pièce et la consigne comme deux
  montants distincts** (déjà anticipé par `ligne_or.aRestituer` en base) — `RF-100` confirme déjà
  que la consigne se facture sur la facture initiale, remboursée par avoir partiel au retour. Ce
  module ajoute le mouvement de stock qui accompagne cette écriture : la vieille pièce déposée par
  le client est **elle-même réceptionnée en stock**, sous un statut distinct (« en attente de
  retour fournisseur », pas un article vendable) — c'est un mouvement d'entrée particulier, pas un
  simple encaissement.
- **`RP-39`** — Le retour de la vieille pièce au fournisseur de l'échange standard est un mouvement
  `retour_consigne`, distinct de `retour_fournisseur` (`RP-30`) parce qu'il ne solde pas une
  commande d'achat mais un dépôt de garantie — la distinction compte pour la traçabilité, pas pour
  le calcul.
- **`RP-40`** — La restitution de la vieille pièce par le client déclenche l'avoir partiel côté
  facturation (`RF-100`) **et** le mouvement `retour_consigne` côté stock — les deux dans le même
  geste au comptoir, jamais l'un sans l'autre (sinon la consigne rendue en caisse sans la pièce
  physique, ou la pièce physique reprise sans le geste financier, sont deux anomalies réelles que le
  système doit rendre visibles s'il en manque une).
- **`RP-41`** — **[À VALIDER — `QP-07`, reprise de la question déjà ouverte en `RF-100`]** — quand
  le client ne rend jamais la vieille pièce et ne la réclame pas non plus, la consigne reste acquise
  au garage. Ce module ne tranche pas **qui** décide de ce point de non-retour ni **au bout de
  combien de temps** — mais propose qu'il s'agisse d'une action explicite et journalisée (jamais un
  job silencieux qui solde une consigne tout seul après N jours), avec N **paramétrable** (`PP-06`)
  si la pratique confirme qu'un délai existe.
- **`RP-42`** — Le taux de TVA de la consigne suit celui de la pièce elle-même (hypothèse de
  `RF-100` : taux normal 8.1 %) — **[À VALIDER fiscalement, `QP-06`, déjà ouvert en `RF-100`]**, ce
  module ne fait qu'hériter de l'hypothèse posée côté facturation, il ne la referme pas.

**5.8 La pièce vendue au comptoir, sans OR (`RP-43` → `RP-48`)**

- **`RP-43`** — Une vente comptoir est un `document_vente` (facturation, type `facture` dans le cas
  usuel du paiement immédiat) **sans OR associé**, avec ses propres lignes de type pièce. Ce module
  ne crée pas un second mécanisme de ligne : la ligne de vente comptoir consomme le même `articleId`
  et déclenche le même mouvement `sortie_comptoir` (§5.3) qu'une réservation déclencherait
  `sortie_or`.
- **`RP-44`** — Le client d'une vente comptoir peut être un **client identifié** (fiche existante,
  historique, conditions commerciales) ou un **client de passage** — **[À VALIDER, `QP-08`]** :
  hypothèse posée, une fiche minimale (nom, éventuellement rien de plus) est créée si le client
  souhaite une facture nominative (garantie, note de frais professionnelle) ; sinon un ticket de
  caisse anonyme suffit et aucune fiche client n'est créée pour un achat ponctuel de quelques francs.
- **`RP-45`** — Le paiement d'une vente comptoir est **encaissé au moment de la vente**, exactement
  comme le prévoit déjà le droit `ENCAISSEMENT_PAIEMENT` du magasinier (§2). Une vente comptoir
  **non payée sur place** (compte ouvert d'un client entreprise, garage voisin qui dépanne une
  pièce et règle en fin de mois) suit le circuit normal de facturation à crédit — ce module ne
  distingue pas un « mode comptoir » particulier du côté facturation, seulement du côté stock
  (absence d'OR).
- **`RP-46`** — Une pièce vendue au comptoir peut être **retournée** par le client (défectueuse,
  erreur de référence, pièce finalement pas montée). Le retour génère un mouvement `retour_client`
  et un avoir (total ou partiel) sur le document de vente d'origine — même chaîne d'immuabilité que
  toute facturation (`RF-xx` de l'étape 2) : on ne modifie jamais la facture émise, on émet un
  avoir.
- **`RP-47`** — **Tension à trancher, pas à cette étape mais explicitement signalée** : le
  magasinier peut créer et encaisser une vente comptoir (brouillon + encaissement, droits déjà
  accordés) mais **ne peut pas l'émettre** (`EMISSION_FACTURE` l'exclut, §2). Sur un comptoir tenu
  seul par un magasinier sans réceptionnaire ni vendeur à proximité, ce chaînon manque pour un achat
  de quelques francs. Ce document **ne modifie pas** la matrice de droits — c'est au lead
  backend/expert-auth de statuer, avec la question posée en clair en `QP-09`.
- **`RP-48`** — Le taux de TVA d'une vente comptoir suit les mêmes règles que toute ligne de pièce
  (`RP-36`) : figé à la création, TTC affiché.

---

6. Machines à états

---

**6.1 L'article**

```
        ┌──────────┐   marquage manuel    ┌───────────┐
        │  actif   │ ────────────────────▶ │ obsolète  │
        └──────────┘   (réf. remplaçante   └───────────┘
             │           conseillée,             │
             │           RP-04)                  │
             │ historique/mouvement existant       │ idem : jamais de suppression
             ▼                                    ▼
        (désactivation, jamais de suppression physique — RP-07)
```

Pas de machine à états complexe pour l'article lui-même : `actif` ↔ `obsolète` ↔ `désactivé`, les
trois réversibles sauf que `désactivé` exige l'absence de mouvement récent en cours (réservation
active) — **[À VALIDER, seuil exact, `QP-02`]**.

**6.2 La commande fournisseur**

```
brouillon ──▶ envoyee ──▶ partiellement_recue ──▶ recue ──▶ cloturee
                 │               │                              ▲
                 │               └──────────────────────────────┘
                 │                  (reliquat soldé, RP-27/28)
                 ▼
              annulee   (avant toute réception ; après réception partielle,
                          seul le reliquat s'annule, RP-28 — la commande
                          elle-même passe à `cloturee`, jamais `annulee`
                          une fois qu'une réception a eu lieu)
```

- `brouillon → envoyee` : le magasinier envoie la commande (mail, portail, téléphone tracé).
- `envoyee → partiellement_recue` : au moins une ligne reçue, au moins un reliquat non nul.
- `envoyee → recue` : réception complète en un seul geste.
- `partiellement_recue → recue` : le reliquat est soldé par livraison (`RP-27`).
- `partiellement_recue → cloturee` : le reliquat restant est annulé explicitement (`RP-28`), pas
  livré.
- `recue → cloturee` : rapprochement final (facture fournisseur reçue, écarts de prix acceptés,
  `RP-29`) — **[À VALIDER : cette étape existe-t-elle réellement comme geste distinct du
  magasinier, ou `recue` et `cloturee` sont-elles la même chose en pratique, `QP-10`]**.

**6.3 La réservation (état dérivé, pas une table séparée nécessairement — voir §8)**

```
active ──▶ satisfaite (mouvement sortie_or généré, RP-21)
   │
   └──▶ liberee (ligne annulée/refusée, ou geste explicite du magasinier, RP-23)
```

Une réservation `active` retire la quantité du stock disponible (`RP-14`). `satisfaite` et
`liberee` sont toutes deux terminales et ne retirent plus rien.

**6.4 La vieille pièce d'un échange standard (consigne)**

```
deposee_par_client ──▶ en_attente_retour_fournisseur ──▶ retournee_fournisseur
        (RP-38)                                                (RP-39)
```

Parallèle, côté facturation : `consigne_facturee` (`RF-100`) → `consigne_remboursee` (avoir
partiel, déclenché par le même geste que `retournee_fournisseur`, `RP-40`) — ou reste
`consigne_facturee` indéfiniment si la vieille pièce n'est jamais rendue (`RP-41`).

---

7. Les cas tordus

---

**7.1 La pièce facturée puis retournée, l'avoir partiel**

**Scénario** : un client achète 4 plaquettes de frein au comptoir, s'aperçoit une fois rentré qu'il
s'est trompé de côté (avant/arrière), revient le lendemain avec les plaquettes non montées et le
ticket.

**Traitement attendu** : mouvement `retour_client` (`RP-46`) pour les 4 plaquettes, stock repris ;
avoir sur le document de vente comptoir d'origine — total si les 4 sont rendues, partiel si 2 sont
déjà montées et 2 rendues. Le prix de vente TTC repris est **celui du document d'origine**, jamais
recalculé au tarif du jour (même principe que toute correction en facturation : on ne modifie pas un
document émis, on émet un avoir dessus).

**7.2 Deux OR concurrents demandent la même pièce en stock 1**

**Scénario** : il reste 1 disque de frein en stock. L'OR-1042 (ouvert ce matin) et l'OR-1043 (ouvert
il y a 5 minutes) réclament chacun 1 disque de la même référence.

**Traitement attendu** : la première ligne créée obtient la réservation (`RP-19`), la seconde voit
immédiatement un stock disponible de 0 (`RP-14`) et bascule en `blocage = 'pieces'` — **pas** une
course silencieuse où les deux lignes croient chacune avoir la pièce jusqu'à ce que le magasinier
s'en aperçoive physiquement au comptoir. C'est exactement le défaut que `RP-14`/`RP-19` existent
pour empêcher.

**7.3 Le véhicule (et son OR) annulé après la commande de la pièce**

**Scénario** : une pièce spéciale, non standard, est commandée pour un OR. Avant son arrivée, le
client vend son véhicule ou annule l'intervention.

**Traitement attendu** : l'annulation de l'OR ou de la ligne libère la réservation (`RP-23`,
premier cas). La commande fournisseur, elle, **ne s'annule pas automatiquement** — le reliquat est
toujours attendu, et une pièce spéciale n'est en général pas reprise par le fournisseur. Le
magasinier doit être **averti** que la pièce en cours de commande n'a plus de destination (liste des
« réservations libérées avec commande encore ouverte »), pas laissé à découvrir l'anomalie quand le
carton arrive.

**7.4 Pièce reçue en trop, ou référence différente de la commande**

**Scénario** : le fournisseur livre 6 filtres à huile alors que 4 étaient commandés (erreur de
préparation), ou livre la bonne quantité mais avec une référence légèrement différente de celle
commandée (le fournisseur a substitué une équivalente sans prévenir).

**Traitement attendu** : le magasinier saisit ce qui est **effectivement livré**, pas ce qui était
commandé — la quantité en trop (`RP-30`, retour fournisseur si le magasinier la renvoie, ou entrée
de stock assumée si le garage la garde et la paie) ; la substitution de référence est acceptée
seulement si l'article livré est reconnu comme référence équivalente (`RP-02`) de celui commandé,
sinon le magasinier crée l'écart en anomalie de réception plutôt que de forcer une correspondance
fausse.

**7.5 Vente comptoir à un autre garage (dépannage entre confrères)**

**Scénario**, courant dans le métier : un garage voisin manque d'une pièce, appelle, envoie
quelqu'un la chercher, règle en fin de mois sur facture groupée.

**Traitement attendu** : c'est une vente comptoir (`RP-43`) à un client de type `entreprise` (le
garage tiers), avec conditions de paiement à crédit — aucune règle nouvelle, le mécanisme client
entreprise de l'étape 1 (`RM-01`, `RM-07`) et la vente comptoir (§5.8) suffisent ensemble.

**7.6 Inventaire avec écart, et la question de qui décide**

**Scénario** : le comptage physique annuel trouve 3 turbos en stock théorique, 2 en rayon. L'écart
peut être une casse jamais déclarée, un vol, une erreur de saisie ancienne, ou une pièce sortie sans
mouvement enregistré (le fameux lien « physique, pas informatique » du tableau blanc).

**Traitement attendu** : un mouvement `ajustement_inventaire` corrige le stock théorique vers le
compté, avec motif obligatoire et auteur — mais l'écart lui-même (qui a coûté combien) est une
information de gestion qui remonte à la direction, **pas** absorbée silencieusement par
l'ajustement. Un ajustement sur un article de valeur significative **(P)** devrait déclencher un
avertissement à la validation, pas seulement une écriture discrète — **[À VALIDER : seuil et
fréquence réelle de l'inventaire pratiqué, `QP-11`]**.

**7.7 La pièce consignée jamais rendue, définitivement**

Déjà couvert en `RP-41` — repris ici comme cas tordu parce qu'il touche trois modules à la fois :
stock (la vieille pièce reste indéfiniment « en attente de retour »), facturation (la consigne reste
facturée, jamais remboursée), et client (aucune règle ne force jamais un client à rendre une pièce).
Le système doit pouvoir **afficher** une liste de consignes non soldées après N jours **(P)**, sans
jamais les solder tout seul.

---

8. Modèle de données métier (conceptuel)

---

Volontairement **sans DDL** — c'est le rôle d'expert-database, pas de cette spécification. Entités
et relations attendues :

- **`article`** — référentiel pièce, par tenant. Porte désignation, marque, catégorie, référence
  principale, prix d'achat, prix de vente TTC, statut (actif/obsolète/désactivé).
- **`article_reference`** — 0..n par article : référence alternative typée (`RP-02`).
- **`stock_article`** — par (tenant, article, site) : quantité physique, emplacement, stock minimum,
  quantité de commande standard.
- **`mouvement_stock`** — trace chaque variation de `stock_article`, immuable (`RP-16` à `RP-18`),
  référence optionnelle vers `ligne_or`, `document_vente_ligne`, `commande_fournisseur_ligne`, ou
  `inventaire`.
- **`reservation_piece`** — lien (tenant, article, site, `ligne_or`), état actif/satisfaite/libérée
  (§6.3). **[À VALIDER par expert-database]** : pourrait n'être qu'un état dérivé de `ligne_or`
  (comme `attente_pieces` l'est déjà pour l'OR) plutôt qu'une table séparée — décision de
  conception hors du périmètre métier de ce document, mais la **sémantique** (§5.4) doit être
  respectée quel que soit le choix technique.
- **`fournisseur`** — minimal pour l'étape 3 (§1) : nom, coordonnées, délai habituel.
- **`commande_fournisseur`** / **`commande_fournisseur_ligne`** — §5.5, §6.2.
- **`consigne_echange_standard`** — lien entre la ligne d'OR de dépose, le montant de consigne, et
  l'état de la vieille pièce (§6.4) — pourrait aussi être porté directement par des colonnes sur
  `ligne_or`/`mouvement_stock` plutôt qu'une table dédiée, même remarque de conception que
  `reservation_piece`.

---

9. Contexte suisse

---

- **TVA** — le taux applicable à une pièce est en général le **taux normal (8.1 %)** : une pièce
  détachée montée dans le cadre d'une réparation automobile n'entre pas dans les catégories à taux
  réduit (2.6 %, biens de première nécessité) ni à taux spécial hébergement (3.8 %). **[À VALIDER,
  `QP-12`]** : je ne connais pas de cas où une pièce automobile bénéficierait d'un taux différent,
  mais je ne l'affirme pas comme certitude fiscale — à confirmer avec la fiduciaire du garage
  pilote, comme `QF-06`/`QF-18` de la spec étape 2 le font déjà pour des points voisins (taxes de
  recyclage).
- **Prix TTC** — cohérence stricte avec l'arbitrage A1 déjà tranché en facturation (`RP-33`) : un
  magasinier suisse annonce et affiche un prix TVA comprise, jamais un prix HT à charger de TVA au
  comptoir.
- **Montants en centimes** — aucune exception pour les pièces (`RP-32`).
- **Importation** — une pièce importée (achetée hors Suisse par le garage lui-même, cas du
  fournisseur allemand frontalier ou de la commande directe constructeur depuis un pays voisin) peut
  porter une TVA à l'import déjà réglée en douane, distincte de la TVA facturée au client suisse.
  **Hors périmètre de ce module** : c'est un sujet d'achat/import du garage, pas de vente au client
  — à ne pas confondre avec `RM-27` de l'étape 1 (véhicule importé), qui est un sujet totalement
  différent malgré le mot commun.
- **QR-facture** — aucune règle spécifique aux pièces : une vente comptoir facturée à crédit suit le
  même mécanisme de facturation/QR-facture que toute autre facture du garage (`RF-5x` et suivants de
  la spec étape 2), ce module n'en crée pas un second circuit.

---

10. Ce qui doit être paramétrable

---

- `PP-01` / Stock d'un site visible en lecture depuis les autres sites (`RP-10`) / tenant / oui, lecture seule
- `PP-02` / Blocage strict du stock négatif, ou forçage possible (`RP-15`) / tenant / blocage, forçage journalisé réservé à un rôle habilité
- `PP-03` / Prix d'achat retenu : dernier prix connu ou moyenne pondérée (`RP-33`) / tenant / **à trancher avec @laupernoe, `QP-04`**
- `PP-04` / Conditionnement = article distinct, ou unité de vente/stock séparées (`RP-05`) / tenant / article distinct
- `PP-05` / Délai avant qu'un ajustement d'inventaire significatif déclenche un avertissement (`§7.6`) / tenant / **à définir, aucune valeur avancée sans donnée réelle**
- `PP-06` / Délai avant qu'une consigne non retournée puisse être proposée comme acquise (`RP-41`) / tenant / **aucune valeur avancée — dépend de `QP-07`**
- `PP-07` / Taux de TVA appliqué à la consigne (`RP-42`) / tenant / 8.1 % — hérite de l'hypothèse `RF-100`, à confirmer fiscalement
- `PP-08` / Seuil de stock minimum et quantité de commande standard (`RP-12`) / par (article, site) / saisi pièce par pièce, pas de valeur globale

---

11. Matrice rôle × action

---

Cohérence stricte avec `apps/api/src/auth/matrice-droits.ts` — ce tableau **décrit** les actions
attendues sur le nouveau périmètre pièces, il ne prétend pas fixer la syntaxe des `Action` qui sera
choisie à l'implémentation (rôle d'expert-auth/expert-api).

- Consulter article/stock / oui / oui / oui / oui / oui / oui / oui (sans prix d'achat/marge, cf. `RF-116` pour le principe) / non (RF-115, aucun droit métier)
- Voir prix d'achat / marge / oui / oui / non **(P)** / non **(P)** / oui **(P)** / oui / non / non
- Créer/modifier un article / oui / non / non / non / oui **[À VALIDER]** / oui / non / non
- Créer une réservation (ligne d'OR pièce) / oui / non / non / oui / oui / oui / oui (`L966_LIGNE_CREATION` déjà accordé, RM existant) / non
- Libérer une réservation active (`RP-23`, 3ᵉ cas) / oui / non / non / non / oui / oui / non / non
- Enregistrer une entrée (réception livraison) / non **(P)** / non / non / non / non **(P)** / oui / non / non
- Enregistrer une sortie (`sortie_or`, `sortie_comptoir`) / non **(P)** / non / non / non / non **(P)** / oui / non / non
- Créer / envoyer une commande fournisseur / oui / non / non / non / oui / oui / non / non
- Réceptionner une commande (partielle ou complète) / non **(P)** / non / non / non / non **(P)** / oui / non / non
- Faire l'inventaire / saisir un ajustement / oui / non / non / non / oui / oui / non / non
- Valider un ajustement significatif (§7.6) / oui / non / non / non / oui **(P)** / non / non / non
- Vente comptoir — brouillon / oui / oui / oui / oui / oui / oui / non / non
- Vente comptoir — encaisser / oui / oui / oui / oui / non (`RF-114`, chef d'atelier exclu de l'encaissement) / oui / non / non
- Vente comptoir — émettre / oui / oui / oui / oui / non / **non — voir `RP-47`/`QP-09`** / non / non
- Avoir sur retour comptoir / oui / oui / non / oui / non / non / non / non

---

12. Cas de test métier

---

- **`CP-01`** — Recherche par référence fournisseur qui diffère de la référence OEM. Contexte : un
  article existe avec référence OEM `03L 115 561 H`, et une référence alternative `HU 719/7x` (Mann
  Filter, `equivalente`). Action : recherche `HU 719/7x`. Attendu : la fiche article unique
  s'affiche, jamais de doublon créé. (`RP-02`, `RP-03`)
- **`CP-02`** — Deux OR concurrents sur le dernier exemplaire. Contexte : stock 1 disque de frein
  réf. X. OR-1042 crée une ligne pièce à 10h00 pour cette référence, réservation active. Action :
  OR-1043 crée une ligne pièce pour la même référence à 10h05. Attendu : la ligne d'OR-1043 voit un
  stock disponible de 0, passe `blocage = 'pieces'` immédiatement, `attente_pieces = true` sur
  OR-1043 (mécanisme existant). (`RP-14`, `RP-19`, §7.2)
- **`CP-03`** — Réservation libérée par annulation de ligne. Contexte : ligne pièce réservée sur
  OR-1050 (stock disponible passé à 0 pour cette référence). Action : la ligne est annulée. Attendu :
  la réservation passe `liberee`, le stock disponible remonte à 1 immédiatement, consultable par un
  autre OR. (`RP-23`)
- **`CP-04`** — Réception partielle et reliquat. Contexte : commande fournisseur de 10 filtres à
  huile envoyée. Action : réception de 6 filtres. Attendu : mouvement `entree_livraison` de 6,
  commande passe `partiellement_recue`, reliquat de 4 consultable, stock disponible augmente de 6.
  (`RP-27`, §6.2)
- **`CP-05`** — Reliquat soldé par annulation. Contexte : reliquat de 4 filtres (`CP-04`), le
  fournisseur informe qu'il ne pourra plus livrer cette référence (arrêt de production). Action :
  le magasinier annule le reliquat avec motif « fournisseur — arrêt de production ». Attendu : la
  ligne de commande passe reliquat à 0 sans mouvement de stock supplémentaire, la commande passe
  `cloturee`, le motif et l'auteur sont journalisés. (`RP-28`)
- **`CP-06`** — Consigne facturée puis retour de la vieille pièce (prouve aussi `RF-100`/`CF-25` côté
  facturation). Contexte : alternateur échange standard posé sur OR-1060, consigne 162.15 TTC
  facturée avec la facture initiale, mouvement d'entrée de la vieille pièce en statut
  `en_attente_retour_fournisseur`. Action : trois semaines plus tard, le fournisseur reprend la
  pièce. Attendu : mouvement `retour_consigne` généré, avoir partiel de 162.15 TTC émis sur la
  facture d'origine (symétrie d'arrondi `MD-40` déjà prouvée par `CF-25`), les deux gestes liés dans
  la même opération de comptoir. (`RP-38` → `RP-40`)
- **`CP-07`** — Pièce fournie par le client, aucun mouvement de stock. Contexte : ligne d'OR de type
  `piece`, `fourniParClient = true`, sans `articleId` (ou avec un `articleId` renseigné pour
  traçabilité mais sans conséquence de stock — **[À VALIDER par expert-database selon le choix de
  modélisation]**). Action : la ligne est réalisée. Attendu : aucun mouvement de stock généré, aucune
  réservation créée, le stock de l'article correspondant (s'il existe côté garage) reste inchangé.
  (`RP-20`)
- **`CP-08`** — Vente comptoir à un client de passage, retour le lendemain. Contexte : vente comptoir
  de 4 plaquettes de frein, ticket émis, aucune fiche client créée (`RP-44`, hypothèse). Action : le
  client revient le lendemain avec 2 plaquettes non montées et le ticket, demande un remboursement
  partiel. Attendu : mouvement `retour_client` de 2 unités, avoir partiel émis sur le document de
  vente d'origine au prix unitaire d'origine (pas celui du jour), stock des 2 plaquettes repris.
  (`RP-46`, §7.1)
- **`CP-09`** — Transfert entre sites. Contexte : stock 0 à Genève, stock 3 à Lausanne pour une
  référence donnée, OR ouvert à Genève. Action : le magasinier de Genève transfère 1 unité depuis
  Lausanne. Attendu : un mouvement unique `transfert` (pas deux mouvements indépendants), stock
  Lausanne −1, stock Genève +1, traçable comme une seule opération liée. (`RP-13`)
- **`CP-10`** — Ajustement d'inventaire avec écart. Contexte : stock théorique 3 turbos, comptage
  physique 2. Action : le magasinier saisit l'ajustement avec motif. Attendu : mouvement
  `ajustement_inventaire` de −1, motif et auteur journalisés, écart signalé à la direction si le
  seuil de valeur significative est dépassé (paramètre `PP-05`, non chiffré tant que la pratique
  réelle n'est pas connue). (§7.6)

---

13. Questions ouvertes à poser à @laupernoe

---

Formulées pour un garagiste ou pour un accès direct aux systèmes existants — pas pour un
développeur.

- **`QP-01`** — Sur un garage à plusieurs sites, un magasinier voit-il aujourd'hui le stock de
  l'autre site depuis son propre poste (Auto-i/Nextlane) ? S'il en a besoin, comment fait-il
  aujourd'hui — coup de fil, tableau partagé, rien du tout ? Ça détermine si `RP-10` (visibilité en
  lecture par défaut) correspond à une vraie pratique ou si c'est une fausse bonne idée qui n'existe
  nulle part sur le terrain. _(À observer chez un garage multi-sites du parc, ou à demander
  directement à un magasinier qui travaille sur plusieurs sites.)_
- **`QP-02`** — À partir de quel signal un magasinier considère-t-il qu'un article ne bouge plus et
  peut être désactivé — plus aucune vente depuis N mois ? Une décision manuelle uniquement ? Ce
  point conditionne si une liste « articles dormants » a de la valeur dès l'étape 3 ou peut
  attendre. _(À demander à un magasinier — regarder s'il existe déjà un rapport de ce type dans
  Auto-i/Nextlane que le garage consulte ou ignore.)_
- **`QP-03`** — Quand un fournisseur change le conditionnement d'une pièce (l'unité devient
  vendue par lot de 2, ou l'inverse), comment le garage gère-t-il ça aujourd'hui dans son DMS actuel
  — un nouvel article, ou une modification de l'article existant qui casse l'historique de prix ?
  Détermine si `RP-05` (conditionnement = article distinct) est la bonne hypothèse. _(À vérifier
  dans Auto-i/Nextlane : chercher un article qui a visiblement changé de conditionnement dans
  l'historique et voir comment c'est tracé, ou son absence.)_
- **`QP-04`** — Le prix d'achat retenu pour calculer une marge est-il le **dernier prix payé**, ou
  une **moyenne pondérée** sur plusieurs livraisons à des prix différents ? C'est une question
  comptable autant que métier — la réponse peut varier selon la fiduciaire. _(À demander à la
  fiduciaire du premier garage autant qu'au magasinier — voir si Auto-i/Nextlane affiche une seule
  valeur de "prix d'achat" par article ou une historique de prix.)_
- **`QP-05`** — Les garages du parc pratiquent-ils réellement l'échange standard avec consigne
  (alternateurs, démarreurs, injecteurs, turbos, boîtes) ? Si oui, sur quel volume — occasionnel ou
  plusieurs fois par semaine ? _(Question déjà ouverte côté facturation `RF-100` — la réponse
  conditionne si tout `§5.7` de ce document mérite d'être construit dès l'étape 3 ou peut être
  différé. À demander directement en atelier : « vous posez des pièces en échange standard, et vous
  facturez une consigne ? »)_
- **`QP-06`** — La consigne d'un échange standard est-elle soumise à TVA au taux normal (8.1 %),
  comme une livraison ordinaire ? _(Question fiscale, déjà ouverte en `RF-100` — à croiser avec une
  fiduciaire plutôt qu'avec un magasinier.)_
- **`QP-07`** — Que se passe-t-il concrètement quand un client ne rend jamais la vieille pièce et ne
  la réclame pas non plus — le garage encaisse la consigne définitivement au bout de combien de
  temps, et qui en décide ? _(Déjà ouverte en `RF-100` — à demander à un magasinier ou au chef
  d'atelier : « ça arrive qu'un client ne ramène jamais le vieux moteur/turbo, vous faites quoi de
  la consigne ? »)_
- **`QP-08`** — Un client qui achète une pièce au comptoir pour quelques francs (ampoule, balai
  d'essuie-glace) obtient-il systématiquement une fiche client, ou un ticket anonyme suffit-il ? Y
  a-t-il un seuil de montant à partir duquel une fiche devient obligatoire (garantie, TVA, note de
  frais professionnelle) ? _(À observer directement au comptoir d'un garage du parc, ou à demander
  au magasinier : « le client qui prend une ampoule et repart, il est dans le système ou pas ? »)_
- **`QP-09`** — Sur un comptoir tenu seul (pas de réceptionnaire ni de vendeur à proximité), le
  magasinier a-t-il aujourd'hui la main pour émettre lui-même une facture comptoir de faible
  montant, ou fait-il systématiquement valider par quelqu'un d'autre ? Ça détermine si `RP-47` doit
  rester une tension à trancher en aval, ou si la matrice de droits doit évoluer dès l'étape 3.
  _(À observer un jour de comptoir seul dans un garage du parc, ou à demander directement au
  magasinier.)_
- **`QP-10`** — Une fois qu'une commande fournisseur est entièrement reçue, y a-t-il un geste de
  rapprochement distinct (vérifier la facture fournisseur reçue contre le bon de commande) avant de
  considérer la commande vraiment terminée, ou la réception complète suffit-elle en pratique ?
  Détermine si `recue` et `cloturee` (§6.2) doivent rester deux états distincts. _(À demander au
  magasinier : « une fois que tout est arrivé, il se passe encore quelque chose avant que ce soit
  vraiment fini pour vous ? »)_
- **`QP-11`** — À quelle fréquence l'inventaire est-il réellement pratiqué — inventaire complet
  annuel, comptage tournant sur les références à forte valeur, jamais formellement fait ? Sur quelle
  profondeur (toutes les pièces, ou seulement celles au-dessus d'un certain prix) ? C'est la question
  qui détermine si `§7.6` et le paramètre `PP-05` doivent être pensés pour un usage fréquent ou
  rarissime. _(Question clé du brief — à demander directement à un magasinier ou au chef d'atelier :
  « vous faites l'inventaire comment, et quand pour la dernière fois ? »)_
- **`QP-12`** — Existe-t-il un cas où une pièce automobile serait facturée à un taux de TVA autre que
  le taux normal ? _(À croiser avec une fiduciaire — question fiscale plutôt que terrain, comme
  `QF-18` de la spec étape 2 pour les taxes de recyclage.)_
