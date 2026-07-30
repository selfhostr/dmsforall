# Modèle documentaire de facturation — conception

> Périmètre : la chaîne devis → bon de commande → facture → avoir, la numérotation légale, le
> calcul des montants et de la TVA, les paiements, la QR-facture, l'export fiduciaire, et les
> points d'accroche que l'**étape 1 doit poser dès maintenant**.
> Public : @laupernoe, expert-database, expert-nestjs, expert-migration-donnees, la
> fiduciaire du premier garage.
> Statut : **conception de référence pour l'étape 2**, à valider point par point sur les items
> `QF-xx` avant implémentation.
> Conventions de référence : `MD-xx` = règle du modèle documentaire · `CF-xx` = cas de test
> chiffré · `PF-xx` = paramètre de facturation · `QF-xx` = question à trancher par la fiduciaire
> ou le garagiste · `AC-xx` = point d'accroche à poser en étape 1.
> Ces préfixes sont distincts de ceux de la spécification étape 1 (`RM`, `CT`, `P`, `Q`), du plan
> backend (`T`, `V`, `I`) et de la reprise de données (`D`, `N`, `CR`, `QG`, `QE`, `R`).

---

## Sommaire

0. [Les trois exigences de la reprise — à graver maintenant](#0-les-trois-exigences-de-la-reprise--à-graver-maintenant)
1. [La chaîne documentaire et son immuabilité](#1-la-chaîne-documentaire-et-son-immuabilité)
2. [Numérotation continue, sans trou, garantie en base](#2-numérotation-continue-sans-trou-garantie-en-base)
3. [Montants, TVA, arrondis](#3-montants-tva-arrondis)
4. [Les cas réels](#4-les-cas-réels)
5. [QR-facture](#5-qr-facture)
6. [Export fiduciaire](#6-export-fiduciaire)
7. [Points d'accroche à poser en étape 1](#7-points-daccroche-à-poser-en-étape-1)
8. [Schéma récapitulatif](#8-schéma-récapitulatif)
9. [Cas de test chiffrés — index](#9-cas-de-test-chiffrés--index)
10. [Ce que je ne tranche pas seul](#10-ce-que-je-ne-tranche-pas-seul)

---

## 0. Les trois exigences de la reprise — à graver maintenant

`docs/reprise-donnees.md` (`D-23`, `D-04`, §5.5) remonte trois exigences vers ce modèle. Elles
passent en premier parce qu'elles sont les seules **irrattrapables** : le reste du modèle
s'ajoute par migration additive sur des documents verrouillés ; ces trois-là changent la
**clé d'unicité** et la **sémantique du numéro**, c'est-à-dire ce qu'on ne peut pas migrer sans
réécrire des documents que la loi et le trigger interdisent de réécrire.

### 0.1 `origine` — deux populations, une seule table

**MD-01** — `document_vente.origine` est un enum Postgres `origine_document` à deux valeurs :
`dfa` (émis par DFA) et `reprise` (importé depuis le système précédent). `NOT NULL`, défaut
`dfa`. Il n'y a **pas** de troisième valeur : un document est de nous, ou il ne l'est pas.

Pourquoi une colonne et pas une table séparée : les deux populations partagent tout ce qui
compte — la recherche par numéro au comptoir, le solde, le lettrage, la relance, la chaîne
facture→avoir, l'export. `document_repris` de la reprise (§5.6) reste une **archive froide
distincte** pour les documents soldés d'exercices clos ; les documents repris **encore vivants**
(créance ouverte, avoir rattaché) entrent dans `document_vente` avec `origine = 'reprise'`
(`D-05`). Deux tables pour la même question métier obligeraient chaque écran, chaque requête de
relance et chaque export à faire une union — et le jour où l'un l'oublie, une créance disparaît.

**MD-02** — `origine` est **immuable** dès l'insertion (trigger `BEFORE UPDATE`), y compris sur
un brouillon. Aucun chemin ne transforme un document repris en document DFA.

### 0.2 `numero_origine` — le numéro du garagiste, verbatim

**MD-03** — Trois colonnes, trois rôles distincts, jamais confondus :

| Colonne | Type | Rôle | `origine='dfa'` | `origine='reprise'` |
|---|---|---|---|---|
| `numero_sequence` | `integer null` | rang dans la séquence DFA — c'est **lui** qui porte la continuité légale | `NOT NULL` dès l'émission | toujours `NULL` |
| `numero` | `text null` | le numéro **affiché**, celui qu'on cherche et qu'on imprime | composé depuis `numero_sequence` + préfixe + année (`P-01`) | copie nettoyée de `numero_origine` |
| `numero_origine` | `text null` | le numéro source **verbatim**, octet pour octet | toujours `NULL` | `NOT NULL` |

```sql
check (
  (origine = 'dfa'     and numero_origine is null)
  or
  (origine = 'reprise' and numero_origine is not null and numero_sequence is null)
),
-- Le numéro n'existe qu'à partir de l'émission : un brouillon abandonné ne consomme rien.
check ((statut = 'brouillon') = (numero is null)),
check (origine <> 'dfa' or statut = 'brouillon' or numero_sequence is not null)
```

**MD-04** — `numero` n'est pas redondant avec `numero_origine`. `numero_origine` conserve la
chaîne source telle quelle : espaces insécables, apostrophes typographiques, caractères de
contrôle, zéros de tête, préfixes maison. `numero` en est la forme **affichable et indexable** :
seuls le rognage des blancs externes et la normalisation des espaces insécables (`U+00A0` → ` `)
et de l'apostrophe `U+2019` → `'` sont autorisés. **Aucun zéro de tête, aucun préfixe, aucun
séparateur n'est jamais retiré** — ce serait fabriquer un numéro que le client n'a pas sur son
papier. Le jour où un écart apparaît entre l'écran et le PDF du garagiste, `numero_origine` est
l'arbitre.

**MD-05 — Un document repris ne consomme jamais la séquence DFA.** Le chargeur d'import
n'appelle jamais `ServiceParametrage.prochainNumero()` (`D-23`). C'est la contrainte qui rend la
continuité légale démontrable : la suite DFA est contiguë *parce que* rien d'étranger n'y entre.

**MD-06 — Contraintes d'unicité couvrant les deux populations.**

```sql
-- 1. Le numéro affiché est unique par tenant et par série. Une facture reprise et une facture
--    DFA ne peuvent pas porter le même numéro : l'index ne connaît pas `origine`.
create unique index document_vente_numero_uk
    on document_vente (tenant_id, type_document, numero)
 where numero is not null;

-- 2. La séquence DFA est unique par tenant / série / exercice. C'est le support de la preuve
--    de continuité (§2.4).
create unique index document_vente_sequence_uk
    on document_vente (tenant_id, type_document, exercice, numero_sequence)
 where origine = 'dfa' and numero_sequence is not null;

-- 3. Un numéro source ne peut pas être importé deux fois (idempotence de l'import).
create unique index document_vente_numero_origine_uk
    on document_vente (tenant_id, type_document, numero_origine)
 where numero_origine is not null;

-- 4. Recherche au comptoir, non unique : le garagiste tape « 847 » ou « FA847 » indifféremment.
create index document_vente_numero_recherche_idx
    on document_vente (tenant_id, numero_normalise);
```

`numero_normalise` est une colonne générée : `upper(regexp_replace(numero, '[^0-9A-Za-z]', '', 'g'))`.

**Pourquoi l'unicité n° 1 porte sur `(tenant, type, numero)` et pas sur `(tenant, numero)`** :
un système source peut avoir réutilisé le même compteur pour ses devis et ses factures — le
document 847 existe alors deux fois, en deux natures. Interdire ça au niveau du tenant forcerait
à renuméroter un document repris, ce que `D-04` interdit. La collision inter-séries est donc
**tolérée en base et signalée en anomalie bloquante à l'import** : le garagiste voit la liste et
décide (préfixer les devis à l'import est acceptable, un devis n'a pas de valeur légale ;
préfixer une facture ne l'est pas).

**Pourquoi l'unicité n° 1 ne porte pas sur l'exercice** : parce qu'un numéro source peut ne pas
contenir d'année, et deux exercices produiraient alors deux `847`. En excluant l'exercice de la
clé, la base refuse la collision au lieu de la produire silencieusement.

> **Rappel `V-04` du plan backend** : les index uniques et les contraintes `EXCLUDE` ignorent le
> RLS et sont évalués sur toute la table. Les quatre index ci-dessus commencent tous par
> `tenant_id` — sans quoi la facture `2026-00318` du garage A bloquerait celle du garage B, et
> le message d'erreur divulguerait l'existence d'une ligne d'un autre tenant.

### 0.3 `tva_non_ventilee` — représenter une facture historique honnêtement

**MD-07** — `document_vente.tva_non_ventilee boolean not null default false`. À `true`, il
signifie : *la source ne donnait qu'un montant de TVA global ; le document porte ses totaux
exacts, mais la ventilation par ligne et par taux n'existe pas et n'a pas été inventée.*

Conséquences, toutes portées par le schéma :

```sql
-- Une TVA non ventilée n'est possible que sur un document repris.
check (not tva_non_ventilee or origine = 'reprise'),
-- Un document DFA a toujours son récapitulatif par taux ; un document à TVA non ventilée n'en a
-- aucun (contrôle applicatif + test d'intégration : aucune ligne dans document_vente_tva).
```

**MD-08 — L'égalité des totaux tient pour les deux populations, sans jamais corriger la source.**
`D-04` interdit de recalculer une facture reprise, et `N-06` constate que la somme des lignes
diverge parfois du total stocké. Le modèle absorbe cet écart au lieu de le nier :

```sql
total_ht_centimes      integer not null,
total_tva_centimes     integer not null,
ecart_reprise_centimes integer not null default 0,
total_ttc_centimes     integer not null,
check (total_ht_centimes + total_tva_centimes + ecart_reprise_centimes = total_ttc_centimes),
check (origine = 'reprise' or ecart_reprise_centimes = 0)
```

Un document DFA ne peut pas avoir d'écart : la contrainte le dit. Un document repris peut en
avoir un, il est **visible** (une ligne technique « écart de reprise » sur l'affichage, type de
ligne `ecart_reprise`), et il ne pollue jamais l'export comptable autrement que sur un compte
dédié paramétrable.

**MD-09** — `taux_tva_pourmille smallint null` au niveau du **document** est réservé aux
documents repris à TVA non ventilée : c'est le taux d'époque déduit de la date d'émission
(`N-07`). Sur un document DFA il est toujours `NULL` — le taux vit sur la ligne, jamais ailleurs.

**MD-10** — Un document repris est **verrouillé à l'écriture comme un document émis** (`D-24`).
Le trigger d'immuabilité (§1.4) ne fait aucune distinction d'origine. Correction d'un document
repris = avoir, émis par DFA, qui référence le document repris par sa clé.

### 0.4 Les six arbitrages métier irréversibles — à ne pas rouvrir

En plus des trois exigences de reprise ci-dessus, six décisions de gestion ont été tranchées et figées. Elles structurent le reste du modèle et ne peuvent pas être modifiées après mise en production du pilote sans des migrations rédhibitoires.

**1. Bloc créancier au niveau **tenant**, pas site.** Une entreprise multi-site (garage Alpine à Genève et Montreux) a une seule entité juridique (donc un seul bloc créancier, une seule série de numérotation légale). Si un site devait avoir son propre IBAN et ses propres coordonnées, il faudrait revoir les clés d'unicité de la numérotation, l'export fiduciaire (un grand livre par site ?), et le bloc créancier recopié sur chaque facture — décisions de fond, pas cosmétiques. La portée de numérotation (`P-01`) est déjà tenant ; la cohérence l'exige.

**2. Deux colonnes `iban` et `qr_iban` toujours distinctes, jamais fusionnées.** Une facture avec IBAN ordinaire + référence SCOR n'a pas de QR; un QR-IBAN oblige une référence QRR. Ces trois régimes (ordinaire-SCOR, ordinaire-NON, QR-IBAN-QRR) ont des durées de vie différentes — un changement de banque affecte l'un sans affecter l'autre. Fusuonner les deux impose à chaque changement d'IBAN de décider d'un régime pour tout. Les tenir séparés permet un changement graduel où des factures coexistent en deux régimes.

**3. Charge QR **recopiée** à l'émission, jamais recomposée à la lecture.** Le payload (le QR lui-même) est calculé une fois, figé en base, imprimé en PDF. S'il était recalculé à chaque accès, un changement d'IBAN du garage réécrirait rétroactivement le QR d'une facture de 2024 — le client qui sort son téléphone pour scanne le bulletin et paye la vérrait soudain **inexact** par rapport à ce qu'il a reçu il y a deux ans. Pire : s'il avait transcrit la référence en lettres à la main (cas limite mais légal), le paiement irait ailleurs. Le payload figé (`MD-77`) est la seule manière de tenir cette promesse : le PDF reste l'arbitre.

**4. `client_adresse.numero` est **nullable** — cases postales, lieux-dits, hameaux existent.** La conséquence visible : le bloc débiteur du QR peut être vide (` 7 lignes vides`) sur une facture émise (`RF-61`) — c'est le cas de la facture de démonstration. Interdire un adresse incomplète forcerait un faux numéro de rue, ce qui échouerait à la scan au guichet postal. Mieux vaut un QR incomplet, imprimable.

**5. `document_vente.devise` **resserrée à CHF/EUR uniquement** (migration `0015`).** Elle n'était contrainte qu'en forme (un texte), alors que `paiement.devise` était bornée (liste fermée). Un document dans une autre devise était structurellement impayable (aucun paiement possible, aucun QR possible). Vider la liberté de l'une vers un enum contrôlé protège une invariant : tout document peut être encaissé et exporté. Cette migration a été exécutée avec vérification que le jeu de démo contient uniquement CHF.

**6. Audit de l'IBAN tracé sur chaque changement** (migration `0016`).** La table du bloc créancier (les coordonnées du garage) n'avait pas de trigger d'audit. Qui a changé l'IBAN, quand, et la valeur précédente **doivent** être auditées — c'est de l'argent que vous n'accrocherez plus. Cette migration a ajouté le trigger ; elle a été appliquée avant le premier garage de production.

Les trois premières décisions ( tenant, deux colonnes IBAN, payload figé) changeront le schéma et l'import structurant si elles sont reconsidérées. Les trois dernières (numero nullable, devise, audit) affectent la logique applicative et l'export. **Aucune ne peut être contournée par un paramétrage ultérieur** — ce sont des structures, pas des options.

### 0.5 Coût comparé — pourquoi maintenant et pas après

| Ajout | Coût aujourd'hui (table vide) | Coût après la mise en production du pilote |
|---|---|---|
| `origine` | 1 enum + 1 colonne + 1 défaut | `ALTER TABLE` + backfill sur des lignes protégées par un trigger `BEFORE UPDATE` qu'il faut désactiver, donc une fenêtre où l'immuabilité est levée sur des factures émises |
| `numero_origine` + éclatement `numero`/`numero_sequence` | 3 colonnes + 4 index | réécriture de la clé d'unicité **et** de tous les numéros affichés ; toute référence externe (relance envoyée, écriture chez la fiduciaire, camt.054 déjà rapproché) devient fausse |
| `tva_non_ventilee` + `ecart_reprise_centimes` | 2 colonnes + 3 `CHECK` | un `CHECK` ajouté sur une table peuplée impose `NOT VALID` puis `VALIDATE`, et surtout : les documents repris déjà chargés auraient été soit refusés (impossible d'importer), soit ventilés arbitrairement (`D-04` violé, donc des faux en base) |

La reprise du premier garage a lieu **avant** ou **pendant** l'étape 2. Il n'y a donc pas de
fenêtre où l'on peut « voir venir » : la première facture importée arrive avant la première
facture émise.

---

## 1. La chaîne documentaire et son immuabilité

### 1.1 Les types et leur enchaînement

```
   devis ──accepté──▶ bon_commande ──▶ facture ──▶ (paiements)
     │                     │              │
     │                     │              └──▶ avoir  (correction, jamais modification)
     │                     │
     │                     └──▶ facture (nature = acompte) ──▶ facture (nature = ordinaire,
     │                                                          avec ligne acompte_deduit)
     └──▶ remplacé par un nouveau devis (jamais modifié)

   ordre_reparation ──▶ 1..n factures  (une par payeur, §4.5)
```

**MD-11** — `type_document` : `devis`, `bon_commande`, `facture`, `avoir`. Quatre séries de
numérotation indépendantes, chacune continue.

**MD-12 — La facture d'acompte n'est pas un cinquième type.** C'est une `facture` avec
`nature = 'acompte'`, dans **la même série** que les factures ordinaires. Raison : au regard de
la TVA c'est une facture pleine et entière (méthode des contre-prestations convenues), la
fiduciaire attend un livre de factures unique et continu, et une série de moins est un invariant
de continuité de moins à prouver. `nature_facture` : `ordinaire` | `acompte`. Voir `QF-02`.

**MD-13 — L'avoir a sa propre série.** Il ne bouche jamais un trou dans la série des factures —
c'est précisément ce qui rend la continuité des factures démontrable. Son signe est opposé
(§3.6), sa lecture comptable est distincte, et la fiduciaire les rapproche séparément.

**MD-14 — Liens de chaîne, en colonnes explicites plutôt qu'en table de liens.**

```sql
document_source_id  uuid null,  -- devis → bon_commande → facture (FK composite tenant)
facture_annulee_id  uuid null,  -- obligatoire et seulement si type_document = 'avoir'
ordre_reparation_id uuid null,  -- l'OR d'origine (n documents pour 1 OR, §4.5)
remplace_id         uuid null   -- devis v1 ← devis v2
```

Une table de liens générique serait plus « souple » et rendrait impossible tout `CHECK` utile.
Ici la base impose : un avoir a une facture, une facture n'a pas de facture annulée, un document
ne se référence pas lui-même, et la cible est du bon type (trigger, le `CHECK` ne pouvant pas
faire de sous-requête).

**MD-15** — `ligne_document.ligne_or_id uuid null` relie chaque ligne facturée à la ligne d'OR
dont elle provient. C'est ce qui rend la **facturation partielle** possible (facturer le client
maintenant, l'assureur quand l'expert donne son accord) sans jamais dupliquer une prestation :
une ligne d'OR ne peut apparaître que sur un seul document non annulé (index unique partiel).

### 1.2 États

| Type | États | Terminal |
|---|---|---|
| `devis` | `brouillon` → `emis` → {`accepte`, `refuse`, `expire`, `remplace`} | oui |
| `bon_commande` | `brouillon` → `emis` → {`transforme`, `annule`} | oui |
| `facture` | `brouillon` → `emis` → `annule_par_avoir` | oui |
| `avoir` | `brouillon` → `emis` | oui |
| tous | `brouillon` → `abandonne` | oui |

**MD-16 — Le règlement n'est pas un état du document.** `statut_reglement`
(`non_regle` | `partiel` | `regle` | `trop_percu` | `irrecouvrable`) est une colonne **dérivée**,
maintenue par trigger depuis `imputation_paiement`, jamais écrite à la main. Une facture émise et
soldée reste `emis` : son cycle de vie documentaire est terminé, seul son règlement bouge. Mélanger
les deux produit une machine à états où « payer » ressemble à « modifier », et où le trigger
d'immuabilité doit faire des exceptions.

**MD-17** — Les transitions vivent dans une table `transition_document_autorisee`
(`type_document`, `depuis`, `vers`), sur le modèle de `transition_autorisee` de l'étape 1 : une
transition inconnue est refusée par la base, pas par un `switch` que quelqu'un oubliera d'étendre.
Cette table n'a pas de `tenant_id` — elle est globale et en lecture seule ; `verifierPostureRls()`
doit savoir distinguer ce cas (`V-08`).

### 1.3 Ce qui est immuable, et à partir de quand

**MD-18 — Le point de non-retour est l'émission, pour les quatre types.** Pas la création, pas le
paiement, pas l'impression : l'émission, c'est-à-dire le moment où le document sort de DFA vers un
tiers. Un devis émis est immuable parce que le client en a une copie ; un bon de commande émis est
immuable parce qu'il est signé ; une facture émise est immuable parce que la loi l'exige.

**MD-19** — Un brouillon est librement modifiable et **ne porte aucun numéro**. Il ne se supprime
pas physiquement : il passe en `abandonne` (cohérent avec `RM-110`). Un brouillon abandonné n'a
jamais consommé de numéro, donc n'a jamais pu créer de trou.

**MD-20 — Liste blanche des colonnes écrivables après émission**, imposée par trigger
`BEFORE UPDATE` :

`statut`, `statut_reglement`, `montant_regle_centimes`, `solde_centimes`, `relance_niveau`,
`relance_le`, `pdf_cle`, `pdf_sha256`, `exporte_le`, `export_id`, `annule_par_avoir_id`,
`contentieux`, `modifie_le`.

Tout le reste — montants, lignes, client figé, adresse figée, dates, taux, numéro, payload QR —
provoque une erreur `problem+json` de code stable `document_verrouille`. Le trigger compare
`OLD`/`NEW` colonne par colonne ; il ne fait **aucune** exception pour un rôle, un administrateur
ou un script de maintenance.

**MD-21** — `ligne_document` : trigger `BEFORE INSERT OR UPDATE OR DELETE` qui rejette toute
opération dès que le document parent n'est plus en `brouillon`. Même patron que le verrouillage de
`pointage` de l'étape 1 (plan backend §4, `RM-95`).

**MD-22 — Une correction passe par un avoir, sans exception.** Y compris pour une faute de frappe
dans une adresse, y compris le jour même, y compris avant tout envoi. Il n'existe aucun endpoint,
aucun droit, aucun rôle « annuler l'émission ». La séquence est : avoir total référençant la
facture → nouvelle facture correcte. L'avoir et la facture de remplacement peuvent être créés dans
la même transaction et proposés en un seul geste dans l'UI — c'est une commodité d'écran, pas une
exception au modèle.

**MD-23** — Un avoir peut être **total** ou **partiel** (`portee`). Somme des avoirs sur une
facture ≤ total de la facture en valeur absolue, par taux de TVA (trigger). Un avoir hérite
**obligatoirement** des taux de TVA de la facture d'origine, jamais des taux courants — voir
`CF-09`, c'est le piège qui se déclenche au premier changement de taux.

### 1.4 Le figement : ce qu'un document recopie et ne référence pas

**MD-24** — Un document émis ne doit **rien** aller chercher ailleurs pour s'afficher. Toute donnée
externe est recopiée à l'émission : identité et adresse du client, n° IDE, langue, conditions de
paiement, coordonnées du créancier, taux de TVA, taux horaires, désignations, plaque et
identification du véhicule. Les FK (`client_id`, `vehicule_id`) restent pour la navigation et les
statistiques ; elles ne servent **jamais** au rendu.

C'est la même règle que `RM-50` sur l'OR, et la même raison que les libellés figés de l'archive de
reprise (§5.6) : « sans eux, l'archive ment progressivement ». Une fusion de clients (`RM-06`) ou
un changement d'adresse ne doit pas modifier rétroactivement une facture émise il y a deux ans.

**MD-25 — Un seul producteur de champs figés.** `ServiceSnapshotClient` (contrat de sortie de T8,
étape 1) est étendu pour produire le bloc figé de facturation. Aucun autre code n'écrit une colonne
`*_fige*` — c'est le risque `V-07` du plan backend, transposé.

---

## 2. Numérotation continue, sans trou, garantie en base

### 2.1 Pourquoi une séquence Postgres est disqualifiée

`nextval()` est **non transactionnel par conception** : il ne se rembobine jamais, précisément
pour ne pas sérialiser les écrivains. Trois conséquences, chacune rédhibitoire :

1. **Un `ROLLBACK` laisse un trou.** Une validation métier qui échoue après l'allocation, un
   `CHECK` violé, une erreur réseau, un `statement_timeout` : le numéro est consommé et perdu. Ce
   n'est pas cosmétique. Une suite de factures `…317, 319, 320…` oblige le garagiste à justifier
   le 318 devant l'AFC, et l'absence de justification fait présumer une facture soustraite.
2. **Une séquence n'est pas scopable par tenant.** Une séquence par tenant × type × exercice =
   des milliers d'objets de catalogue créés dynamiquement, hors de toute migration.
3. **Une séquence ne se remet pas à zéro annuellement** sans un `ALTER SEQUENCE RESTART` manuel
   à minuit le 31 décembre, exécuté par quelqu'un — c'est-à-dire un incident annuel programmé.

Le plan backend de l'étape 1 a déjà tranché dans ce sens pour les OR (`compteur_document`,
« Pas une `SEQUENCE` PostgreSQL »). L'étape 2 reprend le même dispositif, avec deux ajouts.

### 2.2 Le compteur, et l'ajout `valeur_depart`

```sql
create table compteur_document (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenant(id) on delete restrict,
  type_document text     not null,     -- 'facture' | 'avoir' | 'devis' | 'bon_commande'
                                       --   | 'ordre_reparation' | 'client' | 'reference_qr'
  annee         smallint not null,     -- 0 = pas de remise à zéro annuelle (P-01)
  site_id       uuid     null,         -- portée de numérotation (P-01)
  valeur        integer  not null default 0,
  valeur_depart integer  not null default 0,   -- ← AJOUT étape 2
  cree_le       timestamptz not null default now(),
  modifie_le    timestamptz not null default now(),
  check (valeur >= valeur_depart),
  check (valeur_depart >= 0)
);
create unique index compteur_document_uk
  on compteur_document (tenant_id, type_document, annee,
                        coalesce(site_id, '00000000-0000-0000-0000-000000000000'::uuid));
```

**MD-26 — `valeur_depart` rend le calage de reprise auditable.** À la fin d'un import,
`D-23` cale le compteur sur le dernier numéro du système source. Sans trace de ce calage, la
preuve de continuité (§2.4) échoue : elle constaterait qu'il manque 317 factures avant la
première. `valeur_depart` mémorise le point de départ ; la preuve devient exacte, et l'écran
d'administration peut afficher « la numérotation DFA reprend au 318, à la suite de l'ancien
système » plutôt qu'un chiffre sans contexte.

```sql
-- Calage de fin d'import (D-23), une seule fois, tracé dans le journal d'audit.
update compteur_document
   set valeur        = greatest(valeur, :max_numero_source),
       valeur_depart = greatest(valeur_depart, :max_numero_source)
 where tenant_id = :tenant and type_document = 'facture' and annee = :exercice;
```

**MD-27** — `annee` (clé du compteur, `0` si `P-01` désactive la remise à zéro) et
`document_vente.exercice` (l'exercice comptable, toujours l'année réelle de `date_document`) sont
**deux notions différentes**. Les confondre casse la numérotation d'un tenant qui a choisi une
suite continue pluriannuelle.

### 2.3 Le protocole d'allocation

```sql
-- Appelé EN DERNIER dans la transaction d'émission, juste avant le COMMIT.
insert into compteur_document (tenant_id, type_document, annee, site_id, valeur, valeur_depart)
values (:tenant, :type, :annee, :site, 1, 0)
    on conflict (tenant_id, type_document, annee,
                 coalesce(site_id, '00000000-0000-0000-0000-000000000000'::uuid))
    do update set valeur = compteur_document.valeur + 1
 returning valeur;
```

**Pourquoi ça résiste à la concurrence.** L'`UPDATE` pose un verrou de ligne tenu jusqu'au
`COMMIT`. Une transaction concurrente sur le même compteur **bloque**, puis — en `READ COMMITTED`,
le niveau par défaut et celui de l'API — relit la ligne mise à jour et applique son incrément sur
la nouvelle valeur. Il n'existe aucune fenêtre où deux transactions lisent la même valeur : ce
n'est pas un `SELECT … FOR UPDATE` suivi d'un `UPDATE`, c'est un `UPDATE … RETURNING` atomique.

**Pourquoi ça résiste aux transactions annulées.** Le compteur est une **ligne de table**, pas un
compteur hors transaction. Un `ROLLBACK` annule l'incrément : la valeur revient à ce qu'elle était,
et le numéro est réattribué à la transaction suivante. C'est exactement ce que `nextval()` ne fait
pas, et c'est toute la raison de ce choix.

**MD-28 — Le numéro est alloué en dernier, juste avant le `COMMIT`.** Règle déjà posée par le plan
backend (§6.2, contention de `compteur_document`) et **renforcée** en étape 2 : tout ce qui peut
échouer — validations métier, contrôle de période comptable close, calcul et gel du payload QR,
contrôle de plafond, contrôle des avoirs — s'exécute **avant**. La transaction d'émission ne
contient après l'allocation que l'`UPDATE` du document et l'écriture d'audit.

**MD-29 — Rien qui puisse échouer hors transaction ne doit dépendre du numéro.** La génération du
PDF est un job BullMQ postérieur au `COMMIT`. Un PDF qui ne se génère pas est un incident
d'exploitation : on le régénère. Si la génération était dans la transaction, elle deviendrait une
source de trous.

**MD-30 — Ordre d'allocation déterministe en cas d'allocations multiples.** Une transaction qui
émet plusieurs documents (multi-payeur, §4.5 : une facture client et une facture assurance dans le
même geste) alloue ses numéros **triés par `(type_document, annee, site_id)`**. Sans cet ordre,
deux transactions symétriques se bloquent mutuellement — un interblocage détecté par Postgres,
donc une transaction avortée, donc un incident évitable.

**MD-31 — Pas de réservation de numéro.** Aucun endpoint ne rend un numéro « à remplir plus tard ».
Un numéro alloué et non commité n'existe pas ; un numéro commité correspond à un document.

### 2.4 La preuve de continuité

Aucun `CHECK` ne sait exprimer « contigu ». La continuité se **prouve par une requête de contrôle**,
exécutée à trois moments : après chaque émission (test d'intégration), chaque nuit (job), et avant
chaque export fiduciaire (bloquant).

```sql
-- Toute ligne rendue par cette requête est un incident. Attendu : 0 ligne.
select tenant_id, type_document, exercice,
       count(*)                        as emis,
       min(numero_sequence)            as premier,
       max(numero_sequence)            as dernier
  from document_vente
 where origine = 'dfa'
   and numero_sequence is not null
 group by tenant_id, type_document, exercice
having count(*) <> max(numero_sequence) - min(numero_sequence) + 1
    or count(distinct numero_sequence) <> count(*);
```

Complétée par le raccord au compteur, qui vérifie que la suite démarre bien là où le calage de
reprise l'a laissée :

```sql
select d.tenant_id, d.type_document, d.exercice
  from (select tenant_id, type_document, exercice, min(numero_sequence) premier
          from document_vente where origine = 'dfa' and numero_sequence is not null
         group by 1,2,3) d
  join compteur_document c
    on c.tenant_id = d.tenant_id and c.type_document = d.type_document
   and c.annee in (d.exercice, 0)
 where d.premier <> c.valeur_depart + 1;
```

**MD-32 — La continuité est une exigence légale pour `facture` et `avoir`.** Elle est appliquée
au même titre à `devis` et `bon_commande` par uniformité du mécanisme (le coût est nul), mais un
trou sur ces deux séries est un avertissement, pas un incident : un devis n'a pas de valeur légale.
Le job nocturne distingue les deux niveaux.

**MD-33 — Monotonie des dates dans une série.** `date_document` d'un document émis doit être ≥ à
celle du dernier document émis de la même série (même jour accepté). Une facture n° 320 datée du
15.03 après une n° 319 datée du 20.03 est un défaut de forme qu'aucune fiduciaire n'accepte.
Contrôlé à l'émission, dans la même transaction que l'allocation. Voir `QF-09`.

**MD-34 — Aucune émission dans une période comptable close.** Table `periode_comptable`
(`tenant_id`, `debut`, `fin`, `cloturee_le`, `cloturee_par_id`). L'émission avec une
`date_document` dans une période close est refusée. C'est aussi ce qui protège l'export
fiduciaire déjà transmis (§6.5).

---

## 3. Montants, TVA, arrondis

### 3.1 Représentation

**MD-35** — Tous les montants sont des `integer` de **centimes**. Aucun `numeric`, aucun `float`,
aucune conversion par `parseFloat`. Un `numeric` en base et un `number` en TypeScript est le
chemin le plus court vers un centime qui disparaît entre deux couches.

| Grandeur | Colonne | Unité | Domaine |
|---|---|---|---|
| Prix unitaire | `prix_unitaire_centimes` | centime | `integer` |
| Quantité | `quantite_millieme` | millième d'unité | `integer` (4.5 L = `4500`) |
| Temps | `temps_millieme` | millième d'heure | `integer` (1.5 h = `1500`) |
| Taux de TVA | `taux_tva_pourmille` | pour mille | `smallint` |
| Remise en % | `remise_pourmille` | pour mille | `smallint` |

**MD-36 — Le pour mille représente exactement tous les taux suisses, présents et passés.**

| Période | Normal | Réduit | Hébergement |
|---|---|---|---|
| 01.01.2001 – 31.12.2010 | `76` | `24` | `36` |
| 01.01.2011 – 31.12.2017 | `80` | `25` | `38` |
| 01.01.2018 – 31.12.2023 | `77` | `25` | `37` |
| depuis le 01.01.2024 | **`81`** | **`26`** | **`38`** |

Aucune décimale perdue, aucun taux non représentable. La reprise (`N-07`) valide ce choix sur
l'historique ; l'étape 2 le valide sur le présent. Le tableau lui-même reste une base de travail
soumise à `QF-06`, pas une source fiscale.

**MD-37 — `regime_tva` accompagne toujours le taux.** Enum : `normal`, `reduit`, `hebergement`,
`exonere` (taux 0 avec droit à déduction : livraison exportée, `QF-08`), `exclu` (hors du champ,
sans droit à déduction), `marge` (imposition de la marge, documents repris antérieurs à 2018,
§4.6), `acquisition` (impôt sur les acquisitions). Le taux seul ne suffit pas : `exonere` et
`exclu` valent tous deux `0` et se traitent différemment dans la déclaration TVA et dans l'export.

**MD-38 — Le taux est figé sur la ligne, jamais lu au moment de l'affichage.** Un référentiel
global `taux_tva (regime, taux_pourmille, valide_du, valide_au)` — hors tenant, en lecture
seule — sert à **proposer** le taux à la saisie et à **contrôler la vraisemblance** à l'émission
(avertissement si le taux ne correspond pas à la date de prestation ; jamais un rejet pour un
document repris, `D-04`).

**MD-39 — Le taux applicable dépend de la date de la prestation, pas de la date de la facture.**
Une prestation exécutée en décembre 2026 facturée en janvier 2027 porte le taux de décembre 2026.
C'est pour cela que la ligne porte `date_prestation date not null` — voir `AC-04`, c'est un point
d'accroche de l'étape 1 et non une colonne à ajouter plus tard.

### 3.2 L'arrondi : une seule fonction, symétrique

**MD-40 — Arrondi commercial au demi éloigné de zéro** (`half away from zero`), en arithmétique
entière exclusivement :

```ts
/** Arrondit num/den au plus proche entier ; à égalité, s'éloigne de zéro. den > 0. */
export function arrondiCommercial(num: bigint, den: bigint): bigint {
  return num >= 0n ? (num + den / 2n) / den : -((-num + den / 2n) / den);
}
```

**Pourquoi « éloigné de zéro » et pas « vers le haut »** : avec un arrondi vers `+∞`, un montant
de `−40.5` millicentimes donnerait `−40` alors que son opposé donne `+41`. Un avoir total ne
solderait alors pas sa facture au centime — voir `CF-02`, où l'écart apparaît sur une ligne de
CHF 5.00.

**Pourquoi `bigint`** : `quantite_millieme × prix_unitaire_centimes` peut atteindre 10¹⁴ sur une
ligne extrême, et les agrégats d'export dépassent le seuil de sécurité de `Number` (2⁵³ ≈ 9×10¹⁵)
sur un exercice complet. La fonction vit dans `@dfa/shared` et est la **seule** autorisée à
arrondir de l'argent dans tout le dépôt ; une règle ESLint interdit `Math.round` sur un identifiant
contenant `centimes`.

### 3.3 Le calcul de la ligne

```
base_centimes    = arrondiCommercial(prix_unitaire_centimes × quantite_millieme, 1000)
remise_centimes  = remise_montant_centimes
                   ?? arrondiCommercial(base_centimes × remise_pourmille, 1000)
ht_centimes      = base_centimes − remise_centimes − remise_globale_repartie_centimes
tva_centimes     = arrondiCommercial(ht_centimes × taux_tva_pourmille, 1000)      [mode ht]
ttc_centimes     = ht_centimes + tva_centimes
```

**MD-41** — `remise_pourmille` et `remise_montant_centimes` sont **exclusifs** (`CHECK`). Les deux
renseignés, c'est une ambiguïté que personne ne saura trancher six mois plus tard.

**MD-42 — `ht_centimes`, `tva_centimes` et `ttc_centimes` sont stockés sur la ligne, pas calculés
à l'affichage.** Un document émis doit s'imprimer à l'identique dans dix ans, même si la fonction
d'arrondi change. Contrainte de cohérence en base :
`check (ttc_centimes = ht_centimes + tva_centimes)`.

### 3.4 Mode `ht` et mode `ttc` — une contrainte arithmétique incontournable

Un garage annonce ses prix pièces et ses forfaits **TTC** (obligation d'indication des prix au
consommateur), et raisonne **HT** en atelier. Le modèle doit supporter les deux. Or :

> **On ne peut pas avoir simultanément (a) un prix TTC exact tel qu'annoncé, (b) une TVA calculée
> par `arrondi(HT × taux)`, et (c) l'égalité `TTC = HT + TVA`.**

La démonstration ne consiste pas à exhiber un arrondi malheureux, mais à constater que **certains
montants TTC ne sont atteignables par aucun HT**. En mode `ht` à 81 ‰, l'application
`HT ↦ HT + arrondi(HT × 81 / 1000)` saute des valeurs : elle progresse tantôt de 1, tantôt de 2
centimes. Les valeurs sautées sont, littéralement, des prix TTC qu'on ne peut pas afficher.

Sur un forfait annoncé **CHF 70.00 TTC** — un prix de lavage ou de diagnostic parfaitement
ordinaire :

| HT saisi | `arrondi(HT × 81 / 1000)` | TTC obtenu |
|---|---|---|
| 64.75 | 5.24 | **69.99** |
| 64.76 | 5.25 | **70.01** |

Il n'existe aucun HT donnant 70.00. Le garage qui affiche « 70.— » en vitrine ne peut pas émettre
une facture à 70.00 en mode `ht`. Ce n'est pas un cas de laboratoire : sous CHF 40'000, **324'000
valeurs de TTC sont inatteignables**, soit 8.1 % de toutes les valeurs possibles — dont
CHF 1.00, 3.00, 5.00, 70.00, 145.00 et 40.50 (`CF-13`).

**MD-43 — `mode_calcul_tva` est une colonne de ligne**, enum `ht` | `ttc`, figée avec le reste :

| Mode | Ancre | TVA | HT |
|---|---|---|---|
| `ht` (défaut) | `ht_centimes` | `arrondi(ht × taux, 1000)` | saisi |
| `ttc` | `ttc_centimes` | `arrondi(ttc × taux, 1000 + taux)` | `ttc − tva` |

Dans les deux cas `TTC = HT + TVA` tient exactement, par construction. Sur le même forfait en
mode `ttc` : `TVA = arrondi(7'000 × 81 / 1081) = 525` ct, `HT = 6'475` ct, `TTC = 7'000` ct —
exact, et le prix affiché est tenu.

Noter ce qui s'est passé : le HT est **le même** (64.75) dans les deux modes, mais la TVA vaut
5.24 en mode `ht` et 5.25 en mode `ttc`. L'écart d'un centime n'a pas disparu — il a été déplacé
là où il ne se voit pas (la TVA d'une ligne, agrégée avec d'autres) plutôt que là où il fait
mentir le document (le prix que le client a lu et signé).

C'est aussi pour cela que la vente de véhicule de `CF-07` est saisie en mode `ttc` : sur
CHF 24'500.00, `TVA = arrondi(2'450'000 × 81 / 1081) = 183'580` ct et `HT = 2'266'420` ct. Ce
montant-là est atteignable dans les deux modes ; le mode `ttc` garantit qu'il le reste quel que
soit le prix négocié, y compris les 24'505.00 et 24'507.00 qui, eux, ne le sont pas.

`mode_calcul_tva` est un paramètre de tenant (`PF-01`) surchargeable par ligne : la main-d'œuvre
en `ht`, les pièces au tarif catalogue TTC en `ttc`, une vente de véhicule en `ttc`.

### 3.5 L'agrégation du document

```
document_vente_tva  (une ligne par couple (regime, taux) présent sur le document)
  regime_tva, taux_tva_pourmille,
  base_centimes = Σ ht_centimes des lignes du couple
  tva_centimes  = Σ tva_centimes des lignes du couple

total_ht_centimes  = Σ base_centimes
total_tva_centimes = Σ tva_centimes
total_ttc_centimes = total_ht_centimes + total_tva_centimes + ecart_reprise_centimes
```

**MD-44 — La TVA du document est la somme des TVA de ligne.** Règle de `CONTRIBUTING.md` et de `RM-107`,
appliquée sans exception. Elle diffère de l'autre méthode admise (une TVA par taux calculée sur la
base agrégée) d'au plus un demi-centime par ligne. `CF-03` exhibe l'écart d'un centime sur une
facture d'atelier banale de quatre lignes. C'est la valeur **par ligne agrégée** qui est stockée,
imprimée et exportée. Voir `QF-01` : ce point doit être confirmé par la fiduciaire du pilote avant
le premier export, parce que c'est elle qui devra vivre avec la différence.

**MD-45 — `document_vente_tva` est figé à l'émission**, comme le reste. Il alimente directement le
bloc récapitulatif TVA du PDF, l'information de facturation Swico du QR (§5.3) et l'export (§6).
Le recalculer à l'affichage rendrait le document dépendant du code du jour.

### 3.6 Le signe

**MD-46 — Les totaux et les lignes d'un avoir sont stockés en négatif.** `total_ttc_centimes < 0`,
`ht_centimes < 0`, `tva_centimes ≤ 0`, imposés par `CHECK` selon `type_document`. Toute somme sur
`document_vente` donne alors directement le chiffre d'affaires, sans traitement particulier —
c'est ce qui rend l'export (§6) et les contrôles de reprise (`CR-07`) triviaux et non ambigus.

L'affichage inverse le signe : le PDF d'un avoir annonce « Avoir de CHF 119.18 », pas
« CHF −119.18 ». C'est une décision de rendu, isolée dans le générateur de document.

### 3.7 L'arrondi au 5 centimes

**MD-47 — L'arrondi au 5 centimes appartient au paiement, jamais au document.** Le total d'une
facture est exact au centime. La même facture peut être réglée en espèces (arrondie), par carte
(exacte) ou par virement (exacte) : arrondir le document rendrait faux tout autre moyen de
paiement, et surtout rendrait faux le montant encodé dans le QR.

```ts
/** Arrondit au multiple de 5 centimes le plus proche, symétriquement autour de zéro. */
export function arrondiCinqCentimes(centimes: bigint): bigint {
  return centimes >= 0n
    ? ((centimes + 2n) / 5n) * 5n
    : -(((-centimes + 2n) / 5n) * 5n);
}
```

**MD-48** — Il n'y a jamais d'égalité à trancher : les centimes étant entiers, la distance à deux
multiples de 5 ne peut pas être égale (elle vaut au plus 2 d'un côté et 3 de l'autre). La règle
« arrondi au plus proche » est donc totale et déterministe, sans convention supplémentaire.

**MD-49** — L'écart d'arrondi est matérialisé : `imputation_paiement` de nature `arrondi`, montant
`∈ {−2, −1, 0, +1, +2}` centimes, comptabilisé sur un compte dédié paramétrable (§6.3, `QF-03`).
Il n'est jamais absorbé silencieusement dans le montant encaissé — une fiduciaire qui trouve un
écart de 2 centimes non expliqué remonte tout le journal.

---

## 4. Les cas réels

### 4.1 La structure qui résout tout : paiement ≠ imputation

**MD-50 — Un encaissement et son affectation sont deux objets distincts.**

```sql
paiement                                   -- ce qui est réellement entré en caisse ou en banque
  tenant_id, id, site_id,
  date_valeur date not null,
  moyen moyen_paiement not null,           -- especes|carte|virement|qr|twint|compensation|leasing
  montant_centimes integer not null,       -- signé : négatif = remboursement / contre-passation
  devise char(3) not null default 'CHF',
  payeur_client_id uuid null,              -- l'assurance, le leaser, le client…
  payeur_libelle text not null,            -- figé : « Mobilière, sinistre 2026-4471 »
  reference_qr text null,                  -- clé du rapprochement camt.054 (phase 2)
  identifiant_transaction_banque text null,
  source paiement_source not null,         -- 'manuel' | 'camt054' | 'terminal'
  contre_passe_id uuid null,               -- correction : un paiement inverse, jamais un UPDATE
  unique (tenant_id, identifiant_transaction_banque)   -- idempotence de l'ingestion camt.054

imputation_paiement                        -- ce que cet encaissement solde, et sur quel document
  tenant_id, id, paiement_id, document_id,
  montant_centimes integer not null,
  nature nature_imputation not null,       -- reglement|escompte|arrondi|perte|compensation
  impute_le timestamptz not null default now(), impute_par_id uuid
```

Cette séparation résout d'un seul coup les quatre cas que le terrain impose :

| Cas | Résolution |
|---|---|
| Paiement partiel | plusieurs imputations sur un même document, `solde = total − Σ imputations` |
| Un paiement pour plusieurs factures | plusieurs imputations d'un même paiement |
| Trop-perçu | une partie du paiement reste **non imputée** — elle n'est ni perdue ni forcée sur le document |
| Acompte avant tout document | un paiement non imputé, ou imputé sur un bon de commande |

**MD-51 — Deux invariants, et ils ne portent pas sur le même ensemble d'imputations.**

```
(a)  Σ TOUTES les imputations d'un document          ≤ |total_ttc| du document
(b)  Σ des imputations de nature 'reglement' d'un paiement ≤ |montant| du paiement
```

Tous deux par trigger. La restriction de (b) aux imputations de nature `reglement` n'est pas un
détail : `arrondi`, `escompte`, `perte` et `compensation` sont des **écarts qui soldent un
document sans qu'aucun argent ne circule**. Les inclure rendrait le modèle contradictoire —
`CF-05` le montre en deux lignes : sur une facture de 204.31 réglée 204.30 en espèces, les
imputations valent `reglement 204.30` + `arrondi 0.01` = 204.31, soit **plus que les 204.30
réellement encaissés**. Un invariant (b) non restreint refuserait l'écriture, et l'implémenteur
« corrigerait » en absorbant le centime dans l'encaissement — c'est-à-dire en déclarant une
recette de caisse fausse. Le contrôle de caisse du soir ne tomberait plus juste.

**Un document ne peut jamais afficher un solde négatif** : le trop-perçu vit sur le paiement, pas
sur la facture (`CF-11`). C'est ce qui garde le grand livre des débiteurs juste.

**MD-52 — Un paiement est immuable.** Aucune correction en place : on enregistre un paiement de
sens opposé, lié par `contre_passe_id`. Une saisie erronée reste visible, avec sa correction — ce
qu'exige la piste d'audit et ce que la fiduciaire cherche en premier.

**MD-53** — `montant_regle_centimes`, `solde_centimes` et `statut_reglement` sur le document sont
**dérivés et maintenus par trigger** depuis `imputation_paiement`. Ils sont dans la liste blanche
d'écriture après émission (`MD-20`) : ils bougent alors que le document ne bouge pas.

### 4.2 Acomptes

**MD-54 — Deux dispositifs, à ne pas confondre.**

1. **Encaissement d'acompte sans facture** — le client verse 2'000.— à la signature du bon de
   commande. C'est un `paiement` rattaché au `bon_commande`, ou non imputé. **Aucune TVA n'est
   due à ce stade** en méthode des contre-prestations convenues, puisqu'aucune facture n'a été
   émise. Comptablement : dette envers le client (compte d'acomptes reçus).
2. **Facture d'acompte** — un document `facture` avec `nature = 'acompte'`, dans la série des
   factures (`MD-12`). Elle **déclenche la TVA** en méthode convenue. C'est le dispositif normal
   sur une vente de véhicule, parce que le client veut une pièce justificative.

Le choix entre les deux dépend de la méthode de décompte TVA du garage (convenues / reçues) et de
sa pratique. Ce n'est pas à moi de trancher : `QF-02`.

**MD-55 — La facture finale déduit l'acompte par une ligne, jamais par un solde implicite.** Type
de ligne `acompte_deduit`, montant négatif, référence explicite au document d'acompte
(`ligne_document.document_acompte_id`), **au même taux et dans le même mode de calcul** que la
facture d'acompte. C'est ce qui garantit que la TVA déduite est exactement celle qui a été
déclarée — voir `CF-07`, où les 374.65 se retrouvent au centime.

```sql
check (type_ligne <> 'acompte_deduit' or (montant_ht_centimes < 0 and document_acompte_id is not null))
```

**MD-56** — Somme des acomptes déduits ≤ somme des acomptes facturés, par document source
(trigger). Un acompte ne peut pas être déduit deux fois, ni sur deux factures finales.

### 4.3 Trop-perçus

**MD-57** — Le montant non imputé d'un paiement est une **avance client**. Trois issues, toutes
explicites, aucune automatique :

| Issue | Traitement |
|---|---|
| Remboursement | `paiement` de montant négatif, moyen `virement`, lié par `contre_passe_id` |
| Imputation sur une facture future | nouvelle `imputation_paiement` sur le nouveau document |
| Abandon en faveur du garage | imputation de nature `compensation` sur un document de régularisation |

L'écran de fiche client affiche « avance disponible : CHF 19.00 » et la propose à l'imputation lors
de la facture suivante. Ce qu'on ne fait **jamais** : créer un avoir pour matérialiser un
trop-perçu. Un avoir corrige un document, pas un mouvement d'argent.

### 4.4 Remises

**MD-58 — Remise par ligne, en pour mille ou en montant** (§3.3). C'est le cas normal, et c'est ce
que `RM-74` impose : la TVA se calcule par ligne, donc la remise doit être connue par ligne.

**MD-59 — Une remise globale est ventilée sur les lignes à l'émission, au prorata de leur base.**
Le document conserve `remise_globale_saisie_centimes` (ou `remise_globale_pourmille`) **pour
l'affichage** — le client voit bien « Remise fidélité 10 % : CHF −18.34 » sur une seule ligne — et
chaque ligne porte sa part dans `remise_globale_repartie_centimes`.

Pourquoi ventiler au lieu de soustraire du total : une facture mêlant 8.1 % et 0 % (véhicule
exporté) verrait sinon sa remise imputée sur un seul taux arbitraire, ce qui fausse la déclaration
TVA. Le type de ligne `remise` prévu par `RM-63` reste utilisable **uniquement** sur un document
mono-taux ; DFA ventile toujours, ce qui le rend inutile.

**MD-60 — Le résidu d'arrondi de la ventilation est affecté à la ligne de plus grande base ; à
égalité, à celle dont l'ordre d'affichage est le plus petit.** Invariant vérifié par trigger :
`Σ remise_globale_repartie_centimes = remise_globale_saisie_centimes`, au centime. Voir `CF-06`,
où le résidu vaut 1 centime sur trois lignes égales.

**MD-61** — Les plafonds de remise par rôle (`P-13`) sont contrôlés **à l'émission**, sur le
montant effectivement remisé (remise de ligne + part de remise globale), pas à la saisie du
brouillon. Un brouillon peut tout contenir ; c'est l'émission qui engage.

### 4.5 Plusieurs payeurs pour un même OR

C'est le cas de la carrosserie : l'assurance paie les dégâts, le client paie sa franchise et les
travaux d'entretien qu'il a demandés au passage.

**MD-62 — Un OR produit `1..n` factures, une par payeur.** `RM-66` et `RM-67` ont déjà posé le
`payeur` sur la ligne d'OR ; l'étape 2 en tire les documents. Le regroupement se fait par
`(payeur, payeur_client_id)`.

**MD-63 — La franchise est une ligne de répartition explicite sur les deux documents, jamais un
calcul implicite** (`RM-68`). Sur la facture de l'assurance : une ligne négative « franchise à
charge du client ». Sur la facture du client : la même ligne, positive. Les deux au même taux et
au même mode de calcul, sinon l'invariant ci-dessous saute d'un centime.

**MD-64 — Invariant de non-fuite, contrôlé par test d'intégration et par requête de contrôle :**

```
pour chaque OR facturé, pour chaque taux de TVA :
    Σ (base, tva) des lignes de tous les documents non annulés issus de l'OR
  = Σ (base, tva) des lignes facturables de l'OR
```

Au centime, par taux. C'est le contrôle qui détecte une prestation facturée deux fois ou pas du
tout — l'erreur la plus coûteuse et la plus difficile à voir à l'œil sur un OR de carrosserie à
quarante lignes. Voir `CF-10`.

**MD-65 — Facturation partielle dans le temps.** L'assureur peut mettre six semaines à donner son
accord. Le client, lui, paie en repartant. Le modèle le permet sans rien inventer :
`ligne_or.statut_facturation` (`non_facturable` | `a_facturer` | `facture` | `annule`) et
`ligne_document.ligne_or_id`. L'OR passe à `facture` quand plus aucune ligne n'est `a_facturer`.
C'est le point d'accroche `AC-06`, à poser en étape 1.

**MD-66 — Les lignes de payeur `garage`** (geste commercial, retouche, casse — `RM-70`) sont
**facturées à personne et valorisées quand même** : `montant_facturable_centimes = 0` et
`montant_valorise_centimes = coût interne`. Elles apparaissent à 0.00 sur le récapitulatif client
avec leur mention, et sur un compte d'analyse à l'export. Deux colonnes, pas une (`AC-07`).

**MD-67 — À qui la facture est-elle adressée dans un sinistre ?** Le destinataire (le titulaire de
la relation contractuelle) et le payeur (celui qui verse) peuvent différer, et la réponse a des
conséquences TVA — qui déduit l'impôt préalable. Le modèle porte les deux
(`client_id` / `paiement.payeur_client_id`) et n'impose pas de règle. Le choix de pratique est
`QF-05`.

### 4.6 TVA sur marge des occasions — ce qui a changé en 2018

**MD-68 — L'imposition de la marge sur les biens d'occasion a été abrogée au 01.01.2018** et
remplacée par la **déduction de l'impôt préalable fictif** (LTVA art. 28a). Conséquences concrètes
pour le modèle, à confirmer par la fiduciaire (`QF-07`) :

- Une **vente d'occasion courante** (2026) est une vente normale à 8.1 % sur le **prix de vente
  total**. Il n'y a pas de mention particulière, pas de régime spécial sur la facture.
- Le bénéfice fiscal se joue **à l'achat**, pas à la vente : le garage qui rachète un véhicule à
  un particulier non assujetti déduit un impôt préalable fictif calculé sur le prix d'achat. Cette
  information vit dans le **dossier de vente / la fiche véhicule en stock** (étape 4), pas sur la
  facture de vente.
- Le régime `marge` reste dans l'enum **pour les documents repris antérieurs à 2018** : ils portent
  la mention légale « imposition de la marge » et **n'affichent aucun montant de TVA** — en afficher
  un ouvrirait au client un droit à déduction indu.

**MD-69** — D'où une colonne `mention_tva_interdite boolean not null default false` : à `true`, le
générateur de document n'imprime ni taux, ni montant, ni récapitulatif de TVA. C'est la seule
manière de rendre fidèlement une facture reprise sous imposition de la marge, et la contrainte
correspondante : `check (not mention_tva_interdite or total_tva_centimes = 0)`.

**MD-70 — Ce que l'étape 2 doit préparer sans l'implémenter** : la vente de véhicule (étape 4)
aura besoin, sur la facture, du lien vers le dossier de vente et du prix d'achat pour la déduction
fictive. Une colonne `dossier_vente_id uuid null` posée dès l'étape 2 évite une migration sur des
factures verrouillées ; elle ne coûte rien tant qu'elle est vide.

### 4.7 Escompte, perte sur créance

**MD-71 — Un escompte ne se traite pas par un avoir.** Le client qui paie sous 10 jours avec 2 %
d'escompte verse moins que le montant facturé. La facture reste ce qu'elle est ; la différence est
une **imputation de nature `escompte`**, qui solde le document et va sur un compte de réduction de
produits, **avec correction proportionnelle de la TVA**. Voir `CF-14`, où le calcul tombe juste au
centime. Certaines fiduciaires exigent malgré tout un avoir : `QF-04`.

**MD-72** — Une créance abandonnée suit exactement la même structure, nature `perte`, sur le compte
de pertes sur clients, avec la même correction de TVA. Le document n'est pas modifié, il passe en
`statut_reglement = 'irrecouvrable'`.

---

## 5. QR-facture

Référence : Swiss Payment Standards, *Implementation Guidelines QR-bill* (version 2.3) et
*Style Guide QR-facture*. Tout ce qui suit est à revérifier contre la version en vigueur au moment
de l'implémentation — c'est une spécification vivante, et elle a déjà supprimé une fonctionnalité
en cours de route (`MD-77`).

### 5.1 Ce que le modèle porte

**MD-73** — Bloc créancier, au niveau du **tenant** (paramétrage) et **recopié figé** sur chaque
document émis :

| Donnée | Contrainte |
|---|---|
| `qr_iban` | IBAN suisse valide. **QR-IBAN** si l'IID (positions 5 à 9) est dans `30000`–`31999` |
| `creancier_nom` | 70 caractères max |
| `creancier_rue`, `creancier_numero` | adresse **structurée** obligatoire (`MD-77`) |
| `creancier_npa`, `creancier_localite`, `creancier_pays` | NPA 16 car. max, localité 35, pays ISO-2 |

**MD-74 — Le type de référence découle du type d'IBAN, et la base l'impose.**

| IBAN | Référence | Interdit |
|---|---|---|
| QR-IBAN (IID 30000–31999) | **QRR** — 27 chiffres, obligatoire | SCOR, NON |
| IBAN ordinaire | **SCOR** (ISO 11649) ou **NON** | QRR |

```sql
check (
  (type_reference_qr = 'qrr'  and qr_iban_est_qr_iban      and qr_reference ~ '^[0-9]{27}$')
  or (type_reference_qr = 'scor' and not qr_iban_est_qr_iban and qr_reference ~ '^RF[0-9]{2}[0-9A-Z]{1,21}$')
  or (type_reference_qr = 'non'  and not qr_iban_est_qr_iban and qr_reference is null)
)
```

`qr_iban_est_qr_iban` est une colonne générée depuis `qr_iban` : la contrainte reste vraie même si
le tenant change d'IBAN, parce que le document a figé le sien.

**MD-75 — La référence QR est allouée sur un compteur dédié qui ne se remet jamais à zéro et dont
les valeurs ne sont jamais réutilisées** (`compteur_document.type_document = 'reference_qr'`,
`annee = 0`). Un trou dans les références QR est sans conséquence ; une **réutilisation** est
catastrophique, parce qu'elle rapprocherait un paiement de 2031 sur une facture de 2026 encore
ouverte. C'est l'inverse exact de la règle des numéros de document, et il faut que ce soit écrit
noir sur blanc dans le code.

Composition proposée des 26 chiffres utiles, avant chiffre de contrôle :
`[10 zéros de remplissage][4 exercice][2 type][10 compteur]` — voir `CF-15`.

**MD-76 — Unicité perpétuelle** : `unique (tenant_id, qr_reference) where qr_reference is not null`,
sans restriction d'exercice ni de type. C'est la clé de jointure du rapprochement camt.054.

### 5.2 Ce qui est figé à l'émission — et pourquoi

**MD-77 — `qr_payload text` : la chaîne exacte encodée dans le QR, octet pour octet.** C'est la
colonne la plus importante de cette section. Trois raisons, chacune suffisante :

1. **Le créancier change.** Le garage change de banque, déménage, corrige la raison sociale au
   registre du commerce. Une facture émise avant reste payable telle qu'elle a été envoyée ; un
   duplicata doit reproduire le **même** QR, sinon la banque du client rejette le paiement ou le
   crédite ailleurs.
2. **La spécification change.** L'adresse combinée (type `K`) a été **supprimée le 21.11.2025** :
   seules les adresses structurées (`S`) sont acceptées depuis. Un payload recalculé à l'affichage
   changerait de forme au fil des versions de la spec, sur des documents censés être immuables.
3. **La preuve.** `qr_payload_sha256` permet d'affirmer, en litige, que le PDF détenu par le client
   porte bien le QR que DFA a produit. C'est aussi la réponse à l'exigence d'intégrité des documents
   conservés sur support modifiable (`QF-13`).

Sont figés avec lui : `qr_reference`, `type_reference_qr`, `qr_iban`, le bloc créancier, le bloc
débiteur tel qu'imprimé, `qr_montant_centimes`, `qr_devise`, et `qr_langue` (la langue de la
section paiement, celle du client au moment de l'émission — `P-23`).

**MD-78 — Ce qui n'est pas figé** : la mise en page. Elle est déterminée par la spécification et
par le gabarit de rendu ; la regénérer avec un gabarit corrigé est légitime tant que le payload,
lui, ne bouge pas. Sont dérivés à l'affichage et non stockés : le formatage du montant, le
groupage de la référence (`00 00000 00020 26100 00000 04241`, cf. `CF-15`), l'image du QR
elle-même.

### 5.3 Structure du payload

Champs dans l'ordre, séparateur `CR+LF`, encodage **UTF-8**, **997 caractères maximum** :

```
SPC                          QRType, fixe
0200                         Version
1                            Coding Type (UTF-8)
CH________________           IBAN / QR-IBAN du créancier, sans espaces
S                            Adresse structurée (K interdit depuis le 21.11.2025)
<nom> <rue> <n°> <npa> <localité> <pays>       créancier, 6 lignes
(7 lignes vides)             Ultimate Creditor — réservé, toujours vide
<montant>                    optionnel ; 2 décimales, point décimal, sans séparateur de milliers
CHF                          CHF ou EUR uniquement
S|<nom> <rue> <n°> <npa> <localité> <pays>     débiteur final, ou 7 lignes vides
QRR|SCOR|NON                 type de référence
<référence>                  27 chiffres (QRR) ou RFxx… (SCOR) ou vide (NON)
<message non structuré>      140 car. max
EPD                          Trailer
<information de facturation> Swico S1, 140 car. max
<AV1> <AV2>                  procédures alternatives, 100 car. max chacune
```

**MD-79 — Le bloc débiteur est omis en entier si l'adresse est incomplète**, plutôt qu'émis
partiellement. Un client repris sans rue ni NPA (`N-08`) produirait un payload invalide ; sans bloc
débiteur, le payeur écrit son adresse à la main et le paiement passe. Règle d'or : mieux vaut un QR
valide et incomplet qu'un QR complet et refusé au guichet.

**MD-80 — L'information de facturation Swico S1 est construite depuis `document_vente_tva`**, pas
recalculée : `//S1/10/<numéro>/11/<date AAMMJJ>/30/<n° TVA>/31/<date prestation>/32/<taux:base>/
40/<conditions de paiement>`. Elle est ce qui permet à la fiduciaire du **destinataire** d'imputer
automatiquement — un argument commercial réel auprès des clients entreprises et des flottes.

**MD-81 — Contraintes de montant** : `0.01` à `999'999'999.99`, `CHF` ou `EUR` uniquement. Une
facture en devise autre que CHF/EUR ne peut pas porter de QR ; le document existe, la section
paiement est remplacée par les coordonnées bancaires en clair.

### 5.4 Le bulletin de solde

**MD-82** — Le QR d'une facture porte le **montant total**, et ne change jamais — même après un
paiement partiel. Pour encaisser un solde, DFA émet un **bulletin de paiement** distinct :

```sql
bulletin_paiement
  tenant_id, id, document_id, motif ('facture' | 'solde' | 'relance' | 'creance_reprise'),
  qr_reference text not null,          -- la MÊME que le document quand il en a une
  qr_montant_centimes integer null,    -- null = montant libre, le payeur saisit
  qr_payload text not null, qr_payload_sha256 text not null,
  emis_le timestamptz not null
```

La référence reste celle du document : le rapprochement camt.054 continue de pointer la bonne
facture. Le montant est soit le solde, soit **absent** (autorisé par la spec), ce qui est la
solution la plus robuste quand le client paie en plusieurs fois.

**MD-83 — Le bulletin est aussi la réponse aux créances reprises.** Une facture importée avec
`origine = 'reprise'` et un solde ouvert n'a pas de QR de DFA — elle a été imprimée par l'ancien
système. Pour la relancer, DFA émet un `bulletin_paiement` avec **une référence DFA neuve**, sans
toucher au document (`D-24`, `MD-10`). C'est le seul mécanisme qui permet de relancer un impayé
repris sans falsifier le document d'origine.

### 5.5 Ce que le rapprochement camt.054 exige dès maintenant (phase 2)

Rien à implémenter en étape 2, trois colonnes à ne pas oublier :
`paiement.reference_qr`, `paiement.identifiant_transaction_banque` (unique par tenant, c'est
l'idempotence de l'ingestion : un fichier camt importé deux fois ne crédite pas deux fois), et
`paiement.date_valeur` distincte de `cree_le`. Plus la garantie `MD-76` d'unicité perpétuelle de
la référence.

---

## 6. Export fiduciaire

### 6.1 Le modèle d'écriture neutre

**MD-84 — Le cœur produit des écritures, les adaptateurs les sérialisent.** Aucun adaptateur ne
calcule un montant, ne choisit un compte, ni n'arrondit. C'est le principe de la couche connecteurs
(`ARCHITECTURE §5`) appliqué à l'argent, et c'est ce qui rend les quatre cibles interchangeables.

```ts
export interface LigneEcriture {
  readonly compte: string;                    // compte du plan du tenant
  readonly sens: 'debit' | 'credit';
  readonly montantCentimes: number;           // toujours > 0 ; le sens porte le signe
  readonly codeTva: string | null;            // code de la cible, jamais un taux brut
  readonly tauxPourmille: number | null;
  readonly baseTvaCentimes: number | null;
  readonly libelle: string;
}

export interface Ecriture {
  readonly reference: string;                 // n° de document ou identifiant de paiement
  readonly date: string;                      // ISO 8601, date comptable
  readonly libelle: string;
  readonly centreDeCharge: string | null;     // code du site
  readonly lignes: readonly LigneEcriture[];  // invariant : Σ débits = Σ crédits
  readonly documentId: string | null;         // traçabilité retour vers DFA
}

export interface AccountingExporter {
  readonly cible: CibleExport;                // 'bexio'|'winbiz'|'abacus'|'banana'|'csv'
  readonly capacites: CapacitesExport;        // multi-devise, centres de charge, codes TVA…
  exporter(lot: LotExport, ecritures: readonly Ecriture[]): Promise<ResultatExport>;
}
```

**MD-85 — L'équilibre est vérifié avant l'appel à l'adaptateur**, écriture par écriture, en
`bigint`. Une écriture déséquilibrée fait échouer le lot entier : on ne transmet pas un journal
partiellement faux à une fiduciaire, on corrige et on retransmet.

### 6.2 Les écritures produites

| Événement | Débit | Crédit |
|---|---|---|
| Facture émise | Créances clients (TTC) | Produits par catégorie (HT par compte) + TVA due (par taux) |
| Facture d'acompte | Créances clients (TTC) | Acomptes reçus (HT) + TVA due |
| Facture finale avec acompte | Créances clients (solde) + Acomptes reçus (HT de l'acompte) | Produits (HT) + TVA due (différence) |
| Avoir | Produits (HT) + TVA due | Créances clients (TTC) |
| Encaissement | Compte financier | Créances clients |
| Encaissement espèces arrondi | Caisse (montant arrondi) | Créances clients (montant exact) + Différences d'arrondi |
| Escompte | Compte financier + Escomptes (HT) + TVA due (part) | Créances clients |
| Perte sur créance | Compte financier + Pertes sur clients + TVA due (part) | Créances clients |

Chacune est démontrée équilibrée dans les cas de test `CF-04`, `CF-07`, `CF-09` et `CF-14`.

### 6.3 Le plan comptable et son mapping

**MD-86 — Le plan comptable PME suisse est un défaut, pas une vérité.** Le mapping est
paramétrable par tenant (`ARCHITECTURE §4`), parce que chaque fiduciaire a ses habitudes et que le
garage ne changera pas les siennes pour DFA.

```sql
mapping_compte (tenant_id, usage, categorie, compte, actif_du, actif_au)
  -- usage    : 'creances_clients' | 'produit' | 'tva_due' | 'acomptes_recus'
  --            | 'financier' | 'arrondi' | 'escompte' | 'perte' | 'ecart_reprise'
  -- categorie: type de ligne, moyen de paiement, ou taux de TVA selon l'usage
mapping_code_tva (tenant_id, cible, regime_tva, taux_pourmille, code_externe)
correspondance_externe (tenant_id, cible, entite, dfa_id, externe_id)
```

Proposition de défaut, **à faire valider par la fiduciaire du pilote avant le premier export**
(`QF-03`) :

| Usage | Compte proposé | Libellé |
|---|---|---|
| Créances clients | `1100` | Créances résultant de ventes et de prestations |
| Caisse / banque | `1000` / `1020` | selon le moyen de paiement |
| Acomptes reçus | `2030` | Acomptes de clients |
| TVA due | `2200` | TVA sur le chiffre d'affaires |
| Produits — pièces, fournitures | `3200` | Ventes de marchandises |
| Produits — main-d'œuvre, forfaits, produits d'atelier | `3400` | Prestations de services |
| Produits — sous-traitance | `3400` ou compte dédié | à trancher avec la fiduciaire |
| Produits — taxes de recyclage | `3600` | Autres prestations — dépend de `QF-06` |
| Escomptes | `3800` | Déductions sur ventes |
| Pertes sur clients | `3805` | Pertes sur créances |
| Différences d'arrondi | à définir | `QF-03` — compte de produit ou de charge selon la fiduciaire |
| Écart de reprise | compte technique dédié | jamais mélangé à un compte de produit |

**MD-87 — `correspondance_externe` est le pendant de `correspondance_reprise`** (reprise §5.2) :
l'API Bexio veut des identifiants de contacts et de comptes qui lui appartiennent. Sans table de
correspondance, chaque export recrée des doublons chez la fiduciaire.

### 6.4 Niveau d'agrégation

**MD-88 — Deux modes, paramétrables par tenant et par cible (`PF-05`), jamais un seul.**

| Mode | Une écriture par | Pour qui |
|---|---|---|
| `detaille` (défaut) | document, puis par paiement | Bexio, WinBIZ, Abacus : la fiduciaire tient le grand livre des débiteurs dans son outil et veut chaque facture |
| `agrege` | jour × compte × taux de TVA | Banana sur un petit garage : la fiduciaire ne veut pas 900 écritures par mois, DFA reste le grand livre des débiteurs |

**MD-89 — Trois choses ne sont jamais agrégées**, quel que soit le mode : les **taux de TVA** entre
eux (la déclaration TVA deviendrait infaisable), le **compte de créances clients** par client
(l'agrégation détruit le lettrage), et les **exercices** entre eux.

**MD-90 — Toute écriture porte de quoi revenir à sa source** : `reference` (le numéro affiché du
document, celui que le garagiste et le client connaissent) et `documentId`. Une fiduciaire qui
trouve une écriture bizarre doit pouvoir demander « la facture 2026-00318 » et la recevoir en
trente secondes.

### 6.5 Ce qu'il faut conserver pour rester exportable

**MD-91 — Le lot d'export est un objet de première classe, conservé à vie.**

```sql
export_comptable
  tenant_id, id, cible, mode, periode_debut date, periode_fin date,
  genere_le, genere_par_id, nb_ecritures, total_debit_centimes, total_credit_centimes,
  empreinte_sha256 text not null,        -- du fichier ou de la charge utile transmise
  statut ('genere' | 'transmis' | 'accepte' | 'rejete'),
  reponse_cible jsonb                     -- identifiants rendus par l'API, erreurs
```

Plus, sur chaque document et chaque paiement : `exporte_le` et `export_id`. Ce sont deux colonnes
de la liste blanche (`MD-20`) : elles bougent sur un document verrouillé, parce qu'elles décrivent
ce qu'on a fait du document, pas le document.

**MD-92 — Un document déjà exporté ne peut pas être ré-exporté dans un autre lot** sans une action
explicite d'exploitation tracée. C'est la protection contre le double comptage, la faute qui coûte
le plus cher en confiance.

**MD-93 — Une correction postérieure à un export part dans le lot suivant, jamais dans le lot
transmis.** Un avoir émis en avril sur une facture de mars est une écriture d'avril. C'est
exactement pourquoi la chaîne interdit la modification : elle rend cette règle mécanique au lieu de
la confier à la vigilance de quelqu'un.

**MD-94 — Ce qui doit être conservé sur le document pour rester exportable vers les quatre
cibles** — la liste est courte et il suffit qu'un seul élément manque pour bloquer :
numéro affiché, date de document, date de prestation, échéance, identité et n° IDE du client figés,
devise, ventilation par taux (`document_vente_tva`), catégorie comptable de chaque ligne, code
site, référence QR, et le PDF avec son empreinte.

**MD-95 — Durée de conservation : 10 ans** (CO art. 958f), et l'exigence d'intégrité pour les
documents conservés sur support modifiable (`QF-13`) est couverte par `pdf_sha256`, `qr_payload_sha256`
et le journal d'audit. Ce qui suppose que le PDF soit **stocké**, pas régénéré à la demande — un PDF
régénéré est un document différent.

---

## 7. Points d'accroche à poser en étape 1

> C'est la section actionnable **maintenant**. Chaque ligne est une colonne ou une table à ajouter
> pendant que `ordre_reparation` et `ligne_or` n'existent pas encore, ou existent vides. Le coût
> aujourd'hui se compte en minutes ; après, il se compte en migration sur des OR clôturés et des
> factures verrouillées.
>
> Rappel du périmètre posé par la spec étape 1 (§1) : l'OR produit une **proposition de
> facturation**, pas un document. Rien de ce qui suit ne demande d'implémenter la facturation en
> étape 1 — seulement de ne pas se fermer la porte.

### 7.1 Sur `ligne_or`

| # | Ce qu'il faut | Pourquoi, et ce que ça coûte de l'ajouter après |
|---|---|---|
| **AC-01** | `taux_tva_pourmille smallint not null` **figé à la création de la ligne** | Un OR ouvert en décembre et facturé en janvier après un changement de taux serait facturé au mauvais taux. Après coup : il faut deviner rétroactivement le taux de milliers de lignes d'OR clôturés |
| **AC-02** | `regime_tva` (enum, `normal` par défaut) | `exonere` et `exclu` valent tous deux 0 % et ne se déclarent pas pareil (`MD-37`). Une seule valeur est utilisée en étape 1 ; la colonne doit exister |
| **AC-03** | `mode_calcul_tva` (`ht` \| `ttc`, défaut `ht`) | §3.4 : sans elle, une ligne saisie au prix TTC catalogue produit un centime d'écart sur la facture, et il n'y a aucun moyen de savoir après coup laquelle était en TTC |
| **AC-04** | `date_prestation date not null` (défaut : date de clôture de l'OR) | `MD-39` — c'est la date de prestation, pas la date de facture, qui détermine le taux. Sans elle, le premier changement de taux impose de rouvrir des OR |
| **AC-05** | `montant_ht_centimes`, `montant_tva_centimes`, `montant_ttc_centimes` **calculés et stockés** | La facture **recopie**, elle ne recalcule jamais (`MD-24`). Une ligne d'OR dont les montants sont dérivés à l'affichage rend la proposition de facturation non reproductible |
| **AC-06** | `statut_facturation` (`non_facturable` \| `a_facturer` \| `facture` \| `annule`) | `MD-65`, facturation partielle dans le temps (assurance). **C'est l'accroche la plus rentable du lot** : sans elle, facturer le client avant l'assureur est impossible sans migration |
| **AC-07** | `montant_facturable_centimes` **et** `montant_valorise_centimes` | `RM-70` / `MD-66` : une ligne à charge du garage est facturée 0.00 et valorisée quand même. Une seule colonne oblige à choisir entre mentir au client et perdre l'analyse |
| **AC-08** | `payeur_client_id uuid null` à côté de `payeur` (`RM-66`) | Savoir que c'est « assurance » ne suffit pas à émettre une facture : il faut **quelle** assurance, avec son adresse. Après coup : il faut ressaisir les payeurs de tout l'historique |
| **AC-09** | `categorie_comptable text null` | Surcharge exceptionnelle du mapping compte dérivé du type de ligne (§6.3). Nullable, presque toujours vide, indispensable le jour où un garage a un compte de produit particulier |
| **AC-10** | `remise_pourmille` **xor** `remise_montant_centimes` (`CHECK`) | `MD-41`. Les deux colonnes existent déjà dans la spec (`7.5`) mais sans l'exclusion ; l'ajouter sur des données peuplées oblige à arbitrer des lignes ambiguës |

### 7.2 Sur `ordre_reparation`

| # | Ce qu'il faut | Pourquoi |
|---|---|---|
| **AC-11** | `origine` (`dfa` \| `reprise`) + `numero_origine text null` + `origine_lot_id uuid null` | `D-06` et `D-23` : les OR repris entrent en `cloture` avec leur numéro d'origine et **ne consomment pas** le compteur. Exactement le même dispositif que §0, sur la même migration |
| **AC-12** | `conditions_figees` étendues : délai de paiement, `escompte_pourmille`, `escompte_jours`, `numero_ide` du client, `langue_document` | `RM-50` fige déjà les conditions commerciales ; il manque les conditions de **paiement**, qui déterminent l'échéance, l'escompte (`MD-71`) et la mention TVA. Les ajouter après = des OR figés incomplets, donc des factures dont l'échéance est fausse |
| **AC-13** | `adresse_facturation_figee` distincte de l'adresse du client (`RM-03`, §6.4 de la spec) | Une flotte facture au siège et livre en agence. Sans adresse de facturation figée, la facture part à la mauvaise adresse et le QR porte le mauvais débiteur |
| **AC-14** | `date_prestation_debut` / `date_prestation_fin` | Alimentent `AC-04` et l'information Swico du QR (`MD-80`) |
| **AC-15** | Table de liaison `or_document (tenant_id, or_id, document_id, payeur)` prévue, même si vide en étape 1 | `MD-62` : un OR donne **n** factures. Un `ordre_reparation.facture_id` unique serait faux dès le premier sinistre, et le corriger imposerait de casser une FK sur des OR clôturés |
| **AC-16** | `ordre_reparation.statut` inclut `facture` dès l'étape 1 (déjà prévu §5.1) — avec la règle : `facture` ⟺ aucune ligne en `a_facturer` | Sinon la machine à états doit être modifiée en étape 2, sur une table protégée par `transition_autorisee` et par un trigger |

### 7.3 Sur le paramétrage et les compteurs

| # | Ce qu'il faut | Pourquoi |
|---|---|---|
| **AC-17** | `compteur_document.valeur_depart integer not null default 0` | `MD-26` : sans lui, la preuve de continuité (§2.4) est ininterprétable après une reprise. Une colonne, un défaut, zéro risque |
| **AC-18** | `compteur_document.type_document` accepte dès maintenant `facture`, `avoir`, `devis`, `bon_commande`, `reference_qr` | La colonne est déjà `text` (plan backend §2.4) : rien à faire sinon ne pas la transformer en enum trop étroit |
| **AC-19** | `ServiceParametrage.prochainNumero()` prend le type en paramètre ouvert et **reste appelable dans une transaction fournie** (`tx`) | Le contrat de sortie de T7 le prévoit déjà. Le point à ne pas perdre : `MD-28`, l'appel en dernier, et `MD-30`, l'ordre déterministe en cas d'allocations multiples — à écrire dans le contrat, pas seulement dans une revue |
| **AC-20** | `parametre_atelier` : `mode_calcul_tva_defaut`, `taux_tva_defaut_pourmille`, `arrondi_especes_actif` | `PF-01`, `PF-02` : trois colonnes typées, dans la table qui existe déjà. Les ajouter en étape 2 est indolore, mais leur absence en étape 1 fait coder le taux en dur quelque part — et on ne retrouve jamais tous les endroits |
| **AC-21** | Table `periode_comptable` créée (vide) | `MD-34`. Elle conditionne l'émission ; la créer plus tard oblige à traiter le cas « documents antérieurs à toute période » |

### 7.4 Transverse

| # | Ce qu'il faut | Pourquoi |
|---|---|---|
| **AC-22** | `arrondiCommercial()` et `arrondiCinqCentimes()` dans `@dfa/shared`, en `bigint`, dès l'étape 1 | Les calculs de ligne d'OR (`AC-05`) les utilisent déjà. Deux implémentations de l'arrondi dans un même dépôt, c'est deux résultats différents sur la même facture |
| **AC-23** | Règle ESLint interdisant `Math.round` / `parseFloat` / `Number()` sur tout identifiant contenant `centimes`, `montant`, `prix`, `tva` | Un garde-fou automatique vaut mieux qu'une convention. À poser avec la première ligne de code financier, pas après |
| **AC-24** | `ServiceSnapshotClient` (T8) rend **aussi** le bloc de facturation figé (`AC-12`, `AC-13`) | `MD-25` / `V-07` : un seul producteur de champs figés. Deux producteurs, c'est deux vérités |
| **AC-25** | Audit : `ordre_reparation` et `ligne_or` déjà journalisés (`RM-59`, `RM-111`) — étendre le même dispositif aux futurs documents, sans le réinventer | L'audit d'un document de vente est le même problème que celui d'un OR. Une deuxième implémentation divergerait |

### 7.5 Ce qu'il ne faut **pas** faire en étape 1

- **Ne pas** créer `document_vente`, `paiement`, `imputation_paiement` : le modèle n'est pas validé
  (`QF-01` à `QF-13` sont ouverts), et une table verrouillée par trigger est plus coûteuse à
  corriger qu'à créer.
- **Ne pas** implémenter d'arrondi au 5 centimes sur l'OR : il appartient au paiement (`MD-47`).
- **Ne pas** calculer un « total TTC de l'OR » qui serait autre chose que la somme des lignes : la
  proposition de facturation est une **vue**, pas un document.
- **Ne pas** poser de FK `ordre_reparation.facture_id` (`AC-15`).

---

## 8. Schéma récapitulatif

```
                    ┌────────────────────┐
                    │ ordre_reparation   │  étape 1  (AC-11 → AC-16)
                    │  origine, numero_origine
                    └─────────┬──────────┘
                              │  or_document (or_id, document_id, payeur)   AC-15
                              ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ document_vente                                                            │
│  type_document  devis | bon_commande | facture | avoir          MD-11     │
│  nature_facture ordinaire | acompte                             MD-12     │
│  origine        dfa | reprise                                   MD-01     │
│  numero_sequence / numero / numero_origine / numero_normalise   MD-03     │
│  exercice · date_document · date_prestation_* · date_echeance   MD-27/39  │
│  statut · statut_reglement (dérivé)                             MD-16     │
│  client_* figés · adresse_facturation_figée · langue · ide      MD-24     │
│  total_ht / total_tva / ecart_reprise / total_ttc               MD-08     │
│  tva_non_ventilee · taux_tva_pourmille · mention_tva_interdite  MD-07/69  │
│  remise_globale_saisie_centimes                                 MD-59     │
│  qr_iban · qr_reference · type_reference_qr · qr_payload(+sha)  MD-73/77  │
│  document_source_id · facture_annulee_id · remplace_id          MD-14     │
│  ordre_reparation_id · dossier_vente_id                         MD-70     │
│  exporte_le · export_id · pdf_cle · pdf_sha256                  MD-91     │
└───┬──────────────────────┬─────────────────────┬─────────────────────────┘
    │                      │                     │
    ▼                      ▼                     ▼
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────┐
│ ligne_document   │  │ document_vente_  │  │ bulletin_paiement    │
│  ligne_or_id     │  │ tva              │  │  motif, qr_*         │
│  type_ligne      │  │  regime, taux    │  │  MD-82/83            │
│  mode_calcul_tva │  │  base, tva       │  └──────────────────────┘
│  prix, quantité  │  │  figé  MD-45     │
│  remises (ligne  │  └──────────────────┘
│   + globale      │
│   répartie)      │        ┌───────────────┐        ┌────────────────────┐
│  taux, régime    │        │ paiement      │◀───────│ imputation_paiement│
│  ht/tva/ttc      │        │  immuable     │        │  nature: reglement │
│  date_prestation │        │  MD-50/52     │───────▶│   escompte arrondi │
│  document_       │        └───────────────┘        │   perte compensat. │
│   acompte_id     │                                 └─────────┬──────────┘
└──────────────────┘                                           │
                                                               ▼
   ┌────────────────────┐   ┌──────────────────┐   ┌──────────────────────┐
   │ compteur_document  │   │ periode_comptable│   │ export_comptable     │
   │  + valeur_depart   │   │  MD-34           │   │ + mapping_compte     │
   │  MD-26             │   └──────────────────┘   │ + mapping_code_tva   │
   └────────────────────┘                          │ + correspondance_ext │
                                                   └──────────────────────┘
```

Conventions de schéma reprises telles quelles du socle (`apps/api/src/db/schema/`) : `colonneId()`,
`colonneTenantId()`, `colonnesHorodatage()`, FK **composites**
`(tenant_id, x) → cible(tenant_id, id) on delete restrict`, `unique (tenant_id, id)` sur chaque
table pour servir de cible, enums Postgres dérivés de `@dfa/shared`, RLS `FORCE` avec `USING` **et**
`WITH CHECK`, `CHECK` nommés `*_chk`, uniques `*_uk`, index `*_idx`, tous préfixés `tenant_id`.

---

## 9. Cas de test chiffrés — index

> **Statut de cette section : arithmétique exécutée, pas relue.** Les quinze cas ont été calculés
> avec l'implémentation exacte de `arrondiCommercial()` et `arrondiCinqCentimes()` de §3.2 et §3.7,
> en `bigint`, et toutes leurs assertions d'équilibre passent. Les valeurs ci-dessous sont donc des
> **attendus**, pas des ordres de grandeur : un test qui rend autre chose signale un défaut
> d'implémentation, jamais une tolérance d'arrondi.
>
> Règles de rédaction des tests, non négociables :
> - **Aucun `toBeCloseTo` sur de l'argent**, jamais, sous aucun prétexte (`CONTRIBUTING.md`). Égalité
>   stricte sur des entiers de centimes.
> - Les montants sont écrits **en centimes dans le code** (`56660`) et **en francs dans le nom du
>   test** (`« facture d'atelier de CHF 566.60 »`), pour que l'échec soit lisible sans conversion
>   mentale.
> - Chaque cas qui produit des écritures vérifie **Σ débits = Σ crédits** en plus des montants.
> - Emplacement : `packages/shared` pour les cas purs (`CF-01` à `CF-03`, `CF-06`, `CF-13`,
>   `CF-14`, `CF-15`), `apps/api/test/integration/` pour ceux qui engagent la base — contraintes,
>   triggers et RLS font partie du système testé.

### 9.1 `CF-01` — Facture d'atelier, mode `ht`, 8.1 %

Le cas nominal. Prouve `MD-35`, `MD-40`, §3.3, `MD-42`, `MD-44`.

| # | Désignation | Quantité | Prix unitaire | HT | TVA 81 ‰ | TTC |
|---|---|---|---|---|---|---|
| 1 | Main-d'œuvre atelier | `2500` (2.5 h) | 165.00 | **412.50** | **33.41** | 445.91 |
| 2 | Filtre à huile | `1000` (1 pce) | 24.90 | **24.90** | **2.02** | 26.92 |
| 3 | Huile moteur 5W30 | `4500` (4.5 L) | 18.50 | **83.25** | **6.74** | 89.99 |
| 4 | Taxe d'élimination | `1000` (1 pce) | 3.50 | **3.50** | **0.28** | 3.78 |

```
total_ht_centimes  =  52415      (CHF 524.15)
total_tva_centimes =   4245      (CHF  42.45)
total_ttc_centimes =  56660      (CHF 566.60)
```

Détail du seul arrondi non trivial, à reproduire tel quel dans le test :
`arrondi(41250 × 81, 1000)` → `(3'341'250 + 500) / 1000` → `3341` ct. La troncature entière est
le comportement attendu, pas un effet de bord.

`document_vente_tva` contient **une seule ligne** : `(normal, 81, base = 52415, tva = 4245)`.

### 9.2 `CF-02` — Avoir total : la symétrie de l'arrondi n'est pas une préférence

Prouve `MD-40` (« éloigné de zéro » et non « vers le haut ») et `MD-23`. C'est le cas qui justifie
à lui seul la forme de la fonction d'arrondi.

Une ligne unique de **CHF 5.00 HT** à 81 ‰ : `5.00 × 0.081 = 0.405` — exactement à mi-chemin entre
deux centimes. C'est le pire cas, et il se produit sur un montant rond que tout garage facture.

| Règle d'arrondi | TVA facture | TVA avoir | TTC facture | TTC avoir | Solde après avoir total |
|---|---|---|---|---|---|
| **Éloigné de zéro** (`MD-40`) | +0.41 | **−0.41** | +5.41 | −5.41 | **0.00** ✅ |
| Vers `+∞` (« half up ») | +0.41 | **−0.40** | +5.41 | −5.40 | **+0.01** ❌ |

Avec la seconde règle, un avoir total ne solde pas sa facture. Le document reste éternellement en
`statut_reglement = 'partiel'` pour un centime, il apparaît dans chaque relance, et la fiduciaire
reçoit un grand livre des débiteurs qui ne se solde jamais. Le test doit **échouer** si quelqu'un
remplace la fonction par `Math.round` — dont c'est précisément le comportement en JavaScript
(`Math.round(-40.5) === -40`).

### 9.3 `CF-03` — TVA par ligne agrégée ≠ TVA sur la base agrégée

Prouve `MD-44`. Sur la facture de `CF-01`, sans rien y changer :

```
méthode retenue  (Σ des TVA de ligne)        : 33.41 + 2.02 + 6.74 + 0.28  =  42.45
autre méthode admise (TVA sur base agrégée)  : arrondi(52415 × 81, 1000)   =  42.46
                                                                     écart :   0.01
```

Quatre lignes d'un service banal suffisent. Sur un exercice à 900 factures, l'écart cumulé est de
l'ordre de quelques francs — négligeable en valeur, **non négligeable en réconciliation** : c'est
exactement le genre d'écart qui fait rouvrir un décompte TVA trimestriel.

Le test fige la méthode retenue et **documente l'autre valeur en commentaire**, pour que le jour où
la fiduciaire conteste (`QF-01`), la discussion parte de deux chiffres connus et non d'une
investigation.

### 9.4 `CF-04` — Écriture de la facture émise, équilibrée

Prouve `MD-84`, `MD-85`, §6.2. Facture `2026-00318` de `CF-01`, mode `detaille`.

| Sens | Compte | Libellé | Montant | Code TVA | Base |
|---|---|---|---|---|---|
| Débit | `1100` | Créances résultant de ventes | **566.60** | — | — |
| Crédit | `3400` | Prestations de services | 412.50 | `UN81` | 412.50 |
| Crédit | `3200` | Ventes de marchandises | 108.15 | `UN81` | 108.15 |
| Crédit | `3600` | Autres prestations | 3.50 | `UN81` | 3.50 |
| Crédit | `2200` | TVA sur le chiffre d'affaires | **42.45** | — | 524.15 |

```
Σ débits = 56660 ct   Σ crédits = 41250 + 10815 + 350 + 4245 = 56660 ct   ✅
```

Le regroupement des lignes 2 et 3 en `3200` (108.15) est produit par le mapping `type_ligne →
usage/catégorie` de §6.3, **pas** par l'adaptateur. Le test doit vérifier que les quatre
adaptateurs reçoivent la **même** liste d'écritures, au champ près.

### 9.5 `CF-05` — Arrondi au 5 centimes à l'encaissement, dans les deux sens

Prouve `MD-47`, `MD-48`, `MD-49` et la restriction (b) de `MD-51`. Facture de **CHF 204.31**
(forfait 189.00 HT + 8.1 % = 15.31).

| Total facture | Espèces encaissées | Imputation `reglement` | Imputation `arrondi` | Σ imputations | Solde |
|---|---|---|---|---|---|
| **204.31** | **204.30** | 204.30 | **+0.01** | 204.31 | 0.00 |
| **204.33** | **204.35** | 204.35 | **−0.02** | 204.33 | 0.00 |

Détail : `arrondiCinqCentimes(20431)` = `((20431 + 2) / 5) × 5` = `20430`. Et
`arrondiCinqCentimes(20433)` = `((20433 + 2) / 5) × 5` = `20435`. Les deux sens sont testés parce
qu'un arrondi qui ne descendrait jamais serait un arrondi qui vole le client.

**Le premier cas est celui qui casse un invariant naïf** : les imputations totalisent 204.31 alors
que le paiement vaut 204.30. C'est le contre-exemple qui impose la formulation corrigée de
`MD-51` (b) — à écrire comme test de non-régression, avec un commentaire expliquant *pourquoi*
il doit passer.

Écriture correspondante :

```
D 1000 Caisse                          204.30
D <compte d'arrondi, QF-03>              0.01
    C 1100 Créances clients                    204.31        Σ = 204.31 ✅
```

**Aucune correction de TVA sur l'écart d'arrondi** — c'est une hypothèse, pas une certitude, et
elle est portée par `QF-03`.

### 9.6 `CF-06` — Remise globale ventilée : le résidu d'arrondi a un propriétaire

Prouve `MD-59`, `MD-60`. Trois lignes **de base strictement égale** — le cas où la règle de
départage est la seule chose qui décide.

Trois lignes à **55.00 HT** (base totale 165.00), remise globale saisie de **CHF 10.00**.

```
part au prorata = arrondi(1000 × 5500, 16500) = 333 ct   pour chacune des trois lignes
Σ parts = 999 ct         résidu = 1000 − 999 = 1 ct
```

Le résidu va à la ligne de plus grande base ; **les trois sont égales**, donc à celle dont l'ordre
d'affichage est le plus petit — la ligne 1.

| Ligne | Base | `remise_globale_repartie` | HT | TVA 81 ‰ |
|---|---|---|---|---|
| 1 | 55.00 | **3.34** | 51.66 | 4.18 |
| 2 | 55.00 | 3.33 | 51.67 | 4.19 |
| 3 | 55.00 | 3.33 | 51.67 | 4.19 |

```
Σ remises réparties = 1000 ct = remise_globale_saisie_centimes   ✅  (invariant MD-60)
total_ht  = 15500 ct = 16500 − 1000                             ✅
total_tva =  1256 ct        total_ttc = 16756 ct  (CHF 167.56)
```

Le test doit être écrit avec **trois lignes égales**, pas trois lignes différentes : avec des bases
distinctes, le départage par ordre d'affichage n'est jamais exercé et la règle reste non testée.

### 9.7 `CF-07` — Vente de véhicule avec acompte, mode `ttc`

Prouve `MD-12`, `MD-43`, `MD-54`, `MD-55`, `MD-56` et §6.2. C'est le cas le plus complet du
document, et celui que le premier garage rencontrera le plus tôt.

**Étape 1 — facture d'acompte `2026-00301`, CHF 5'000.00 TTC**, mode `ttc`, 81 ‰ :

```
tva = arrondi(500'000 × 81, 1081) = 37'465 ct   →  CHF   374.65
ht  = 500'000 − 37'465 = 462'535 ct             →  CHF 4'625.35
                                          TTC  =  CHF 5'000.00  ✅ exact
```

```
D 1100 Créances clients               5'000.00
    C 2030 Acomptes de clients                4'625.35
    C 2200 TVA due 8.1 %                        374.65      Σ = 5'000.00 ✅
```

**Étape 2 — facture finale `2026-00412`**, véhicule à **CHF 24'500.00 TTC**, mode `ttc` :

| Ligne | Type | TTC | TVA | HT |
|---|---|---|---|---|
| 1 | véhicule | +24'500.00 | +1'835.80 | +22'664.20 |
| 2 | `acompte_deduit` → `2026-00301` | **−5'000.00** | **−374.65** | **−4'625.35** |

```
total_ht  = 1'803'885 ct   →  CHF 18'038.85
total_tva =   146'115 ct   →  CHF  1'461.15
total_ttc = 1'950'000 ct   →  CHF 19'500.00     = 24'500.00 − 5'000.00  ✅ exact
```

**Les deux égalités qui font tout l'intérêt du cas :**

```
TVA déduite sur la ligne 2 (374.65)  =  TVA déclarée sur la facture d'acompte (374.65)   ✅
TVA totale déclarée : 374.65 + 1'461.15 = 1'835.80 = TVA du prix de vente complet        ✅
```

Elles ne tiennent que parce que la ligne `acompte_deduit` reprend **le taux et le mode de calcul**
de la facture d'acompte (`MD-55`). Le test doit inclure la variante fautive — ligne 2 saisie en
mode `ht` — et vérifier qu'elle est **refusée**, pas silencieusement acceptée.

```
D 1100 Créances clients              19'500.00
D 2030 Acomptes de clients            4'625.35
    C 3000 Ventes de véhicules                22'664.20
    C 2200 TVA due 8.1 %                       1'461.15

Σ débits = 24'125.35     Σ crédits = 24'125.35   ✅
```

Le solde du compte `2030` revient exactement à zéro pour ce dossier : c'est le contrôle que la
fiduciaire fera en premier.

### 9.8 `CF-08` — Paiement partiel et bulletin de solde

Prouve `MD-16`, `MD-50`, `MD-53`, `MD-82`. Facture de `CF-01`, **CHF 566.60**.

| Date | Événement | `montant_regle` | `solde` | `statut_reglement` |
|---|---|---|---|---|
| 20.03.2026 | émission | 0.00 | 566.60 | `non_regle` |
| 15.04.2026 | virement 300.00 | 300.00 | 266.60 | `partiel` |
| 02.05.2026 | virement 266.60 | 566.60 | **0.00** | `regle` |

Ce que le test doit vérifier **en plus** des trois lignes ci-dessus, et qui est le vrai objet du
cas :

- `document_vente.statut` vaut `emis` **aux trois instants**. Le règlement n'est pas un état du
  document (`MD-16`).
- `qr_payload` et `qr_montant_centimes` sont **identiques bit pour bit** avant et après le
  paiement partiel : le QR de la facture porte 566.60 pour toujours (`MD-82`).
- L'encaissement du solde passe par un `bulletin_paiement` de motif `solde`, portant **la même**
  `qr_reference` et un montant de 266.60 — ou aucun montant, ce qui est plus robuste si le client
  paie encore en plusieurs fois.

### 9.9 `CF-09` — Avoir sur une facture émise sous un taux antérieur

Prouve `MD-23`, `MD-36`, `MD-38`, `MD-45`. Le piège se déclenche au **premier** changement de taux,
et il s'est déjà produit une fois : 7.7 % → 8.1 % au 01.01.2024.

Facture émise le **15.12.2023** : main-d'œuvre 1'000.00 HT à **77 ‰** → TVA 77.00, TTC 1'077.00.
Avoir total émis le **20.01.2024**, alors que le taux courant vaut 81 ‰.

| Taux utilisé par l'avoir | TVA de l'avoir | TTC de l'avoir | Solde de la facture | Conséquence |
|---|---|---|---|---|
| **77 ‰ — hérité** (`MD-23`) | −77.00 | −1'077.00 | **0.00** | correct |
| 81 ‰ — courant | −81.00 | −1'081.00 | **−4.00** | trop-perçu fabriqué **et CHF 4.00 de TVA récupérée à tort auprès de l'AFC** |

La seconde ligne n'est pas une erreur d'affichage : c'est une déclaration TVA fausse dans les deux
cases (chiffre d'affaires *et* impôt), sur un exercice différent de celui de la facture. Le test
doit vérifier que le trigger **refuse** l'avoir au taux courant, avec un code d'erreur stable.

```
D 3400 Prestations de services        1'000.00      base 1'000.00, taux 77 ‰
D 2200 TVA due                           77.00
    C 1100 Créances clients                   1'077.00      Σ = 1'077.00 ✅
```

L'écriture porte **77 ‰**, pas 81 ‰. Un adaptateur qui remapperait le code TVA sur le taux courant
casserait la déclaration : c'est pourquoi `mapping_code_tva` est indexé sur
`(regime_tva, taux_pourmille)` et non sur le seul régime (§6.3).

### 9.10 `CF-10` — Carrosserie multi-payeur : l'invariant de non-fuite

Prouve `MD-62`, `MD-63`, `MD-64`, `MD-66`. Le cas où une erreur coûte le plus cher et se voit le
moins.

**OR de carrosserie**, lignes facturables :

| Ligne | Payeur | HT | TVA 81 ‰ |
|---|---|---|---|
| Tôlerie + peinture | assurance | 4'200.00 | 340.20 |
| Pièces de carrosserie | assurance | 1'850.00 | 149.85 |
| Service annuel demandé au passage | client | 380.00 | 30.78 |
| Retouche offerte | **garage** | facturable **0.00** / valorisée **120.00** | 0.00 |

Franchise convenue : **CHF 500.00**, portée en ligne explicite sur les deux documents, **en mode
`ttc` des deux côtés** → HT 462.53, TVA 37.47.

| | Facture assurance | Facture client |
|---|---|---|
| Lignes | tôlerie + pièces − franchise | service + franchise + retouche à 0.00 |
| `total_ht` | **5'587.47** | **842.53** |
| `total_tva` | **452.58** | **68.25** |
| `total_ttc` | **6'040.05** | **910.78** |

**Invariant de non-fuite (`MD-64`), au taux 81 ‰ :**

```
Σ bases des deux documents      = 5'587.47 +  842.53 = 6'430.00
Σ bases facturables de l'OR     = 4'200.00 + 1'850.00 + 380.00 + 0.00 = 6'430.00   ✅

Σ TVA des deux documents        =   452.58 +   68.25 =   520.83
Σ TVA des lignes de l'OR        =   340.20 +  149.85 +  30.78 + 0.00 =   520.83    ✅
```

Les deux lignes de franchise s'annulent **exactement** (−462.53 / +462.53 et −37.47 / +37.47) parce
qu'elles partagent taux **et** mode de calcul.

**La variante fautive, à tester explicitement** — franchise saisie en mode `ht` sur un document et
`ttc` sur l'autre :

```
base côté ht : 500.00      base côté ttc : 462.53      →  fuite de base :  37.47
tva  côté ht :  40.50      tva  côté ttc :  37.47      →  fuite de TVA  :   3.03
```

CHF 37.47 de chiffre d'affaires qui apparaît ou disparaît selon le sens, sur un OR à quarante
lignes que personne ne recompte à la main. C'est la raison d'être de l'invariant, et il doit
tourner **en requête de contrôle nocturne**, pas seulement en test.

La ligne `garage` n'entre dans aucun total de facture — l'invariant porte sur les lignes
**facturables** — mais ses 120.00 valorisés partent sur un compte d'analyse à l'export (`MD-66`).

### 9.11 `CF-11` — Trop-perçu : ce qu'on fait, et surtout ce qu'on ne fait pas

Prouve `MD-51`, `MD-57`. Facture de `CF-01` (566.60). Le client vire **585.60** (chiffre transposé
à la saisie).

```
imputation 'reglement' sur la facture   = 566.60   →  solde 0.00, statut 'regle'
part non imputée du paiement            =  19.00   →  avance client, visible sur la fiche
Σ                                       = 585.60   ✅
```

```
D 1020 Banque                           585.60
    C 1100 Créances clients                    566.60
    C 2030 Avances de clients                   19.00     Σ = 585.60 ✅
```

Remboursement (`MD-52`, `MD-57`) : paiement de **−19.00**, moyen `virement`, lié par
`contre_passe_id`. `D 2030 19.00 / C 1020 19.00`. **Aucune écriture de TVA dans aucun des deux
sens** — c'est le point du cas.

**La variante interdite, à tester comme rejet** : émettre un avoir de 19.00 TTC pour « solder » le
trop-perçu. Elle produirait CHF **1.42** de TVA récupérée à tort
(`arrondi(1900 × 81, 1081)`), un chiffre d'affaires diminué de 17.58 sans qu'aucune prestation
n'ait été annulée, et un document de vente créé pour un mouvement d'argent. Un avoir corrige un
document, pas un virement.

### 9.12 `CF-12` — Facture reprise à TVA non ventilée, avec écart de reprise

Prouve `MD-03` à `MD-10`, et l'articulation avec `D-04` (ne jamais recalculer une facture reprise).

Facture Auto-i `FA-2019-1184`, émise le 12.09.2019, taux d'époque **77 ‰**. L'ancien système
arrondissait le **total du document** au 5 centimes — pratique que DFA interdit (`MD-47`) et que la
reprise doit néanmoins représenter fidèlement.

| Champ | Valeur importée |
|---|---|
| `origine` | `reprise` |
| `numero_origine` | `FA-2019-1184` (verbatim) |
| `numero` | `FA-2019-1184` |
| `numero_sequence` | **`NULL`** — la séquence DFA n'est pas consommée (`MD-05`) |
| `numero_normalise` | `FA20191184` |
| `tva_non_ventilee` | `true` |
| `taux_tva_pourmille` (document) | `77` — déduit de la date d'émission (`MD-09`, `N-07`) |
| lignes dans `document_vente_tva` | **aucune** (`MD-07`) |

```
total_ht_centimes      = 124'000    (CHF 1'240.00)   ← de la source, jamais recalculé
total_tva_centimes     =   9'548    (CHF    95.48)   ← de la source
                 somme = 133'548    (CHF 1'335.48)
total_ttc_centimes     = 133'550    (CHF 1'335.50)   ← de la source, arrondi 5 ct d'époque
ecart_reprise_centimes =       2    (CHF     0.02)

check : 124'000 + 9'548 + 2 = 133'550   ✅
```

Ce que le test doit vérifier en plus des montants :

- Le même import rejoué **ne crée pas un second document** (`document_vente_numero_origine_uk`).
- Une facture DFA portant `ecart_reprise_centimes <> 0` est **refusée** par le `CHECK` de `MD-08`.
- Une facture DFA portant `tva_non_ventilee = true` est **refusée** (`MD-07`).
- Un `UPDATE` sur les montants du document repris est **refusé** au même titre qu'une facture émise
  (`MD-10`) — le trigger ne regarde pas `origine`.
- Le compteur `facture` de l'exercice concerné n'a **pas** bougé.

**Ce document ne produit aucune écriture d'export** : l'exercice 2019 est clos chez la fiduciaire,
qui en a déjà le journal. Seule sa **créance encore ouverte** compte, et elle relève d'un solde
d'ouverture à la bascule — voir `QF-10`, qui n'est pas tranché.

### 9.13 `CF-13` — Le mode de calcul n'est pas une préférence d'affichage

Prouve `MD-43` et §3.4. Forfait annoncé **CHF 70.00 TTC**, 81 ‰.

| Mode | HT | TVA | TTC obtenu |
|---|---|---|---|
| `ht`, HT saisi à 64.75 | 64.75 | 5.24 | **69.99** ❌ |
| `ht`, HT saisi à 64.76 | 64.76 | 5.25 | **70.01** ❌ |
| **`ttc`** | **64.75** | **5.25** | **70.00** ✅ |

Aucun HT entier ne donne 70.00 : la valeur est **inatteignable** en mode `ht`. Noter que le mode
`ttc` retient le **même HT** (64.75) que la première ligne, et une TVA différente d'un centime —
l'écart est déplacé sur la TVA, pas supprimé.

Le test doit inclure la **preuve d'exhaustivité**, qui est ce qui transforme l'anecdote en règle :

```
pour tout HT de 0 à 4'000'000 ct : compter les TTC sautés par HT ↦ HT + arrondi(HT × 81 / 1000)
attendu : 324'000 valeurs inatteignables sous CHF 40'000.00
dont, vérifiées nominativement :  1.00 · 3.00 · 5.00 · 40.50 · 70.00 · 145.00
```

Le jour où quelqu'un proposera de « simplifier » en supprimant `mode_calcul_tva`, ce test est la
réponse.

### 9.14 `CF-14` — Escompte 2 % avec correction proportionnelle de TVA

Prouve `MD-71` et §6.2. C'est le cas où le calcul « tombe juste » et où l'on peut le démontrer.

Facture entreprise : **3'200.00 HT** à 81 ‰ → TVA 259.20, TTC **3'459.20**. Conditions : 2 %
d'escompte à 10 jours. Le client paie le 8ᵉ jour.

```
escompte = arrondi(345'920 × 20, 1000) = 6'918 ct        →  CHF 69.18   (2 % du TTC)
  dont TVA = arrondi(6'918 × 81, 1081) =   518 ct        →  CHF  5.18
  dont HT  = 6'918 − 518               = 6'400 ct        →  CHF 64.00

client verse : 345'920 − 6'918 = 339'002 ct              →  CHF 3'390.02
```

**Les deux égalités à asserter, et qui ne sont pas évidentes a priori :**

```
HT de l'escompte (64.00)  =  2 % exactement du HT facturé (arrondi(320'000 × 20, 1000) = 6'400)  ✅
TVA nette due (259.20 − 5.18 = 254.02)  =  arrondi((320'000 − 6'400) × 81, 1000) = 25'402        ✅
```

La seconde est celle qui compte : la TVA finalement due est **exactement** celle qu'on aurait
calculée si la facture avait porté 3'136.00 HT dès le départ. C'est ce que la fiduciaire vérifiera,
et c'est ce qui rend l'escompte-par-imputation défendable face à l'escompte-par-avoir (`QF-04`).

Imputations : `reglement 3'390.02` + `escompte 69.18` = 3'459.20 → `statut_reglement = 'regle'`.

```
D 1020 Banque                         3'390.02
D 3800 Déductions sur ventes             64.00      base −64.00, taux 81 ‰
D 2200 TVA due                            5.18
    C 1100 Créances clients                   3'459.20      Σ = 3'459.20 ✅
```

### 9.15 `CF-15` — Référence QR : composition et chiffre de contrôle

Prouve `MD-74`, `MD-75`, `MD-76`. Le chiffre de contrôle est le **modulo 10 récursif** (procédure
des ex-BVR), pas un modulo 97 ni une somme de Luhn — trois algorithmes qu'on confond couramment.

Table de report, à recopier telle quelle : `[0, 9, 4, 6, 8, 2, 7, 1, 3, 5]`.

```
report ← 0
pour chaque chiffre d :  report ← table[(report + d) mod 10]
chiffre de contrôle   =  (10 − report) mod 10
```

Facture n° 424 de l'exercice 2026, série `facture` (code `10`) :

| Segment | Longueur | Valeur |
|---|---|---|
| Remplissage | 10 | `0000000000` |
| Exercice | 4 | `2026` |
| Type de série | 2 | `10` |
| Compteur `reference_qr` | 10 | `0000000424` |
| **Chiffre de contrôle** | 1 | **`1`** |

```
26 chiffres utiles :  00000000002026100000000424
référence (27)     :  000000000020261000000004241
groupage affiché   :  00 00000 00020 26100 00000 04241
```

Trois assertions, toutes nécessaires :

```
/^[0-9]{27}$/.test(reference)                    → true    (contrainte CHECK de MD-74)
mod10récursif(reference complète de 27 chiffres) → 0       (auto-validation)
mod10récursif('...425') ≠ 1                      → détecte la faute de frappe d'un chiffre
```

Le compteur vient de `compteur_document (type_document = 'reference_qr', annee = 0)` : il **ne se
remet jamais à zéro** et ses valeurs **ne sont jamais réutilisées** (`MD-75`). Le test doit vérifier
qu'un `ROLLBACK` sur l'émission laisse un **trou** dans les références QR sans que rien ne le
signale — c'est le comportement voulu, à l'exact opposé de la règle des numéros de document, et il
mérite un commentaire dans le code pour que personne ne le « corrige ».

### 9.16 Table de couverture

Un cas de test qui ne couvre aucune règle est du bruit ; une règle qu'aucun cas ne couvre est une
promesse.

| Cas | Règles prouvées | Où |
|---|---|---|
| `CF-01` | `MD-35`, `MD-40`, `MD-42`, `MD-44` | `@dfa/shared` |
| `CF-02` | `MD-23`, `MD-40` | `@dfa/shared` |
| `CF-03` | `MD-44`, `MD-45` | `@dfa/shared` |
| `CF-04` | `MD-84`, `MD-85`, `MD-86`, `MD-90` | intégration |
| `CF-05` | `MD-47`, `MD-48`, `MD-49`, `MD-51` (b) | intégration |
| `CF-06` | `MD-41`, `MD-59`, `MD-60` | `@dfa/shared` |
| `CF-07` | `MD-12`, `MD-43`, `MD-54`, `MD-55`, `MD-56` | intégration |
| `CF-08` | `MD-16`, `MD-50`, `MD-53`, `MD-82` | intégration |
| `CF-09` | `MD-23`, `MD-36`, `MD-38`, `MD-45` | intégration |
| `CF-10` | `MD-62`, `MD-63`, `MD-64`, `MD-66` | intégration |
| `CF-11` | `MD-51`, `MD-52`, `MD-57` | intégration |
| `CF-12` | `MD-01` à `MD-10` | intégration |
| `CF-13` | `MD-43` | `@dfa/shared` |
| `CF-14` | `MD-71`, `MD-72` | `@dfa/shared` |
| `CF-15` | `MD-74`, `MD-75`, `MD-76` | `@dfa/shared` |

**Règles structurelles non couvertes par ces quinze cas**, et qui exigent leurs propres tests
d'intégration : `MD-18` à `MD-22` (immuabilité — un test par colonne de la liste blanche),
`MD-26` à `MD-34` (numérotation : concurrence, rollback, calage de reprise, preuve de continuité),
`MD-77` (stabilité du `qr_payload` après changement d'IBAN du tenant), `MD-92` et `MD-93`
(double export et correction post-export).

---

## 10. Ce que je ne tranche pas seul

Deux natures de décisions non tranchées, à ne pas confondre. Les **`PF-xx`** sont des choix qui
appartiennent à chaque garage et se règlent en base à l'exploitation : ils n'attendent qu'une
valeur par défaut. Les **`QF-xx`** sont des points de **conformité ou de pratique comptable** :
ils attendent une réponse humaine, et l'implémentation qui les devine produira du faux avec
l'apparence du juste.

### 10.1 Paramètres de facturation — `PF-xx`

Décidés par tenant, modifiables sans migration, **jamais codés en dur**. Ils n'ont pas besoin d'être
tranchés avant l'implémentation : seule leur **valeur par défaut** engage.

| # | Paramètre | Défaut proposé | Portée |
|---|---|---|---|
| **PF-01** | `mode_calcul_tva_defaut` (`ht` \| `ttc`) | `ht` | tenant, **surchargeable par ligne** (§3.4) |
| **PF-02** | `taux_tva_defaut_pourmille`, `regime_tva_defaut` | `81`, `normal` | tenant, surchargeable par prestation et par ligne |
| **PF-03** | Bloc créancier QR : `qr_iban`, nom, adresse structurée, `type_reference_qr` | aucun — **l'émission est refusée tant qu'il est vide** | tenant, éventuellement par site |
| **PF-04** | Conditions de paiement : délai, `escompte_pourmille`, `escompte_jours`, barème de relance | 30 jours net, sans escompte | tenant, surchargeable par client (`AC-12`) |
| **PF-05** | Export : cible, mode d'agrégation (`detaille` \| `agrege`), périodicité, mapping de comptes | `detaille` | tenant **× cible** |

La numérotation (préfixe, format, portée par site, remise à zéro annuelle) n'apparaît pas ici :
elle est déjà `P-01` de la spécification étape 1, et l'étape 2 n'y ajoute que `valeur_depart`
(`MD-26`, `AC-17`).

`PF-03` mérite une insistance : un tenant sans bloc créancier complet **ne doit pas pouvoir émettre
une facture**, plutôt qu'en émettre une sans QR. Une facture sans QR est refusée par le client, et
le garage l'apprend une semaine plus tard.

### 10.2 Questions à trancher avant implémentation — `QF-xx`

Colonne « bloque quoi » : ce qui ne peut pas être écrit tant que la réponse n'est pas là.

| # | Question | À qui | Bloque quoi | Si personne ne répond |
|---|---|---|---|---|
| **QF-01** | TVA du document = **Σ des TVA de ligne** (écart d'un centime de `CF-03`) — confirmé ? | fiduciaire | le premier export | on garde la méthode par ligne, imposée par `CONTRIBUTING.md` et `RM-107`, et on documente l'écart |
| **QF-02** | Acomptes : **facture d'acompte** (TVA due immédiatement) ou **encaissement sans facture** ? Le garage décompte-t-il selon les contre-prestations **convenues** ou **reçues** ? | fiduciaire **et** garagiste | la vente de véhicule, donc l'étape 4 ; le modèle porte les deux dispositifs (`MD-54`) | on livre les deux, on laisse le garage choisir au cas par cas — au risque d'une pratique incohérente sur un même exercice |
| **QF-03** | Plan comptable : les comptes proposés en §6.3, **et** le compte des différences d'arrondi (produit ou charge ?), **et** l'arrondi 5 ct entraîne-t-il une correction de TVA ? | fiduciaire | le premier export ; l'hypothèse « pas de correction de TVA sur l'arrondi » de `CF-05` | on livre le plan PME par défaut ; le mapping étant paramétrable, l'erreur est rattrapable — **sauf** sur la TVA de l'arrondi, qui ne l'est pas |
| **QF-04** | Escompte : **imputation** (`MD-71`, `CF-14`) ou **avoir** ? Certaines fiduciaires exigent l'avoir | fiduciaire | rien immédiatement | on livre l'imputation, dont `CF-14` prouve l'exactitude ; basculer vers l'avoir plus tard est additif |
| **QF-05** | Sinistre : la facture est-elle **adressée** au client ou à l'assurance ? Qui déduit l'impôt préalable ? | fiduciaire **et** garagiste | la pratique, pas le modèle — qui porte déjà destinataire et payeur séparément (`MD-67`) | le garage choisit par dossier ; risque d'incohérence entre deux réceptionnaires |
| **QF-06** | Taxes de recyclage / d'élimination et débours : quel taux, quel compte, sont-ils dans la base TVA ? Et **validation du tableau des taux historiques** de `MD-36` | fiduciaire | la ligne 4 de `CF-01` et le compte `3600` | on facture à 8.1 % sur un compte de produit — **hypothèse la plus probable mais non vérifiée** |
| **QF-07** | Occasions : mentions requises sur la facture de vente sous **déduction de l'impôt préalable fictif** (LTVA art. 28a). Faut-il conserver le prix d'achat sur le document ? | fiduciaire | l'étape 4, mais `dossier_vente_id` (`MD-70`) doit être posée en étape 2 | on pose la colonne, vide. Coût nul, et elle évite une migration sur des factures verrouillées |
| **QF-08** | `exonere` vs `exclu` : véhicule livré à l'étranger, plaques U, vente à un diplomate. Quels justificatifs le document doit-il porter ? | fiduciaire | la mention légale sur le document, pas le modèle (`MD-37` porte les deux régimes) | les deux régimes existent et se déclarent différemment ; la mention imprimée reste à écrire |
| **QF-09** | Monotonie des dates dans une série (`MD-33`) : contrôle **bloquant** ou avertissement ? Quelle tolérance en pratique ? | fiduciaire | le comportement de l'émission | bloquant. Une série non monotone est un défaut de forme, et il est plus facile de desserrer que de resserrer |
| **QF-10** | **Créances reprises** : à la bascule, qui tient le grand livre des débiteurs ? Solde d'ouverture chez la fiduciaire, ou export d'écritures depuis DFA ? Les documents `origine = 'reprise'` sont-ils exportés (`CF-12`) ? | fiduciaire **et** expert-migration-donnees | la reprise elle-même — **cette question a la date de péremption la plus proche** | on n'exporte aucun document repris et on produit un état des créances ouvertes à la date de bascule, à charge pour la fiduciaire de le saisir |
| **QF-11** | Mentions légales obligatoires sur la facture (LTVA art. 26) : n° IDE, désignation de la prestation, période. Le gabarit proposé les porte-t-il toutes ? | fiduciaire | le gabarit PDF, pas le modèle | on applique l'art. 26 tel qu'on le lit — **une facture non conforme fait perdre au client son droit à déduction, et c'est le garage qui l'entend** |
| **QF-12** | Délais de paiement, escompte, barème et cadence de relance du garage | garagiste | la valeur par défaut de `PF-04` | 30 jours net, sans escompte |
| **QF-13** | Conservation 10 ans (CO art. 958f) et **intégrité sur support modifiable** : `pdf_sha256` + `qr_payload_sha256` + journal d'audit suffisent-ils, ou faut-il un stockage WORM ? | fiduciaire, éventuellement un conseil | l'architecture de stockage des PDF — **structurant, et coûteux à changer après** | on stocke le PDF avec son empreinte et on journalise ; si le WORM est exigé, c'est une reprise d'infrastructure, pas une migration de schéma |

### 10.3 Les quatre à poser en premier

Toutes ne se valent pas. Par ordre de péremption :

1. **`QF-10`** — la reprise a lieu **avant ou pendant** l'étape 2. Une réponse tardive se paie en
   ressaisie manuelle chez la fiduciaire, ou en un export dont personne ne veut.
2. **`QF-02`** — décide de la forme des documents de vente de véhicule. Se tromper impose un avoir
   sur chaque acompte déjà émis.
3. **`QF-13`** — décide d'une architecture de stockage. Changer d'avis après la mise en production
   du pilote signifie déplacer des documents dont l'intégrité est précisément ce qui est en jeu.
4. **`QF-03`** — bloque le premier export, donc la fin de l'étape 2. Le mapping de comptes est
   rattrapable ; la TVA de l'arrondi ne l'est pas.

Les neuf autres peuvent recevoir une réponse pendant l'implémentation sans rien invalider de ce qui
aura été écrit. **Aucune des treize ne doit être tranchée par un agent.**

### 10.4 Ce que ce document affirme et qui reste à vérifier en exécution

Par honnêteté sur le statut de ce qui précède :

- **L'arithmétique de §9 est exécutée**, pas relue : les quinze cas ont tourné avec les fonctions
  d'arrondi de §3.2 et §3.7 et toutes leurs assertions d'équilibre passent. C'est le seul endroit
  du document dont je réponds sans réserve.
- **La correction apportée à §3.4** : la démonstration précédente (CHF 24'500.00 TTC, « un centime
  manque ») était **fausse** — ce montant est parfaitement atteignable en mode `ht`. La conclusion
  `MD-43` reste juste, mais elle repose désormais sur un contre-exemple vérifié (CHF 70.00) et sur
  un dénombrement exhaustif (`CF-13`).
- **La correction apportée à `MD-51`** : l'invariant tel qu'il était écrit rendait `CF-05`
  inécrivable. Il est restreint aux imputations de nature `reglement`.
- **Les références Swiss Payment Standards de §5** (version 2.3, suppression de l'adresse combinée
  au 21.11.2025, plages d'IID QR-IBAN, limite de 997 caractères) sont à **revérifier contre la
  version en vigueur** au moment d'implémenter. La spécification est vivante ; le contrôle se fait
  contre le document officiel, pas contre ce fichier.
- **Les taux historiques de `MD-36`** et les comptes de §6.3 sont une base de travail, pas une
  source fiscale (`QF-06`, `QF-03`).

---
