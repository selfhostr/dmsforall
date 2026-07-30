# Spécification métier — Étape 4 : Véhicules / Ventes

> Périmètre : le véhicule en stock destiné à la vente (VN et VO), la reprise, le dossier de vente
> de la proposition à la livraison, le financement/leasing, les frais annexes (plaques, MFK,
> garantie, préparation, immatriculation).
> Public : expert-database, expert-api, expert-tests, expert-facturation (chaîne documentaire et
> régime TVA), expert-migration-donnees (reprise de stock VO depuis Auto-i/Nextlane).
> Statut : spécification métier de référence, à faire relire par un vendeur/chef de vente avant
> implémentation (voir §13). Rien n'existe encore côté code pour ce module (ni schéma, ni API, ni
> écran) — cette spécification précède toute conception technique, comme l'exige l'ordre de travail
> du dépôt.
> Convention : `RV-xx` = règle métier testable (« ventes »), `CV-xx` = cas de test métier,
> `PV-xx` = point de paramétrage (varie d'un garage à l'autre, ne jamais coder en dur),
> `QV-xx` = question ouverte à poser à @laupernoe / au terrain. **[À VALIDER]** marque une hypothèse que
> je pose faute de connaître la pratique exacte du parc, ou un point de droit fiscal que je ne peux
> pas certifier sans un texte de loi sous les yeux — à distinguer du **métier établi**, que
> j'affirme sans réserve parce qu'il découle directement de ce que fait un vendeur tous les jours.
> Aucun chiffre (taux, délai, marge, seuil) n'est inventé ici : ce qui doit être paramétrable est
> signalé comme tel et laissé ouvert.

---

## Sommaire

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

## 1. Périmètre et non-périmètre

**Dans le périmètre** : le véhicule en stock destiné à la vente (fiche distincte du véhicule-client
de l'atelier, avec provenance, coût, marge, durée en stock), la distinction VN/VO, la reprise
(estimation, valeur négociée, entrée en stock du véhicule repris), le dossier de vente de la
proposition à la livraison, le financement au comptant et le leasing, les frais annexes facturés en
plus du véhicule (plaques, expertise MFK, garantie, préparation, immatriculation), la livraison.

**Hors périmètre étape 4** (à ne pas reconstruire ici, juste ne pas s'y fermer) :
- **Le contrat de leasing lui-même** — mensualités, taux, durée, valeur résiduelle. C'est un
  contrat entre le client et l'organisme de financement ; DFA n'en tient pas la comptabilité, au
  même titre que DFA ne tient pas la comptabilité générale du garage (`RF-101` de la spec étape 2).
  Ce que DFA modélise, c'est **la vente du garage à l'organisme** — voir §5.5.
- **La gestion du crédit constructeur / floor plan** (financement du stock par la banque de
  l'importateur, intérêts courus sur les VN en stock) — impact réel sur la rentabilité, mais c'est
  une ligne de trésorerie du garage, pas un objet que le vendeur manipule dossier par dossier.
- **La configuration détaillée d'un VN** (catalogue d'options, calculateur de prix constructeur) —
  ce module suppose qu'un prix de vente VN arrive déjà calculé (du connecteur constructeur ou saisi
  manuellement), pas qu'il le recalcule depuis une nomenclature d'options.
- **Les enchères VO** (canal d'achat de stock entre professionnels) — traitées comme un canal
  d'approvisionnement parmi d'autres (§5.1), pas comme un module d'enchère à part entière.
- **L'immatriculation cantonale elle-même** (dépôt du dossier au SAN/office de la circulation) —
  DFA prépare les documents et suit l'échéance, ne se substitue pas au portail cantonal.
- **Les véhicules de démonstration et d'essai** en tant que catégorie distincte de gestion de flotte
  — ils partagent la fiche « véhicule en stock » (usage démo au lieu de vente immédiate) mais leur
  cycle de vie propre (immatriculation à durée, plaques interchangeables déjà couvertes §6.9 de la
  spec étape 1) n'est pas détaillé ici. À confirmer en §13.

---

## 2. Ce qui existe déjà et que ce module doit respecter

- **Le véhicule (fiche technique)** — `apps/api/src/db/schema/atelier/vehicule.ts` — porte déjà
  immatriculation, VIN, marque/modèle, garantie (`garantieDebut`, `garantieMois`, `garantieKm`),
  statut (`actif`/`archive`, jamais de suppression physique, `RM-31`). La vente ne crée pas un
  second objet véhicule : le véhicule en stock (§5.1) est le **même** enregistrement, avant qu'il
  n'ait de détenteur client.
- **La détention** (`vehicule_detention`) modélise déjà qui détient un véhicule et pourquoi une
  détention se termine — `motif_fin_detention` contient déjà **`vente`** et **`reprise`**
  (`packages/shared/src/contrats/atelier/enums.ts:95`). C'est l'accroche exacte de ce module : à la
  livraison d'une vente, on clôt la détention du vendeur (garage ou ancien propriétaire) avec le
  motif `vente` et on ouvre une détention du nouveau client ; à une reprise, on clôt la détention du
  client avec le motif `reprise` et on ouvre une détention... au nom de qui ? C'est une question
  ouverte, voir `QV-01`.
- **Les plaques** (`vehicule_plaque`) portent déjà `professionnelle` (booléen) et
  `interchangeable` (booléen) — les plaques garagiste existent déjà dans le modèle. Ce module
  s'appuie dessus pour représenter un véhicule en stock circulant sous plaques professionnelles
  (§5.6, §9).
- **L'expertise** (`vehicule_expertise`, `resultat_expertise`, `source_echeance_expertise`) est déjà
  modélisée avec la règle `RM-28`/`CT-10` : une convocation cantonale prime toujours sur une
  périodicité calculée. Une VO qui doit repasser au contrôle avant livraison utilise cet objet, ne
  le duplique pas.
- **La chaîne documentaire de facturation** (étape 2, livrée) porte déjà les quatre types
  `devis` → `bon_commande` → `facture` → `avoir` (`type_document_vente`, `MD-11`), et une colonne
  `dossier_vente_id uuid null` posée dès l'étape 2 pour accrocher la vente sans migration sur des
  factures verrouillées (`MD-70`). **Ce module ne réinvente pas de second mécanisme de facturation**
  — une vente de véhicule produit un devis, un bon de commande (signature client, §5.4) puis une
  facture par ce mécanisme existant, avec `dossier_vente_id` renseigné.
- **Le régime TVA occasion est déjà tranché à l'étape 2**, et ce module ne le rouvre pas : `MD-68`
  établit qu'une vente d'occasion courante (2026) est une **vente normale à 8.1 % sur le prix de
  vente total** — pas de mention spéciale sur la facture. Le bénéfice fiscal (déduction de l'impôt
  préalable fictif sur un achat à un particulier non assujetti, LTVA art. 28a) se joue **à
  l'achat**, et vit dans le dossier de vente / la fiche véhicule en stock — c'est précisément ce que
  ce module doit porter (§5.8). Le régime `marge` de l'enum `regime_tva` reste réservé aux documents
  repris d'avant 2018 (`MD-69`) ; il n'est **pas** le mécanisme applicable aux ventes neuves de DFA.
- **Le rôle `vendeur`** a des droits déjà tranchés à l'étape 2 (`apps/api/src/auth/matrice-droits.ts:723`) :
  il émet devis, bon de commande et facture, encaisse, mais **n'émet jamais d'avoir**. §11 s'aligne
  dessus sans le rouvrir.
- **Le principe client ≠ payeur** existe déjà à l'atelier (`payeur_ligne_or` :
  `client`/`constructeur`/`assurance`/`tiers`/`garage`, avec `payeurClientId` distinct du client de
  l'OR, `RM-70`/`MD-62`) et à l'encaissement (`paiement.payeurClientId`,
  `apps/api/src/db/schema/facturation/paiement.ts:49`). Le leasing (§5.5) est un cas de plus de ce
  même principe : le destinataire de la facture n'est pas la personne qui conduira le véhicule. Ce
  module s'aligne sur ce principe déjà prouvé, il ne le réinvente pas.
- **Le client entreprise multi-contacts** (`client`, `client_adresse` typée
  `principale`/`facturation`/`livraison`, `client_contact` avec rôles cumulables
  `conducteur`/`gestionnaire_flotte`/`signataire`/`comptabilite`) est déjà modélisé côté atelier —
  une vente à une entreprise (véhicule de fonction, flotte) réutilise ces mêmes objets, ne les
  duplique pas.
- **Le moyen de paiement `leasing`** existe déjà dans `moyen_paiement`
  (`apps/api/src/db/schema/facturation/enums.ts:107`), aux côtés d'espèces/carte/virement/QR/Twint/
  compensation. §5.5 précise ce que ce moyen implique côté destinataire de facture.
- **`RF-101`** (étape 2) : DFA ne tient pas de comptabilité interne. Ce module n'introduit pas de
  grand livre parallèle pour les commissions vendeur, les primes constructeur à recevoir ou le
  floor plan — ces flux sont réels mais sortent vers la fiduciaire ou restent hors DFA (§13).

---

## 3. Vocabulaire

| Terme | Définition métier |
|---|---|
| **VN** | Véhicule neuf (*Neuwagen*). Commandé au constructeur/importateur, n'existe en stock DFA qu'à partir de la commande ferme (ou de son arrivée), délai de livraison de plusieurs semaines à plusieurs mois. |
| **VO** | Véhicule d'occasion (*Occasion*). Disponible immédiatement ou après remise en état, provenance variable (§5.1). |
| **Occasion certifiée** | VO du programme du constructeur (souvent appelée par sa marque commerciale, ex. véhicule labellisé), avec garantie et standards de préparation propres au programme — à distinguer d'une VO « garage » sans label. |
| **Véhicule de démonstration (démo)** | Véhicule en stock utilisé pour les essais clients avant d'être vendu, généralement sous plaques professionnelles interchangeables. |
| **Reprise** | Véhicule apporté par le client en déduction du prix d'un véhicule acheté chez le garage. Entre en stock du garage à la livraison. |
| **Valeur de reprise négociée** | Le montant réellement porté au dossier de vente en déduction — peut différer de la valeur marchande réelle estimée (§5.3). |
| **Prime constructeur / prime de reprise** | Rabais temporaire financé (en tout ou partie) par le constructeur/importateur pour stimuler les ventes, distinct de la valeur de reprise du véhicule lui-même. |
| **Dossier de vente** | L'objet qui porte tout le parcours d'une vente : proposition, véhicule vendu, reprise éventuelle, financement, frais annexes, documents liés, jusqu'à la livraison. |
| **Bon de commande** | Le document signé par le client qui l'engage sur l'achat (type `bon_commande` de la chaîne documentaire existante). |
| **Leasing** | Financement où l'organisme devient acquéreur du véhicule auprès du garage ; le client est preneur (locataire) auprès de l'organisme, pas acheteur auprès du garage (§5.5). |
| **Plaques professionnelles (plaques garagiste)** | Jeu de plaques interchangeables détenues par le garage, utilisées pour les essais et les déplacements de véhicules en stock non immatriculés individuellement (déjà modélisées, §2). |
| **MFK** | Expertise / contrôle technique cantonal périodique. Une VO peut nécessiter un passage avant livraison si l'échéance est proche ou dépassée. |
| **Frais de remise en état (reconditionnement)** | Travaux (mécanique, carrosserie, pneus, nettoyage) exécutés sur une VO entre son entrée en stock et sa mise en vente, qui réduisent la marge affichée. |
| **Jours de stock (aging)** | Durée écoulée depuis l'entrée en stock d'un véhicule non vendu — indicateur de coût d'immobilisation. |
| **Immatriculation** | Démarche administrative cantonale qui attribue (ou transfère) des plaques au nom du nouveau détenteur. |

---

## 4. Le flux réel de bout en bout

**VN — de la commande à la livraison :**
1. Le client configure/choisit un modèle avec le vendeur. Un **devis** est émis (prix catalogue,
   options, reprise estimée si applicable).
2. Le client signe le **bon de commande** — engagement ferme, souvent avec un acompte.
3. Le vendeur transmet la commande au constructeur/importateur (hors DFA aujourd'hui, potentiel
   connecteur futur, feuille de route §5). Le véhicule n'existe en stock DFA qu'à ce moment, sous
   un statut « en commande », sans châssis/VIN connu au départ.
4. Réception du véhicule par le garage (VIN connu, contrôle de conformité à la commande).
5. **Préparation avant livraison** : montage d'accessoires, contrôle qualité, nettoyage,
   immatriculation (plaques neuves ou transfert), pose des plaques définitives.
6. Le client règle le solde (ou le financement est confirmé) et **facture** émise.
7. **Livraison** : remise des clés, explication du véhicule, remise des documents (§5.7).

**VO — de l'entrée en stock à la vente :**
1. Le véhicule entre en stock par une des voies de provenance (§5.1) : reprise, achat direct à un
   particulier, achat professionnel/enchères, retour de leasing, ou véhicule de démonstration
   déclassé.
2. **Remise en état** si nécessaire (mécanique, carrosserie, pneus, nettoyage, MFK si l'échéance
   l'exige) — chaque étape a un coût qui vient réduire la marge (§5.1).
3. Le véhicule est mis en vente : prix affiché fixé.
4. Un client se présente, essaie, négocie — éventuellement avec sa propre reprise (§5.3).
5. **Devis** puis **bon de commande** signé.
6. Financement confirmé si applicable (comptant, crédit, leasing — §5.5).
7. **Facture** émise, **livraison** (§5.7).

**La reprise, en parallèle d'une vente VN ou VO :**
1. Estimation initiale de la valeur du véhicule du client (souvent donnée verbalement, avant même
   que la vente soit ferme).
2. Négociation : la valeur de reprise finale portée au dossier de vente peut différer de
   l'estimation ou de la valeur marchande réelle (§5.3 — c'est là qu'intervient la reprise
   « gonflée »).
3. À la livraison du véhicule vendu, le véhicule repris change de détenteur (le client → le garage)
   et entre en stock du garage comme une VO de plus, avec sa propre provenance « reprise ».

---

## 5. Règles métier

### 5.1 Le véhicule en stock à vendre (`RV-01` → `RV-14`)

- **`RV-01`** — Un véhicule en stock est le **même enregistrement `vehicule`** que celui que
  l'atelier connaît (§2), enrichi d'attributs propres à la vente (prix d'achat, frais de remise en
  état, prix de vente, statut commercial). Il n'existe pas de table « véhicule de vente » séparée
  du « véhicule atelier ».
- **`RV-02`** — Un véhicule en stock a une **provenance**, qui détermine son traitement fiscal et
  sa fiche de coût : `neuf_constructeur` (VN commandé), `reprise` (entré via une vente, §5.3),
  `achat_particulier` (achat direct hors reprise, hors atelier), `achat_professionnel` (confrère,
  enchères), `retour_leasing` (véhicule racheté à un organisme en fin de contrat), `demonstrateur`
  (ex-véhicule de démo déclassé en vente). Cette liste est **extensible**, comme les autres enums du
  domaine (§2) — un garage peut avoir un canal spécifique.
- **`RV-03`** — Le **prix d'achat** (ou la valeur d'entrée en stock pour une reprise, `RV-19`) est
  obligatoire dès l'entrée en stock, en centimes. Sans lui, aucune marge ne peut être calculée et
  aucun indicateur de rentabilité n'a de sens.
- **`RV-04`** — Les **frais de remise en état** s'accumulent ligne par ligne sur la durée du séjour
  en stock (mécanique, carrosserie, pneus, nettoyage, transport). **[À VALIDER]** : la façon la plus
  naturelle de les tracer est un **OR de type `interne`** (déjà existant, §2) lié au véhicule, dont
  le total remonte automatiquement au coût du véhicule en stock plutôt qu'à une facturation client —
  à confirmer avec un chef d'atelier/chef de vente, `QV-02`.
- **`RV-05`** — Le **prix de vente affiché** est distinct du prix finalement facturé (négociation,
  remise, reprise). Le prix affiché est ce que montre l'annonce/la vitrine ; le dossier de vente
  (§5.4) porte le prix réellement convenu.
- **`RV-06`** — La **marge** d'un véhicule en stock se calcule comme *prix de vente convenu − (prix
  d'achat + frais de remise en état cumulés + coûts de reprise éventuels imputés, `RV-21`)*. Elle
  n'est visible que par les rôles habilités (direction, vente) — jamais montrée sur un document
  client.
- **`RV-07`** — La **durée en stock** (« jours de stock ») se calcule depuis la date d'entrée en
  stock jusqu'à la date de facturation (ou la date du jour si toujours en stock). C'est un
  indicateur de pilotage, pas une donnée qui figure sur un document de vente.
- **`RV-08`** — **[À VALIDER — seuils, `QV-03`]** : un garage peut vouloir être alerté quand un
  véhicule dépasse un certain nombre de jours en stock (dépréciation, coût de financement). Le
  seuil est **paramétrable par tenant** (`PV-01`), pas codé en dur.
- **`RV-09`** — Un véhicule en stock porte un **statut commercial**, distinct du `statut_vehicule`
  (`actif`/`archive`) déjà existant : `en_commande` (VN pas encore livré au garage),
  `disponible` (en stock, à vendre), `reserve` (dossier de vente en cours dessus, §6.2), `vendu`
  (facturé, en attente de livraison), `livre` (détention transférée). Ce statut est propre à ce
  module — il ne remplace pas `statut_vehicule`, qui continue de porter `actif`/`archive`.
- **`RV-10`** — Un véhicule `reserve` par un dossier de vente **ne peut pas** être proposé/réservé
  par un second dossier tant que le premier n'est ni facturé ni annulé — cas tordu détaillé en
  `CV-01`.
- **`RV-11`** — Un véhicule sous plaques professionnelles (essai, transport) n'est **pas**
  détenteur au sens `vehicule_detention` d'un client — il reste sous la détention du garage (§2,
  `QV-01`) jusqu'à la livraison effective.
- **`RV-12`** — Un VN en statut `en_commande` peut ne pas avoir de VIN connu — l'enregistrement
  `vehicule` peut donc exister avec des champs identifiants (VIN, immatriculation) vides jusqu'à
  réception, ce que le schéma technique doit permettre sans forcer une valeur provisoire inventée.
- **`RV-13`** — Un véhicule de démonstration suit le même modèle qu'un VO en stock (provenance
  `demonstrateur` une fois déclassé), avec un usage transitoire en essais avant sa mise en vente
  effective — voir la question de périmètre `QV-04`.
- **`RV-14`** — Le prix d'achat et les frais de remise en état ne sont **jamais** montrés au client
  sur un document de vente (devis, bon de commande, facture) — ils alimentent uniquement le calcul
  de marge interne (`RV-06`) et, pour la reprise, la donnée de déduction de l'impôt préalable fictif
  (§5.8).

### 5.2 VN et VO — ce qui les distingue réellement (`RV-15` → `RV-18`)

- **`RV-15`** — La différence structurante n'est pas neuf/occasion au sens de l'âge, c'est
  **disponibilité immédiate contre commande à délai** : un VN engage le client sur un délai de
  livraison qu'il ne maîtrise pas (dépend du constructeur), une VO est en principe livrable dès que
  la préparation est terminée. Le dossier de vente porte une **date de livraison estimée**
  obligatoire pour un VN, optionnelle (ou immédiate) pour une VO.
- **`RV-16`** — La **garantie** diffère par nature : un VN part avec la garantie constructeur
  complète (durée/km, déjà portée par `garantieMois`/`garantieKm` sur le véhicule, §2) ; une VO
  porte soit un **reliquat de garantie constructeur** (si le véhicule est encore jeune), soit une
  **garantie occasion du garage** (durée et étendue propres, souvent plus courte et limitée),
  éventuellement les deux cumulées. Le dossier de vente doit permettre de saisir la garantie
  effectivement vendue avec cette occasion précise, pas seulement recopier le champ véhicule.
- **`RV-17`** — La **marge** est structurellement différente : sur un VN, elle est en général
  **contractuelle et étroite** (barème constructeur, primes de volume à l'importateur) ; sur une VO,
  elle dépend entièrement de la qualité de l'achat/reprise et de la remise en état — c'est là que se
  joue la rentabilité réelle d'un service des ventes VO. Ce module ne code aucun taux de marge type
  (aucun chiffre n'est inventé, §0), mais le calcul (`RV-06`) doit être disponible véhicule par
  véhicule pour que le garage voie où il gagne.
- **`RV-18`** — Un VN annulé après commande constructeur (client se rétracte) peut laisser le garage
  avec un véhicule non désiré à écouler — il devient alors une VO **neuve non immatriculée** (« VO à
  kilométrage zéro ») pour la suite du processus. Cas tordu détaillé en `CV-06`.

### 5.3 La reprise (`RV-19` → `RV-28`)

- **`RV-19`** — La reprise porte **deux valeurs distinctes**, et le dossier de vente doit les
  garder toutes les deux : la **valeur estimée** (évaluation technique/argus au moment de
  l'estimation) et la **valeur de reprise négociée** (celle qui figure réellement en déduction sur
  le bon de commande/la facture). Confondre les deux fait disparaître exactement le levier de
  négociation que le vendeur utilise tous les jours.
- **`RV-20`** — **La reprise gonflée est une pratique réelle et établie** : un vendeur peut afficher
  une valeur de reprise supérieure à la valeur marchande réelle pour faire accepter au client un
  prix catalogue qu'il n'aurait pas accepté autrement — c'est, dans les faits, une remise sur le
  véhicule neuf déguisée en surprime de reprise. Le modèle ne doit ni l'empêcher (c'est une pratique
  commerciale légitime), ni la cacher : les deux valeurs (`RV-19`) doivent rester visibles côté
  garage pour que la marge réelle (`RV-06`) reste correcte, même quand le prix affiché au client
  raconte une autre histoire.
- **`RV-21`** — L'écart entre valeur négociée et valeur estimée est un **coût commercial**, pas une
  perte sur le véhicule repris : il doit s'imputer au dossier de vente du véhicule **vendu** (celui
  qui a bénéficié de la remise déguisée), pas gonfler artificiellement le prix d'achat du véhicule
  **repris** dans sa propre fiche de stock. Sinon la VO reprise entre en stock à un prix d'achat
  fictif, et sa propre marge de revente paraîtra faussement mauvaise. Le modèle de facturation porte
  déjà un champ dédié à cet écart au niveau du document : `ecart_reprise_centimes`
  (`apps/api/src/db/schema/facturation/document-vente.ts:97`) — ce module en est le producteur
  métier, il ne le réinvente pas.
- **`RV-22`** — **[À VALIDER — traitement fiscal de l'échange, `QV-05`]** : quand une reprise couvre
  tout ou partie du prix du véhicule vendu, il s'agit techniquement d'un échange (le garage reçoit
  un bien en paiement partiel). La base TVA de chaque opération doit-elle être calculée sur la
  valeur négociée figurant au dossier, ou sur la valeur marchande objective du véhicule repris
  (principe général de l'échange en matière de TVA) ? La pratique courante (TVA sur le prix de vente
  net après déduction de la reprise) peut ne pas correspondre exactement à ce que la loi exige en
  cas d'écart significatif entre valeur négociée et valeur réelle — question fiscale à trancher avec
  la fiduciaire, pas par ce document.
- **`RV-23`** — À la livraison du véhicule vendu, la détention du véhicule repris **change** :
  clôture de la détention du client avec motif `reprise` (déjà dans l'enum, §2), ouverture d'une
  nouvelle détention. Voir `QV-01` pour le détenteur à utiliser.
- **`RV-24`** — Le véhicule repris **entre en stock** du garage au moment de la livraison du
  véhicule vendu (pas avant — le client roule avec son ancien véhicule jusqu'à la livraison du
  nouveau, sauf accord particulier). Il devient alors un véhicule en stock à part entière (`RV-01`),
  provenance `reprise` (`RV-02`), avec la **valeur négociée** comme prix d'achat d'entrée en stock —
  c'est la valeur négociée, pas la valeur estimée, qui a un sens comptable : c'est ce que le garage a
  réellement « payé » pour ce véhicule (en nature).
- **`RV-25`** — Une reprise peut être refusée en cours de négociation (le client garde son véhicule,
  paie comptant) sans annuler le reste du dossier de vente — la reprise est une composante
  optionnelle du dossier, pas un objet qui le conditionne.
- **`RV-26`** — Le véhicule repris peut arriver au garage avec une **dette de financement
  résiduelle** (leasing ou crédit en cours) — voir cas tordu détaillé `CV-04`. Le dossier de vente
  doit pouvoir enregistrer ce solde à régler comme condition suspensive de la reprise.
- **`RV-27`** — L'estimation initiale de la reprise (avant tout engagement) n'a **aucune valeur
  contractuelle** — elle peut être révisée à la baisse au moment de l'expertise physique du véhicule
  (état réel différent de ce qui a été déclaré). Le dossier de vente doit garder trace des deux
  moments (estimation puis valeur définitive) pour éviter les litiges.
- **`RV-28`** — La reprise d'un véhicule immatriculé à l'étranger ou avec une expertise étrangère
  suit les mêmes règles de stock, mais peut nécessiter une expertise suisse avant toute revente —
  se raccorde à `vehicule_expertise` (§2), pas de duplication.

### 5.4 Le dossier de vente — de la proposition à la livraison (`RV-29` → `RV-38`)

- **`RV-29`** — Le dossier de vente est l'objet central de ce module : il lie un véhicule en stock
  (`RV-01`), un client acheteur, une reprise optionnelle (§5.3), un financement (§5.5), les frais
  annexes (§5.6), et les documents de la chaîne facturation existante (devis, bon de commande,
  facture) via `dossier_vente_id` (§2).
- **`RV-30`** — Un dossier de vente peut exister **avant** qu'un véhicule précis ne lui soit
  associé (le vendeur ouvre un dossier « client intéressé par tel modèle » avant d'avoir un VIN,
  typiquement pour un VN pas encore commandé) — l'association au véhicule en stock devient
  obligatoire au passage à l'état engagé (§6.2).
- **`RV-31`** — Le **devis** émis dans le cadre d'un dossier de vente n'engage ni le client ni le
  garage — il peut être révisé librement tant qu'il n'est pas transformé en bon de commande, exactement
  comme le reste de la chaîne documentaire existante (`type_document_vente`, §2).
- **`RV-32`** — Le **bon de commande signé** est l'événement qui engage réellement le client — c'est
  à cet instant que le véhicule passe au statut commercial `reserve` (`RV-09`) et que l'acompte,
  s'il y en a un, est encaissé.
- **`RV-33`** — **[À VALIDER — pratique du terrain, `QV-06`]** : l'acompte à la signature du bon de
  commande est-il systématique, à quel taux/montant, et sous quelle forme documentaire (facture
  d'acompte comme déjà porté par `nature_facture = 'acompte'`, §2, ou simple encaissement) ? Le
  modèle porte déjà les deux dispositifs côté facturation (`MD-54`, mentionné en `QF-02`) — ce
  module ne tranche pas seul lequel s'applique aux ventes.
- **`RV-34`** — La signature du bon de commande n'est **valable** qu'accompagnée d'une identité
  vérifiée du client acheteur (pièce d'identité pour un particulier, extrait du registre du commerce
  et pouvoir de signature pour une entreprise) — pratique établie, pas nouvelle à ce module, mais le
  dossier de vente doit prévoir une trace de cette vérification (`RV-35`).
- **`RV-35`** — Un dossier de vente conserve la liste des **documents produits ou requis** :
  proposition, bon de commande signé, contrat de financement/leasing (si applicable, produit par
  l'organisme, pas par DFA), pièce d'identité vérifiée, carte grise ancienne détention, permis de
  circulation nouveau, attestation d'assurance du client (obligatoire avant immatriculation en
  Suisse), preuve du paiement/financement. **[À VALIDER — check-list exacte et responsabilité de
  cocher, `QV-07`]**.
- **`RV-36`** — Un dossier de vente **entreprise** (véhicule de fonction, flotte) distingue déjà,
  via les objets clients existants (§2), le **signataire** du bon de commande, le **conducteur**
  attitré du véhicule (peut différer du signataire) et le **contact comptabilité** qui recevra la
  facture si elle diffère de l'adresse principale. Ce module ne réinvente pas cette distinction, il
  la consomme.
- **`RV-37`** — La **facture** d'un dossier de vente n'est émise, en règle générale, qu'au moment où
  la livraison est imminente ou effective — **livraison conditionnée au règlement** (comptant,
  carte, virement confirmé) ou à la **confirmation ferme de financement** (accord de crédit signé,
  ou paiement de l'organisme de leasing reçu ou garanti). C'est une différence structurante avec
  l'atelier, où une créance ouverte après restitution est courante pour un client de confiance — en
  vente de véhicule, le garage ne remet, en pratique, pas les clés sans être payé ou sans garantie
  ferme de paiement. **[À VALIDER — tolérances réelles selon le garage, `QV-08`]**.
- **`RV-38`** — Une fois la **facture émise**, le dossier de vente suit la même immutabilité que
  n'importe quel document de vente verrouillé (§2) : toute correction du prix du véhicule après
  facturation passe par un **avoir**, jamais par une modification du document. Le rôle `vendeur` ne
  peut pas émettre cet avoir (§2, §11) — seul un rôle habilité (comptable/direction) le fait.

### 5.5 Le financement et le leasing (`RV-39` → `RV-45`)

- **`RV-39`** — Le **leasing n'est pas une vente au client** : c'est une vente du garage à
  l'**organisme de financement**, qui devient propriétaire du véhicule. Le client n'est que
  **preneur** (locataire) auprès de l'organisme, dans un contrat que DFA ne gère pas (§1).
- **`RV-40`** — Conséquence directe : sur le document de vente (facture), le **destinataire de la
  facture** (`document_vente.clientId`) est l'**organisme de leasing** — pas le client final. Le
  client final reste le **détenteur** au sens `vehicule_detention` (c'est lui qui roule et qui
  amène le véhicule à l'atelier plus tard), exactement le principe client ≠ payeur déjà établi côté
  atelier (§2, `RM-70`). Il faut donc que l'organisme de leasing existe comme **fiche client** (type
  `entreprise`) dans DFA, distincte du client conducteur.
- **`RV-41`** — Le moyen de paiement `leasing` (déjà dans `moyen_paiement`, §2) marque la façon dont
  le garage est réglé par l'organisme — il ne dispense pas de renseigner correctement le
  destinataire de la facture (`RV-40`) : les deux informations sont liées mais distinctes
  techniquement.
- **`RV-42`** — Le dossier de vente doit conserver la **référence du contrat de leasing** (numéro,
  organisme) à titre de traçabilité, sans en porter le détail financier (mensualité, durée,
  kilométrage contractuel) qui reste dans le système de l'organisme.
- **`RV-43`** — **[À VALIDER — séquencement réel, `QV-09`]** : le garage facture-t-il l'organisme
  **avant** ou **après** avoir reçu la confirmation de financement, et **avant** ou **après** la
  livraison au client ? La pratique varie probablement selon l'organisme (délai de virement,
  procédure propre) — question de terrain, pas d'arbitrage de conception.
- **`RV-44`** — Un financement **au comptant avec crédit bancaire classique** (pas un leasing) reste
  une vente normale **au client** : la banque prête au client, qui paie le garage directement ou via
  virement de la banque au nom du client — le client reste le destinataire de la facture, contrairement
  au leasing. Ne pas confondre les deux dispositifs dans le modèle.
- **`RV-45`** — Un financement (leasing ou crédit) **refusé par l'organisme après signature du bon
  de commande** est un cas réel — voir `CV-05`.

### 5.6 Les frais annexes (`RV-46` → `RV-51`)

- **`RV-46`** — Un dossier de vente facture, en plus du prix du véhicule, des postes réels et
  distincts : **plaques** (émission/transfert), **expertise MFK** (si nécessaire avant livraison),
  **garantie** (si vendue en supplément, garantie étendue), **préparation** (montage d'accessoires,
  traitement, nettoyage haut de gamme), **immatriculation** (démarches administratives). Chacun est
  une **ligne de document** distincte (chaîne `ligne_document` déjà existante, §2), pas un montant
  fourre-tout noyé dans le prix du véhicule — la ventilation compte pour la TVA (des taux ou régimes
  différents peuvent s'appliquer, `QV-10`) et pour la lisibilité du client.
- **`RV-47`** — Les **plaques cantonales** ont un coût administratif (émission ou transfert) refacturé
  au client — le canton d'immatriculation dépend du domicile du client, pas du canton du garage : un
  garage vaudois qui vend à un client genevois prépare un dossier pour des plaques GE.
- **`RV-48`** — La **garantie étendue** vendue en supplément (au-delà de la garantie constructeur ou
  occasion standard, `RV-16`) est un produit facturé séparément, avec ses propres conditions —
  potentiellement un produit d'un assureur tiers, pas nécessairement le garage lui-même qui porte le
  risque. **[À VALIDER — le garage revend-il un produit d'assurance tiers ou porte-t-il le risque
  lui-même, `QV-11`]**, ça change qui est payeur/bénéficiaire d'une éventuelle prise en charge future
  côté atelier (rejoint `payeur = 'garantie'`... à vérifier si cette valeur existe déjà côté
  `payeur_ligne_or`, sinon c'est un manque à signaler hors périmètre de ce document).
- **`RV-49`** — La **prime constructeur/prime de reprise** (vocabulaire §3) réduit le prix effectif
  payé par le client (une remise visible sur le document de vente), tandis que le garage se fait
  rembourser cette prime par le constructeur/importateur **hors DFA** — DFA ne tient pas ce
  recouvrement (`RF-101`, §2). Le document de vente porte la remise, pas la créance sur le
  constructeur.
- **`RV-50`** — Les frais annexes suivent la même règle TVA que le reste du document (8.1 % en
  principe, `RM-107`/agrégation par ligne déjà en place) sauf régime particulier justifié — aucune
  exception n'est codée en dur sans validation fiscale (`QV-10`).
- **`RV-51`** — Une expertise MFK requise avant livraison suit le processus déjà modélisé côté
  atelier (OR de type `expertise`, §2, `vehicule_expertise`) — ce module se raccorde au résultat
  (accepté / accepté avec défauts / refusé), il ne le duplique pas. Un résultat `refuse` bloque la
  livraison (`RV-56`).

### 5.7 La livraison (`RV-52` → `RV-58`)

- **`RV-52`** — La livraison suppose que **tous** les éléments suivants soient réunis :
  facture émise et réglée (ou financement confirmé, `RV-37`), plaques posées, immatriculation faite,
  attestation d'assurance du client reçue, documents du véhicule remis (permis de circulation, carnet
  d'entretien / historique électronique, clés — y compris la seconde clé si applicable).
- **`RV-53`** — La livraison est l'événement qui déclenche le **changement de détention** —
  clôture de la détention précédente (garage ou ancien propriétaire) avec motif `vente`, ouverture
  de la détention du nouveau client (§2, déjà l'enum existant).
- **`RV-54`** — La livraison déclenche aussi, pour un VN, le **début de la garantie constructeur**
  telle qu'enregistrée sur le véhicule (`garantieDebut`, §2) — ce n'est pas la date de commande ni
  la date de facturation qui fait foi, c'est la date de livraison effective.
- **`RV-55`** — Le kilométrage de départ (0 pour un VN, kilométrage réel constaté pour une VO) doit
  être enregistré à la livraison via le mécanisme de kilométrage déjà existant côté véhicule (§2),
  pour que le premier relevé atelier futur ne déclenche pas une alerte de kilométrage régressif
  injustifiée.
- **`RV-56`** — Une livraison **ne peut pas** avoir lieu tant qu'une expertise MFK requise est en
  statut `refuse` non résolu (`RV-51`) — blocage métier, pas seulement organisationnel.
- **`RV-57`** — Le véhicule livré devient, à partir de cet instant, un **véhicule-client** ordinaire
  au sens de l'atelier (rendez-vous, OR, kilométrage, expertise à venir) — ce module s'arrête là, le
  reste du cycle de vie appartient à l'étape 1.
- **`RV-58`** — **[À VALIDER — pratique de suivi post-livraison, `QV-12`]** : certains garages font un
  appel ou un contrôle de satisfaction à J+X après livraison. Si cette pratique doit être outillée,
  elle relève potentiellement du pointage/CRM (lot 2), pas de ce module — à confirmer.

### 5.8 Contexte TVA propre à la vente — compléments à `MD-68`→`MD-70` (`RV-59` → `RV-62`)

- **`RV-59`** — **Métier établi** (repris de `MD-68`, §2, ne pas rouvrir) : une vente de véhicule
  d'occasion en 2026 est une vente TVA normale sur le prix de vente total, sans mention spéciale.
  Le régime `marge` de l'enum n'est **pas** utilisé pour une vente conclue aujourd'hui.
- **`RV-60`** — Ce que ce module doit fournir à la facturation pour le futur export comptable
  (`MD-70`) : pour chaque véhicule en stock d'origine `reprise`/`achat_particulier` (§5.1), si le
  **vendeur précédent était un particulier non assujetti** ou un **assujetti**, et le **prix
  d'achat/valeur de reprise négociée** — ces deux données déterminent l'éligibilité et le calcul de
  la déduction de l'impôt préalable fictif (LTVA art. 28a) que la fiduciaire opère à sa façon, hors
  facture de vente. **[À VALIDER — calcul exact et taux applicable, déjà ouvert en `QF-07`]**.
- **`RV-61`** — **[À VALIDER — véhicule importé directement par le garage, `QV-13`]** : un véhicule
  acheté par le garage lui-même à l'étranger (hors réseau d'importation officiel du constructeur en
  Suisse) est soumis à la TVA à l'importation et, potentiellement, à l'impôt sur les véhicules
  automobiles perçu à l'importation (distinct de la TVA) — coûts réels qui viennent augmenter le
  prix d'achat d'entrée en stock (`RV-03`). Cette spécification **ne certifie pas** les taux ni les
  conditions d'assujettissement de cet impôt à l'importation : à vérifier avec la fiduciaire avant
  tout codage d'un quelconque taux.
- **`RV-62`** — Un véhicule vendu et **livré à l'étranger**, ou vendu **sous plaques U (usage
  particulier export)**, relève potentiellement d'un régime d'exonération plutôt que du taux normal
  — DFA porte déjà `exonere` et `exclu` comme régimes distincts côté facturation (§2, `QF-08`,
  ouvert et non résolu à l'étape 2). Ce module ne tranche pas cette question, il la signale comme
  pertinente pour la vente de véhicule en particulier (client diplomate, livraison hors Suisse,
  véhicule destiné à l'export).

---

## 6. Machines à états

### 6.1 Le véhicule en stock — statut commercial (`RV-09`)

```
                    ┌───────────────┐
   (commande VN) →  │  en_commande  │
                    └───────┬───────┘
                            │ réception physique
                            ▼
                    ┌───────────────┐
   (achat/reprise → │  disponible   │ ◄────────────┐
    directe en VO)  └───────┬───────┘               │
                            │ bon de commande signé  │ dossier annulé/abandonné
                            ▼                        │
                    ┌───────────────┐                │
                    │   reserve     │ ───────────────┘
                    └───────┬───────┘
                            │ facture émise
                            ▼
                    ┌───────────────┐
                    │     vendu     │
                    └───────┬───────┘
                            │ livraison effective (RV-52)
                            ▼
                    ┌───────────────┐
                    │     livre     │  → devient véhicule-client (RV-57)
                    └───────────────┘
```

Remarque : `reserve → disponible` (retour en stock) doit rester possible à tout moment avant
facturation — annulation ou abandon du dossier de vente ne doit jamais laisser un véhicule bloqué en
`reserve` indéfiniment (`CV-01`).

### 6.2 Le dossier de vente

```
 prospection ──► engage ──► en_preparation ──► pret_a_livrer ──► livre ──► clos
      │              │             │                  │
      │              │             │                  │
      └──────────────┴─────────────┴──────────────────┴──► annule / abandonne
```

- `prospection` : devis émis ou non, aucun engagement du client.
- `engage` : bon de commande signé (`RV-32`), véhicule passé `reserve`.
- `en_preparation` : VN en attente constructeur, ou VO en remise en état / immatriculation.
- `pret_a_livrer` : tout est réuni (`RV-52`) sauf le rendez-vous de remise.
- `livre` : clés remises, détention transférée (`RV-53`).
- `clos` : toute la paperasse (immatriculation, garantie enregistrée) est complète — état purement
  administratif, pas la même chose que `livre`.
- `annule` : possible depuis `prospection` ou `engage` (avant facturation) — rupture volontaire.
- `abandonne` : le client ne donne plus signe de vie — même logique que l'OR abandonné côté atelier
  (`RM`, spec étape 1, §6.5), à réutiliser plutôt qu'à réinventer.

Après `livre`, toute correction de prix passe par un avoir sur la facture (`RV-38`) — le dossier de
vente lui-même n'a pas de retour en arrière.

### 6.3 La reprise (au sein d'un dossier de vente)

```
 estimee ──► negociee ──► confirmee (à la signature du bon de commande, RV-19/RV-27)
    │
    └──► refusee (RV-25 : le client garde son véhicule, le reste du dossier continue)
```

`confirmee` déclenche l'entrée en stock à la livraison du véhicule vendu (`RV-24`), pas avant.

---

## 7. Les cas tordus

### 7.1 Le véhicule vendu entre la prise du dossier et la préparation

**Contexte** : deux vendeurs travaillent en parallèle. Le véhicule A (VO unique en stock) est
proposé à un client par le vendeur 1 (devis, pas encore de bon de commande), pendant que le vendeur
2 fait signer un bon de commande sur le même véhicule à un autre client.

**Règle** : `RV-10`/`RV-32` — seul le passage à `reserve` (bon de commande signé) verrouille le
véhicule. Tant qu'un dossier reste en `prospection` (simple devis), le véhicule reste `disponible`
et peut être réservé par un autre dossier. Le premier vendeur doit être notifié que son véhicule
vient d'être vendu sous lui — **[À VALIDER — mécanisme de notification, `QV-14`]**.

### 7.2 La dette de leasing résiduelle sur le véhicule repris

**Contexte** : le client apporte en reprise un véhicule encore sous leasing chez un autre
organisme, avec un solde restant dû de plusieurs milliers de francs.

**Règle** : `RV-26` — la reprise n'est **définitive** que sous condition suspensive du solde du
leasing existant. En pratique, le garage règle ce solde à l'ancien organisme (souvent en déduisant
le montant de la valeur de reprise négociée avant de la porter au dossier), ou le client règle lui-
même le solde avant la reprise. Le dossier de vente doit porter cette dette et son mode de
règlement, sinon la valeur de reprise affichée au client ne correspond à rien de vérifiable.
**[À VALIDER — qui règle concrètement l'organisme et à quel moment, `QV-05` bis]**.

### 7.3 Le financement (leasing ou crédit) refusé après signature du bon de commande

**Contexte** : le client signe un bon de commande avec l'intention de financer en leasing.
L'organisme refuse le dossier une semaine plus tard (défaut de solvabilité).

**Règle** : le dossier de vente ne peut pas passer en facture tant que le financement n'est pas
confirmé (`RV-37`). Un refus fait revenir le dossier à `engage` en attente d'un nouveau mode de
financement, ou le fait basculer en `annule` si le client ne peut finalement pas payer — le véhicule
repasse `disponible` (`RV-10`). L'acompte éventuellement versé (`RV-33`) suit sa propre règle de
remboursement/retenue — **[À VALIDER, `QV-06` bis]**.

### 7.4 Le client entreprise avec plusieurs conducteurs et une adresse de facturation distincte

**Contexte** : une PME achète trois véhicules de fonction. Le signataire du bon de commande est le
directeur, chaque véhicule a un conducteur attitré différent, et la facture doit partir au service
comptabilité d'une adresse différente du siège.

**Règle** : `RV-36` — les objets client existants (contact `signataire`, contact `conducteur` par
véhicule, adresse `facturation` distincte de l'adresse `principale`) couvrent déjà ce cas côté
atelier ; la vente l'utilise tel quel. Trois dossiers de vente distincts (un par véhicule), un seul
client entreprise, trois détentions différentes une fois livrés.

### 7.5 La reprise gonflée découverte après coup par la comptabilité

**Contexte** : trois mois après la vente, le véhicule repris (entré en stock à une valeur négociée
de CHF X) se revend nettement en dessous de son prix d'achat apparent, alertant la comptabilité sur
une marge négative alors que l'affaire globale (vente + reprise) était rentable.

**Règle** : `RV-21` — c'est exactement le risque que cette règle prévient : l'écart entre valeur
négociée et valeur estimée doit être imputé au dossier de vente d'origine (`ecart_reprise_centimes`,
déjà porté par le modèle de facturation), pas caché dans le prix d'achat du véhicule repris. Si
l'écart est bien imputé à l'origine, la marge apparente du véhicule repris en stock reste réaliste,
et la rentabilité de l'affaire complète (vente + reprise) reste lisible ailleurs.

### 7.6 Le VN annulé après commande constructeur

**Contexte** : le client se rétracte après que le garage a passé commande au constructeur ; le
véhicule arrive quand même, personne pour le récupérer au prix commandé.

**Règle** : `RV-18` — le véhicule devient une VO à kilométrage zéro, provenance à requalifier
(`neuf_constructeur` reste l'origine réelle, mais le statut commercial repart à `disponible` pour un
nouveau dossier). Le éventuel acompte du premier client suit une règle de retenue/remboursement
propre au garage — **[À VALIDER, `QV-06` ter]**.

### 7.7 Le véhicule vendu sans reprise, mais avec une prime constructeur conditionnelle

**Contexte** : le constructeur offre une prime de CHF X « toute reprise, même hors d'état » pour
stimuler les ventes — le client sans véhicule à reprendre (jeune conducteur, primo-accédant) ne peut
techniquement pas en bénéficier, ce qui devient un argument de négociation à la baisse du prix
catalogue à la place.

**Règle** : `RV-49` — la prime reste une remise visible sur le document quel que soit son origine
(reprise réelle ou substitution négociée), le garage se faisant rembourser ou non par le
constructeur selon les conditions réelles de l'opération — hors DFA (`RF-101`).

---

## 8. Modèle de données métier (conceptuel)

Volontairement conceptuel — noms de champs indicatifs, pas un schéma final (rôle d'expert-database).

### 8.1 Véhicule en stock (extension du `vehicule` existant, pas une nouvelle table racine)

- Rattaché à `vehicule.id` existant (§2).
- `provenance` (`RV-02`), `date_entree_stock`, `prix_achat_centimes` (`RV-03`),
  `frais_remise_etat_cumules_centimes` (dérivé des OR internes liés, `RV-04`),
  `prix_vente_affiche_centimes` (`RV-05`), `statut_commercial` (`RV-09`),
  `vendeur_precedent_assujetti` (booléen, `RV-60`), `origine_reprise_dossier_vente_id` (traçabilité
  si provenance = `reprise`).

### 8.2 Dossier de vente

- `id`, `tenant_id`, `site_id`, `statut` (§6.2), `type_vehicule` (`vn`/`vo`, pour le filtrage, dérivé
  de la provenance et du statut du véhicule associé plutôt qu'une donnée saisie séparément —
  question de conception à trancher par expert-database).
- `vehicule_id` (nullable tant que non associé, `RV-30`), `client_acheteur_id`,
  `client_facture_id` (peut différer, leasing `RV-40`), `client_conducteur_id` (peut différer,
  entreprise `RV-36`).
- `date_livraison_estimee` (`RV-15`), `date_livraison_effective`.
- Liens vers les documents de la chaîne facturation existante via `dossier_vente_id` déjà posé côté
  facturation (§2) — aucune duplication du montant, de la TVA ou du statut de paiement ici.

### 8.3 Reprise (rattachée à un dossier de vente)

- `id`, `dossier_vente_id`, `vehicule_repris_id` (référence à un `vehicule` existant ou nouvellement
  créé si le véhicule repris n'était pas connu de DFA), `valeur_estimee_centimes` (`RV-19`),
  `valeur_negociee_centimes` (`RV-19`), `statut` (§6.3), `dette_financement_residuelle_centimes`
  (`RV-26`), `organisme_financement_solde` (texte libre ou lien vers un tiers, `CV-02`).

### 8.4 Financement / leasing (rattaché à un dossier de vente)

- `id`, `dossier_vente_id`, `type` (`comptant`/`credit`/`leasing`, `RV-39`/`RV-44`), `organisme_id`
  (fiche client existante, `RV-40`), `reference_contrat` (`RV-42`), `statut_confirmation`
  (`en_attente`/`confirme`/`refuse`, `CV-03`).

### 8.5 Frais annexes

- Ne sont **pas** un objet de données à part — ce sont des `ligne_document` typées sur le document
  de vente existant (§2), avec un `type_ligne_document` étendu si besoin pour distinguer
  plaques/MFK/garantie/préparation/immatriculation dans les rapports (`RV-46`).

---

## 9. Contexte suisse

- **TVA** : 8.1 % normal, applicable à une vente VO comme VN sur le prix de vente total (`RV-59`,
  déjà tranché `MD-68`). Le bénéfice fiscal de l'achat à un particulier (impôt préalable fictif, LTVA
  art. 28a) se joue à l'achat, pas à la vente (`RV-60`) — sujet fiscal à valider avec la fiduciaire
  (`QF-07`, déjà ouvert à l'étape 2, ce module lui fournit juste les données).
- **QR-facture** : la facture d'un dossier de vente suit exactement le même mécanisme QR que le
  reste de la facturation (§2) — pas de traitement spécial pour un véhicule.
- **MFK (expertise)** : peut être requise avant livraison d'une VO selon l'échéance — se raccorde à
  l'objet expertise déjà existant (`RV-51`).
- **Plaques cantonales** : dépendent du domicile du client, pas du canton du garage (`RV-47`) ;
  plaques professionnelles déjà modélisées pour l'usage stock/essai (`RV-11`, §2).
- **Véhicules importés** : un achat direct à l'étranger par le garage soulève TVA à l'importation et
  potentiellement un impôt à l'importation distinct — non certifié ici, à valider (`RV-61`, `QV-13`).
- **Assurance obligatoire** : la Suisse impose une attestation d'assurance RC avant immatriculation
  — condition de livraison déjà intégrée (`RV-52`), pas un sujet DFA au-delà de vérifier sa
  présence dans le dossier.

---

## 10. Ce qui doit être paramétrable

| Repère | Ce qui varie d'un garage à l'autre |
|---|---|
| `PV-01` | Seuil de jours de stock déclenchant une alerte (`RV-08`) |
| `PV-02` | Taux/montant d'acompte par défaut à la signature du bon de commande (`RV-33`) |
| `PV-03` | Check-list exacte des documents requis avant livraison (`RV-35`) |
| `PV-04` | Tolérance de livraison sans paiement intégral confirmé, si elle existe (`RV-37`) |
| `PV-05` | Liste des provenances de véhicule en stock, extensible par tenant (`RV-02`) |
| `PV-06` | Durée et étendue par défaut de la garantie occasion du garage (`RV-16`) |
| `PV-07` | Ventilation exacte des frais annexes facturés par défaut (`RV-46`) |
| `PV-08` | Statuts intermédiaires du dossier de vente activés/désactivés selon la taille du garage (`en_preparation` a-t-il un sens pour un tout petit garage VO uniquement ?) |

---

## 11. Matrice rôle × action

Cohérente avec `apps/api/src/auth/matrice-droits.ts` — ce module ne crée pas de nouveau rôle, il
étend l'usage des rôles existants.

| Action | vendeur | direction | comptable | réceptionnaire |
|---|---|---|---|---|
| Créer/modifier un dossier de vente en `prospection` | oui | oui | — | — |
| Faire signer un bon de commande | oui | oui | — | — |
| Saisir une estimation/valeur de reprise négociée | oui | oui | — | — |
| Voir la marge d'un véhicule en stock (`RV-06`) | **[À VALIDER, `QV-15`]** | oui | oui | — |
| Émettre la facture de vente | oui | oui | oui | — |
| Émettre un avoir sur une facture de vente | **non** (§2, déjà tranché) | oui | oui | — |
| Confirmer un financement/leasing | oui | oui | oui | — |
| Enregistrer la livraison (changement de détention) | oui | oui | — | possible selon organisation (`QV-16`) |
| Modifier le prix d'achat/frais de remise en état d'un véhicule en stock | **[À VALIDER, `QV-15`]** | oui | — | — |

---

## 12. Cas de test métier

- **`CV-01`** — Deux dossiers de vente sur le même véhicule VO unique. Contexte : véhicule
  `disponible`, dossier 1 en `prospection` (devis), dossier 2 passe en `engage` (bon de commande
  signé) → le véhicule passe `reserve`, le dossier 1 doit être averti que le véhicule n'est plus
  disponible et ne peut plus être engagé sur ce même véhicule (`RV-10`).
- **`CV-02`** — Reprise avec dette de leasing résiduelle. Contexte : reprise négociée à CHF 15'000,
  solde de leasing existant de CHF 4'000 sur l'ancien véhicule → le montant réellement déduit du
  prix du véhicule vendu est CHF 11'000, le solde de CHF 4'000 est réglé à l'organisme d'origine —
  prouve que le modèle distingue valeur négociée brute et net après solde (`RV-26`, `CV du §7.2`).
- **`CV-03`** — Leasing refusé après bon de commande signé. Contexte : dossier `engage`, financement
  `en_attente`, l'organisme répond `refuse` → dossier ne peut pas passer en facture, retour à
  `engage` pour un nouveau mode de financement ou passage à `annule`, véhicule repasse `disponible`
  (`RV-37`, `CV du §7.3`).
- **`CV-04`** — Vente à une entreprise avec conducteur, signataire et adresse de facturation
  distincts. Contexte : PME, directeur signataire, employé conducteur, comptabilité à une autre
  adresse → un seul dossier de vente porte trois identifiants clients différents sans erreur de
  facture envoyée à la mauvaise adresse (`RV-36`, `CV du §7.4`).
- **`CV-05`** — Reprise gonflée puis contrôle de marge. Contexte : véhicule vendu CHF 40'000 catalogue,
  reprise négociée à CHF 12'000 pour une valeur estimée de CHF 9'000 (écart CHF 3'000) → le véhicule
  repris entre en stock à CHF 12'000 (valeur négociée, `RV-24`), l'écart de CHF 3'000 est imputé au
  dossier de vente d'origine (`RV-21`) et non à la fiche du véhicule repris — la marge de revente
  future du véhicule repris reste lisible (`CV du §7.5`).
- **`CV-06`** — VN annulé après commande constructeur, revendu comme VO à kilométrage zéro. Contexte :
  dossier 1 `engage` puis `annule` après réception du véhicule au garage → le véhicule repasse
  `disponible`, un dossier 2 peut être ouvert dessus sans recréer l'enregistrement `vehicule`
  (`RV-18`, `CV du §7.6`).
- **`CV-07`** — Livraison bloquée par une expertise MFK refusée. Contexte : VO en `pret_a_livrer`,
  expertise MFK obligatoire avant livraison passe en `refuse` → le dossier ne peut pas passer
  `livre` tant que le résultat n'est pas corrigé (`RV-56`).
- **`CV-08`** — Facture de leasing adressée au bon destinataire. Contexte : vente VN financée en
  leasing par un organisme tiers, client conducteur distinct → la facture porte le nom/adresse de
  l'organisme comme client facturé, la détention à la livraison est ouverte au nom du client
  conducteur, pas de l'organisme (`RV-40`).
- **`CV-09`** — Frais annexes ventilés en lignes distinctes. Contexte : vente VN avec plaques,
  immatriculation, garantie étendue et préparation → quatre lignes de document distinctes, pas un
  montant global « divers », chacune avec son propre traitement TVA le cas échéant (`RV-46`).
- **`CV-10`** — Correction de prix après facture émise. Contexte : facture de vente émise et
  réglée, erreur de CHF 500 découverte sur le prix de vente convenu → correction uniquement par
  avoir, le vendeur ne peut pas l'émettre lui-même (`RV-38`, §11).

---

## 13. Questions ouvertes à poser à @laupernoe

Pour chacune, l'endroit où aller regarder ou à qui demander — le terrain de @laupernoe (accès direct à
Auto-i et Nextlane sur plus de dix garages) vaut mieux que tout raisonnement ici.

- **`QV-01`** — Qui est le **détenteur** d'un véhicule en stock au sens `vehicule_detention` (§2) ?
  Un client interne représentant le garage lui-même (comme les plaques professionnelles le
  suggèrent), ou un mécanisme séparé pour « pas de détenteur, en stock » ? **Où regarder** : comment
  Auto-i/Nextlane représentent un véhicule en stock sans propriétaire — probablement une fiche
  client spéciale « stock » ou un champ nul toléré. C'est structurant pour le schéma, à trancher tôt.
- **`QV-02`** — Les frais de remise en état d'une VO passent-ils réellement par un OR interne
  (`RV-04`), ou par une saisie directe de montant sans passage atelier, dans les garages que tu
  suis ? **Où regarder** : comment un garage 100% atelier + un peu de VO facture en interne la
  préparation d'une occasion — probablement visible dans Auto-i sur un OR sans client.
- **`QV-03`** — Le seuil d'alerte « véhicule qui dort » (`RV-08`, `PV-01`) — un chiffre type existe-t-il
  dans la pratique (30/60/90 jours), ou est-ce trop variable pour même proposer une valeur par
  défaut ? **Où demander** : un chef de vente d'un de tes garages orientés VN/VO.
- **`QV-04`** — Les véhicules de démonstration méritent-ils un traitement distinct de la VO en stock
  (immatriculation temporaire, kilométrage limité, obligation de revente sous délai réglementaire côté
  constructeur) ? **Où regarder** : conditions contractuelles démo d'un de tes garages VN, souvent
  imposées par l'importateur.
- **`QV-05`** — Le traitement fiscal de l'échange (reprise) en cas d'écart entre valeur négociée et
  valeur réelle (`RV-22`) — la pratique courante suffit-elle (TVA sur le prix net après reprise), ou
  y a-t-il un risque de redressement documenté que tu as déjà vu passer ? **Où demander** : une
  fiduciaire habituée aux concessions, pas seulement une fiduciaire généraliste.
- **`QV-05` bis** — Qui règle concrètement le solde de leasing d'un véhicule repris (`RV-26`, `CV-02`)
  — le garage avance-t-il systématiquement, ou est-ce au client de solder avant la reprise ? **Où
  regarder** : un dossier de reprise récent avec leasing en cours dans un de tes garages.
- **`QV-06`** — L'acompte à la signature du bon de commande (`RV-33`, `PV-02`) — systématique ?
  Sous quelle forme (facture d'acompte ou simple encaissement) ? **Où regarder** : un bon de
  commande VN récent, la mention d'acompte y figure probablement déjà.
- **`QV-07`** — La check-list exacte des documents requis avant livraison (`RV-35`, `PV-03`) —
  varie-t-elle sensiblement d'un garage à l'autre, ou y a-t-il un standard de fait ? **Où
  regarder** : le dossier physique/numérique remis au client à la livraison dans deux ou trois de
  tes garages, pour comparer.
- **`QV-08`** — La tolérance réelle de livraison sans paiement intégral (`RV-37`, `PV-04`) — un
  bon client connu du garage repart-il parfois avec le véhicule avant règlement complet, comme en
  atelier ? **Où demander** : direction d'un garage VN/VO établi, question de politique commerciale
  autant que de risque.
- **`QV-09`** — Le séquencement réel facturation/livraison pour un leasing (`RV-43`) — le garage
  attend-il le virement de l'organisme avant de livrer, ou livre-t-il sur promesse ferme ? **Où
  regarder** : la pratique décrite dans Auto-i/Nextlane pour un dossier leasing récent.
- **`QV-10`** — Les frais annexes (plaques, MFK, garantie, préparation) sont-ils systématiquement à
  8.1 %, ou certains postes ont-ils un traitement TVA particulier (débours purs, taxes reversées sans
  marge) ? **Où demander** : la fiduciaire, même question de fond que `QF-06` côté pièces (taxes de
  recyclage).
- **`QV-11`** — La garantie étendue vendue en supplément (`RV-48`) — le garage porte-t-il le risque
  lui-même ou revend-il un produit d'un assureur tiers dans tes garages ? Ça change qui encaisse quoi
  et qui gère un sinistre de garantie plus tard. **Où regarder** : un contrat de garantie étendue
  émis récemment, la mention de l'assureur y figure si c'est un produit tiers.
- **`QV-12`** — Le suivi de satisfaction post-livraison (`RV-58`) — outillé aujourd'hui dans tes
  garages, ou fait à la main (appel, e-mail) sans outil dédié ? Détermine si ça rejoint le lot 2
  (pointage/CRM) ou reste hors DFA.
- **`QV-13`** — L'import direct de véhicules par le garage lui-même (hors réseau d'importation
  officiel, `RV-61`) — pratique fréquente ou marginale dans tes garages ? Si marginale, ce module
  peut la laisser explicitement hors périmètre v1 plutôt que de la spécifier à moitié.
- **`QV-14`** — Le mécanisme de notification quand un véhicule proposé par un vendeur est vendu par
  un collègue entre-temps (§7.1) — un simple statut visible suffit-il, ou faut-il une alerte active ?
  Question d'écran (expert-ui), mais le comportement métier attendu vient d'abord du terrain.
- **`QV-15`** — Qui voit la marge d'un véhicule en stock (`RV-06`, §11) — le vendeur lui-même, ou
  uniquement direction/comptable ? Ça touche à une pratique de confidentialité commerciale
  courante (le vendeur ne voit pas toujours ce que le garage a payé le véhicule repris) —
  probablement variable d'un garage à l'autre, donc paramétrable, mais la valeur par défaut mérite
  ton avis.
- **`QV-16`** — L'enregistrement de la livraison (changement de détention, `RV-53`) — est-ce
  toujours le vendeur qui la fait, ou parfois un réceptionnaire/administratif comme pour la
  restitution atelier ? **Où regarder** : qui signe/valide la remise de clés dans le processus actuel
  de deux ou trois garages différents.

**Une question de priorité, pas seulement de contenu** : si une partie de tes dix+ garages fait
**surtout de l'atelier** avec très peu de vente de véhicules (quelques VO occasionnelles, pas de VN
du tout), l'étape 4 leur apporte peu de valeur immédiate comparée à l'étape 3 (Pièces), qui touche
tous les garages tous les jours. Ça vaut la peine de le savoir avant de prioriser l'implémentation
réelle de ce module par rapport aux Pièces — une répartition approximative (combien font
essentiellement de l'atelier, combien ont un vrai service des ventes VN/VO) m'intéresse pour la
suite de la feuille de route.
