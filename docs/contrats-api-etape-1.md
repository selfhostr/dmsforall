Contrats d'API — Étape 1 : Atelier + Clients
============================================

> Auteur : expert-api. Sources : `docs/specification-etape-1-atelier-clients.md` (RM-01→112, machines
> à états §5, cas tordus §6, paramètres P-01→32, cas de test CT-01→52),
> `docs/plan-etape-1-backend.md` (§4 endpoints, §4.3 codes, §4.5 idempotence),
> `docs/plan-etape-1-frontend.md` (§10 dépendances D-01→D-12), et le socle livré
> (`packages/shared/src/contrats/`, `apps/api/src/common/`, `packages/shared/openapi/dfa-openapi.json`).
> Public : expert-nestjs, expert-database, expert-react, expert-tests, expert-i18n.
>
> **Ce document est le contrat. Il précède l'implémentation et prime sur les listes d'endpoints
> esquissées dans les deux plans** — les divergences assumées avec ces plans sont listées en §14, avec
> leur justification. Rien ici n'est du code d'implémentation.

Le lecteur visé n'est pas seulement l'équipe : c'est **le développeur d'un connecteur OEM en 2029** qui
découvre cette API sans contexte, et qui doit pouvoir répondre seul à trois questions — _quelles
ressources existent, que se passe-t-il quand on me refuse quelque chose, et qu'est-ce qui ne changera
jamais._

---

Sommaire
--------

1. [Conventions transverses](#1-conventions-transverses)
2. [Décision structurante : les transitions sont des actions nommées](#2-décision-structurante--les-transitions-sont-des-actions-nommées)
3. [Le contrat d'erreur exploitable (D-05)](#3-le-contrat-derreur-exploitable-d-05)
4. [Codes d'erreur, d'avertissement et de confirmation](#4-codes-derreur-davertissement-et-de-confirmation)
5. [Idempotence (D-03, D-04)](#5-idempotence-d-03-d-04)
6. [Pagination, filtres et tris](#6-pagination-filtres-et-tris)
7. [Ressources et endpoints — la table complète](#7-ressources-et-endpoints--la-table-complète)
8. [Les projections agrégées (D-01, D-02, D-10)](#8-les-projections-agrégées-d-01-d-02-d-10)
9. [Concurrence et conflits (D-06)](#9-concurrence-et-conflits-d-06)
10. [Webhooks et journal d'événements](#10-webhooks-et-journal-dévénements)
11. [Compatibilité ascendante : préparer l'étape 2](#11-compatibilité-ascendante--préparer-létape-2)
12. [Fragments OpenAPI de référence](#12-fragments-openapi-de-référence)
13. [Tests de contrat à écrire](#13-tests-de-contrat-à-écrire)
14. [Divergences assumées avec les plans, et points à trancher](#14-divergences-assumées-avec-les-plans-et-points-à-trancher)

---

1. Conventions transverses

---

1.1 Trois catégories de chemins, et une seule règle par catégorie
-----------------------------------------------------------------

L'erreur classique d'une API métier riche est de mélanger des ressources, des actions et des rapports
sous une même grammaire, puis de ne plus savoir quel verbe HTTP s'applique où. On fixe trois
catégories, exhaustives et reconnaissables **à l'œil nu dans le chemin**.

- Catégorie — **Ressource**
- Forme du segment — nom **pluriel**, kebab-case
- Verbes autorisés — `GET` (collection et unité), `POST` (création), `PATCH`, `PUT` (cas §5.2)
- Exemple — `/clients`, `/ordres-reparation/{id}/lignes`

- Catégorie — **Action**
- Forme du segment — **verbe à l'infinitif**, kebab-case
- Verbes autorisés — `POST` **uniquement**
- Exemple — `/ordres-reparation/{id}/terminer`

- Catégorie — **Projection**
- Forme du segment — nom composé décrivant le contenu
- Verbes autorisés — `GET` **uniquement**, jamais d'identifiant propre
- Exemple — `/vehicules/{id}/contexte-atelier`, `/planning/charge`

Conséquences, toutes vérifiables mécaniquement (§13) :

- un segment verbe n'expose **jamais** `GET` : il n'y a rien à lire à `/terminer`, et personne ne sera
  tenté d'y coller une collection six mois plus tard ;
- une ressource n'a **jamais** de `DELETE` dans cette API — RM-110 : rien n'est physiquement supprimé.
  L'absence totale de `DELETE` est une propriété du contrat, pas une omission ;
- une projection n'a **jamais** d'effet de bord, ce qui la rend cacheable et rejouable par un connecteur.

**Pourquoi l'infinitif plutôt que le substantif** (`/terminer` et non `/terminaison`, comme le propose
le plan backend §4.2) : un substantif se lit comme une sous-ressource et invite au `GET
/ordres-reparation/{id}/annulation`, qui n'existera jamais. En français, la dérivation substantive est
en plus irrégulière (`honorer` → « honoration » ?), ce qui produirait une nomenclature bancale et
mémorisable seulement par ceux qui l'ont écrite. L'infinitif est régulier, univoque, et il rend la
règle « verbe ⇒ POST seul » applicable sans exception.

1.2 Règles non négociables héritées du socle
--------------------------------------------

- Règle — **Aucun `tenantId`** en chemin, query, corps ou en-tête
- Application étape 1 — Vérifié par test de contrat sur le document OpenAPI complet (§13). `siteId` **est** accepté : ce n'est pas un tenant. Un `siteId` d'un autre tenant → `404 RESSOURCE_INTROUVABLE`, jamais 403 (I-13).

- Règle — Préfixe et version
- Application étape 1 — `/api/v1` — inchangé. Voir §11.4 pour la politique de version.

- Règle — Erreurs
- Application étape 1 — `application/problem+json`, schéma unique `ProblemeDetailCommunDto`, champ `code` seul contrat machine. Le front n'affiche jamais `title` ni `detail`.

- Règle — Pagination
- Application étape 1 — Curseur opaque (§6).

- Règle — Auth
- Application étape 1 — Cookie de session (`@ApiCookieAuth`). Les tokens API pour connecteurs sont étape 5 ; le contrat n'en dépend pas.

- Règle — Un droit par route
- Application étape 1 — `@ExigerDroit('atelier.or.terminer')`, matrice `apps/api/src/auth/matrice-droits.ts`. Nomenclature imposée : `<module>.<ressource>.<action>`.

1.3 Nommage des champs et unités
--------------------------------

Le suffixe d'unité dans le nom du champ est la meilleure défense connue contre un flottant qui
s'infiltre trois ans plus tard dans un connecteur tiers.

- Grandeur — Argent
- Suffixe imposé — `…Centimes`
- Type JSON — `integer`
- Exemple — `plafondCentimes: 80000` (= CHF 800.00)

- Grandeur — Total agrégé
- Suffixe imposé — `…Centimes`
- Type JSON — `integer` (64 bits côté base)
- Exemple — `totalTtcCentimes: 74235`

- Grandeur — Temps de travail
- Suffixe imposé — `…Centiemes` (d'heure)
- Type JSON — `integer`
- Exemple — `tempsBaremeCentiemes: 120` (= 1,2 h)

- Grandeur — Quantité
- Suffixe imposé — `…Millieme`
- Type JSON — `integer`
- Exemple — `quantiteMillieme: 2500` (= 2,5)

- Grandeur — Taux, rabais, TVA
- Suffixe imposé — `…Pourmille`
- Type JSON — `integer`
- Exemple — `tauxTvaPourmille: 81` (= 8,1 %)

- Grandeur — Durée d'horloge
- Suffixe imposé — `…Secondes` / `…Minutes`
- Type JSON — `integer`
- Exemple — `dureeBruteSecondes`

- Grandeur — Date métier
- Suffixe imposé — `…Le` (date seule)
- Type JSON — `string` (`date`)
- Exemple — `debutLe: "2026-03-20"`

- Grandeur — Horodatage
- Suffixe imposé — `…Le`
- Type JSON — `string` (`date-time`, UTC)
- Exemple — `ouvertLe: "2026-07-27T06:42:11.000Z"`

Aucun champ monétaire, temporel ou quantitatif n'est jamais typé `number` non entier. **Il n'existe
aucun champ `float` dans cette API**, et c'est une clause de compatibilité : en introduire un serait
une rupture, pas un ajout.

Le reste : `camelCase`, enums en `snake_case` (miroir exact des types PostgreSQL, source unique
`packages/shared/src/contrats/atelier/enums.ts`), identifiants en `uuid`, dates en ISO 8601 UTC —
le formatage suisse (`1'234.50`, `jj.mm.aaaa`) est **strictement une affaire de présentation** et
n'apparaît nulle part dans les charges utiles.

1.4 En-têtes de requête et de réponse
-------------------------------------

- En-tête — `Idempotency-Key`
- Sens — uuid v4, identité de la **requête**
- Où — §5.1 — obligatoire sur les créations listées

- En-tête — `If-Match`
- Sens — ETag attendu
- Où — obligatoire sur `PATCH /ordres-reparation/{id}` (§9)

- En-tête — `ETag`
- Sens — `W/"<version>"`
- Où — réponse de `GET /ordres-reparation/{id}` et de toute action qui le modifie

- En-tête — `X-Requete-Id`
- Sens — corrélation, = `problem.instance`
- Où — déjà en place (socle)

- En-tête — `Content-Language`
- Sens — langue effective d'un document généré
- Où — réponses `GET …/documents/{type}` (RM-108, P-23)

- En-tête — `Deprecation`, `Sunset`
- Sens — RFC 8594
- Où — §11.4, aucun usage en étape 1

---

2. Décision structurante : les transitions sont des actions nommées

---

**Tranché : `POST /ordres-reparation/{id}/<verbe>`. `PATCH {"statut": "termine"}` est refusé.**

C'est le choix qui engage l'API le plus durablement, parce qu'il détermine la forme de toute
évolution ultérieure des machines à états (OR, ligne, RDV, pointage, prêt — cinq machines, une
vingtaine de transitions autorisées, quinze interdites nommément).

2.1 Les trois options examinées
-------------------------------

**Option A — `PATCH /ordres-reparation/{id}` avec `{"statut": "..."}`.**
Séduisante parce qu'elle donne une surface minuscule : une route, un champ. Elle casse sur quatre
points, tous démontrés par la spécification elle-même :

1. **La transition porte un corps propre.** `/receptionner` exige un kilométrage (RM-51) ;
   `/refuser-controle` exige un motif (T-12) ; `/rouvrir` exige un motif (T-15) ; `/restituer` exige
   éventuellement une signature de réserve (§6.12) ; `/annuler` exige un motif (T-20). Un `PATCH`
   générique devrait accepter l'union de tous ces champs, tous optionnels au niveau du schéma, et
   déporter en runtime la vérité « motif obligatoire _si_ statut = annule ». Un développeur tiers ne
   peut pas lire cette règle dans l'OpenAPI : elle n'y est pas exprimable.
2. **La transition porte un droit propre.** §10 de la spécification : le réceptionnaire peut terminer
   et annuler, le technicien peut passer en contrôle, seule la direction lève une rétention. Avec un
   `PATCH` unique, l'autorisation devient un `switch` dans le service, invisible dans le contrat, et
   la règle « une route = un droit » (`@ExigerDroit`) s'effondre au moment précis où elle devient utile.
3. **La transition porte un code d'erreur propre.** `OR_RECEPTION_REQUISE`, `OR_LIGNES_A_VALIDER`,
   `OR_POINTAGE_OUVERT`, `OR_ANNULATION_IMPOSSIBLE` ne sont pas interchangeables. Documenter « ce
   `PATCH` peut renvoyer onze codes selon la valeur du champ `statut` » est un aveu de conception.
4. **La transition n'est pas une mise à jour de champ.** Terminer un OR touche les lignes, calcule des
   totaux, écrit un journal d'audit, peut déclencher un webhook. `PATCH` promet une sémantique de
   modification partielle qu'on ne tient pas.

**Option B — une ressource `transitions` en sous-collection** :
`POST /ordres-reparation/{id}/transitions {"type": "terminer", ...}`.
Formellement élégante (les transitions deviennent listables, ce qui donne gratuitement un journal), et
c'est ce qu'esquisse le plan frontend en §2.4 (`POST /rendez-vous/{id}/transition`). Rejetée pour la
même raison que A, atténuée mais intacte : le corps reste polymorphe (`oneOf` discriminé par `type`),
donc les champs obligatoires par transition restent invisibles dans un client généré, et le droit
requis redevient dynamique. Le bénéfice « journal gratuit » est illusoire : l'audit (RM-59, RM-111) est
écrit par trigger et exposé par `GET /ordres-reparation/{id}/journal`, il n'a pas besoin de cette
sous-collection.

**Option C — retenue : une action nommée par transition.**
`POST /ordres-reparation/{id}/terminer`. Chaque action a son schéma de corps, son droit, sa liste de
codes d'erreur, son exemple réaliste. L'OpenAPI **est** la documentation de la machine à états : un
développeur tiers voit dix actions et comprend le cycle de vie sans lire la spécification métier.

Coût assumé : la surface passe de 1 à ~12 routes pour l'OR. C'est le prix d'un contrat qui se lit. Le
plan backend arrive à la même conclusion (§4.1) ; on ne diverge que sur la forme du segment (§1.1).

2.2 Le corollaire indispensable : la machine à états est aussi une donnée
-------------------------------------------------------------------------

Une API d'actions nommées oblige le client à savoir quelles actions sont possibles maintenant — sinon
il code la machine à états en dur, et il se désynchronise au premier changement de paramètre.

**`GET /referentiels/transitions?entite=ordre_reparation`** rend la machine à états lisible : pour
chaque statut de départ, les transitions autorisées, l'action correspondante, le droit requis, les
champs de corps obligatoires. Le front s'en sert pour griser un bouton (§3.3 du plan frontend) ; le
connecteur s'en sert pour ne pas tenter l'impossible ; l'équipe s'en sert comme table de vérité unique
avec la base (§3 du plan backend).

Deuxième corollaire : **`ordreReparation.actionsDisponibles`** — un tableau de codes d'action calculé
pour l'appelant courant (statut + droits + paramètres), présent dans la réponse de
`GET /ordres-reparation/{id}`. Il ne remplace pas la vérification serveur ; il évite au client de la
rejouer. Champ additif, donc sans risque d'évolution.

2.3 Ce que les actions **ne** font pas
--------------------------------------

- **Aucune action n'accepte de statut cible.** `POST /terminer` ne prend pas `{"statut": "termine"}` :
  la cible est dans le chemin. Un statut dans un corps est un défaut de revue.
- **Aucune action n'est un raccourci multi-transitions.** Pas de `POST /finaliser` qui enchaînerait
  contrôle + terminaison + restitution : chaque franchissement d'état doit être auditable seul.
- **`statut` est en lecture seule partout**, y compris dans les `PATCH`. Les champs dérivés
  (`etatAffiche`, `attentes`, `actionsDisponibles`) le sont aussi, et ne sont **jamais** l'entrée
  d'une décision serveur.

---

3. Le contrat d'erreur exploitable (D-05)

---

> « Un `problem+json` qui dit _refusé_ sans dire **quoi** est inutilisable en atelier. »
> D-05 du plan frontend. C'est la demande la plus juste des douze, et la plus structurante.

3.1 Le problème à résoudre
--------------------------

I-08 : on refuse de terminer un OR **parce que deux lignes attendent un accord**. I-09 : on refuse
**parce que Rui et Sarah pointent encore**. I-10 : on refuse **parce que trois lignes validées n'ont
pas été exécutées**. Dans les trois cas, le réceptionnaire, debout au comptoir avec le client devant
lui, a besoin de la liste — et d'un chemin pour en sortir.

`ProblemeDetail` actuel offre `erreurs: ErreurChamp[]`, conçu pour la **validation de saisie**
(`champ` / `code` / `message`). Le détourner pour y loger des identifiants de lignes serait un abus :
le front sait déjà que `erreurs[]` se rend sous les champs d'un formulaire, et une ligne d'OR n'est pas
un champ. On ajoute donc, **sans rien retirer ni renommer**, trois propriétés facultatives.

3.2 L'extension — additive, donc rétrocompatible
------------------------------------------------

```ts
// packages/shared/src/contrats/probleme.ts — AJOUTS UNIQUEMENT
export const TYPES_ELEMENT_BLOQUANT = [
  'ligne_or',
  'pointage',
  'technicien',
  'point_controle',
  'devis_complementaire',
  'signature',
  'travail_reporte',
  'ressource_planning',
  'ordre_reparation',
  'champ',
] as const;
export type TypeElementBloquant = (typeof TYPES_ELEMENT_BLOQUANT)[number];

export interface ElementBloquant {
  readonly type: TypeElementBloquant;
  /** uuid de l'élément ; nom du champ quand `type = 'champ'`. */
  readonly id: string;
  /** Libellé FR stable pour le support et les logs. JAMAIS affiché par le front. */
  readonly libelle: string;
  /** Attributs d'affichage minimaux. Additif : on ajoute des clés, on n'en retire jamais. */
  readonly donnees?: Readonly<Record<string, unknown>>;
}

export interface ActionProposee {
  readonly code: CodeActionProposee;
  /** Indice d'appel, facultatif. Le client peut l'ignorer : tout est dans l'OpenAPI. */
  readonly methode?: 'POST' | 'PATCH' | 'GET';
  readonly chemin?: string;
  readonly parametres?: Readonly<Record<string, unknown>>;
}

export interface ProblemeDetail {
  // … champs existants inchangés (type, title, status, code, detail, instance, erreurs)
  /** Ce qui bloque, nommément. Présent sur tout refus de transition (I-08→I-10, RM-54…). */
  readonly blocages?: readonly ElementBloquant[];
  /** Codes à renvoyer dans `confirmations[]` pour rejouer la requête (§4.4). */
  readonly confirmationsRequises?: readonly CodeConfirmation[];
  /** Le chemin de sortie. Invariant frontend n°8 : aucun refus sans chemin de sortie. */
  readonly actionsProposees?: readonly ActionProposee[];
}
```

Trois propriétés facultatives ajoutées à un schéma existant : les clients de l'étape 0 continuent de
fonctionner sans recompilation, les générateurs de types produisent des champs optionnels, et aucune
réponse existante ne change de forme. C'est le modèle de toute évolution future de ce contrat.

`libelle` mérite une justification, parce que la règle du projet est « le front n'affiche jamais un
message serveur ». Il n'est **pas** destiné à l'affichage : il existe pour que la trace de support, le
log et le corps brut d'une réponse soient lisibles par un humain sans requête supplémentaire. Le front
rend l'élément à partir de `type`, `id` et `donnees`, avec ses propres composants et sa propre langue.
La règle reste entière et doit être répétée dans la description OpenAPI du champ.

3.3 Les codes d'action proposée
-------------------------------

Liste fermée, en `SCREAMING_SNAKE` comme les codes d'erreur, dans `packages/shared` :

- `CodeActionProposee` — `CREER_DEVIS_COMPLEMENTAIRE`
- Situation — `OR_PLAFOND_DEPASSE` (RM-54, CT-20)
- Ce que le client propose — ouvre le panneau devis pré-rempli avec `parametres.ligneIds` et `parametres.nouveauPlafondSuggereCentimes`

- `CodeActionProposee` — `VALIDER_LIGNES`
- Situation — `OR_LIGNES_A_VALIDER` (I-08)
- Ce que le client propose — fait défiler jusqu'aux lignes de `blocages`

- `CodeActionProposee` — `ARRETER_POINTAGES`
- Situation — `OR_POINTAGE_OUVERT` (I-09)
- Ce que le client propose — liste les techniciens, propose l'arrêt

- `CodeActionProposee` — `MARQUER_LIGNES_REALISEES`
- Situation — `OR_LIGNE_NON_REALISEE` (I-10)
- Ce que le client propose — idem

- `CodeActionProposee` — `COMPLETER_CONTROLE_QUALITE`
- Situation — `OR_CHECKLIST_INCOMPLETE` (P-08)
- Ce que le client propose — liste les points manquants

- `CodeActionProposee` — `CREER_OR_RETOUCHE`
- Situation — `OR_TRANSITION_INTERDITE` sur `facture → en_cours` (I-02)
- Ce que le client propose — `parametres.ordreReparationParentId`

- `CodeActionProposee` — `CREER_NOUVEL_OR`
- Situation — `OR_TRANSITION_INTERDITE` depuis `restitue` (I-04), `absent → honore` (CT-16)
- Ce que le client propose — —

- `CodeActionProposee` — `RENSEIGNER_PO`
- Situation — `OR_PO_MANQUANT` (RM-14, CT-49)
- Ce que le client propose — —

- `CodeActionProposee` — `SIGNER_RESERVE_SECURITE`
- Situation — `OR_RESERVE_SECURITE_REQUISE` (§6.12, CT-52)
- Ce que le client propose — `parametres.typeSignature: "reserve-securite"`

- `CodeActionProposee` — `FOURNIR_MOTIF`
- Situation — `VEHICULE_KILOMETRAGE_REGRESSIF`, `POINTAGE_MOTIF_REQUIS`
- Ce que le client propose — `parametres.motifsAcceptes: [...]` — l'enum du motif attendu

- `CodeActionProposee` — `REJOUER_AVEC_CONFIRMATION`
- Situation — `CONFIRMATION_REQUISE` (§4.4)
- Ce que le client propose — rejoue avec `confirmations[]`

- `CodeActionProposee` — `DEMANDER_HABILITATION`
- Situation — confirmation requise mais **l'appelant n'a pas le droit**
- Ce que le client propose — affiche « demandez au chef d'atelier »

- `CodeActionProposee` — `RECEPTIONNER_VEHICULE`
- Situation — `OR_RECEPTION_REQUISE` (I-07, CT-18)
- Ce que le client propose — —

- `CodeActionProposee` — `RAFRAICHIR`
- Situation — `CONFLIT` (§9)
- Ce que le client propose — refetch + réapplication de la saisie

`DEMANDER_HABILITATION` est la réponse à un piège d'ergonomie réel : quand le réceptionnaire ouvre un
OR pour un client bloqué (RM-08), il ne peut pas confirmer lui-même. Sans ce code, l'écran affiche un
refus muet et le réceptionnaire appelle le support.

3.4 Exemples normatifs
----------------------

Ces trois corps sont à reprendre **tels quels** comme `examples` OpenAPI (§12.3) et comme fixtures de
test (CT-21, CT-22, CT-20).

**I-08 — terminer avec deux lignes à valider**

```json
{
  "type": "https://docs.dmsforall.example/erreurs/OR_LIGNES_A_VALIDER",
  "title": "Des lignes attendent encore une décision",
  "status": 409,
  "code": "OR_LIGNES_A_VALIDER",
  "instance": "01J8Z6M4S3Q0K8V2N7T1R5W9XA",
  "blocages": [
    {
      "type": "ligne_or",
      "id": "8f2c…a91",
      "libelle": "Disques de frein avant (jeu)",
      "donnees": { "numeroLigne": 4, "totalTtcCentimes": 62000, "origine": "constatee" }
    },
    {
      "type": "ligne_or",
      "id": "b17d…4e0",
      "libelle": "Plaquettes avant",
      "donnees": { "numeroLigne": 5, "totalTtcCentimes": 32000, "origine": "constatee" }
    }
  ],
  "actionsProposees": [
    {
      "code": "CREER_DEVIS_COMPLEMENTAIRE",
      "methode": "POST",
      "chemin": "/api/v1/ordres-reparation/3a1f…c22/devis-complementaires",
      "parametres": {
        "ligneIds": ["8f2c…a91", "b17d…4e0"],
        "nouveauPlafondSuggereCentimes": 174000
      }
    },
    { "code": "VALIDER_LIGNES" }
  ]
}
```

**I-09 — terminer avec deux pointages ouverts**

```json
{
  "type": "https://docs.dmsforall.example/erreurs/OR_POINTAGE_OUVERT",
  "title": "Des pointages sont encore en cours",
  "status": 409,
  "code": "OR_POINTAGE_OUVERT",
  "instance": "01J8Z6M8YB2H4C6D8E0F2G4H6J",
  "blocages": [
    {
      "type": "pointage",
      "id": "c4e1…77a",
      "libelle": "Rui Almeida — depuis 09:12",
      "donnees": {
        "technicienId": "d09a…113",
        "technicienPrenom": "Rui",
        "debutLe": "2026-07-27T07:12:00.000Z",
        "ligneOrId": "8f2c…a91"
      }
    },
    {
      "type": "pointage",
      "id": "e88b…2f5",
      "libelle": "Sarah Berger — depuis 10:04",
      "donnees": {
        "technicienId": "77c2…908",
        "technicienPrenom": "Sarah",
        "debutLe": "2026-07-27T08:04:00.000Z",
        "ligneOrId": null
      }
    }
  ],
  "actionsProposees": [{ "code": "ARRETER_POINTAGES" }]
}
```

**RM-54 / CT-20 — validation d'une ligne qui franchit le plafond**

```json
{
  "type": "https://docs.dmsforall.example/erreurs/OR_PLAFOND_DEPASSE",
  "title": "Le plafond autorisé serait dépassé",
  "status": 409,
  "code": "OR_PLAFOND_DEPASSE",
  "instance": "01J8Z6MC5N7P9R1T3V5X7Z9B1D",
  "blocages": [
    {
      "type": "ligne_or",
      "id": "b17d…4e0",
      "libelle": "Plaquettes avant",
      "donnees": { "totalTtcCentimes": 9000 }
    },
    {
      "type": "champ",
      "id": "plafondCentimes",
      "libelle": "Plafond autorisé 30000, déjà validé 28000, demandé 9000",
      "donnees": {
        "plafondCentimes": 30000,
        "dejaValideCentimes": 28000,
        "apresValidationCentimes": 37000
      }
    }
  ],
  "actionsProposees": [
    {
      "code": "CREER_DEVIS_COMPLEMENTAIRE",
      "parametres": { "ligneIds": ["b17d…4e0"], "nouveauPlafondSuggereCentimes": 37000 }
    }
  ]
}
```

> Le front n'affiche jamais une erreur sèche sur ce cas : il ouvre le panneau de devis complémentaire
> pré-rempli (§3.5 du plan frontend). Le corps ci-dessus contient exactement ce qu'il faut pour le
> faire — c'est le critère de validation du contrat.

3.5 Règles d'usage, opposables en revue
---------------------------------------

1. **Tout refus d'action ou de transition porte `blocages` dès qu'il existe un élément nommable.**
   Un `409 OR_LIGNES_A_VALIDER` sans `blocages` est un bug, pas un choix.
2. **`blocages` est borné** : 50 éléments maximum, `donnees.total` indiquant le compte réel au-delà.
   Un OR pathologique ne doit pas produire une réponse d'erreur d'un mégaoctet.
3. **`actionsProposees` est vide uniquement quand aucune sortie n'existe** — état terminal (`annule`,
   `cloture`). Tout autre refus sans action proposée est un défaut de conception (invariant frontend
   n°8), à corriger côté serveur et non à compenser côté écran.
4. **Ces champs ne portent jamais de donnée non autorisée à l'appelant.** Un technicien reçoit les
   identifiants de lignes mais jamais `totalTtcCentimes` (invariant frontend n°10 : le technicien ne
   voit aucun montant). Le filtrage se fait **côté serveur**, à la construction de `blocages`.
5. **`erreurs[]` reste réservé à la validation de saisie.** Ne jamais y mettre un blocage métier.

---

4. Codes d'erreur, d'avertissement et de confirmation

---

4.1 Trois familles, un seul espace de traduction
------------------------------------------------

La spécification distingue clairement trois natures de retour, et les confondre produit exactement les
bugs d'ergonomie que le plan frontend §9.5 cherche à éviter.

- Famille — **Erreur**
- Type TS — `CodeErreur`
- Transport — `problem+json`, statut ≥ 400
- Rendu front — `RefusBloquant`

- Famille — **Avertissement**
- Type TS — `CodeAvertissement`
- Transport — `avertissements[]` dans une réponse **2xx**
- Rendu front — encart informatif, non bloquant

- Famille — **Confirmation**
- Type TS — `CodeConfirmation`
- Transport — `confirmationsRequises[]` d'un `409 CONFIRMATION_REQUISE`
- Rendu front — `AvertissementConfirmable`

Les trois familles partagent **un seul espace de clés i18n**, `erreurs:codes.<CODE>`, déjà en place.
C'est ce qui permet à `CLIENT_DOUBLON_PROBABLE` (avertissement) et `CLIENT_BLOQUE` (confirmation) de
vivre dans `apps/web/src/i18n/locales/*/erreurs.json` aux côtés des erreurs, sans que le contrat
serveur ne les déclare comme des erreurs — parce qu'elles n'en sont pas. Les codes sont **globalement
uniques** toutes familles confondues : un code appartient à une famille et une seule, pour toujours.

> **Point d'implémentation** : `STATUT_PAR_CODE_ERREUR` (`apps/api/src/common/erreurs/erreur-metier.ts`)
> ne contient que la famille `CodeErreur`. Y faire figurer un code d'avertissement serait un
> contresens : il n'a pas de statut HTTP.

4.2 Alignement sur les traductions déjà écrites
-----------------------------------------------

Les 23 codes de `apps/web/src/i18n/locales/fr/erreurs.json` § `codes` ont été relus un à un. **On
s'aligne sur ces noms**, y compris là où le plan backend §4.3 en proposait d'autres : les traductions
FR/DE/IT existent, elles sont cohérentes avec les clés du namespace `or:refus.*`, et un renommage
cosmétique après coup est du coût pur.

Écarts relevés entre `plan-etape-1-backend.md` §4.3 et les traductions — **le nom i18n l'emporte** :

- Plan backend — `OR_LIGNES_NON_REALISEES`
- Retenu (= i18n) — **`OR_LIGNE_NON_REALISEE`**
- Note — correspond à `or:refus.ligneNonRealisee`

- Plan backend — `OR_PO_REQUIS`
- Retenu (= i18n) — **`OR_PO_MANQUANT`**
- Note — correspond à `or:refus.poManquant`

- Plan backend — `OR_MENTION_SECURITE_REQUISE`
- Retenu (= i18n) — **`OR_RESERVE_SECURITE_REQUISE`**
- Note — correspond à `or:refus.reserveSecuriteRequise`

- Plan backend — `POINTAGE_DEJA_OUVERT`
- Retenu (= i18n) — **`POINTAGE_CHEVAUCHEMENT`**
- Note — symétrique de `RDV_RESSOURCE_CHEVAUCHEMENT`

- Plan backend — `VEHICULE_KM_REGRESSIF`
- Retenu (= i18n) — **`VEHICULE_KILOMETRAGE_REGRESSIF`**
- Note — non abrégé, plus lisible pour un tiers

- Plan backend — `VEHICULE_PLAQUE_OCCUPEE`
- Retenu (= i18n) — **`VEHICULE_PLAQUE_COLLISION`**
- Note — « collision » couvre aussi le cas interchangeable

- Plan backend — `RDV_RESSOURCE_INDISPONIBLE`
- Retenu (= i18n) — **`RDV_RESSOURCE_CHEVAUCHEMENT`**
- Note — la ressource n'est pas indisponible, elle est doublement réservée

- Plan backend — `VEHICULE_SUPPRESSION_IMPOSSIBLE`, `CLIENT_SUPPRESSION_IMPOSSIBLE`
- Retenu (= i18n) — **`VEHICULE_ARCHIVAGE_IMPOSSIBLE`, `CLIENT_DESACTIVATION_IMPOSSIBLE`**
- Note — il n'existe **aucun `DELETE`** dans cette API : un code nommé « suppression » documenterait une opération inexistante (RM-12, RM-31)

**Un seul écart à corriger dans les fichiers i18n** — le seul dont le nom induit un tiers en erreur :

- Actuel (i18n) — `RDV_VEHICULE_NON_IDENTIFIE`
- À renommer — **`RDV_IDENTIFICATION_INCOMPLETE`**
- Pourquoi — RM-35 / CT-12 exigent **client _et_ véhicule** identifiés. Le message FR déjà écrit dit correctement « Un RDV avec client et véhicule identifiés est nécessaire pour l'honorer » — seule la clé ment. Un connecteur qui reçoit `RDV_VEHICULE_NON_IDENTIFIE` alors que c'est le client qui manque perdra du temps, et le champ `blocages` ne rattrapera pas un nom faux.

> Renommage à faire par expert-i18n dans `fr/de/it/erreurs.json` (**clé seule, messages inchangés**),
> avant que le code ne soit ajouté à `CODES_ERREUR`. Coût : trois lignes. Après publication de la v1,
> ce même changement coûterait une dépréciation de six mois.

Note mineure sans action : `OR_LIGNES_A_VALIDER` est au pluriel, `OR_LIGNE_NON_REALISEE` au singulier
alors que les deux transportent une liste. L'incohérence est cosmétique, le code est opaque au front,
et le renommage ne vaut pas la churn sur trois fichiers de traduction. **On ne touche pas.**

4.3 Codes d'erreur — la table complète
--------------------------------------

Codes existants (socle, gelés) : `VALIDATION_ECHOUEE`, `AUTH_*` (9), `DROIT_INSUFFISANT`,
`RESSOURCE_INTROUVABLE`, `CONFLIT`, `ERREUR_INTERNE`. **On ajoute en fin de tableau, on ne réordonne
jamais** — `CODES_ERREUR` est un `as const` dont l'ordre n'a pas de sens sémantique, mais le respecter
évite les diffs illisibles et les revues distraites.

- Code — `OR_TRANSITION_INTERDITE`
- HTTP — 409
- Règle — I-01→I-07, I-11, I-12
- `blocages` — statut courant + cible

- Code — `OR_RECEPTION_REQUISE`
- HTTP — 409
- Règle — I-07, CT-18
- `blocages` — —

- Code — `OR_KM_ENTREE_REQUIS`
- HTTP — 400
- Règle — RM-51, CT-19, P-10
- `blocages` — `champ:kilometrageEntree`

- Code — `OR_LIGNES_A_VALIDER`
- HTTP — 409
- Règle — I-08, CT-21
- `blocages` — **lignes**

- Code — `OR_POINTAGE_OUVERT`
- HTTP — 409
- Règle — I-09, CT-22
- `blocages` — **pointages + techniciens**

- Code — `OR_LIGNE_NON_REALISEE`
- HTTP — 409
- Règle — I-10
- `blocages` — **lignes**

- Code — `OR_CHECKLIST_INCOMPLETE`
- HTTP — 409
- Règle — P-08, T-13
- `blocages` — **points de contrôle**

- Code — `OR_PLAFOND_DEPASSE`
- HTTP — 409
- Règle — RM-54, CT-20
- `blocages` — lignes + champ plafond

- Code — `OR_ANNULATION_IMPOSSIBLE`
- HTTP — 409
- Règle — RM-62, I-03, CT-25, CT-26
- `blocages` — pointages / lignes / facture

- Code — `OR_LIGNE_VERROUILLEE`
- HTTP — 409
- Règle — I-15, CT-30
- `blocages` — ligne

- Code — `OR_PO_MANQUANT`
- HTTP — 409
- Règle — RM-14, CT-49
- `blocages` — `champ:numeroCommandeInterne`

- Code — `OR_RESERVE_SECURITE_REQUISE`
- HTTP — 409
- Règle — §6.12, CT-52, P-28
- `blocages` — **lignes marquées sécurité**

- Code — `OR_FACTURATION_AUCUNE_LIGNE`
- HTTP — 409
- Règle — I-14
- `blocages` — payeur concerné

- Code — `LIGNE_TRANSITION_INTERDITE`
- HTTP — 409
- Règle — §5.2, CT-28
- `blocages` — ligne + statut

- Code — `LIGNE_SUPPRESSION_IMPOSSIBLE`
- HTTP — 409
- Règle — RM-71, CT-27
- `blocages` — pointages / pièces

- Code — `DEVIS_IMMUABLE`
- HTTP — 409
- Règle — RM-79, CT-35
- `blocages` — devis

- Code — `DEVIS_INTERLOCUTEUR_REQUIS`
- HTTP — 400
- Règle — RM-81, CT-32
- `blocages` — `champ:interlocuteurNom`

- Code — `RDV_TRANSITION_INTERDITE`
- HTTP — 409
- Règle — §5.3, CT-16
- `blocages` — statut courant

- Code — `RDV_IDENTIFICATION_INCOMPLETE`
- HTTP — 409
- Règle — RM-35, CT-12
- `blocages` — `champ:clientId` / `champ:vehiculeId`

- Code — `RDV_RESSOURCE_CHEVAUCHEMENT`
- HTTP — 409
- Règle — RM-39, CT-15
- `blocages` — **réservations en conflit**

- Code — `RDV_ANNULATION_IMPOSSIBLE`
- HTTP — 409
- Règle — RM-47, CT-17
- `blocages` — OR lié

- Code — `RDV_HORS_OUVERTURE`
- HTTP — 409
- Règle — RM-48
- `blocages` — plage demandée

- Code — `POINTAGE_TRANSITION_INTERDITE`
- HTTP — 409
- Règle — §5.4
- `blocages` — pointage + statut

- Code — `POINTAGE_CHEVAUCHEMENT`
- HTTP — 409
- Règle — RM-88 (P-06 = interdit et clôture auto refusée)
- `blocages` — pointage ouvert

- Code — `POINTAGE_OR_NON_MODIFIABLE`
- HTTP — 409
- Règle — RM-92, CT-41
- `blocages` — OR + statut

- Code — `POINTAGE_LIGNE_NON_POINTABLE`
- HTTP — 409
- Règle — RM-93, CT-34
- `blocages` — ligne + statut

- Code — `POINTAGE_PERIODE_VERROUILLEE`
- HTTP — 409
- Règle — RM-95, CT-43
- `blocages` — période

- Code — `POINTAGE_MOTIF_REQUIS`
- HTTP — 400
- Règle — RM-94, CT-42
- `blocages` — `champ:motif`

- Code — `POINTAGE_HORODATAGE_INVALIDE`
- HTTP — 400
- Règle — §5.4 (pointage dans le futur), dérive d'horloge §4.3 front
- `blocages` — `champ:debutLe`/`finLe`

- Code — `VEHICULE_KILOMETRAGE_REGRESSIF`
- HTTP — 409
- Règle — RM-24, CT-07
- `blocages` — dernier relevé connu

- Code — `VEHICULE_PLAQUE_COLLISION`
- HTTP — 409
- Règle — RM-18, CT-06
- `blocages` — **véhicule qui porte déjà la plaque**

- Code — `VEHICULE_VIN_EXISTANT`
- HTTP — 409
- Règle — RM-15
- `blocages` — véhicule existant

- Code — `VEHICULE_ARCHIVAGE_IMPOSSIBLE`
- HTTP — 409
- Règle — RM-31
- `blocages` — OR ouverts

- Code — `CLIENT_TYPE_IMMUABLE`
- HTTP — 409
- Règle — RM-01
- `blocages` — —

- Code — `CLIENT_DESACTIVATION_IMPOSSIBLE`
- HTTP — 409
- Règle — RM-12
- `blocages` — OR / RDV / détentions

- Code — `PRET_VEHICULE_INDISPONIBLE`
- HTTP — 409
- Règle — RM-103, CT-45
- `blocages` — prêt en conflit

- Code — `PRET_CONDUCTEUR_REQUIS`
- HTTP — 400
- Règle — RM-102
- `blocages` — `champ:conducteur*`

- Code — `CONFIRMATION_REQUISE`
- HTTP — 409
- Règle — §4.4
- `blocages` — ce qui doit être confirmé

- Code — `IDEMPOTENCE_CONFLIT`
- HTTP — 409
- Règle — §5.1
- `blocages` — —

- Code — `FONCTION_NON_DISPONIBLE`
- HTTP — 501
- Règle — §11.3
- `blocages` — —

**40 codes ajoutés.** 21 reprennent des clés i18n déjà traduites (dont 1 renommée, §4.2) ; **19 codes
restent à traduire en FR/DE/IT** par expert-i18n :
`OR_KM_ENTREE_REQUIS`, `OR_CHECKLIST_INCOMPLETE`, `OR_FACTURATION_AUCUNE_LIGNE`,
`LIGNE_SUPPRESSION_IMPOSSIBLE`, `RDV_TRANSITION_INTERDITE`, `RDV_ANNULATION_IMPOSSIBLE`,
`RDV_HORS_OUVERTURE`, `POINTAGE_TRANSITION_INTERDITE`, `POINTAGE_MOTIF_REQUIS`,
`POINTAGE_HORODATAGE_INVALIDE`, `VEHICULE_VIN_EXISTANT`, `VEHICULE_ARCHIVAGE_IMPOSSIBLE`,
`CLIENT_TYPE_IMMUABLE`, `CLIENT_DESACTIVATION_IMPOSSIBLE`, `PRET_VEHICULE_INDISPONIBLE`,
`PRET_CONDUCTEUR_REQUIS`, `CONFIRMATION_REQUISE`, `IDEMPOTENCE_CONFLIT`, `FONCTION_NON_DISPONIBLE`
(19 entrées — `OR_CHECKLIST_INCOMPLETE` correspond à la clé UI `or:refus.checklistIncomplete` déjà
prévue par le plan frontend §7.2, dont le code manquait dans les deux plans).

4.4 Avertissements et confirmations
-----------------------------------

**Avertissements** — un succès avec réserve, jamais une erreur (RM-05, RM-25, RM-38, §6.16). Enveloppe
de réponse en §7.1.

- `CodeAvertissement` — `CLIENT_DOUBLON_PROBABLE`
- Déclencheur — RM-05, CT-01
- `donnees` — `candidats[]` : `{clientId, numeroClient, nom, npa, critere}`

- `CodeAvertissement` — `VEHICULE_VIN_COURT`
- Déclencheur — RM-15
- `donnees` — `vin`, `longueur`

- `CodeAvertissement` — `VEHICULE_IDENTIFICATION_INCOMPLETE`
- Déclencheur — RM-16
- `donnees` — —

- `CodeAvertissement` — `VEHICULE_KILOMETRAGE_ABERRANT`
- Déclencheur — RM-25
- `donnees` — `ecartKm`, `kmParJour`

- `CodeAvertissement` — `VEHICULE_EXPERTISE_ECHUE`
- Déclencheur — RM-29, CT-09
- `donnees` — `prochaineExpertiseLe`, `source`

- `CodeAvertissement` — `PLANNING_CAPACITE_DEPASSEE`
- Déclencheur — RM-38, CT-14
- `donnees` — `capaciteCentiemes`, `chargeCentiemes`, `date`

- `CodeAvertissement` — `POINTAGE_CLOTURE_AUTOMATIQUE`
- Déclencheur — RM-89, CT-37
- `donnees` — `pointageId`, `orNumero`, `finLe`, `cause: nouveau_pointage\

- `CodeAvertissement` — `PRET_CASCADE_RESTITUTION`
- Déclencheur — RM-104, CT-46
- `donnees` — `pretId`, `clientSuivant`, `dateReservee`

- `CodeAvertissement` — `OR_MULTI_PAYEURS_DESACTIVE`
- Déclencheur — P-12
- `donnees` — —

`POINTAGE_CLOTURE_AUTOMATIQUE` mérite d'être souligné : CT-37 attend qu'un démarrage de pointage
**réussisse** tout en signalant la clôture du précédent. C'est précisément un avertissement en 2xx —
le modéliser en erreur casserait le pointage hors ligne, dont la file ne doit jamais traiter un succès
dans un `catch` (§4.3 du plan frontend).

**Confirmations** — le geste explicite d'un rôle habilité, tracé.

- `CodeConfirmation` — `CLIENT_BLOQUE`
- Règle — RM-08
- Droit requis — `chef_atelier` ou `direction`

- `CodeConfirmation` — `VEHICULE_DEUX_OR_OUVERTS`
- Règle — P-29 = `avertir`
- Droit requis — `receptionnaire`+

- `CodeConfirmation` — `RDV_RESSOURCE_CHEVAUCHEMENT`
- Règle — RM-39, CT-15
- Droit requis — `chef_atelier` ou `direction`

- `CodeConfirmation` — `RDV_HORS_OUVERTURE`
- Règle — RM-48
- Droit requis — `chef_atelier` ou `direction`

- `CodeConfirmation` — `PRET_VEHICULE_INDISPONIBLE`
- Règle — RM-103
- Droit requis — `chef_atelier` ou `direction`

- `CodeConfirmation` — `OR_SANS_RDV`
- Règle — P-21 = interdit
- Droit requis — `chef_atelier` ou `direction`

**Protocole de confirmation** — deux temps, jamais un `?force=true` (un forçage se trace) :

1. La requête part sans `confirmations`. Le serveur détecte une condition confirmable.
2. **Si l'appelant a le droit correspondant** → `409 CONFIRMATION_REQUISE`, avec
   `confirmationsRequises: ["CLIENT_BLOQUE"]`, les `blocages` explicatifs et
   `actionsProposees: [{ code: "REJOUER_AVEC_CONFIRMATION" }]`.
   **Sinon** → `409` portant le code d'erreur spécifique de la condition la plus bloquante,
   sans `confirmationsRequises`, avec `actionsProposees: [{ code: "DEMANDER_HABILITATION" }]`.
3. Le client rejoue la **même requête** avec `"confirmations": ["CLIENT_BLOQUE"]` dans le corps.
   Le serveur revérifie le droit, exécute, et **journalise la confirmation** (RM-59, RM-111).

Règles associées :

- toutes les conditions confirmables sont évaluées **en une passe** : `confirmationsRequises` les liste
  toutes, il n'y a jamais deux allers-retours ;
- une confirmation envoyée pour une condition qui n'existe plus est **ignorée sans erreur** (le monde a
  pu changer entre les deux appels — au comptoir, c'est la norme) ;
- `confirmations` est un champ du **corps**, jamais un en-tête ni une query : il entre dans l'empreinte
  d'idempotence, donc un rejeu confirmé n'est pas confondu avec la requête initiale.

---

5. Idempotence (D-03, D-04)

---

Deux mécanismes, un critère de choix limpide : **qui nomme la ressource ?**

5.1 Le serveur nomme → en-tête `Idempotency-Key`
------------------------------------------------

Quand la création consomme une ressource rare et non réutilisable — un numéro d'OR séquentiel (RM-49),
un numéro de client jamais réutilisé (RM-11) —, le client ne peut pas nommer la ressource. Il nomme la
**requête**.

`Idempotency-Key: <uuid v4>`, **obligatoire** (absence → `400 VALIDATION_ECHOUEE`) sur :

- Endpoint — `POST /clients`
- Pourquoi — RM-11 — un rejeu ne doit pas brûler un numéro de client

- Endpoint — `POST /vehicules`
- Pourquoi — un doublon de véhicule pollue la recherche par plaque, l'entrée n°1 du produit

- Endpoint — `POST /rendez-vous`
- Pourquoi — double-clic au téléphone, §5.6 du plan frontend

- Endpoint — `POST /ordres-reparation`
- Pourquoi — **le cas critique** — RM-49, un rejeu ne brûle jamais un numéro d'OR

- Endpoint — `POST /rendez-vous/{id}/honorer`
- Pourquoi — crée un OR (RM-43)

- Endpoint — `POST /ordres-reparation/{id}/lignes`
- Pourquoi — saisie en rafale, double `Entrée` (§3.5 du plan frontend)

- Endpoint — `POST /ordres-reparation/{id}/devis-complementaires`
- Pourquoi — pièce à valeur probante

- Endpoint — `POST /ordres-reparation/{id}/devis-complementaires/{devisId}/repondre`
- Pourquoi — **une double réponse est un litige** (RM-81)

- Endpoint — `POST /ordres-reparation/{id}/signatures`
- Pourquoi — une signature perdue ou dupliquée détruit la preuve (RM-109)

- Endpoint — `POST /prets`
- Pourquoi — lot 5

Sémantique, à documenter mot pour mot dans l'OpenAPI :

- clé **inconnue** → traitement normal, mémorisation de `(statut, corps)` ;
- clé **connue, empreinte du corps identique** (SHA-256 du corps canonicalisé) → **rejeu de la réponse
  mémorisée à l'identique**, même statut, même corps, plus l'en-tête `Idempotency-Rejeu: true` ;
- clé **connue, empreinte différente** → `409 IDEMPOTENCE_CONFLIT` ;
- clé **connue, requête initiale encore en cours** → `409 IDEMPOTENCE_CONFLIT` avec `Retry-After: 1` ;
- portée : `(tenant_id, methode, chemin, cle)`. Une même clé sur deux endpoints différents est valide
  et ne se recoupe pas ;
- **rétention garantie 7 jours.** C'est un engagement de contrat, pas un détail d'exploitation : un
  connecteur doit savoir combien de temps un rejeu reste sûr. Toute réduction est une rupture (§11.4) ;
- l'écriture de la clé et le travail métier sont dans **la même transaction**.

5.2 Le client nomme → `PUT` sur un identifiant fourni par le client
-------------------------------------------------------------------

C'est la réponse à D-03, et elle mérite d'être comprise pour ce qu'elle est : **la seule façon de
clôturer hors ligne un pointage jamais synchronisé.** L'événement `fin` produit sur la tablette doit
référencer un identifiant qui existe déjà côté client ; attendre un identifiant serveur rendrait la
file hors ligne inopérante dès la première coupure de wifi d'atelier.

```
PUT  /api/v1/pointages/{pointageId}          ← démarrage, {pointageId} = uuid v4 généré sur l'appareil
POST /api/v1/pointages/{pointageId}/arreter  ← clôture, référence le même identifiant
```

`PUT` sur un URI choisi par le client est la forme HTTP canonique de ce besoin, et elle est
**intrinsèquement idempotente : aucun en-tête `Idempotency-Key` n'est requis.** Deux mécanismes
coexistent donc, mais aucun ne se superpose : le pointage est le seul cas où le client peut nommer.

Sémantique précise :

- ressource absente → `201 Created` ;
- ressource présente, empreinte du corps identique → `200 OK` avec la représentation existante ;
- ressource présente, empreinte différente → `409 IDEMPOTENCE_CONFLIT`.

**Ce `PUT` crée, il ne met jamais à jour.** C'est un écart délibéré au « remplacement intégral » de
HTTP, et il est imposé par RM-94 : toute correction de pointage exige un motif, un rôle habilité et la
conservation de la valeur d'origine. Un `PUT` qui écraserait silencieusement contournerait la piste
d'audit. Les corrections passent par `PATCH /pointages/{pointageId}` avec `motif` obligatoire.

Trois précisions qui éviteront des tickets :

1. **Pas de fuite inter-tenant possible.** L'unicité est `(tenant_id, id)` : un `pointageId` déjà
   utilisé chez un autre tenant est invisible et créable normalement. Un `PUT` ne peut donc jamais
   révéler l'existence d'une ressource d'autrui.
2. **`Idempotency-Key` reste accepté** sur ces deux routes et sert d'identité d'**événement** : la file
   hors ligne du plan frontend (§4.3) utilise `Idempotency-Key = id de l'événement local`, distinct du
   `pointageId` pour l'événement `fin`. C'est ce qui permet de rejouer un `arreter` sans ambiguïté.
3. **`POST …/arreter` est idempotent par nature** : le corps porte `finLe` explicite. Rejeu avec le
   même `finLe` → `200`, aucun effet. Rejeu avec un `finLe` différent →
   `409 POINTAGE_TRANSITION_INTERDITE` (le pointage est déjà terminé) et le client doit passer par une
   correction — pas par un second arrêt.

5.3 Horloge et hors ligne
-------------------------

`PUT /pointages/{id}` accepte `debutLe` (horodatage **déclaré par l'appareil**),
`decalageHorlogeMs` (mesuré au dernier échange réussi) et `appareilId`. Le serveur stocke les deux
horodatages — déclaré et reçu — et lève l'anomalie `POINTAGE_CLOTURE_AUTOMATIQUE` /
`POINTAGE_HORODATAGE_INVALIDE` selon le cas. **Une tablette dont l'horloge dérive de 20 minutes est un
fait à enregistrer, pas un bug à masquer** : le serveur n'écrase jamais silencieusement l'heure
déclarée par son heure de réception.

Bornes refusées (`400 POINTAGE_HORODATAGE_INVALIDE`) : `debutLe` dans le futur au-delà de la tolérance
de dérive (5 minutes), `finLe` antérieur à `debutLe`, `debutLe` dans une période verrouillée
(`409 POINTAGE_PERIODE_VERROUILLEE`, RM-95).

---

6. Pagination, filtres et tris

---

6.1 Le curseur doit apprendre à trier autrement que par date de création
------------------------------------------------------------------------

Le curseur du socle encode `{"c": "<cree_le ISO>", "i": "<uuid>"}` pour un tri fixe
`(cree_le DESC, id DESC)`. L'étape 1 introduit des tris métier indispensables : un planning se lit par
heure de début, une liste d'OR par restitution promise, une liste de clients par nom. Le curseur doit
suivre, **sans casser les curseurs existants**.

**Curseur v2**, toujours opaque, base64url de :

```json
{ "t": "restitution_promise:asc", "v": "2026-07-27T14:00:00.000Z", "i": "3a1f…c22" }
```

- `t` : le tri auquel appartient le curseur ; `v` : la valeur de la clé de tri du dernier élément
  (string, entier ou `null`) ; `i` : l'`id`, départage stable.
- **Un curseur v1 (`{c,i}`) reste décodable** et vaut `t = "cree_le:desc"`. Aucun client existant n'est
  affecté ; la migration est invisible.
- Un curseur dont `t` ≠ paramètre `tri` de la requête → `400 VALIDATION_ECHOUEE`
  (`erreurs[0].champ = "curseur"`). Sans cette vérification, changer de tri en cours de pagination
  produit des pages silencieusement fausses — un bug qu'on ne voit qu'en production, sur des données
  réelles, et qu'on ne reproduit jamais.
- Tout tri exposé doit être **total** : la clé de tri est toujours complétée par `id`, et toute colonne
  nullable trie avec `NULLS LAST` documenté.

Paramètres communs à toutes les collections : `limite` (1..200, défaut 50), `curseur`, `tri`.
`tri` a la forme `<champ>:<asc|desc>`, avec une **liste fermée par collection** (un tri non listé →
`400`, jamais un tri silencieusement ignoré).

6.2 Filtres et tris, collection par collection
----------------------------------------------

Convention : un filtre multivalué se répète (`?statut=actif&statut=bloque`) — pas de listes séparées
par virgules, qui cassent dès qu'une valeur en contient une. Un intervalle s'écrit `xDu` / `xAu`,
bornes **incluses**. `q` est la recherche libre normalisée (RM-112).

- Collection — `GET /clients`
- Filtres — `q`, `type`, `statut` (multi, défaut `actif`+`bloque`), `groupeId`, `poObligatoire`, `siteId` (si P-30 = cloisonné)
- Tris (défaut **gras**) — **`nom:asc`**, `numeroClient:asc`, `creeLe:desc`, `dernierPassageLe:desc`
- Notes — `q` porte sur nom, raison sociale, n° client, téléphone, e-mail, IDE

- Collection — `GET /vehicules`
- Filtres — `q`, `detenteurId`, `statut`, `marque`, `importe`, `prochaineExpertiseAu`, `siteId`
- Tris (défaut **gras**) — **`plaque:asc`**, `creeLe:desc`, `prochaineExpertiseLe:asc`
- Notes — `prochaineExpertiseAu` sert la liste de relance (RM-29)

- Collection — `GET /clients/{id}/vehicules`
- Filtres — `inclureAnciennesDetentions` (bool, défaut `false`)
- Tris (défaut **gras**) — **`plaque:asc`**
- Notes — RM-20 : détentions closes visibles sur demande

- Collection — `GET /clients/{id}/ordres-reparation`
- Filtres — `statut` (multi)
- Tris (défaut **gras**) — **`ouvertLe:desc`**
- Notes — RM-21 : les OR restent au client de l'époque

- Collection — `GET /vehicules/{id}/kilometrages`
- Filtres — `du`, `au`
- Tris (défaut **gras**) — **`releveLe:desc`**
- Notes — RM-23

- Collection — `GET /vehicules/{id}/travaux-reportes`
- Filtres — `statut` (multi, défaut `ouvert`), `urgence`
- Tris (défaut **gras**) — **`constateLe:desc`**
- Notes — RM-73

- Collection — `GET /rendez-vous`
- Filtres — `siteId` **(obligatoire)**, `du`/`au` **(obligatoires, fenêtre ≤ 62 jours)**, `statut` (multi), `technicienId`, `posteTravailId`, `motifId`, `vehiculeId`, `clientId`, `origine`
- Tris (défaut **gras**) — **`debutLe:asc`**
- Notes — fenêtre bornée : sans elle, un connecteur balaie trois ans de planning à chaque poll

- Collection — `GET /ordres-reparation`
- Filtres — `siteId`, `statut` (multi), `vue` (§6.3), `clientId`, `vehiculeId`, `technicienId`, `localisation` (multi), `attente` (multi : `accord\
- Tris (défaut **gras**) — pieces\
- Notes — externe`), `restitutionPromiseDu`/`Au`, `ouvertDu`/`Au`, `q`

- Collection — `GET /ordres-reparation/{id}/lignes`
- Filtres — `statut` (multi), `origine`, `payeur`, `technicienId`
- Tris (défaut **gras**) — **`ordreAffichage:asc`**
- Notes — collection paginée pour connecteurs ; l'écran lit les lignes embarquées (§8.3)

- Collection — `GET /ordres-reparation/{id}/devis-complementaires`
- Filtres — `decision`
- Tris (défaut **gras**) — **`numeroOrdre:asc`**
- Notes —

- Collection — `GET /ordres-reparation/{id}/journal`
- Filtres — `entite`, `action`, `du`/`au`
- Tris (défaut **gras**) — **`survenuLe:desc`**
- Notes — RM-59, chargé à l'ouverture du panneau

- Collection — `GET /pointages`
- Filtres — `du`/`au` **(obligatoires, ≤ 92 jours)**, `technicienId`, `siteId`, `ordreReparationId`, `ligneOrId`, `statut` (multi), `anomalie` (bool), `natureActivite`
- Tris (défaut **gras**) — **`debutLe:desc`**
- Notes — `statut=en_cours` remplace un endpoint `/ouverts` ; `anomalie=true` remplace `/anomalies`

- Collection — `GET /periodes-pointage`
- Filtres — `statut`, `annee`
- Tris (défaut **gras**) — **`debutLe:desc`**
- Notes — RM-95

- Collection — `GET /prets`
- Filtres — `siteId`, `statut` (multi), `du`/`au`, `vehiculeCourtoisieId`, `clientId`
- Tris (défaut **gras**) — **`debutPrevuLe:desc`**
- Notes — lot 5

- Collection — `GET /audit`
- Filtres — `entite` **(obligatoire)**, `entiteId` **(obligatoire)**, `du`/`au`
- Tris (défaut **gras**) — **`survenuLe:desc`**
- Notes — droits `direction`/`admin`

**Sur les fenêtres obligatoires** (`/rendez-vous`, `/pointages`, `/audit`) : c'est une décision de
contrat, pas une limite d'implémentation. Une collection dont la taille croît sans borne avec
l'ancienneté du tenant produit, cinq ans plus tard, des connecteurs qui paginent des centaines de
milliers de lignes à chaque synchronisation. Imposer la fenêtre **maintenant** est gratuit ; l'imposer
plus tard est une rupture.

6.3 Les sept vues d'exception : du sucre, jamais une sémantique cachée
----------------------------------------------------------------------

Le plan frontend §2.5 demande sept vues pré-câblées avec compteurs. `?vue=<nom>` existe, **mais sous
une règle stricte : toute vue est exactement équivalente à une combinaison de filtres primitifs
documentés.** Une vue ne fait jamais rien que le développeur tiers ne puisse reproduire — sans quoi
elle devient une sémantique privée, non testable et impossible à faire évoluer.

- `vue` — `en_cours`
- Équivalent primitif exact — `statut=ouvert&statut=en_cours&statut=controle`
- Règle — —

- `vue` — `attente_accord`
- Équivalent primitif exact — `attente=accord`
- Règle — RM-58

- `vue` — `attente_pieces`
- Équivalent primitif exact — `attente=pieces`
- Règle — RM-58

- `vue` — `attente_externe`
- Équivalent primitif exact — `attente=externe`
- Règle — §6.15

- `vue` — `prets_au_retrait`
- Équivalent primitif exact — `statut=termine&statut=facture&localisation=pret_au_retrait`, tri `joursAttenteRetrait:desc`
- Règle — §6.5, CT-50

- `vue` — `restitution_aujourdhui`
- Équivalent primitif exact — `restitutionPromiseDu=<aujourd'hui>&restitutionPromiseAu=<aujourd'hui>`, tri `restitutionPromiseLe:asc`
- Règle — RM-56

- `vue` — `pointages_anormaux`
- Équivalent primitif exact — _(sur `/pointages`)_ `anomalie=true`
- Règle — RM-91, RM-96

`vue` et les filtres primitifs sont **cumulables** (`?vue=prets_au_retrait&siteId=…`) ; en cas de
contradiction, le filtre explicite l'emporte et l'écart est documenté. La projection
**`GET /ordres-reparation/compteurs-vues?siteId=`** renvoie les six compteurs d'un coup — la barre de
vues du chef d'atelier ne déclenche pas six requêtes.

6.4 Ce qui n'est pas paginé, et pourquoi
----------------------------------------

Trois exceptions, toutes explicites et bornées — parce qu'un curseur sur un résultat de saisie au
clavier est un piège, pas une garantie :

- Endpoint — `GET /recherche`
- Borne — `limite` ≤ 50, pas de curseur
- Justification — omnibox à la frappe : on veut les meilleurs résultats, pas la page 3. Un `curseurSuivant` inciterait à paginer une recherche fuzzy dont le classement change à chaque frappe.

- Endpoint — `GET /parametres-atelier`
- Borne — singleton
- Justification — —

- Endpoint — `GET /vehicules/{id}/contexte-atelier`
- Borne — sections bornées (§8.1)
- Justification — —

Ces trois-là sont des **projections** (§1.1), pas des collections. La règle « pagination par curseur
sur toutes les collections » reste sans exception.

---

7. Ressources et endpoints — la table complète

---

7.1 L'enveloppe de réponse des écritures
----------------------------------------

Toute création ou modification d'une ressource métier de l'étape 1 répond avec :

```jsonc
{ "donnees": {/* la ressource */}, "avertissements": [/* §4.4, souvent vide */] }
```

Trois questions tranchées d'un coup :

- **Pourquoi une enveloppe ?** RM-05, RM-25, RM-38, §6.16 imposent des succès avec réserve. Sans
  enveloppe, un avertissement voyagerait en en-tête (structure fragile) ou dans la ressource (pollution
  du modèle métier). Avec, il est impossible à manquer.
- **Pourquoi pas sur les `GET` ?** Une lecture n'avertit de rien. Les `GET` renvoient la ressource nue,
  et les collections gardent l'enveloppe de pagination existante (`{donnees, curseurSuivant, limite}`)
  — dont la clé `donnees` est justement celle qu'on réutilise ici. La cohérence est réelle, pas
  cosmétique.
- **Pourquoi l'enveloppe sur _toutes_ les écritures, même celles qui n'avertissent jamais ?** Parce
  qu'ajouter une enveloppe plus tard est une **rupture**. Le champ `avertissements` est toujours
  présent, éventuellement `[]`. Un endpoint d'écriture qui répondrait nu s'interdirait d'avertir un
  jour — et un jour, il faudra.

Exceptions : `204 No Content` (aucune ressource à rendre) et les endpoints d'authentification du
socle, inchangés.

7.2 Codes implicites sur tous les endpoints
-------------------------------------------

Pour ne pas répéter cinq lignes quarante fois, **ces codes sont implicites partout** et ne sont pas
listés dans les tables ci-dessous :

`400 VALIDATION_ECHOUEE` · `401 AUTH_SESSION_ABSENTE` / `AUTH_SESSION_EXPIREE` ·
`403 DROIT_INSUFFISANT` · `403 AUTH_ORIGINE_REFUSEE` (mutations) · `404 RESSOURCE_INTROUVABLE`
(y compris pour une ressource d'un autre tenant — I-13) · `429 AUTH_TROP_DE_TENTATIVES` ·
`500 ERREUR_INTERNE`.

Les tables listent **uniquement les codes métier** propres à chaque endpoint. C'est cette colonne qui
est contractuelle : elle doit être exhaustive, et un code renvoyé mais non déclaré est un bug de
contrat (§13).

7.3 Clients
-----------

- Méthode et chemin — `GET /clients`
- Entrée — §6.2
- 2xx — `200` page
- Codes métier — —

- Méthode et chemin — `POST /clients`
- Entrée — `Idempotency-Key` ; `{type, civilite?, nom?, prenom?, raisonSociale?, ide?, langueCorrespondance, adressePrincipale, telephones[], email?, conditions?, poObligatoire?, groupeId?, confirmations?}`
- 2xx — `201` enveloppe
- Codes métier — `IDEMPOTENCE_CONFLIT` · avert. `CLIENT_DOUBLON_PROBABLE` (RM-05, CT-01 : **jamais bloquant**)

- Méthode et chemin — `GET /clients/{clientId}`
- Entrée — —
- 2xx — `200`
- Codes métier — —

- Méthode et chemin — `PATCH /clients/{clientId}`
- Entrée — champs modifiables (le `type` n'en est pas)
- 2xx — `200` enveloppe
- Codes métier — `CLIENT_TYPE_IMMUABLE` (RM-01)

- Méthode et chemin — `POST /clients/{clientId}/desactiver`
- Entrée — `{motif}`
- 2xx — `200` enveloppe
- Codes métier — `CLIENT_DESACTIVATION_IMPOSSIBLE` (RM-12, `blocages` = OR/RDV/détentions ouverts)

- Méthode et chemin — `POST /clients/{clientId}/fusionner`
- Entrée — `Idempotency-Key` ; `{clientSourceId, confirmationNom}`
- 2xx — `200` enveloppe (cible)
- Codes métier — `CLIENT_DESACTIVATION_IMPOSSIBLE`, `CONFIRMATION_REQUISE` · droit `direction` seul (§10)

- Méthode et chemin — `GET /clients/{clientId}/vehicules`
- Entrée — §6.2
- 2xx — `200` page
- Codes métier — —

- Méthode et chemin — `GET /clients/{clientId}/ordres-reparation`
- Entrée — §6.2
- 2xx — `200` page
- Codes métier — —

- Méthode et chemin — `GET\
- Entrée — POST /clients/{clientId}/adresses`·`PATCH .../adresses/{adresseId}`
- 2xx — RM-03
- Codes métier — `200`/`201`

- Méthode et chemin — `GET\
- Entrée — POST /clients/{clientId}/contacts`·`PATCH .../contacts/{contactId}`
- 2xx — RM-04, rôles cumulables
- Codes métier — `200`/`201`

- Méthode et chemin — `GET\
- Entrée — POST /clients/{clientId}/conditions`
- 2xx — RM-07, **datées**
- Codes métier — `200`/`201`

- Méthode et chemin — `GET\
- Entrée — POST /clients/{clientId}/consentements`
- 2xx — RM-09
- Codes métier — `200`/`201`

- Méthode et chemin — `GET\
- Entrée — POST /clients/{clientId}/notes`
- 2xx — RM-13 (`interne`\
- Codes métier — `alerte`)

**`POST /clients/{clientId}/fusionner`** (RM-06, CT-02) : la fusion est irréversible côté utilisateur
et déplace véhicules, OR, RDV et documents. `confirmationNom` reprend le nom exact de la fiche
absorbée — une garde saisie, pas une case à cocher. La fiche absorbée devient `inactif` avec
`fusionneVersClientId` renseigné, et **`GET /clients/{sourceId}` continue de répondre `200`** avec ce
renvoi : un connecteur qui détient l'ancien identifiant doit pouvoir suivre la trace, pas recevoir 404.

**`GET /doublons-clients?nom=&npa=&email=&telephoneMobile=&ide=&exclureClientId=`** (projection,
RM-05) : détection **avant** création, consommée à la frappe. Renvoie
`{candidats: [{clientId, numeroClient, nom, npa, critere: "nom_npa"|"email"|"telephone"|"ide", score}]}`.
Placée à la racine et non sous `/clients/…` par application de la règle §1.1 : un segment littéral ne
se met jamais là où un identifiant est attendu (`/clients/doublons-probables` serait ambigu avec
`/clients/{clientId}` et se casserait le jour où un identifiant cesse d'être un uuid).

7.4 Véhicules
-------------

- Méthode et chemin — `GET /vehicules`
- Entrée — §6.2
- 2xx — `200` page
- Codes métier — —

- Méthode et chemin — `POST /vehicules`
- Entrée — `Idempotency-Key` ; `{vin?, marque, modele, version?, codeTypeCh?, premiereMiseEnCirculationLe?, plaque?, detenteurId?, importe?, …}`
- 2xx — `201` enveloppe
- Codes métier — `VEHICULE_VIN_EXISTANT` (RM-15) · `VEHICULE_PLAQUE_COLLISION` (RM-18, CT-06) · avert. `VEHICULE_VIN_COURT`, `VEHICULE_IDENTIFICATION_INCOMPLETE`

- Méthode et chemin — `GET /vehicules/{vehiculeId}`
- Entrée — —
- 2xx — `200`
- Codes métier — —

- Méthode et chemin — `PATCH /vehicules/{vehiculeId}`
- Entrée — données d'atelier (RM-26), garanties (RM-33)
- 2xx — `200` enveloppe
- Codes métier — `VEHICULE_VIN_EXISTANT`

- Méthode et chemin — `POST /vehicules/{vehiculeId}/archiver`
- Entrée — `{motif}` (RM-31)
- 2xx — `200` enveloppe
- Codes métier — `VEHICULE_ARCHIVAGE_IMPOSSIBLE` (`blocages` = OR ouverts)

- Méthode et chemin — `POST /vehicules/{vehiculeId}/fusionner`
- Entrée — `{vehiculeSourceId, confirmationVin}`
- 2xx — `200` enveloppe
- Codes métier — RM-32, droit `direction`

- Méthode et chemin — `GET\
- Entrée — POST /vehicules/{vehiculeId}/plaques`
- 2xx — `{valeur, canton, debutLe, interchangeable?, professionnelle?, paysEtranger?}`
- Codes métier — `200`/`201`

- Méthode et chemin — `POST /vehicules/{vehiculeId}/plaques/{plaqueId}/cloturer`
- Entrée — `{finLe}`
- 2xx — `200`
- Codes métier — RM-17

- Méthode et chemin — `GET\
- Entrée — POST /vehicules/{vehiculeId}/detentions`
- 2xx — `{clientId, debutLe}` — correction/import
- Codes métier — `200`/`201`

- Méthode et chemin — **`POST /vehicules/{vehiculeId}/changer-detenteur`**
- Entrée — `{nouveauClientId, changementLe, motifFin, nouvellePlaque?}`
- 2xx — `200` enveloppe
- Codes métier — RM-20/21, CT-47

- Méthode et chemin — `GET\
- Entrée — POST /vehicules/{vehiculeId}/kilometrages`
- 2xx — `{valeur, unite, releveLe, source, motifRegression?}`
- Codes métier — `200`/`201` enveloppe

- Méthode et chemin — `GET\
- Entrée — POST /vehicules/{vehiculeId}/expertises`
- 2xx — `{dateLe, resultat, defauts[], prochaineEcheanceLe, sourceEcheance}`
- Codes métier — `200`/`201`

- Méthode et chemin — `GET\
- Entrée — POST /vehicules/{vehiculeId}/campagnes`·`PATCH .../campagnes/{campagneId}`
- 2xx — RM-30
- Codes métier — `200`/`201`

- Méthode et chemin — `GET /vehicules/{vehiculeId}/travaux-reportes` · `PATCH .../{travailId}`
- Entrée — RM-73
- 2xx — `200`
- Codes métier — —

- Méthode et chemin — **`GET /vehicules/{vehiculeId}/contexte-atelier`**
- Entrée — projection, §8.1
- 2xx — `200`
- Codes métier — —

**`POST /vehicules/{vehiculeId}/changer-detenteur`** est un ajout au regard des deux plans, et il est
important. Le plan backend expose `POST /detentions` + `POST /detentions/{id}/cloturer` : deux appels
pour une opération qui doit être **atomique**. Une vente interrompue entre les deux laisse un véhicule
sans détenteur courant ou avec deux — précisément l'invariant que la contrainte `EXCLUDE` protège en
base, et qu'on ne doit pas pouvoir violer temporairement depuis l'API. Un appel, une transaction, une
entrée d'audit, et le scénario §6.2 / CT-47 devient un contrat testable. Les deux endpoints atomiques
restent exposés pour les corrections d'historique et les imports.

**Kilométrage régressif** (CT-07) : sans `motifRegression`, `409 VEHICULE_KILOMETRAGE_REGRESSIF` avec
`blocages` = dernier relevé connu et `actionsProposees: [{code:"FOURNIR_MOTIF", parametres:{motifsAcceptes:[
"compteur_remplace","erreur_saisie","changement_unite","correction"]}}]`. La conversion mi→km est faite
**par le serveur** avant comparaison (CT-08) : le client n'a aucune arithmétique d'unité à rejouer.

7.5 Recherche (D-08)
--------------------

**`GET /recherche?q=&types=&limite=`** — projection, `types` répétable
(`vehicule`\|`client`\|`ordre_reparation`), `limite` ≤ 50.

Le serveur normalise `q` (casse, accents, espaces, apostrophes, tirets, points), détecte la forme
(2 lettres + chiffres → plaque ; 17 caractères → VIN ; `@` → e-mail ; `OR-` → numéro d'OR) et cherche
par fragment (CT-04). La réponse est **typée et plate** :

```jsonc
{
  "resultats": [
    {
      "type": "vehicule",
      "id": "…",
      "score": 0.94,
      "correspondance": { "champ": "plaque", "valeur": "VD 123456", "historique": false },
      "resume": {
        "plaque": "VD 123456",
        "designation": "VW Touran 2.0 TDI",
        "annee": 2018,
        "detenteurNom": "Meier Hans",
        "ordreReparationOuvert": { "id": "…", "numero": "OR-2026-1042" },
      },
    },
    {
      "type": "vehicule",
      "id": "…",
      "score": 0.61,
      "correspondance": {
        "champ": "plaque",
        "valeur": "VD 123456",
        "historique": true,
        "porteeJusquLe": "2025-02-01",
      },
      "resume": {
        "plaque": "FR 4711",
        "designation": "Opel Corsa 1.2",
        "detenteurNom": "Rossi Maria",
      },
    },
  ],
  "plaqueInterchangeable": false,
}
```

Trois exigences métier portées par le contrat, non par le client :

- **plaque historique** (CT-05, RM-17) : `correspondance.historique = true` + `porteeJusquLe`. Le
  véhicule courant sort en premier, l'historique est signalé, jamais confondu ;
- **plaque interchangeable** (RM-18, §6.9) : `plaqueInterchangeable = true` et **les deux véhicules
  sont retournés**. Le serveur ne choisit jamais à la place de l'utilisateur ;
- **plaque professionnelle (U)** : `resume.plaqueProfessionnelle = true`.

La normalisation est serveur parce qu'elle doit être **identique à celle des index d'expression**
(`normaliser_recherche()`, plan backend §2.1.7). Deux normalisations divergentes, l'une en TypeScript
navigateur et l'autre en SQL, produiraient des résultats manquants indébogables.

7.6 Ordres de réparation — ressource et champs libres
-----------------------------------------------------

- Méthode et chemin — `GET /ordres-reparation`
- Entrée — §6.2, §6.3
- 2xx — `200` page
- Codes métier — —

- Méthode et chemin — `POST /ordres-reparation`
- Entrée — `Idempotency-Key` ; `{siteId, vehiculeId, clientId, type, rendezVousId?, kilometrageEntree?, demandes[], plafondCentimes?, plafondAutorisePar?, restitutionPromiseLe?, conducteurPresent?, statutInitial: "planifie"\
- 2xx — "ouvert", confirmations?}`
- Codes métier — `201` enveloppe

- Méthode et chemin — `GET /ordres-reparation/{orId}`
- Entrée — —
- 2xx — `200` + `ETag`
- Codes métier — —

- Méthode et chemin — `PATCH /ordres-reparation/{orId}`
- Entrée — `If-Match` ; `{localisation?, restitutionPromiseLe?, motifReport?, plafondCentimes?, plafondAutorisePar?, numeroCommandeInterne?, conducteurPresent?}`
- 2xx — `200` enveloppe + `ETag`
- Codes métier — `CONFLIT` (§9) · `OR_LIGNE_VERROUILLEE` (I-15, OR figé) · avert. `PRET_CASCADE_RESTITUTION` (RM-104, CT-46)

- Méthode et chemin — `GET\
- Entrée — POST /ordres-reparation/{orId}/demandes`
- 2xx — `{verbatim}` — RM-52
- Codes métier — `200`/`201`

- Méthode et chemin — `GET /ordres-reparation/{orId}/journal`
- Entrée — §6.2
- 2xx — `200` page
- Codes métier — RM-59, RM-111

- Méthode et chemin — `GET /ordres-reparation/{orId}/documents`
- Entrée — —
- 2xx — `200`
- Codes métier — liste des types disponibles **et la langue de sortie** de chacun (RM-108, P-23)

- Méthode et chemin — `GET /ordres-reparation/{orId}/documents/{type}`
- Entrée — `?langue=` (surcharge motivée)
- 2xx — `200` `application/pdf` + `Content-Language`
- Codes métier — RM-61 : imprimable **à tout moment**, dans l'état courant

- Méthode et chemin — `GET /ordres-reparation/{orId}/proposition-facturation`
- Entrée — projection, §8.4
- 2xx — `200`
- Codes métier — `OR_FACTURATION_AUCUNE_LIGNE` si aucun payeur n'a de ligne (I-14)

- Méthode et chemin — `POST /ordres-reparation/{orId}/signatures`
- Entrée — `Idempotency-Key` ; `{type, nomSignataire, image, appareil, empreinteDocument}`
- 2xx — `201` enveloppe
- Codes métier — RM-109

`PATCH` modifie **uniquement des champs libres**, jamais un statut. Un report de restitution exige
`motifReport` (RM-56) : le refuser est une règle métier, pas une validation de forme —
`400 VALIDATION_ECHOUEE` avec `erreurs[0].champ = "motifReport"`.

7.7 Ordres de réparation — les actions
--------------------------------------

Toutes en `POST`, toutes journalisées, toutes renvoyant **l'OR complet à jour** (§8.3) dans
l'enveloppe : après une transition, l'écran d'OR n'a pas à relire — c'est l'écran le plus rafraîchi du
produit.

- Action — `/receptionner`
- Transition — T-03 `planifie→ouvert`
- Corps — `{kilometrageEntree, unite, signatureDifferee?, motifDifferee?}`
- Codes métier — `OR_TRANSITION_INTERDITE` · `OR_KM_ENTREE_REQUIS` (RM-51) · `VEHICULE_KILOMETRAGE_REGRESSIF`

- Action — `/demarrer`
- Transition — T-04 `ouvert→en_cours`
- Corps — `{}`
- Codes métier — `OR_TRANSITION_INTERDITE` · `OR_RECEPTION_REQUISE` (I-07, CT-18)

- Action — `/reprendre-travaux`
- Transition — T-06/T-08/T-10
- Corps — `{ligneIds?, motif?}` — lève les blocages
- Codes métier — `OR_TRANSITION_INTERDITE`

- Action — `/passer-en-controle`
- Transition — T-11 `en_cours→controle`
- Corps — `{}`
- Codes métier — `OR_LIGNES_A_VALIDER` (I-08) · `OR_LIGNE_NON_REALISEE` (I-10) · `OR_POINTAGE_OUVERT` (I-09)

- Action — `/refuser-controle`
- Transition — T-12 `controle→en_cours`
- Corps — `{motif}` **obligatoire**
- Codes métier — `OR_TRANSITION_INTERDITE`

- Action — `/valider-controle`
- Transition — T-13 `controle→termine`
- Corps — `{controleurId, pointsControles[]}`
- Codes métier — `OR_CHECKLIST_INCOMPLETE` (P-08) · `OR_POINTAGE_OUVERT` · `OR_PO_MANQUANT`

- Action — `/terminer`
- Transition — T-14 `en_cours→termine` (P-08 = `jamais`)
- Corps — `{kilometrageSortie?}`
- Codes métier — `OR_TRANSITION_INTERDITE` (si CQ obligatoire) · `OR_LIGNES_A_VALIDER` · `OR_POINTAGE_OUVERT` · `OR_LIGNE_NON_REALISEE` · `OR_PO_MANQUANT` (RM-14, CT-49)

- Action — `/rouvrir`
- Transition — T-15 `termine→en_cours`
- Corps — `{motif}` **obligatoire**
- Codes métier — `OR_TRANSITION_INTERDITE` (I-02 depuis `facture` → `CREER_OR_RETOUCHE`)

- Action — `/restituer`
- Transition — T-17/T-18
- Corps — `{kilometrageSortie?, piecesRestituees?, paiementRecu?}`
- Codes métier — `OR_TRANSITION_INTERDITE` (I-12) · `OR_RESERVE_SECURITE_REQUISE` (§6.12, CT-52) · `OR_PO_MANQUANT`

- Action — `/cloturer`
- Transition — T-19
- Corps — `{}`
- Codes métier — `OR_TRANSITION_INTERDITE` · `OR_PO_MANQUANT`

- Action — `/annuler`
- Transition — T-20
- Corps — `{motif}` **obligatoire**
- Codes métier — `OR_ANNULATION_IMPOSSIBLE` (RM-62, CT-25, CT-26 — `blocages` = pointages, pièces, factures)

- Action — `/invoquer-retention` · `/lever-retention`
- Transition — §6.5
- Corps — `{motif, montantContesteCentimes?}`
- Codes métier — droit `direction` seul (§10)

**Réservé étape 2, non publié en v1** : `/facturer` (T-16). Le nom est réservé ici pour qu'aucune autre
action ne le prenne. Publier dès maintenant une route répondant `501 FONCTION_NON_DISPONIBLE` serait
pire : un connecteur coderait contre elle. Le front sait que la facturation arrive à l'étape 2 par
`GET /parametres-atelier` → `fonctionnalites.facturation = false` (§8.2), pas en tâtonnant.

**Actions groupées sur les lignes** — portées par l'OR, jamais par la sous-collection :

- Action — `/valider-lignes`
- Corps — `{ligneIds[]}`
- Codes métier — `OR_PLAFOND_DEPASSE` (RM-54, CT-20) · `LIGNE_TRANSITION_INTERDITE` · `OR_LIGNE_VERROUILLEE`

- Action — `/refuser-lignes`
- Corps — `{ligneIds[], motif?}`
- Codes métier — `LIGNE_TRANSITION_INTERDITE`

- Action — `/annuler-lignes`
- Corps — `{ligneIds[], motif}` **obligatoire**
- Codes métier — `LIGNE_SUPPRESSION_IMPOSSIBLE` (RM-71, CT-27) · `LIGNE_TRANSITION_INTERDITE`

- Action — `/soumettre-lignes-a-devis`
- Corps — `{ligneIds[]}`
- Codes métier — `LIGNE_TRANSITION_INTERDITE`

**Pourquoi le groupe est atomique, et pourquoi ce n'est pas une optimisation.** Valider cinq lignes une
par une contre un plafond (RM-54) donne quatre succès et un refus, avec l'OR laissé dans un état que
personne n'a voulu : le client a accepté un ensemble, on lui en a validé une partie. `POST
/valider-lignes {ligneIds}` évalue le total **de l'ensemble** contre le plafond et applique tout ou
rien. La correction est dans la sémantique, pas dans le nombre de requêtes. Le cas d'une seule ligne
est un tableau de taille 1 — pas de route dédiée, pas de duplication de règle.

Le placement au niveau de l'OR (`/valider-lignes` plutôt que `/lignes/valider`) applique la règle §1.1 :
`/lignes/valider` entrerait en concurrence de routage avec `/lignes/{ligneId}`.

7.8 Lignes d'OR
---------------

- Méthode et chemin — `GET /ordres-reparation/{orId}/lignes`
- Entrée — §6.2
- 2xx — `200` page
- Codes métier — —

- Méthode et chemin — `POST /ordres-reparation/{orId}/lignes`
- Entrée — `Idempotency-Key` ; `{type, origine, designation, reference?, quantiteMillieme, tempsBaremeCentiemes?, prixUnitaireCentimes?, rabaisPourmille?, payeur?, technicienId?, urgence?, securite?, fournieParClient?, pieceARestituer?, codeOperation?, codeDefaut?, numeroSinistre?}`
- 2xx — `201` enveloppe
- Codes métier — `OR_LIGNE_VERROUILLEE` (I-15, CT-30) · `IDEMPOTENCE_CONFLIT`

- Méthode et chemin — `PATCH /ordres-reparation/{orId}/lignes/{ligneId}`
- Entrée — champs libres (désignation, quantité, temps, prix, rabais, payeur, technicien, urgence, marqueurs)
- 2xx — `200` enveloppe
- Codes métier — `OR_LIGNE_VERROUILLEE` · `OR_PLAFOND_DEPASSE` (si la ligne est déjà `validee`)

- Méthode et chemin — `POST /ordres-reparation/{orId}/lignes/{ligneId}/marquer-realisee`
- Entrée — `{tempsReelCentiemes?}`
- 2xx — `200` enveloppe
- Codes métier — `LIGNE_TRANSITION_INTERDITE` (RM-72, CT-28 : `refusee` ne devient jamais `realisee`)

- Méthode et chemin — `POST /ordres-reparation/{orId}/lignes-depuis-prestation`
- Entrée — `{prestationId, quantiteMillieme?}`
- 2xx — `201` enveloppe
- Codes métier — catalogue §7.9 de la spéc, prix **figés** à la création

- Méthode et chemin — `POST /ordres-reparation/{orId}/lignes-depuis-travaux-reportes`
- Entrée — `{travailReporteIds[]}`
- 2xx — `201` enveloppe
- Codes métier — RM-73 → reprise au passage suivant

**Aucun `DELETE`.** RM-71 / CT-27 : une ligne s'annule avec motif et reste visible. C'est le point où
une API mal conçue détruit une preuve, et c'est la raison pour laquelle le privilège `DELETE` n'est
même pas accordé au rôle applicatif en base (plan backend §2.1.3).

**Valeurs figées à la création** (RM-50, RM-65, RM-07) : taux horaire, prix unitaire, taux de TVA et
conditions client sont **capturés par le serveur** au moment de la création et renvoyés dans la
représentation. Le client ne les envoie jamais et ne les recalcule jamais. Ils apparaissent en lecture
seule dans la ressource, avec `figeLe`.

7.9 Devis complémentaires
-------------------------

- Méthode et chemin — `GET /ordres-reparation/{orId}/devis-complementaires`
- Entrée — §6.2
- 2xx — `200` page
- Codes métier — —

- Méthode et chemin — `POST /ordres-reparation/{orId}/devis-complementaires`
- Entrée — `Idempotency-Key` ; `{ligneIds[], nouveauPlafondCentimes, canal, destinataireContactId?, impactRestitutionLe?}`
- 2xx — `201` enveloppe
- Codes métier — `LIGNE_TRANSITION_INTERDITE` · `DEVIS_IMMUABLE`

- Méthode et chemin — `GET /ordres-reparation/{orId}/devis-complementaires/{devisId}`
- Entrée — —
- 2xx — `200`
- Codes métier — —

- Méthode et chemin — `POST /…/devis-complementaires/{devisId}/repondre`
- Entrée — `Idempotency-Key` ; `{decision, canal, interlocuteurNom, repondueLe, retranscription?, lignes?: [{ligneId, decision}]}`
- 2xx — `200` enveloppe
- Codes métier — `DEVIS_INTERLOCUTEUR_REQUIS` (RM-81, CT-32) · `DEVIS_IMMUABLE` (RM-79, CT-35)

Pas de `PATCH`, pas de `DELETE` : un devis répondu est immuable (RM-79). Une réponse erronée se corrige
par un nouveau devis, jamais par réécriture — c'est la pièce qui gagne le litige.

`interlocuteurNom` est **obligatoire au niveau du schéma** (`required`), et son absence produit
`DEVIS_INTERLOCUTEUR_REQUIS` plutôt qu'un `VALIDATION_ECHOUEE` générique : la règle est métier (« le
nom de la personne qui a répondu »), le code doit la nommer pour que le message traduit soit juste.

Effets de bord contractuels de `/repondre`, à documenter dans la description de l'endpoint parce
qu'ils dépassent la ressource et surprendraient un tiers :

- `partiel` → chaque ligne prend sa propre décision (CT-33) ;
- les lignes refusées alimentent les **travaux reportés** du véhicule (RM-73) — visibles ensuite dans
  `GET /vehicules/{id}/travaux-reportes` et dans le contexte-atelier ;
- l'OR reprend son cours, il n'est **jamais** annulé (RM-84, §6.1) ;
- selon P-24, une ligne de démontage/remontage est **proposée** dans `avertissements` — jamais créée en
  silence (CT-36). C'est le cas tordu le plus important de la spécification, et le contrat doit refléter
  la nuance « proposer ≠ créer ».

7.10 Pointages
--------------

- Méthode et chemin — `GET /pointages`
- Entrée — §6.2 (fenêtre obligatoire)
- 2xx — `200` page
- Codes métier — —

- Méthode et chemin — **`PUT /pointages/{pointageId}`**
- Entrée — `{technicienId, siteId, natureActivite, ordreReparationId?, ligneOrId?, activiteIndirecteId?, debutLe, source, appareilId?, decalageHorlogeMs?}`
- 2xx — `201` / `200` enveloppe
- Codes métier — `POINTAGE_OR_NON_MODIFIABLE` (RM-92, CT-41) · `POINTAGE_LIGNE_NON_POINTABLE` (RM-93, CT-34) · `POINTAGE_CHEVAUCHEMENT` (RM-88) · `POINTAGE_PERIODE_VERROUILLEE` (RM-95) · `POINTAGE_HORODATAGE_INVALIDE` · `IDEMPOTENCE_CONFLIT` · avert. `POINTAGE_CLOTURE_AUTOMATIQUE` (RM-89, CT-37)

- Méthode et chemin — `POST /pointages/{pointageId}/arreter`
- Entrée — `{finLe}`
- 2xx — `200` enveloppe
- Codes métier — `POINTAGE_TRANSITION_INTERDITE` · `POINTAGE_PERIODE_VERROUILLEE` · `POINTAGE_HORODATAGE_INVALIDE`

- Méthode et chemin — `PATCH /pointages/{pointageId}`
- Entrée — `{debutLe?, finLe?, ligneOrId?, natureActivite?, motif}` — `motif` **obligatoire**
- 2xx — `200` enveloppe
- Codes métier — `POINTAGE_MOTIF_REQUIS` (RM-94, CT-42) · `POINTAGE_PERIODE_VERROUILLEE` (CT-43) · `POINTAGE_TRANSITION_INTERDITE`

- Méthode et chemin — `POST /pointages/{pointageId}/valider` · `/devaliser`
- Entrée — `{motif?}`
- 2xx — `200` enveloppe
- Codes métier — `POINTAGE_TRANSITION_INTERDITE` · droit chef d'atelier

- Méthode et chemin — `GET\
- Entrée — POST /periodes-pointage`
- 2xx — `{debutLe, finLe}`
- Codes métier — `200`/`201`

- Méthode et chemin — `POST /periodes-pointage/{periodeId}/verrouiller`
- Entrée — `{}`
- 2xx — `200` enveloppe
- Codes métier — RM-95, droits `comptable`/`direction`

- Méthode et chemin — `GET /indicateurs-pointage`
- Entrée — `du`/`au` **obligatoires**, `technicienId?`, `siteId?`
- 2xx — `200`
- Codes métier — RM-99 — présence, productivité, rendement, taux de retouche

`GET /pointages/ouverts` et `/anomalies` **n'existent pas** : ce sont `?statut=en_cours` et
`?anomalie=true`. Même raison qu'en §6.3 — un endpoint dédié qui n'est qu'un filtre finit toujours par
diverger silencieusement du filtre équivalent.

Le technicien ne reçoit **aucun montant** dans ces réponses (invariant frontend n°10) : la projection
des champs monétaires est faite côté serveur selon le rôle, pas masquée côté écran. Un écran d'atelier
est un écran partagé.

7.11 Rendez-vous et planning
----------------------------

- Méthode et chemin — `GET /rendez-vous`
- Entrée — §6.2 (site + fenêtre obligatoires)
- 2xx — `200` page
- Codes métier — —

- Méthode et chemin — `POST /rendez-vous`
- Entrée — `Idempotency-Key` ; `{siteId, debutLe, dureeMinutes, heuresAtelierCentiemes?, clientId? \
- 2xx — {nom, telephone}, vehiculeId?, motifPrincipalId, motifsSecondairesIds[], verbatim?, modeAttente, origine, ressources[], vehiculeCourtoisieId?, confirmations?}`
- Codes métier — `201` enveloppe

- Méthode et chemin — `GET\
- Entrée — PATCH /rendez-vous/{rdvId}`
- 2xx — changement de véhicule autorisé tant que `planifie` (§6.3)
- Codes métier — `200`

- Méthode et chemin — `POST /rendez-vous/{rdvId}/honorer`
- Entrée — `Idempotency-Key` ; corps de `POST /ordres-reparation` (sans `rendezVousId`)
- 2xx — `201` enveloppe `{rendezVous, ordreReparation}`
- Codes métier — `RDV_IDENTIFICATION_INCOMPLETE` (RM-35, CT-12) · `RDV_TRANSITION_INTERDITE` (CT-16) · tous les codes de création d'OR

- Méthode et chemin — `POST /rendez-vous/{rdvId}/marquer-absent`
- Entrée — `{}`
- 2xx — `200` enveloppe
- Codes métier — `RDV_TRANSITION_INTERDITE` · avert. si seuil de no-show franchi (RM-44)

- Méthode et chemin — `POST /rendez-vous/{rdvId}/annuler`
- Entrée — `{origine: "client"\
- 2xx — "garage", motif?}`
- Codes métier — `200` enveloppe

- Méthode et chemin — `POST /rendez-vous/{rdvId}/reporter`
- Entrée — `{nouveauDebutLe, dureeMinutes?, motif}`
- 2xx — `201` enveloppe (**nouveau RDV**)
- Codes métier — `RDV_TRANSITION_INTERDITE` · `RDV_RESSOURCE_CHEVAUCHEMENT`

- Méthode et chemin — `GET /planning/charge`
- Entrée — `siteId`, `du`, `au`
- 2xx — `200`
- Codes métier — projection §8.5

- Méthode et chemin — `GET\
- Entrée — PATCH /sites/{siteId}/capacite-atelier`
- 2xx — RM-38, P-20
- Codes métier — `200`

`/annuler` couvre `annule_client` et `annule_garage` par un champ `origine` plutôt que par deux
endpoints : c'est la même transition, avec la même trace d'audit et le même droit — seule l'imputation
statistique change. Deux routes auraient dupliqué la règle « impossible si l'OR est ouvert ».

`/reporter` renvoie **`201` et le nouveau RDV** (RM-45), l'ancien passant `reporte` avec
`reporteVersRendezVousId`. Le déplacement subi par le client est une donnée de qualité de service : le
contrat interdit structurellement la modification en place.

7.12 Paramétrage, référentiels, courtoisie, audit
-------------------------------------------------

- Méthode et chemin — `GET /parametres-atelier` · `PATCH` (admin)
- Note — projection §8.2, `ETag`

- Méthode et chemin — `GET /sites/{siteId}/parametres-atelier` · `PATCH`
- Note — P-20, P-31 — paramètres de niveau site, greffés sur la ressource `/sites` du socle

- Méthode et chemin — `GET\
- Note — POST /referentiels/taux-horaires`·`PATCH /{id}`

- Méthode et chemin — `GET\
- Note — POST /referentiels/prestations`·`PATCH /{id}`

- Méthode et chemin — `GET\
- Note — POST /referentiels/motifs-rendez-vous`·`/postes-travail`·`/activites-indirectes`·`/checklists-controle`

- Méthode et chemin — `GET /referentiels/transitions?entite=`
- Note — §2.2 — la machine à états comme donnée

- Méthode et chemin — `GET\
- Note — POST /vehicules-courtoisie`·`PATCH /{id}`

- Méthode et chemin — `GET\
- Note — POST /prets`·`GET /prets/{id}`·`POST /prets/{id}/remettre`·`/retourner`·`/cloturer`·`/annuler`

- Méthode et chemin — `GET /audit?entite=&entiteId=`
- Note — RM-111, droits `direction`/`admin`

---

8. Les projections agrégées (D-01, D-02, D-10)

---

8.0 Ce que coûte un endpoint agrégé, et à quelles conditions on le paie
-----------------------------------------------------------------------

L'objection est réelle et il faut la formuler honnêtement : **un agrégat est façonné par un écran.**
Quand l'écran change, l'endpoint est sous pression de changer ; le développeur tiers hérite d'une forme
qui répond aux besoins d'une UI qu'il ne voit pas ; et l'agrégat masque quelles ressources existent
vraiment.

On les accepte quand même — l'alternative est intenable : à 7h15, six clients à la file, l'encart
d'alertes véhicule (RM-36, CT-13) est ce qui décide du chiffre d'affaires de la matinée, et cinq
requêtes séquentielles le rendent inutilisable. Mais on ne les accepte que sous **quatre règles**, qui
transforment l'agrégat en composition cacheable plutôt qu'en domaine parallèle :

1. **Aucun champ n'existe uniquement dans l'agrégat.** Chaque section est la projection d'une ressource
   accessible seule (`/travaux-reportes`, `/campagnes`, `/expertises`, `/kilometrages`, `/notes`). Un
   agrégat qui invente un champ crée une source de vérité concurrente.
2. **Additif uniquement.** On ajoute une section, on n'en retire ni n'en renomme jamais (§11).
3. **Aucune écriture, aucun effet de bord.** `GET` seul, donc rejouable, cacheable, sans risque.
4. **Chaque section est bornée** et porte son propre compteur total, pour qu'un véhicule à 40 travaux
   reportés ne produise pas une charge utile absurde au moment le plus pressé.

Distinction importante, qu'on maintiendra dans le temps : **`GET /ordres-reparation/{id}` n'est pas un
agrégat d'écran** (§8.3). Un OR _est_ un document — lignes, devis, signatures et pointages cumulés en
font partie au sens métier. Le retourner entier, c'est respecter sa frontière naturelle, pas céder à
l'UI. Cette distinction protège de la dérive : on peut refuser un futur `/tableau-de-bord-comptoir`
sans se contredire.

8.1 `GET /vehicules/{vehiculeId}/contexte-atelier` (D-01, RM-36, CT-13)
-----------------------------------------------------------------------

Consommé au même instant à la prise de RDV **et** à la réception du matin.

```jsonc
{
  "vehicule": {
    "id": "…",
    "plaque": "VD 123456",
    "canton": "VD",
    "designation": "VW Touran 2.0 TDI",
    "premiereMiseEnCirculationLe": "2018-04-12",
    "vin": "WVGZZZ1TZJW…",
    "codeTypeCh": "1ZM431",
    "importe": { "estImporte": true, "paysOrigine": "DE", "importeLe": "2021-06-01" },
    "identificationIncomplete": false,
  },
  "detenteurCourant": {
    "clientId": "…",
    "numeroClient": "C-004128",
    "nom": "Meier Hans",
    "langueCorrespondance": "de",
    "statut": "actif",
    "depuisLe": "2021-06-15",
    "poObligatoire": false,
  },
  "dernierKilometrage": {
    "valeurKm": 187450,
    "unite": "km",
    "releveLe": "2026-04-02",
    "source": "ordre_reparation",
  },
  "expertise": {
    "derniereLe": "2023-06-15",
    "prochaineLe": "2026-06-15",
    "source": "convocation",
    "echue": true,
    "joursDepuisEcheance": 42,
  },
  "garantie": {
    "constructeur": { "finLe": "2023-04-12", "plafondKm": 100000, "active": false },
    "garage": null,
  },
  "campagnesOuvertes": [
    { "id": "…", "code": "23K7", "description": "Rappel pompe à carburant", "obligatoire": true },
  ],
  "travauxReportes": {
    "total": 2,
    "elements": [
      {
        "id": "…",
        "designation": "Disques avant hors cote",
        "urgence": "urgent",
        "constateLe": "2026-04-02",
        "kilometrageAlors": 182100,
        "montantEstimeCentimes": 94000,
        "ordreReparationOrigineId": "…",
      },
    ],
  },
  "alertesClient": [
    { "id": "…", "nature": "alerte", "texte": "Exige d'être rappelé avant tout supplément" },
  ],
  "ordresReparationOuverts": [{ "id": "…", "numero": "OR-2026-1042", "statut": "en_cours" }],
  "depotPneus": null,
  "avertissements": [
    {
      "code": "VEHICULE_EXPERTISE_ECHUE",
      "message": "Expertise échue depuis le 15.06.2026",
      "donnees": { "prochaineExpertiseLe": "2026-06-15", "source": "convocation" },
    },
  ],
}
```

Points de contrat :

- **`expertise.source` est présent et fait foi** : une convocation cantonale prime toujours sur une
  périodicité calculée (RM-28, CT-10). Sans ce champ, un client afficherait une date fausse avec
  aplomb ;
- `garantie` porte **date _et_ plafond km** (RM-33) — le réceptionnaire ne doit jamais promettre une
  garantie inexistante ;
- `ordresReparationOuverts` alimente la confirmation `VEHICULE_DEUX_OR_OUVERTS` (P-29) ;
- `depotPneus` est **présent et `null`** en étape 1 : le champ réserve la place de l'hôtel à pneus
  (§1, Q-19) sans engager d'implémentation. Le déclarer maintenant coûte une ligne ; l'ajouter dans
  trois ans coûte une revue de tous les clients ;
- `travauxReportes.elements` est borné à 10, `total` donne le compte réel ;
- **filtrage par rôle** : `montantEstimeCentimes` disparaît pour un technicien.

**Nom retenu : `contexte-atelier`** (plan frontend §2.4 et D-01), contre `dossier-comptoir` (plan
backend §4.2). Un seul nom, pas d'alias : un alias créé le premier jour est une dette de compatibilité
qu'on porte pour toujours et que personne n'ose retirer.

8.2 `GET /parametres-atelier` (D-02, R3 du plan frontend)
---------------------------------------------------------

Singleton du tenant, **lisible par tout utilisateur authentifié** (l'UI en dépend à chaque écran),
modifiable par `admin`. `ETag` + `Cache-Control: private, must-revalidate` : `staleTime` 30 min côté
front, revalidation à coût nul.

```jsonc
{
  "or": {
    "prefixe": "OR",
    "porteeNumerotation": "tenant",
    "resetAnnuel": true,
    "etatPlanifieActif": true,
    "sansRdvAutorise": true,
    "rdvRetroactifAuto": true,
    "deuxOrMemeVehicule": "avertir",
  },
  "reception": {
    "kmEntreeObligatoire": true,
    "kmSortieObligatoire": false,
    "signature": "recommandee",
    "plafondDefautCentimes": 30000,
  },
  "travaux": {
    "uniteTemps": "heures_decimales",
    "arrondiPointage": "dixieme",
    "chevauchementPointageAutorise": false,
    "pointageObligatoirePourTerminer": false,
    "controleQualite": "selon_type",
    "dureeMaxPointageHeures": 10,
  },
  "facturation": {
    "multiPayeursAutorise": true,
    "restitutionAvantPaiement": false,
    "piecesClientAutorisees": true,
    "politiqueDemontageRefuse": "au_dela_seuil",
    "seuilDemontageCentimes": 15000,
    "produitsAtelier": { "mode": "pourcentage_plafonne", "pourmille": 30, "plafondCentimes": 5000 },
  },
  "documents": { "langue": "client", "mentionSecurite": "obligatoire" },
  "vehicule": { "expertiseAlerteMois": 3, "visibiliteHistoriqueNouveauDetenteur": "technique" },
  "planning": {
    "noShowSeuilAlerte": 2,
    "tamponPretMinutes": 120,
    "rappel": { "canal": "sms", "joursAvant": 1 },
  },
  "fonctionnalites": {
    "facturation": false,
    "stockPieces": false,
    "depotPneus": false,
    "prets": true,
  },
  "version": 7,
}
```

Deux décisions à ne pas perdre de vue :

- **Regroupement par domaine, pas liste plate de `P-xx`.** Les numéros `P-xx` sont un artefact de
  rédaction de la spécification ; un connecteur ne doit jamais avoir à connaître `P-19` pour lire un
  arrondi. La correspondance `P-xx` ↔ champ est documentée en annexe de l'OpenAPI, pas dans les noms.
- **`fonctionnalites` est le drapeau d'étape.** Il permet à un client de découvrir que la facturation
  n'existe pas encore, sans coder « étape 2 » en dur, et il deviendra `true` sans aucun changement de
  contrat. C'est ce qui remplace la publication d'un `/facturer` qui répondrait 501.

Les paramètres de niveau site (P-20 capacité, P-31 heure de clôture automatique) vivent sur
`GET /sites/{siteId}/parametres-atelier` — greffés sur la ressource `/sites` du socle plutôt que dans
une famille `/parametrage/sites/{id}` parallèle, qui donnerait deux chemins pour un même site.

8.3 `GET /ordres-reparation/{orId}` — le document complet (D-10)
----------------------------------------------------------------

Renvoie **l'OR entier** : identité et valeurs figées, demandes en verbatim, lignes, devis
complémentaires, contrôle qualité, signatures, prêt, cumuls de pointage, totaux par payeur, drapeaux
d'attente, `actionsDisponibles`, `version`. Toutes les actions de §7.7 renvoient la même
représentation, ce qui supprime le refetch systématique après mutation.

Champs dérivés, en **lecture seule et jamais entrants** (A-03 du plan backend) :

```jsonc
{
  "statut": "en_cours",
  "attentes": { "accord": true, "pieces": false, "externe": false },
  "etatAffiche": "attente_accord",
  "actionsDisponibles": ["reprendre-travaux", "passer-en-controle", "annuler"],
  "nombreLignes": 12,
  "lignesTronquees": false,
  "version": 34,
  "modifieLe": "2026-07-27T09:14:22.000Z",
  "modifiePar": { "utilisateurId": "…", "nomAffiche": "Sarah B." },
}
```

`etatAffiche` est le plus bloquant des trois drapeaux (`accord > pieces > externe`), calculé une fois
côté serveur : sans lui, chaque client réimplémenterait la priorité, et deux clients finiraient par
afficher deux états différents pour le même OR.

`nombreLignes` et `lignesTronquees` existent dès la v1 alors que rien n'est tronqué aujourd'hui. C'est
délibéré : le jour où un OR pathologique imposera un plafond, il pourra être introduit **sans rupture**,
parce que les clients auront toujours vu le champ. Un `lignesTronquees` ajouté après coup serait ignoré
par tous les clients déjà déployés — c'est-à-dire inutile.

8.4 `GET /ordres-reparation/{orId}/proposition-facturation` — l'accroche de l'étape 2
-------------------------------------------------------------------------------------

Projection en lecture seule (CT-29), **sans émission de document, sans numérotation, sans verrouillage**
— tout cela est l'étape 2. Elle produit le regroupement par payeur, avec TVA calculée par ligne puis
agrégée (RM-107), la franchise d'assurance en **ligne explicite côté client** (RM-68), et les lignes de
payeur `garage` valorisées à 0.00 avec leur mention (RM-70).

Sa forme est déjà celle dont l'étape 2 aura besoin : `groupes[]` par payeur, chacun avec
`lignes[]`, `totalHtCentimes`, `totalTvaCentimes`, `totalTtcCentimes`, et une ventilation
`tva[] : {tauxPourmille, baseHtCentimes, montantCentimes}`. **HT, TVA et TTC sont tous les trois
présents dès l'étape 1**, même si l'atelier ne raisonne qu'en TTC : les ajouter plus tard serait
additif, mais les calculer plus tard obligerait à revalider toute l'arithmétique sur des OR existants.

8.5 `GET /planning/charge?siteId=&du=&au=`
------------------------------------------

Par jour et par compétence : `capaciteCentiemes`, `chargeCentiemes`, `tauxOccupationPourmille`,
`depassement` (booléen). Le dépassement **n'est jamais bloquant** (RM-38, CT-14) : le surbooking est une
pratique volontaire, et une API qui l'interdirait serait contournée dès la première semaine.

Point d'ergonomie porté par le contrat : quand la capacité n'est pas saisie (P-20), `capaciteCentiemes`
vaut **`null`**, jamais `0`. Le plan frontend §8.2 l'exige — une barre de charge à « — » est honnête,
une barre à zéro est un mensonge.

---

9. Concurrence et conflits (D-06)

---

Plusieurs postes et plusieurs onglets travaillent sur le même OR : c'est la norme au comptoir, pas
l'exception (§9.3 du plan frontend).

- `GET /ordres-reparation/{orId}` renvoie `ETag: W/"34"` et le champ `version` (entier monotone par OR,
  incrémenté en base).
- **`If-Match` est obligatoire sur `PATCH /ordres-reparation/{orId}`** — là où les pertes de mise à jour
  sont réelles (deux personnes modifient le plafond). Absence → `428`… **non** : `400 VALIDATION_ECHOUEE`
  avec `erreurs[0].champ = "If-Match"`. On n'introduit pas un statut sans code métier associé.
- **`If-Match` est facultatif sur les actions** (§7.7) : une transition est déjà gardée par son état de
  départ et ses préconditions ; exiger l'ETag y ajouterait un aller-retour sans gain, et casserait les
  clients qui enchaînent une action après une lecture volontairement ancienne.
- Discordance → **`409 CONFLIT`** (et non `412 Precondition Failed`), avec :

```json
{
  "code": "CONFLIT",
  "status": 409,
  "blocages": [
    {
      "type": "champ",
      "id": "plafondCentimes",
      "libelle": "Plafond modifié entre-temps",
      "donnees": { "valeurAttendue": 30000, "valeurActuelle": 80000 }
    }
  ],
  "actionsProposees": [{ "code": "RAFRAICHIR" }],
  "detail": "Version 34 attendue, version 36 courante."
}
```

Le corps porte `modifiePar`, `modifieLe` et `champsModifies` dans `blocages`, ce qui permet l'encart
« Cet OR a été modifié par Sarah à 09:14 » **sans requête supplémentaire**, avec conservation de la
saisie et bouton « Réappliquer » (§5.5 du plan frontend).

**Pourquoi 409 et non 412**, alors que 412 est le statut HTTP canonique pour `If-Match` : le contrat
d'erreur du projet associe un code métier stable à un statut unique (`STATUT_PAR_CODE_ERREUR`).
Renvoyer 412 pour `CONFLIT` créerait deux statuts pour un même code, ou un second code pour une même
situation utilisateur. La déviation est délibérée, documentée ici et dans la description OpenAPI de
chaque `PATCH` — c'est le seul endroit où l'API s'écarte d'une convention HTTP courante, et un tiers
doit pouvoir le découvrir sans surprise.

---

10. Webhooks et journal d'événements

---

Aucun connecteur ne consommera ces webhooks en 2026. Le catalogue et l'enveloppe se figent quand même
maintenant, pour une raison qui ne se rattrape pas : **on ne peut pas fabriquer rétroactivement
l'historique des événements d'un garage.** Si l'étape 1 n'écrit pas ses événements, l'étape 5 démarrera
avec un journal vide et les premiers connecteurs travailleront à l'aveugle sur les dossiers antérieurs.

10.1 Outbox dès l'étape 1
-------------------------

Chaque transition écrit, **dans la même transaction** que le changement d'état, une ligne dans
`evenement_metier` (`tenant_id`, `type`, `ressource`, `ressource_id`, `survenu_le`, `charge_utile`,
`version_schema`). L'émission HTTP peut n'être branchée qu'à l'étape 2 : c'est l'écriture qui est
urgente, pas la livraison. C'est l'unique demande de ce document qui touche l'implémentation de
l'étape 1 sans être exigée par un écran — et c'est celle qui sera la plus coûteuse à ajouter après.

10.2 Catalogue d'événements de l'étape 1
----------------------------------------

Nom : `<ressource>.<evenement au participe passé>`, en `snake_case`. Additif : **on ajoute des types,
on n'en renomme jamais.**

- Type — `ordre_reparation.ouvert`
- Déclencheur — T-02 / T-03

- Type — `ordre_reparation.termine`
- Déclencheur — T-13 / T-14

- Type — `ordre_reparation.restitue`
- Déclencheur — T-17 / T-18

- Type — `ordre_reparation.cloture`
- Déclencheur — T-19

- Type — `ordre_reparation.annule`
- Déclencheur — T-20

- Type — `ligne_or.constatee`
- Déclencheur — ligne d'origine `constatee` créée (constat technicien)

- Type — `devis_complementaire.envoye` · `.repondu`
- Déclencheur — RM-79→81

- Type — `rendez_vous.honore` · `.absent` · `.reporte`
- Déclencheur — §5.3

- Type — `vehicule.detenteur_change`
- Déclencheur — RM-20, §6.2

- Type — `vehicule.kilometrage_releve`
- Déclencheur — RM-23

- Type — `pointage.anomalie_detectee`
- Déclencheur — RM-91, RM-96

- Type — `client.fusionne`
- Déclencheur — RM-06

Réservés étape 2, déjà nommés pour que personne ne prenne le nom : `facture.emise`, `facture.payee`,
`avoir.emis`.

10.3 Enveloppe et signature
---------------------------

```jsonc
{
  "id": "01J8Z…",
  "type": "ordre_reparation.termine",
  "versionSchema": 1,
  "survenuLe": "2026-07-27T14:02:11.000Z",
  "tenantId": "…",
  "siteId": "…",
  "ressource": { "type": "ordre_reparation", "id": "…", "numero": "OR-2026-1042" },
  "donnees": {/* projection stable, additive */},
}
```

- `tenantId` **apparaît dans la charge utile d'un webhook** — et c'est la seule exception à la règle
  §1.2, parfaitement compatible avec elle : un webhook n'est pas une requête entrante. Le destinataire
  n'a aucun moyen de savoir de quel garage vient l'événement autrement.
- Signature : `X-DFA-Signature: t=<epoch>,v1=<hex>` avec
  `HMAC-SHA256(secret, "<t>.<corps brut>")`, comparaison à temps constant, rejet au-delà de
  **5 minutes** de dérive (anti-rejeu). Secret par endpoint, rotation supportée par **deux secrets
  actifs simultanément** — sans quoi toute rotation est une coupure.
- Livraison **au moins une fois**, ordre non garanti : le consommateur déduplique sur `id` et ignore un
  `survenuLe` plus ancien que son état. Le dire dans la documentation évite des connecteurs qui
  supposent l'inverse et corrompent leurs données au premier retry.
- Réessais : 5 tentatives, backoff exponentiel (1 min → 2 h), puis mise en quarantaine de l'endpoint et
  alerte.
- `versionSchema` par type d'événement : un changement incompatible incrémente la version et **les deux
  versions sont émises** pendant la période de transition (§11.4).

---

11. Compatibilité ascendante : préparer l'étape 2

---

11.1 La règle de base, à énoncer dans la documentation publique
---------------------------------------------------------------

> Un client de cette API **doit ignorer les champs qu'il ne connaît pas** et **ne doit pas échouer sur
> une valeur d'enum inconnue**. Sous cette condition, l'ajout d'un champ, d'un endpoint, d'un
> avertissement ou d'un événement n'est jamais une rupture.

Sans cette clause explicite, tout ajout devient négociable, et une API qui ne peut plus rien ajouter
meurt lentement.

11.2 Les enums sont le vrai risque, pas les champs
--------------------------------------------------

Ajouter un champ ne casse personne. **Ajouter une valeur d'enum casse tout client qui l'énumère
exhaustivement** — et le front du projet le fait volontairement (« si le backend ajoute une valeur
d'enum, `tsc` doit échouer », §7.3 du plan frontend). Ce qui est une bonne discipline en interne est
une rupture pour un tiers.

D'où une **classification explicite de chaque enum dans l'OpenAPI**, via l'extension
`x-dfa-enum-extensible` :

- `x-dfa-enum-extensible` — `false` — **gelé**
- Enums — `statut_ordre_reparation`, `statut_ligne_or`, `statut_rendez_vous`, `statut_pointage`, `payeur_ligne_or`, `origine_ligne_or`
- Engagement — Aucune valeur ne sera ajoutée en v1. Un client peut les énumérer exhaustivement sans risque. `facture` et `facturee` **existent déjà** : l'étape 2 ne les ajoutera pas, elle les rendra atteignables.

- `x-dfa-enum-extensible` — `true` — **extensible**
- Enums — `type_ligne_or`, `localisation_vehicule`, `motif_fin_detention`, `source_kilometrage`, `type_ordre_reparation`, `canal_devis`, `origine_rendez_vous`, `nature_activite_pointage`, `TypeElementBloquant`, `CodeAvertissement`, `CodeActionProposee`
- Engagement — Peuvent croître en mineure. Un client doit traiter l'inconnu comme « autre » et ne jamais échouer.

Les enums de **statut sont gelés** parce qu'ils portent la machine à états : y ajouter une valeur, c'est
changer le cycle de vie, ce qui est une rupture métier bien avant d'être une rupture technique. C'est
aussi ce qui valide, a posteriori, la décision A-03 du plan backend : avoir gardé `attente_accord`,
`attente_pieces` et `attente_externe` **hors** de l'enum de statut évite trois valeurs dans un enum
qu'on s'engage à ne plus toucher.

`CodeErreur` est un cas à part : c'est un enum de sortie que le client mappe pour l'affichage. Il est
**extensible par nature**, et le contrat impose déjà le repli (`api/erreurs.ts` : un code inconnu
retombe sur `ERREUR_INTERNE`). À documenter comme tel pour les tiers.

11.3 Ce que l'étape 2 ajoutera sur ces mêmes ressources — et qui est déjà prévu ici
-----------------------------------------------------------------------------------

- Ajout étape 2 — Émission de facture
- Prévu dès maintenant — statut `facture` **dans l'enum gelé** ; transition T-16 ; nom `/facturer` réservé et non publié
- Nature — atteignable sans changer l'enum

- Ajout étape 2 — `factureId` / `numeroFacture` sur la ligne
- Prévu dès maintenant — colonne `facture_id` nullable (plan backend §2.1.8) ; champ absent tant qu'il est vide
- Nature — ajout de champ = additif

- Ajout étape 2 — Numérotation légale, QR-facture
- Prévu dès maintenant — `proposition-facturation` (§8.4) a déjà la forme du document
- Nature — nouvelle ressource `/factures`, aucun impact

- Ajout étape 2 — Ventilation HT / TVA / TTC
- Prévu dès maintenant — **déjà exposée** en étape 1 par ligne et par groupe de payeur
- Nature — rien à faire

- Ajout étape 2 — Adresse de facturation figée
- Prévu dès maintenant — **déjà figée** sur l'OR (RM-50)
- Nature — rien à faire

- Ajout étape 2 — Verrouillage après émission
- Prévu dès maintenant — `OR_LIGNE_VERROUILLEE` (I-15) déjà en place
- Nature — rien à faire

- Ajout étape 2 — Avoirs
- Prévu dès maintenant — `ordre_reparation.facture → annule` reste interdit (I-03)
- Nature — code `OR_ANNULATION_IMPOSSIBLE` déjà présent

- Ajout étape 2 — Paiements, exports fiduciaires
- Prévu dès maintenant — `Idempotency-Key` et son contrat de rétention déjà établis
- Nature — même mécanisme

- Ajout étape 2 — Événements `facture.emise`
- Prévu dès maintenant — outbox déjà en place (§10.1)
- Nature — nom réservé

- Ajout étape 2 — Stock pièces (étape 3)
- Prévu dès maintenant — `articleId` nullable sur la ligne
- Nature — ajout de champ

- Ajout étape 2 — Véhicules en stock (étape 4)
- Prévu dès maintenant — `vehiculeStockId` nullable
- Nature — ajout de champ

- Ajout étape 2 — Dépôt de pneus
- Prévu dès maintenant — `contexte-atelier.depotPneus: null` déjà présent
- Nature — passe de `null` à un objet

`FONCTION_NON_DISPONIBLE` (501) reste au catalogue pour un cas précis : un paramètre activé dont
l'implémentation n'est pas encore là. **Mieux vaut un 501 explicite qu'un calcul faux** — un garage qui
active les produits d'atelier en mode « lignes réelles » avant que ce mode existe doit recevoir un refus
net, pas une facture silencieusement fausse.

11.4 Politique de version et de dépréciation
--------------------------------------------

- **`/api/v1` ne bougera pas** pour tout ce qui est additif. Une `v2` ne serait justifiée que par un
  changement de modèle de sécurité ou une refonte de la forme d'erreur — rien de prévisible.
- **Interdits, sans exception** : renommer ou retirer un champ, retirer un endpoint, restreindre une
  validation, resserrer une borne de pagination, réduire la rétention d'idempotence, ajouter une valeur
  à un enum gelé, transformer un champ optionnel de requête en obligatoire.
- **Dépréciation** : `x-dfa-deprecie: {depuis, remplacePar, sunset}` dans l'OpenAPI, en-têtes
  `Deprecation` et `Sunset` (RFC 8594) sur les réponses concernées, entrée de changelog. **Minimum
  6 mois** entre annonce et retrait, et le double dès qu'un connecteur tiers en production dépend de
  l'endpoint — un intégrateur OEM ne redéploie pas sur commande.
- **Le document OpenAPI généré est versionné dans le dépôt** (`packages/shared/openapi/`). Une revue
  qui modifie ce fichier autrement que par ajout doit être refusée, et un test de non-régression de
  contrat (§13) rend cette règle mécanique plutôt que déclarative.

---

12. Fragments OpenAPI de référence

---

Ces fragments sont **normatifs** : ils fixent la forme attendue de la génération NestJS/Swagger. Le
document réel reste produit par `pnpm api:openapi` à partir des décorateurs — ce qui suit dit à quoi il
doit ressembler.

12.1 Schémas d'erreur enrichis
------------------------------

```yaml
components:
  schemas:
    ElementBloquant:
      type: object
      required: [type, id, libelle]
      properties:
        type:
          type: string
          x-dfa-enum-extensible: true
          enum:
            [
              ligne_or,
              pointage,
              technicien,
              point_controle,
              devis_complementaire,
              signature,
              travail_reporte,
              ressource_planning,
              ordre_reparation,
              champ,
            ]
          description: >
            Nature de l'élément bloquant. Extensible : un client qui rencontre une valeur
            inconnue doit l'afficher de façon générique, jamais échouer.
        id:
          type: string
          description: uuid de l'élément ; nom du champ lorsque `type = champ`.
        libelle:
          type: string
          description: >
            Libellé FR stable, destiné au support et aux journaux. Le front ne l'affiche
            JAMAIS : il rend l'élément à partir de `type`, `id` et `donnees`.
        donnees:
          type: object
          additionalProperties: true
          description: >
            Attributs d'affichage. Additif : des clés peuvent apparaître, aucune ne
            disparaît. Filtré selon le rôle de l'appelant (un technicien ne reçoit
            aucun montant).

    ActionProposee:
      type: object
      required: [code]
      properties:
        code:
          type: string
          x-dfa-enum-extensible: true
          enum:
            [
              CREER_DEVIS_COMPLEMENTAIRE,
              VALIDER_LIGNES,
              ARRETER_POINTAGES,
              MARQUER_LIGNES_REALISEES,
              COMPLETER_CONTROLE_QUALITE,
              CREER_OR_RETOUCHE,
              CREER_NOUVEL_OR,
              RENSEIGNER_PO,
              SIGNER_RESERVE_SECURITE,
              FOURNIR_MOTIF,
              REJOUER_AVEC_CONFIRMATION,
              DEMANDER_HABILITATION,
              RECEPTIONNER_VEHICULE,
              RAFRAICHIR,
            ]
        methode: { type: string, enum: [POST, PATCH, GET] }
        chemin: { type: string, description: Indice d'appel ; le client peut l'ignorer. }
        parametres: { type: object, additionalProperties: true }

    ProblemeDetailCommunDto:
      type: object
      required: [type, title, status, code, instance]
      properties:
        # … champs de l'étape 0, inchangés …
        blocages:
          type: array
          maxItems: 50
          items: { $ref: '#/components/schemas/ElementBloquant' }
          description: >
            Éléments qui empêchent l'opération, nommément. Présent sur tout refus de
            transition dès qu'un élément est nommable (I-08, I-09, I-10, RM-54).
        confirmationsRequises:
          type: array
          items:
            {
              type: string,
              enum:
                [
                  CLIENT_BLOQUE,
                  VEHICULE_DEUX_OR_OUVERTS,
                  RDV_RESSOURCE_CHEVAUCHEMENT,
                  RDV_HORS_OUVERTURE,
                  PRET_VEHICULE_INDISPONIBLE,
                  OR_SANS_RDV,
                ],
            }
          description: >
            Codes à renvoyer dans `confirmations[]` du corps pour rejouer la requête.
            Présent uniquement si l'appelant détient le droit de confirmer.
        actionsProposees:
          type: array
          items: { $ref: '#/components/schemas/ActionProposee' }
          description: >
            Chemins de sortie. Vide uniquement si aucune sortie n'existe (état terminal).
```

12.2 Enveloppes de réponse
--------------------------

```yaml
Avertissement:
  type: object
  required: [code, message]
  properties:
    code: { type: string, x-dfa-enum-extensible: true }
    message: { type: string, description: FR stable, jamais affiché tel quel par le front. }
    donnees: { type: object, additionalProperties: true }

ReponseOrdreReparation:
  type: object
  required: [donnees, avertissements]
  properties:
    donnees: { $ref: '#/components/schemas/OrdreReparationDto' }
    avertissements:
      type: array
      items: { $ref: '#/components/schemas/Avertissement' }
      description: >
        Toujours présent, souvent vide. Un succès avec réserve (doublon probable,
        capacité dépassée, clôture automatique de pointage) n'est jamais une erreur.
```

12.3 Une action de transition, entièrement documentée
-----------------------------------------------------

```yaml
paths:
  /ordres-reparation/{ordreReparationId}/terminer:
    post:
      tags: [Atelier]
      operationId: terminerOrdreReparation
      summary: Passer l'OR à « terminé » (T-14).
      description: |
        Transition `en_cours → termine`, autorisée uniquement si le contrôle qualité n'est
        pas obligatoire pour ce tenant (paramètre `travaux.controleQualite`). Sinon, passer
        par `/passer-en-controle` puis `/valider-controle`.

        Préconditions (RM-60) : aucune ligne `a_valider` (I-08), aucune ligne `validee` non
        `realisee` (I-10), aucun pointage ouvert (I-09), numéro de commande interne
        renseigné si le client l'exige (RM-14).

        Renvoie l'OR complet à jour : aucun rechargement n'est nécessaire après l'appel.
      security: [{ cookie: [] }]
      parameters:
        - name: ordreReparationId
          in: path
          required: true
          schema: { type: string, format: uuid }
      requestBody:
        required: false
        content:
          application/json:
            schema:
              type: object
              properties:
                kilometrageSortie: { type: integer, minimum: 0, example: 187612 }
                unite: { type: string, enum: [km, mi], default: km }
              additionalProperties: false
            example: { kilometrageSortie: 187612, unite: km }
      responses:
        '200':
          description: OR terminé.
          headers:
            ETag: { schema: { type: string }, description: 'W/"<version>"' }
          content:
            application/json:
              schema: { $ref: '#/components/schemas/ReponseOrdreReparation' }
        '409':
          description: |
            Préconditions non remplies. Codes possibles : `OR_TRANSITION_INTERDITE`,
            `OR_LIGNES_A_VALIDER`, `OR_LIGNE_NON_REALISEE`, `OR_POINTAGE_OUVERT`,
            `OR_PO_MANQUANT`.
          content:
            application/problem+json:
              schema: { $ref: '#/components/schemas/ProblemeDetailCommunDto' }
              examples:
                lignesAValider:
                  summary: Deux lignes constatées attendent l'accord du client (I-08, CT-21)
                  value: { $ref: '#/components/examples/OrLignesAValider' }
                pointageOuvert:
                  summary: Rui et Sarah pointent encore (I-09, CT-22)
                  value: { $ref: '#/components/examples/OrPointageOuvert' }
```

> Les deux `examples` sont ceux de §3.4, mot pour mot. **Chaque endpoint de l'étape 1 doit porter au
> moins un exemple de refus réaliste** — un tiers apprend une API par ses erreurs, pas par ses succès.

12.4 Le pointage hors ligne
---------------------------

```yaml
/pointages/{pointageId}:
  put:
    tags: [Pointage]
    operationId: demarrerPointage
    summary: Démarrer un pointage sur un identifiant fourni par le client.
    description: |
      L'identifiant est généré **sur l'appareil** (uuid v4). C'est ce qui permet de
      clôturer hors ligne un pointage jamais synchronisé : l'événement de fin référence
      un identifiant qui existe déjà côté client.

      Idempotent par construction — aucun `Idempotency-Key` n'est requis :
      absent → `201` ; présent avec le même corps → `200` ; présent avec un corps
      différent → `409 IDEMPOTENCE_CONFLIT`.

      **Ce PUT crée, il ne met jamais à jour.** Toute correction passe par `PATCH` avec un
      motif obligatoire (RM-94) : un écrasement silencieux contournerait la piste d'audit.
    requestBody:
      required: true
      content:
        application/json:
          schema:
            type: object
            required: [technicienId, siteId, natureActivite, debutLe, source]
            properties:
              technicienId: { type: string, format: uuid }
              siteId: { type: string, format: uuid }
              natureActivite: { type: string, enum: [productif_ligne, productif_or, indirect] }
              ordreReparationId: { type: string, format: uuid, nullable: true }
              ligneOrId: { type: string, format: uuid, nullable: true }
              activiteIndirecteId: { type: string, format: uuid, nullable: true }
              debutLe:
                { type: string, format: date-time, description: Horodatage déclaré par l'appareil. }
              decalageHorlogeMs:
                {
                  type: integer,
                  description: heureServeur − heureClient au dernier échange réussi.,
                }
              appareilId: { type: string, maxLength: 64 }
              source: { type: string, enum: [ecran_atelier, badge, mobile, saisie] }
            additionalProperties: false
          example:
            technicienId: 'd09a1c7e-4b21-4f88-9a30-1f2e3c4d5b60'
            siteId: '1c2d3e4f-5a6b-7c8d-9e0f-1a2b3c4d5e6f'
            natureActivite: productif_ligne
            ordreReparationId: '3a1fbe22-9c44-4d10-8f77-22aa33bb44cc'
            ligneOrId: '8f2c0a91-77bd-4e10-b3aa-991122334455'
            debutLe: '2026-07-27T07:12:00.000Z'
            decalageHorlogeMs: -1240
            appareilId: 'tablette-atelier-02'
            source: ecran_atelier
    responses:
      '201':
        description: |
          Pointage démarré. `avertissements` peut contenir `POINTAGE_CLOTURE_AUTOMATIQUE`
          si un pointage précédent a été clôturé (RM-89, CT-37) — c'est un **succès**, et
          la file hors ligne ne doit pas le traiter comme une erreur.
      '200': { description: Rejeu strictement identique — pointage déjà créé. }
      '409':
        description: |
          `POINTAGE_OR_NON_MODIFIABLE` (RM-92) · `POINTAGE_LIGNE_NON_POINTABLE` (RM-93) ·
          `POINTAGE_CHEVAUCHEMENT` (RM-88) · `POINTAGE_PERIODE_VERROUILLEE` (RM-95) ·
          `IDEMPOTENCE_CONFLIT`.
```

12.5 Pagination, tri et curseur
-------------------------------

```yaml
  /ordres-reparation:
    get:
      operationId: listerOrdresReparation
      parameters:
        - { name: limite, in: query, schema: { type: integer, minimum: 1, maximum: 200, default: 50 } }
        - { name: curseur, in: query, schema: { type: string, maxLength: 512 },
            description: >
              Curseur opaque renvoyé par la page précédente. Il encode le tri auquel il
              appartient : le fournir avec un `tri` différent produit
              `400 VALIDATION_ECHOUEE` plutôt qu'une page silencieusement fausse. }
        - { name: tri, in: query,
            schema: { type: string,
                      enum: ['ouvertLe:desc', 'restitutionPromiseLe:asc',
                             'numeroSequence:desc', 'joursAttenteRetrait:desc'],
                      default: 'ouvertLe:desc' } }
        - { name: vue, in: query,
            schema: { type: string, enum: [en_cours, attente_accord, attente_pieces,
                                           attente_externe, prets_au_retrait,
                                           restitution_aujourdhui] },
            description: >
              Sucre syntaxique. Chaque vue est **exactement** équivalente à une combinaison
              de filtres primitifs, documentée en §6.3 : un connecteur peut toujours la
              reproduire sans utiliser ce paramètre. }
        - { name: statut, in: query, style: form, explode: true,
            schema: { type: array, items: { type: string } } }
        - { name: attente, in: query, style: form, explode: true,
            schema: { type: array, items: { type: string, enum: [accord, pieces, externe] } } }
```

---

13. Tests de contrat à écrire

---

À placer dans la suite d'intégration (`expert-tests`), exécutés **sur le document OpenAPI généré**,
pas sur des routes prises une à une — sans quoi la 41ᵉ route échappera à la règle.

- # — C-01
- Test — **Aucune opération n'expose un paramètre ou une propriété nommée `tenantId`** (chemin, query, en-tête, corps, à toute profondeur)
- Ce qu'il protège — la règle n°1 du projet

- # — C-02
- Test — Tout segment de chemin qui est un **verbe** (liste close) n'accepte que `POST`
- Ce qu'il protège — §1.1

- # — C-03
- Test — **Aucune opération `DELETE`** dans tout le document
- Ce qu'il protège — RM-110

- # — C-04
- Test — Toute réponse ≥ 400 référence `ProblemeDetailCommunDto` et aucun autre schéma
- Ce qu'il protège — contrat d'erreur unique

- # — C-05
- Test — Tout code renvoyé en exécution figure dans la liste déclarée pour l'endpoint
- Ce qu'il protège — exhaustivité de la colonne « codes métier »

- # — C-06
- Test — Toute collection déclare `limite`, `curseur`, `tri` ; tout `tri` a un enum fermé et un défaut
- Ce qu'il protège — §6

- # — C-07
- Test — Un curseur dont le `t` ne correspond pas au `tri` demandé → `400`, jamais une page
- Ce qu'il protège — §6.1

- # — C-08
- Test — Tout endpoint listé en §5.1 refuse l'absence d'`Idempotency-Key` par `400`
- Ce qu'il protège — §5.1

- # — C-09
- Test — Tout `409` de transition d'OR porte `blocages` non vide **et** `actionsProposees` non vide
- Ce qu'il protège — D-05, invariant frontend n°8

- # — C-10
- Test — Toute écriture répond avec l'enveloppe `{donnees, avertissements}`
- Ce qu'il protège — §7.1

- # — C-11
- Test — Chaque enum du document porte `x-dfa-enum-extensible`
- Ce qu'il protège — §11.2

- # — C-12
- Test — Les enums marqués `false` sont **identiques** à la liste gelée de référence
- Ce qu'il protège — §11.2

- # — C-13
- Test — Chaque `CodeErreur` a une entrée dans `STATUT_PAR_CODE_ERREUR` **et** dans `fr/de/it/erreurs.json`
- Ce qu'il protège — pas de code muet en production

- # — C-14
- Test — Tout endpoint mutant déclare au moins un `example` de refus
- Ce qu'il protège — §12.3

- # — C-15
- Test — Le document généré ne perd ni ne renomme aucun champ par rapport à l'instantané versionné
- Ce qu'il protège — §11.4

- # — C-16
- Test — Une ressource d'un autre tenant répond `404`, jamais `403`
- Ce qu'il protège — I-13, CT-11

C-15 mérite une insistance : c'est le seul test qui empêche une rupture accidentelle d'atteindre la
production. Un instantané du document OpenAPI est versionné ; le test compare et échoue sur toute
suppression ou tout renommage, en laissant passer les ajouts. C'est la traduction mécanique de « on
ajoute, on ne casse jamais ».

---

14. Divergences assumées avec les plans, et points à trancher

---

14.1 Divergences avec `plan-etape-1-backend.md` §4
--------------------------------------------------

- Point — Forme des actions
- Plan backend — substantifs (`/terminaison`, `/annulation`)
- Ce contrat — **infinitifs** (`/terminer`, `/annuler`)
- Pourquoi — §1.1 — un substantif se lit comme une sous-ressource et rend la règle « verbe ⇒ POST » inapplicable ; en français la dérivation est irrégulière (`honorer` → ?)

- Point — Nom de l'agrégat véhicule
- Plan backend — `/dossier-comptoir`
- Ce contrat — **`/contexte-atelier`**
- Pourquoi — nommé deux fois par le plan frontend et par la demande d'origine ; un seul nom, aucun alias

- Point — Paramétrage
- Plan backend — `/parametrage/atelier`, `/parametrage/sites/{id}`
- Ce contrat — **`/parametres-atelier`**, **`/sites/{id}/parametres-atelier`**
- Pourquoi — ressource au pluriel, et les paramètres de site se greffent sur `/sites` du socle plutôt que de créer un second chemin vers un site

- Point — Référentiels
- Plan backend — `/referentiel/...`
- Ce contrat — **`/referentiels/...`**
- Pourquoi — pluriel, cohérence

- Point — Actions sur ligne
- Plan backend — `POST .../lignes/{lid}/validation`
- Ce contrat — **`POST .../valider-lignes {ligneIds[]}`** au niveau de l'OR
- Pourquoi — atomicité contre le plafond (RM-54) : valider 5 lignes une à une laisse un état que personne n'a voulu. Évite aussi la collision de routage `/lignes/valider` vs `/lignes/{id}`

- Point — Pointage
- Plan backend — `POST /pointages/demarrage` + `pointageId` dans le corps
- Ce contrat — **`PUT /pointages/{pointageId}`**
- Pourquoi — idempotence intrinsèque, pas d'en-tête requis, pas de collision `/pointages/demarrage` vs `/pointages/{id}` ; répond exactement à D-03

- Point — `/pointages/ouverts`, `/pointages/anomalies`
- Plan backend — endpoints dédiés
- Ce contrat — **filtres** `?statut=en_cours`, `?anomalie=true`
- Pourquoi — un endpoint qui n'est qu'un filtre finit par diverger du filtre équivalent

- Point — Détenteur
- Plan backend — `POST /detentions` + `/detentions/{id}/cloture`
- Ce contrat — **`POST /vehicules/{id}/changer-detenteur`** (les deux autres restent pour les corrections)
- Pourquoi — atomicité : un véhicule ne doit jamais être observable sans détenteur ou avec deux (CT-47)

- Point — Doublons clients
- Plan backend — `GET /clients/{id}/doublons-probables`
- Ce contrat — **`GET /doublons-clients?...`**
- Pourquoi — détection **avant** création (RM-05, à la frappe) ; et un segment littéral ne se place pas là où un identifiant est attendu

- Point — Codes
- Plan backend — 8 noms différents des traductions
- Ce contrat — **noms i18n retenus** (§4.2)
- Pourquoi — les traductions FR/DE/IT existent et sont cohérentes avec `or:refus.*`

- Point — Codes « suppression »
- Plan backend — `VEHICULE_SUPPRESSION_IMPOSSIBLE`, `CLIENT_SUPPRESSION_IMPOSSIBLE`
- Ce contrat — **`VEHICULE_ARCHIVAGE_IMPOSSIBLE`, `CLIENT_DESACTIVATION_IMPOSSIBLE`**
- Pourquoi — il n'existe aucun `DELETE` : un code nommé « suppression » documenterait une opération inexistante

- Point — `CONFIRMATION_REQUISE`
- Plan backend — toujours ce code
- Ce contrat — **conservé, mais uniquement si l'appelant a le droit** ; sinon code spécifique + `DEMANDER_HABILITATION`
- Pourquoi — sans cela, un réceptionnaire face à un client bloqué reçoit un refus muet

- Point — Codes manquants
- Plan backend — —
- Ce contrat — **ajout** de `OR_CHECKLIST_INCOMPLETE` et `POINTAGE_HORODATAGE_INVALIDE`
- Pourquoi — P-08 est exigé par `or:refus.checklistIncomplete` côté front ; la dérive d'horloge est explicitement attendue par §4.3 du plan frontend

14.2 Réponses aux douze dépendances du plan frontend
----------------------------------------------------

- # — D-01
- Statut — **Servi** — §8.1, nom `contexte-atelier` retenu, avec `depotPneus: null` réservé

- # — D-02
- Statut — **Servi** — §8.2, regroupé par domaine, `ETag`, plus `fonctionnalites` pour l'attente de l'étape 2

- # — D-03
- Statut — **Servi** — §5.2, `PUT /pointages/{pointageId}`

- # — D-04
- Statut — **Servi** — §5.1, dix endpoints, rétention 7 jours contractuelle

- # — D-05
- Statut — **Servi** — §3, `blocages` + `actionsProposees` + `confirmationsRequises`

- # — D-06
- Statut — **Servi** — §9, `ETag`/`version`, `If-Match` sur `PATCH`, corps de conflit exploitable

- # — D-07
- Statut — **Servi** — §4.3, 39 codes, dont 19 à traduire (§4.3) et 1 clé à renommer (§4.2)

- # — D-08
- Statut — **Servi** — §7.5, plaques historiques et interchangeables portées par le contrat

- # — D-09
- Statut — **Partiellement caduc** — `receptionnaire` **existe déjà** dans `ROLES_UTILISATEUR` et dans `0000_socle.sql`. Seule la **cumulabilité** des rôles reste ouverte, et le plan backend A-02 la reporte à l'étape 2. Aucun impact sur ce contrat : les droits sont exprimés par route (`@ExigerDroit`), pas par rôle

- # — D-10
- Statut — **Servi** — §8.3, OR complet, renvoyé aussi par chaque action

- # — D-11
- Statut — **Hors périmètre API** — durée de session, à arbitrer avec expert-auth. Aucun endpoint de ce contrat n'en dépend

- # — D-12
- Statut — **Ce document** — l'OpenAPI généré doit suivre §12 avant le démarrage de la vague 1

14.3 Points à trancher avant l'implémentation
---------------------------------------------

1. **Renommage `RDV_VEHICULE_NON_IDENTIFIE` → `RDV_IDENTIFICATION_INCOMPLETE`** dans les trois fichiers
   de traduction, **clé seule** (les messages FR/DE/IT sont déjà justes). À faire avant l'ajout du code
   à `CODES_ERREUR`. C'est la seule action de coordination bloquante de ce document.
2. **19 codes à traduire** en FR/DE/IT (liste §4.3), plus les codes d'avertissement et de confirmation
   de §4.4 — même espace de clés `erreurs:codes.*`.
3. **`Avertissement`, `ElementBloquant`, `ActionProposee`, `CodeAvertissement`, `CodeConfirmation`,
   `CodeActionProposee`** à déclarer dans `packages/shared/src/contrats/` ; `ProblemeDetail` et
   `ProblemeDetailCommunDto` à étendre de trois propriétés facultatives (§3.2). C'est le seul
   changement du contrat d'erreur de l'étape 0, et il est strictement additif.
4. **Outbox `evenement_metier`** (§10.1) à inscrire au lot 2, même si aucun webhook n'est livré à
   l'étape 1 : c'est le seul élément de ce document qu'on ne pourra pas rattraper après coup.
5. **Q-05 / Q-06 (planning par créneau ou par charge, affectation à la prise de RDV)** restent ouvertes
   côté métier ; le contrat les couvre toutes deux (`ressources[]` optionnel, `/planning/charge`
   indépendant), mais trancher tôt évitera d'exposer durablement deux modes.
