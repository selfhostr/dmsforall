# Audit simplicité et performance — backend API

Périmètre : `apps/api/src/`. Lecture seule, aucune modification apportée au dépôt.
Base : PostgreSQL 16 + Drizzle, multi-tenant avec RLS.

Méthode : recherche systématique (grep + analyse de code, pas d'exécution `EXPLAIN` réelle — pas
d'accès à une base vivante depuis cet audit) sur les sept axes demandés, avec vérification manuelle
de chaque candidat avant de le retenir. Beaucoup de candidats initiaux se sont révélés être des
faux positifs une fois le code environnant lu (le dépôt est déjà très soigné sur RLS et pagination
— voir la section « Vérifié, rien trouvé » en fin de document, qui compte autant que les
trouvailles).

---

## 1. [CORRECTION — priorité haute] `journal()` d'un OR : transaction imbriquée + N+1 sur l'audit trail

**Fichier** : `apps/api/src/atelier/service-or.ts:488-518` (méthode `journal()`)
**Fichier lié** : `apps/api/src/common/audit/service-audit.ts:55-71` (`ServiceAuditImpl.pourEntite`)

`journal()` ouvre sa propre transaction (`this.acces.enTenant(ctx, async (tx) => {...})`), charge
les lignes et devis de l'OR, puis construit la liste des entités à auditer (l'OR + chaque ligne +
chaque devis) et boucle dessus :

```ts
for (const { entite, id } of entites) {
  // eslint-disable-next-line no-await-in-loop -- sérialisation délibérée, voir doc ci-dessus.
  const lot = await this.audit.pourEntite(ctx, entite, id);
  ...
}
```

`pourEntite` (`common/audit/service-audit.ts:60`) ouvre **sa propre transaction** via
`this.acces.enTenant(ctx, ...)` — une connexion neuve, son propre `BEGIN`/`COMMIT` — exactement le
piège documenté dans CONTRIBUTING.md pour `AccesBase.enTenant`. Deux problèmes cumulés :

- **N+1** : pour un OR avec, disons, 15 lignes + 3 devis, `journal()` déclenche 19 allers-retours
  séquentiels vers le pool de connexions au lieu d'une requête batchée (`entite_id = any(...)`).
  Avec « 50 OR/jour » et un OR moyen à quelques lignes, chaque appel à l'écran journal d'un OR migre
  ce qui devrait être 1 requête en N+1.
- **Non-atomicité documentée dans le dépôt lui-même** : `atelier/service-or.ts:696-699` (dans
  `obtenirComplet`, un autre appelant de `pourEntite`) porte ce commentaire explicite :

  > « pas de transaction imbriquée ici, à la différence de `ServiceAudit.pourEntite` juste au-dessus
  > (hors périmètre de ce correctif, voir `journal()`) »

  C'est une dette technique déjà identifiée par l'équipe, jamais soldée. Le même problème a été
  **corrigé ailleurs** (`ventes/service-dossier-vente.ts:916-925`, `assembler(..., pourListe=true)`
  saute complètement l'appel d'audit en liste, commentaire : « évite d'ouvrir jusqu'à `limite`
  transactions d'audit imbriquées en parallèle sur une seule page, ce qui épuisait le pool `pg`
  (`max 10` par défaut) » — un incident réel, pas hypothétique). `journal()` reste le seul endroit
  qui n'a pas reçu ce correctif, et ne peut pas simplement « sauter » l'audit comme les vues liste
  l'ont fait : c'est justement la vue qui EST l'audit.

- Conséquence correction (mineure mais réelle) : chaque `pourEntite` imbriqué tourne sur une
  connexion et donc un instantané (snapshot) différent de la transaction principale qui vient de
  charger `lignes`/`devisRows`. Sous écriture concurrente, le journal peut techniquement diverger de
  l'état des lignes/devis vus au même instant par le reste de `journal()`.

**Gain attendu** : ajouter une méthode batchée à `ServiceAudit` (ex. `pourEntitesTx(tx, ctx,
paires: readonly {entite, id}[])`) qui exécute une seule requête `where (entite, entite_id) = any
(...)` (ou une requête par nature d'entité, donc au plus 3 requêtes — OR/ligne_or/devis —, pas 19)
et prend le `tx` déjà ouvert de `journal()` en paramètre. Passe de N+1 connexions séquentielles à 1
(voire 3), et rétablit l'atomicité vis-à-vis du reste de `journal()`.

---

## 2. [PERFORMANCE — déjà identifié, à finaliser] Index trigram manquants : `article`, `fournisseur`, `depot_pneus`

**Fichier** : `apps/api/src/recherche/service-recherche.ts:687-697` (article), `:779-782`
(fournisseur), `:855-860` (depot_pneus)

Confirmé : la recherche globale (`GET /recherche`) interroge ces trois natures via
`normaliser_recherche(...)  like normaliser_recherche(${motif})`, mais **aucun index GIN trigram**
n'existe sur les colonnes concernées — seuls des btree classiques (`article_designation_idx`,
`article_reference_principale_idx`, `fournisseur_nom_idx`, migration `0022`) sont posés, et ces
btree ne peuvent structurellement pas servir un `LIKE '%fragment%'`. `depot_pneus.code_case` n'a
même pas de btree. Le code source documente déjà les trois `CREATE INDEX` à poser — je les ai
vérifiés contre les migrations existantes (`0006`, `0007`, `0013`, `0020`, `0022`) : la forme est
cohérente avec la famille d'index déjà en place (GIN, `tenant_id` en tête, `gin_trgm_ops`).

**Requêtes concernées** : `chercherArticles` (`recherche/service-recherche.ts:703-745`),
`chercherFournisseurs` (`:787-809`), `chercherDepotsPneus` (`:867-959`).

**Index proposés (à poser dans une NOUVELLE migration, ex. `0049_recherche_trgm_pieces_pneus.sql`)** :

```sql
create index article_recherche_designation_trgm_idx on public.article
  using gin (tenant_id, public.normaliser_recherche(designation) gin_trgm_ops);

create index article_recherche_reference_trgm_idx on public.article
  using gin (tenant_id, public.normaliser_recherche(reference_principale) gin_trgm_ops);

create index fournisseur_recherche_trgm_idx on public.fournisseur
  using gin (tenant_id, public.normaliser_recherche(nom) gin_trgm_ops);

create index depot_pneus_recherche_code_case_trgm_idx on public.depot_pneus
  using gin (tenant_id, public.normaliser_recherche(code_case) gin_trgm_ops);
```

**Gain attendu** : même ordre de grandeur que la mesure déjà faite sur `document_vente`
(migration `0020`) : Bitmap Heap Scan → Bitmap Index Scan, ~230 ms → ~2 ms au volume mesuré
(91k lignes/tenant). Aujourd'hui ces trois natures dégradent silencieusement le temps de réponse de
`GET /recherche` dès qu'un tenant a un catalogue pièces ou un hangar pneus significatif — sans
erreur, juste lent, exactement le profil que 200 tenants × 5 ans rendra visible en premier sur ces
tables (le catalogue pièces grossit vite, contrairement aux clients/véhicules).

---

## 3. [PERFORMANCE] Tableau de bord financier : 4 sous-requêtes redondantes sans index dédié

**Fichier** : `apps/api/src/tableau-bord/service-tableau-bord-financier.ts:58-83`

`obtenir()` construit un filtre commun (`filtreDocumentsPeriode` : `type_document in ('facture',
'avoir')`, `statut <> 'brouillon'`, `date_document` sur la période) et l'utilise dans **quatre**
sous-requêtes scalaires indépendantes sur `document_vente` (`sum(total_ht_centimes)`,
`sum(total_tva_centimes)`, `sum(total_ttc_centimes)`, `count(*)`) — PostgreSQL planifie et exécute
chacune séparément : quatre scans du même sous-ensemble de lignes au lieu d'un seul passage.

Aucun index ne couvre `(tenant_id, type_document, date_document)` — les index existants sur
`document_vente` (migration `0010`) sont `(tenant_id, client_id, date_document desc)`,
`(tenant_id, ordre_reparation_id)`, `(tenant_id, cree_le desc, id desc)`, etc. : aucun n'a
`type_document` en tête. Chaque appel du tableau de bord financier (rôle `direction`/`comptable`,
consulté souvent) force donc un Bitmap Heap Scan sur `tenant_id` puis un filtre résiduel sur
`type_document`/`statut`/`date_document`, sur une table qui grossit ~50 documents/jour/tenant.

**Gain attendu** :

1. Fusionner les quatre sommes en une seule sous-requête (`select sum(...) as ht, sum(...) as tva,
sum(...) as ttc, count(*) as n from document_vente where ...`) : 4 scans → 1.
2. Ajouter un index dédié :

```sql
create index document_vente_periode_type_idx on public.document_vente
  (tenant_id, type_document, date_document)
  where statut <> 'brouillon';
```

Ce même index sert aussi partiellement `encoursClientsCentimes` (`type_document = 'facture' and
statut = 'emis'`, sans borne de date) grâce au préfixe `(tenant_id, type_document)`.

---

## 4. [CORRECTION — priorité basse à moyenne] Rehachage Argon2id : `UPDATE` scopé au seul RLS

**Fichier** : `apps/api/src/auth/services/authentification.service.ts:416-441`
(`rehacherEnArrierePlan`)

```ts
this.accesBase.enTenant(
  { tenantId, utilisateurId, ... },
  async (tx) => {
    await tx
      .update(utilisateur)
      .set({ motDePasseHash: nouveauHash })
      .where(eq(utilisateur.id, utilisateurId));   // <- pas de tenantId ici
  },
)
```

C'est le **seul** `.update(...).where(...)` de tout `apps/api/src/` (hors seed/dev) dont la clause
`where` ne mentionne pas `tenantId` alors que la table est multi-tenant (vérifié
systématiquement : tous les autres `.update()`/`.delete()` du dépôt scopent explicitement, voir la
section « Vérifié » ci-dessous). Ici, l'isolation repose entièrement sur le GUC RLS posé par
`enTenant()` — exactement la situation que la doctrine du projet interdit (« le RLS est le filet,
jamais le mécanisme »).

Risque pratique aujourd'hui limité : `utilisateurId` provient du flux de login qui vient de
authentifier ce même utilisateur dans ce même tenant, pas d'une entrée externe non validée. Mais
c'est un `UPDATE` en tâche de fond (`.then().catch()`, non attendu par l'appelant), donc une future
régression sur la provenance de `utilisateurId`/`tenantId` ne serait détectée par aucun test
d'isolation tenant existant (ces tests ciblent typiquement les endpoints, pas les effets de bord
asynchrones du login).

**Correctif proposé** (une ligne) :

```ts
.where(and(eq(utilisateur.tenantId, tenantId), eq(utilisateur.id, utilisateurId)))
```

---

## 5. [PERFORMANCE — mineur] Résumés utilisateur chargés ligne par ligne au lieu d'un batch

**Fichiers** :

- `apps/api/src/atelier/service-or.ts:392-405` (`listerDemandes`)
- `apps/api/src/atelier/service-or.ts:700-714` (`obtenirComplet` — demandes ET devis)
- `apps/api/src/atelier/service-devis.ts:84-106` (`lister`)

Chacune de ces méthodes fait `lignes.map(async (l) => mapperX(l, await
chargerResumeUtilisateur(tx, ctx, l.xId)))` — un `SELECT` par ligne pour résoudre le nom affiché de
l'utilisateur (saisie de demande, émetteur de devis), plus `listerLignesDevis` par devis dans le cas
`service-devis.ts`. `chargerResumeUtilisateur` (`atelier/references.ts:361-374`) prend `tx` en
paramètre direct (pas de transaction imbriquée — donc pas le défaut de correction du point 1), mais
reste un aller-retour SQL par ligne au lieu d'un seul `where id = any(...)`.

Impact réel modéré : ces listes sont bornées (demandes/devis par OR, pas 200 lignes comme les
lignes d'OR), donc pas un incident de pool comme le point 1 — mais c'est le même patron répété trois
fois, et un OR avec beaucoup de devis complémentaires (négociation longue avec l'assurance, cas
réel en carrosserie) le rend visible. Fusion possible : collecter les `xId` du lot puis un seul
`select id, prenom, nom from utilisateur where tenant_id = ... and id = any(${ids})`, tel
`enrichirVehicules` le fait déjà dans `recherche/service-recherche.ts:280-332` (jointure `LATERAL`
en un seul aller-retour, avec le commentaire explicite « plutôt que N+1 requêtes par véhicule » —
le patron correct existe déjà ailleurs dans le même dépôt, juste pas repris ici).

---

## Vérifié, rien trouvé (résultat valable en soi)

- **Duplication de logique de réservation atelier/pièces (le cas cité par CONTRIBUTING.md)** :
  vérifié — n'existe plus sous cette forme. `atelier/service-ligne-or.ts` insère directement dans
  `reservation_piece` à la création d'une ligne (`reserverPieceSiApplicable`, ligne 872), mais c'est
  le SEUL point d'écriture de création de réservation dans tout le dépôt (`grep
"insert(reservationPiece)"` : une seule occurrence). Les opérations de cycle de vie
  (`satisfaire`/`libérer`) vivent exclusivement dans `pieces/service-reservation.ts`, exposées en
  variantes `*Tx` (`satisfaireTx`, `libererTx`, `libererPourLigneTx`, `satisfairePourLigneTx`,
  `libererToutesActivesPourOrTx`) prenant un `tx` déjà ouvert — patron documenté explicitement comme
  le correctif du piège `AccesBase.enTenant` (`pieces/service-reservation.ts:118-124`,
  `atelier/atelier.module.ts:67`, « dette technique soldée »). Pas de règle métier dupliquée à deux
  endroits.

- **`AccesBase.enTenant` imbriqué** : recherche systématique (script de comptage de portée
  d'accolades sur toutes les fonctions à paramètre `tx: TransactionDfa`, puis sur tous les appels
  `.enTenant(ctx, async (tx) => {...})` suivis d'un appel `.methode(ctx` à l'intérieur du bloc) sur
  l'ensemble de `apps/api/src/` : un seul site trouvé, celui du point 1
  (`atelier/service-or.ts:514`, `ServiceAudit.pourEntite` — déjà signalé, déjà connu de l'équipe qui
  l'a documenté ailleurs dans le même fichier). Tout le reste du dépôt respecte le patron `*Tx`.

- **Pagination par curseur temporel (`timestamptz` → `::text` →
  `valeurCurseurTimestamptz`)** : vérifié module par module (`pieces/`, `pneus/`, `ventes/`,
  `clients/`, `vehicules/`, `socle/`, `parametrage/`, `pointage/`, `facturation/paiements/`,
  `exploitation/`) — chaque tri sur colonne `timestamptz` passe par le marqueur `temporel: true` +
  `expressionTriValeur()` (`::text` en sortie de `SELECT`) + `valeurCurseurTimestamptz()` côté
  encodage. Deux cas a priori suspects (`valeur: derniere.triValeur` sans passer par
  `valeurCurseurDepuisTri` dans `clients/service-client-vehicules.ts:126` et
  `ventes/service-suivi-vente.ts:267`) se sont révélés corrects après lecture : le premier ne trie
  que sur `plaque` (texte), le second sur une expression déjà castée `(...)::text` dérivée d'une
  colonne `date` (pas `timestamptz`), documentée comme telle en tête de fonction. `vehicules/
service-vehicule.ts::valeurDeTri` — la fonction explicitement citée comme origine historique du
  bug dans `common/pagination/valeur-temporelle.ts` — est bien corrigée (`ligne 515` :
  `valeurCurseurTimestamptz(ligne.creeLe)`). Aucune violation trouvée. `atelier/` et
  `facturation/documents/` n'utilisent pas de curseur temporel du tout (pagination par décalage
  `decoderCurseurOffset`/`encoderCurseurOffset`, sur des listes bornées — mécanisme différent, hors
  du champ de ce piège précis).

- **Scope tenant explicite** : recherche systématique de tout `.update(...)`/`.delete(...)` dont la
  clause `where` ne mentionne pas `tenantId`/`tenant_id` : un seul résultat retenu après vérification
  manuelle (point 4 ci-dessus). Un second candidat (`clients/service-client-sous-collections.ts:294`)
  s'est révélé un faux positif : la condition est construite dans une variable nommée
  `conditionAdresse` qui inclut bien `eq(clientAdresse.tenantId, ctx.tenantId)`, simplement définie
  quelques lignes avant l'appel.

---

## Cinq actions au meilleur rapport gain/effort

1. **Batcher `ServiceAudit.pourEntite` pour `journal()`** (point 1) — effort faible (une méthode
   `pourEntitesTx` + un appel groupé à la place de la boucle), gain net sur latence ET correction
   d'un défaut d'atomicité déjà documenté par l'équipe elle-même. À faire en premier : c'est le seul
   défaut de CORRECTION de cet audit.
2. **Poser les 4 index trigram manquants** (point 2) — effort minimal (une migration, forme déjà
   écrite et documentée dans le code source lui-même), gain immédiat et mesurable sur `GET
/recherche` pour tout tenant avec un catalogue pièces ou un hangar pneus non trivial.
3. **Corriger le `.where()` du rehachage Argon2id** (point 4) — une ligne, ferme un écart de
   doctrine avant qu'une évolution future du flux de login ne le rende exploitable.
4. **Fusionner les 4 sous-requêtes du tableau de bord financier + poser l'index dédié**
   (point 3) — effort faible, gain direct sur un écran consulté régulièrement par la direction.
5. **Batcher `chargerResumeUtilisateur` dans les 3 endroits identifiés** (point 5) — effort faible,
   gain modeste mais le patron correct (jointure `LATERAL` unique) existe déjà ailleurs dans le
   dépôt (`recherche/service-recherche.ts`), il suffit de le reprendre.

Aucun défaut de corruption de données ni de fuite inter-tenant n'a été trouvé. Le point le plus
grave (finding 1) est un défaut de correction à faible probabilité d'impact réel (lecture seule,
fenêtre de divergence étroite) plutôt qu'un risque de données fausses en base — mais il correspond
exactement au piège que CONTRIBUTING.md documente, et l'équipe l'a déjà repéré sans le corriger.
