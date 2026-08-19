Spécification métier — Plan du parc & Hangar à pneus
====================================================

Statut : proposition métier, avant tout contrat API/schéma définitif. Périmètre : deux
fonctionnalités visuelles distinctes qui partagent une même mécanique (« une case = un objet »).

---

1. Le métier

---

**1.1 Le parc, ce que c'est vraiment**

Un garage suisse n'a pas « un parking » : plusieurs zones hétérogènes, et un véhicule en change
plusieurs fois par jour.

1. **Places atelier** — le pont, la place devant le pont, la place d'attente après diagnostic.
   Nombre fixe et connu.
2. **Extérieur / cour** — le parc au sens strict. Souvent peint au sol ou implicite (« la rangée
   le long du grillage »), rarement numéroté aussi rigoureusement que le dépôt pièces.
3. **Show-room / exposition** — VN/VO en vente (recoupe `vehicule_stock`).
4. **Véhicules de remplacement** — sous-parc à part, où ce qui compte n'est pas « où
   physiquement » mais « disponible / prêté / en révision ».
5. **Place client nommée** — cas marginal (livraison prévue, client VIP).

Un véhicule occupe une place **de façon approximative et volontaire** : le mécanicien gare où il
y a de la place, pas où le plan dit qu'il doit être. Un DMS qui exige une saisie stricte à chaque
déplacement (scan, checklist) sera abandonné en une semaine — le piège classique des outils
calqués sur un plan d'entrepôt logistique. La donnée doit être **déclarative et corrigible en un
geste**, jamais bloquante : le champ « emplacement » d'un véhicule indique la dernière position
connue, ce n'est pas une vérité d'inventaire auditée.

Conséquence directe : **une place n'est pas garantie unique à un véhicule** en base (pas de
contrainte UNIQUE sur la place occupée) — le garagiste doit pouvoir forcer une position sans que
le système refuse. Le système peut _signaler_ un doublon, jamais le bloquer.

**1.2 Le hangar à pneus, ce que c'est vraiment**

Un vrai métier, indépendant du parc — plus rigoureux en pratique parce que l'argent et la
responsabilité y sont engagés :

- **Qui possède les pneus** : le client, presque toujours. Le garage stocke en dépôt (parfois
  facturé, parfois offert avec un contrat d'entretien). Ce n'est **pas du stock pièces** —
  `stock_article` modélise des pièces que le garage possède et vend ; un jeu de pneus en hangar
  appartient au client et ne sera jamais vendu par le garage. Les deux notions ne doivent pas être
  confondues dans le même modèle.
- **Deux jeux par véhicule** : été et hiver, changés deux fois par an (autour de Pâques et
  d'octobre). Le jeu non monté est en dépôt.
- **Repérage physique** : une étiquette collée sur un pneu (parfois les quatre) avec un numéro ou
  un code-barres, qui renvoie à une case physique du hangar (rack, étagère, palette). Format
  propre à chaque garage — texte libre, comme `stock_article.emplacement`.
- **Rattachement** : à un **véhicule**, pas directement à un client — c'est le véhicule qui
  détermine la dimension/monte, et un même client peut avoir plusieurs véhicules avec chacun son
  jeu. Le client s'atteint en passant par le véhicule
  (`vehicule.proprietaireEconomiqueClientId` / `vehicule_detention`).
- **Au changement de saison** : le garagiste sort le jeu entrant, monte, redépose le jeu sortant
  (même place ou une nouvelle). Typiquement une ligne d'OR (prestation « changement pneus »).
- **Jeu abandonné** : cas réel et récurrent — voiture vendue, client parti ailleurs, pneus trop
  usés pour valoir la reprise. Il faut une règle de relance (délai raisonnable, ex. 18-24 mois
  sans mouvement) et un statut explicite « à relancer » plutôt qu'une suppression : un jeu retiré
  physiquement doit rester traçable (qui, quand, sur quelle autorisation) — même principe que le
  dépôt lui-même, jamais de suppression silencieuse d'un enregistrement qui engage un tiers.
- **Facturation du dépôt** : varie d'un garage à l'autre (§3) — incluse dans un forfait entretien,
  forfait annuel par jeu, ou gratuite tant que le client sert chez eux. Le module doit savoir
  déclencher une ligne facturable au changement de saison, jamais l'imposer.

**1.3 Le point de friction que @laupernoe soulève**

Véhicule vendu entre la prise de RDV et le passage à l'atelier, jeu de pneus dont le client ne
revient jamais, véhicule qui change trois fois de place dans la journée — dans tous ces cas la
donnée de position doit pouvoir être **fausse un moment sans casser le système**. Le plan n'est
pas un système de vérité, c'est une aide à la mémoire visuelle (conséquence sur l'écran : §6).

---

2. Règles métier

---

**Parc**

- RPA-01. Un `emplacement_parc` a un `code` (court, affiché sur la case), un `type`
  (`atelier`/`exterieur`/`exposition`/`remplacement`/`client`), et appartient à un site.
- RPA-02. Un véhicule a au plus une position courante, mais sans FK stricte : un champ texte
  libre (§4) doublé, en option, d'un rattachement à une case définie. Taper « devant le pont 2 »
  sans avoir créé la case correspondante doit rester possible.
- RPA-03. Aucune contrainte d'unicité en base sur « un emplacement = un seul véhicule » — juste un
  signal visuel de doublon à l'écran.
- RPA-04. Un véhicule vendu, archivé ou sorti du site n'affiche plus de position sur le plan (la
  dernière position reste en base pour l'historique) — cohérent avec `vehicule.statut = 'archive'`.
- RPA-05. Le plan (grille, libellés, disposition) est propre à chaque site — deux sites d'un même
  tenant ont deux plans indépendants.
- RPA-06. Créer/modifier une case ne nécessite ni migration ni ticket support : paramétrage
  courant, au même titre qu'un `stock_article.emplacement`.

**Hangar à pneus**

- RPP-01. Un `depot_pneus` (un jeu) est rattaché à un véhicule (obligatoire) et hérite du client
  via ce véhicule — jamais de client directement rattaché en double source de vérité.
- RPP-02. Un `depot_pneus` a une `saison` (`ete`/`hiver`) et un `statut`
  (`en_depot`/`monte`/`a_relancer`/`sorti`). À un instant T, un véhicule a au plus un jeu
  `en_depot` par saison (contrainte d'unicité tenant+véhicule+saison sur les statuts actifs) —
  ici, contrairement au parc, l'unicité a un sens métier réel et doit être imposée : deux jeux
  « été en dépôt » pour le même véhicule est une anomalie de saisie, pas un cas normal.
- RPP-03. Le changement de saison est un événement métier (pas juste une case texte modifiée) :
  il inverse les statuts des deux jeux d'un véhicule (`monte` ↔ `en_depot`) et peut, en option,
  être rattaché à une ligne d'OR (`ligne_or_id` nullable) qui a réalisé le changement.
- RPP-04. Un jeu sans mouvement depuis une durée paramétrable (défaut proposé : 24 mois) passe en
  `a_relancer` automatiquement — visible dans une liste dédiée, jamais supprimé silencieusement.
- RPP-05. Un jeu passe en `sorti` uniquement par une action explicite tracée (motif obligatoire :
  `rendu_au_client`/`vehicule_vendu`/`mis_au_rebut`/`autre`) — jamais par suppression de ligne.
  Cohérent avec la doctrine « immuable, correction par mouvement/statut, jamais par DELETE » déjà
  appliquée à `mouvement_stock`.
- RPP-06. Vente du véhicule : le dépôt de pneus n'est **pas** transféré automatiquement au nouvel
  propriétaire — c'est un choix commercial (le vendeur peut les inclure ou les reprendre). Le
  passage du véhicule en `vehicule_stock`/vente déclenche un signalement (pas un blocage) sur les
  dépôts pneus ouverts liés à ce véhicule, pour que le vendeur statue explicitement (garder,
  rendre, transférer au nouveau propriétaire).
- RPP-07. Le repérage physique (`code_case`) suit exactement le patron `stock_article.emplacement`
  : texte libre, `trim().max(60)`, nullable — pas de nomenclature imposée, chaque garage a la
  sienne.

**Facturation du dépôt (paramétrable, §3)**

- RPP-08. Le forfait de dépôt, s'il existe, est un article/prestation ordinaire facturé via un OR
  ou une facturation directe — pas un mécanisme dédié. Le module ne fait que proposer le
  déclenchement (« créer la ligne de dépôt annuel ? ») au moment du changement de saison, jamais
  automatiquement au dos du client.

---

3. Ce qui varie d'un garage à l'autre — paramétrage proposé

---

- Facturation du dépôt pneus / Gratuit si entretien chez eux / forfait annuel fixe / inclus dans un abonnement pneus / Booléen `facturation_depot_active` + montant par défaut au niveau site, dérogeable par dépôt
- Délai avant relance d'un jeu oublié / 12 à 36 mois selon garage / `delai_relance_mois` paramètre site, défaut 24
- Rigueur du plan de parc / Certains garages veulent un plan fidèle au centimètre (grandes concessions), d'autres juste 3 zones grossières / Le plan est une grille libre dimensionnée par le garage lui-même (voir §5) — pas de taille imposée
- Un jeu de pneus peut-il être rattaché à un client sans véhicule connu (VO pas encore repris en DMS) / Cas réel à la migration d'un DMS existant / `vehicule_id` reste obligatoire mais le véhicule peut être un enregistrement minimal (`identificationIncomplete = true`, mécanisme déjà existant sur `vehicule`)

---

4. Modèle de données proposé

---

Principe directeur : **réutiliser le patron `emplacement` texte libre** de `stock_article` plutôt
que d'inventer une hiérarchie de zones. Le plan de parc a néanmoins besoin d'une notion de
**disposition visuelle** (où dessiner la case) que `stock_article.emplacement` n'a pas — c'est la
vraie nouveauté à modéliser, pas le rattachement lui-même.

**4.1 `emplacement_parc` — conditionnel, Lot D seulement (voir §7-8)**

```
id, tenant_id (RLS), site_id → site(tenant_id, id)
code              text NOT NULL     -- "P12", "Pont 2", libellé affiché sur la case
type              enum emplacement_parc_type (atelier / exterieur / exposition / remplacement / client)
position_colonne, position_ligne  smallint NOT NULL   -- coordonnée grille, rendu visuel
actif             boolean NOT NULL default true
cree_le / modifie_le
UNIQUE (tenant_id, site_id, code)
UNIQUE (tenant_id, site_id, position_colonne, position_ligne)  -- deux cases ne se superposent pas
```

**4.2 Extension de `vehicule` (colonnes, pas de nouvelle table) — Lot C**

```
emplacement_parc_id   uuid NULL  → emplacement_parc(tenant_id, id)   -- rattachement structuré, optionnel
emplacement_libre      text NULL, trim/max 60                        -- patron stock_article.emplacement, toujours dispo
emplacement_maj_le      timestamptz NULL                              -- dernière fois où la position a été touchée
```

Décision : **pas de table `position_vehicule` séparée à ce stade**. Un véhicule n'a besoin que de
sa position courante, pas d'un historique de déplacement fin (contrairement au kilométrage ou à
la détention, qui ont une vraie valeur d'historique métier) — à ajouter plus tard en
`vehicule_position` append-only (patron `vehicule_kilometrage`) seulement si le besoin émerge.

`emplacement_parc_id` et `emplacement_libre` coexistent délibérément (comme
`reference_remplacement_id` le fait ailleurs pour un besoin différent) : la case structurée sert
le rendu visuel du plan, le texte libre est le filet pour tout ce qui n'a pas (encore) de case
définie — cour, place client nommée, « chez le carrossier en sous-traitance ».

**4.3 `depot_pneus` (nouvelle table, module `atelier` ou `pieces` — à trancher, Lot A prioritaire)**

```
id, tenant_id (RLS), vehicule_id NOT NULL → vehicule(tenant_id, id)
site_id            uuid NOT NULL  → site(tenant_id, id)
saison             enum saison_pneu (ete / hiver)
statut             enum statut_depot_pneus (en_depot / monte / a_relancer / sorti)
code_case          text NULL, trim/max 60          -- patron stock_article.emplacement
dimension          text NULL                        -- "205/55 R16", recopié de vehicule.pneusEte/Hiver
etat               text NULL                        -- observation libre ("usure 4mm")
entre_le           timestamptz NOT NULL default now()
dernier_mouvement_le  timestamptz NOT NULL default now()
motif_sortie       enum motif_sortie_depot_pneus NULL  -- requis si statut = sorti
ligne_or_dernier_changement_id  uuid NULL → ligne_or(tenant_id, id)  -- traçabilité RPP-03
cree_le / modifie_le

UNIQUE partiel (tenant_id, vehicule_id, saison) WHERE statut IN ('en_depot', 'monte')  -- RPP-02
CHECK (statut = 'sorti') = (motif_sortie IS NOT NULL)
INDEX (tenant_id, site_id, statut)                              -- vue hangar par site
INDEX (tenant_id, dernier_mouvement_le) WHERE statut = 'en_depot'  -- job de relance RPP-04
```

Suit les conventions du dépôt : UUID, `timestamptz`, `tenant_id NOT NULL` + RLS, enum Postgres
extensible, CHECK de cohérence, index de pagination/filtrage. Aucun JSONB — rien ici n'est
réellement variable par marque ou tenant. Entité auditée (même mécanisme `audit_atelier` que
`vehicule_travail_reporte`/`vehicule_stock`) : un jeu de pneus engage la responsabilité du garage,
tout changement de statut doit être reconstituable.

**4.4 Ce qui n'est PAS créé**

- Pas de table `zone_hangar` séparée : le hangar est un `site` (un garage à plusieurs hangars
  physiques le note dans `code_case`, ex. « Hangar B / rack 3 »). Pas de sur-modélisation tant que
  le besoin exprimé reste « retrouver un jeu », pas « dessiner le hangar ».
- Pas de lien direct `depot_pneus.client_id` (RPP-01) : le client se lit via `vehicule`.

---

5. Endpoints et droits

---

Module `pneus` (ou sous-module `atelier`), prioritaire :

```
GET    /sites/{siteId}/hangar-pneus       -- vue hangar : jeux en dépôt, filtrable par statut/saison
GET    /vehicules/{id}/depots-pneus       -- historique des jeux d'un véhicule
POST   /vehicules/{id}/depots-pneus       -- entrer un jeu en dépôt
POST   /depots-pneus/{id}/changer-saison  -- inverse monté/en dépôt, option ligne_or_id
POST   /depots-pneus/{id}/sortir          -- statut sorti + motif obligatoire
GET    /depots-pneus/a-relancer           -- liste des jeux oubliés (site ou tenant)
```

Droits : `pneus.depot.lire`, `pneus.depot.creer`, `pneus.depot.gerer` (changement saison, sortie).

Module `parc`, conditionnel (Lot D) :

```
GET    /sites/{siteId}/plan-parc          -- grille complète : cases + véhicules positionnés
POST   /sites/{siteId}/emplacements-parc  -- créer une case
PATCH  /emplacements-parc/{id}            -- déplacer/renommer une case, désactiver
PATCH  /vehicules/{id}/position           -- poser/déplacer un véhicule (case structurée ou texte libre)
```

Droits : `parc.plan.lire`, `parc.plan.configurer`, `vehicules.position.modifier` (ce dernier
plausiblement déjà couvert par un droit véhicule existant à vérifier en conception API — ne pas
dupliquer un droit qui existe déjà).

---

6. Les écrans, en deux phrases chacun

---

**Hangar à pneus** : une grille de cases fixes de rack (disposition physique stable, pas de
glisser-déposer libre), avec un code couleur été/hiver et un badge sur les jeux à relancer ;
cliquer une case ouvre la fiche du jeu (véhicule, client, dimension, dernier mouvement) et propose
l'action évidente du moment (« changer de saison », « sortir »). Recherche par plaque ou nom
client en un champ, qui surligne directement la case sur le plan plutôt que d'afficher une ligne
de tableau — c'est le point qui justifie un plan visuel plutôt qu'un tableau filtrable classique.

**Plan du parc** : une grille de cases dessinées une fois par le garage (glisser-déposer à la
création, comme un plan de salle de restaurant) ; au quotidien, le garagiste voit chaque case avec
une vignette véhicule (plaque + marque/modèle) et fait glisser un véhicule d'une case à l'autre en
un geste — jamais un formulaire. Aucune saisie n'est obligatoire pour qu'un OR avance : un
véhicule sans position s'affiche dans une liste « non placés » à côté de la grille.

Le point dur commun : la saisie/modification du plan lui-même ne doit pas être un projet. La
création de cases est un formulaire répétable trivial (code + type + position en glissant sur une
grille libre, pas de coordonnées à taper à la main) — un garagiste doit pouvoir configurer son plan
seul, un après-midi, sans ticket support ni intervention de @laupernoe.

---

7. Avis critique

---

Les deux fonctionnalités viennent bien de la concurrence (Nextlane a un « plan parking » visuel ;
plusieurs DMS pneus suisses vendent le hangar comme argument commercial), et elles n'ont pas la
même valeur.

**Le hangar à pneus a une valeur métier réelle et immédiate.** Problème vécu deux fois par an par
littéralement chaque garage suisse avec de la clientèle particuliers, avec un vrai risque (jeu
égaré = client mécontent + coût de remplacement à charge du garage), et l'alternative actuelle est
un classeur/Excel ou une mémoire humaine qui part avec l'employé qui quitte. Ça justifie son coût
de développement — table simple, machine à états à quatre statuts, écran de recherche rapide.
Accord avec l'intuition de @laupernoe.

**Le plan du parc est plus faible que ça n'en a l'air.** Le problème qu'il prétend résoudre
(« où est la voiture ») a déjà une réponse à 80 % gratuite : la recherche véhicule par plaque
existe (`recherche/`), et `emplacement_libre` en texte donne l'essentiel — un garagiste qui tape
« BMW X3 Dupont » retrouve le dossier et lit « devant le pont 2 » en une ligne, sans qu'il faille
dessiner une grille cliquable. La version visuelle apporte un vrai confort (reconnaissance
instantanée plutôt que lecture), mais c'est un gain d'ergonomie, pas un gain fonctionnel —
contrairement au hangar, où l'absence de traçabilité est un vrai risque métier, pas un inconfort.

**Version simplifiée qui capture 80% de la valeur pour 20% du travail** : ne pas construire la
grille visuelle pour le parc dans un premier temps. Juste `vehicule.emplacement_libre` (texte
libre, patron `stock_article.emplacement`) + un filtre "trier par emplacement" dans l'écran
véhicules existant. Zéro nouvelle table, zéro nouvel écran, un champ et une colonne triable. Si,
après usage réel chez un premier garage, la demande d'un vrai plan visuel persiste (plusieurs
dizaines de véhicules simultanés, plusieurs employés qui cherchent en même temps), construire la
grille visuelle en Lot 3 seulement.

**Recommandation d'ordre** :

1. `depot_pneus` (hangar) — valeur métier prouvée, complexité contenue.
2. `vehicule.emplacement_libre` seul (version simplifiée du parc) — quasi gratuit, livré avec le
   même lot que le hangar si un agent a de la marge.
3. Plan visuel complet du parc (`emplacement_parc` + écran grille) — seulement si la version
   simplifiée ne suffit pas en usage réel chez un premier garage.

---

8. Découpage en lots implémentables

---

**Lot A — Hangar à pneus, schéma + API** (`expert-database` puis `expert-nestjs`, périmètre
`apps/api/src/db/schema/pneus/` ou sous-module atelier + `apps/api/src/pneus/`)

- Migration `depot_pneus` + enums (`saison_pneu`, `statut_depot_pneus`, `motif_sortie_depot_pneus`)
- Audit trail (`audit_atelier` ou équivalent)
- Endpoints CRUD + `changer-saison` + `sortir` + `a-relancer`
- Job planifié (relance automatique après délai) — coordonner avec l'existant BullMQ

**Lot B — Hangar à pneus, écran** (`expert-ui` puis `expert-react`, périmètre
`apps/web/src/ecrans/pneus/` ou `atelier/`)

- Grille de cases fixes, recherche par plaque/client, badge relance
- Dépend du contrat OpenAPI du Lot A (bloquant pour le code ; la maquette peut être conçue en
  parallèle par `expert-ui`)

**Lot C — Parc simplifié** (`expert-database` + `expert-nestjs`, périmètre
`apps/api/src/db/schema/atelier/vehicule.ts` + endpoint véhicule existant)

- Colonnes `emplacement_libre` + `emplacement_maj_le` sur `vehicule`
- Filtre/tri par emplacement dans l'endpoint liste véhicules existant
- Léger : peut être fait par le même agent que le Lot A en fin de mission, ou en parallèle strict
  (aucun chevauchement de fichiers avec le Lot A)

**Lot D — Plan visuel du parc (conditionnel)** — reporté tant que le Lot C n'a pas montré ses
limites en usage réel. S'il est lancé : `emplacement_parc` (schéma + API, périmètre analogue au
Lot A) puis écran grille glisser-déposer (périmètre analogue au Lot B).

Ordre recommandé : **A puis B**, **C en parallèle de A/B** (aucun fichier partagé), **D différé**.
