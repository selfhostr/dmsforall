-- =============================================================================================
-- 0067_reprise_donnees.sql — reprise de données par dépôt d'archive (contrat gelé
-- packages/shared/src/contrats/reprise.ts). Périmètre : apps/api/src/reprise/ (hors lecteurs/,
-- écrit en parallèle par un autre agent).
--
-- NUMÉROTATION : 0066 est la dernière migration existante ; 0067 réservée pour ce chantier,
-- d'autres agents travaillent en parallèle ailleurs dans le dépôt (contrat reprise.ts, lecteurs/,
-- écrans web) sans toucher aux migrations.
--
-- CORRECTIF (rejoué sur base réelle, échec initial) : `reprise_plan.analyse_id`,
-- `reprise_import.plan_id` et `reprise_rapport.import_id` référencent leur table cible sur
-- `(tenant_id, id)` — PostgreSQL exige qu'une cible de FK soit couverte par une contrainte
-- UNIQUE (ou PK) EXACTEMENT sur ce couple de colonnes ; `reprise_analyse`/`reprise_plan`/
-- `reprise_import` ne portaient qu'une PK sur `id` seul et un `unique (tenant_id,
-- dossier_reprise_id)` pour le singleton par dossier — aucun des deux ne couvre `(tenant_id,
-- id)`. `dfa_migrator there is no unique constraint matching given keys for referenced table
-- "reprise_analyse"` à l'exécution réelle de `pnpm db:migrate`. Chaque table ciblée par une FK
-- porte donc maintenant SON PROPRE `<table>_tenant_id_uk unique (tenant_id, id)`, même patron
-- que `dossier_reprise_tenant_id_uk` (déjà correct dès la première version) et que le reste du
-- dépôt (`client_tenant_id_uk`, `facture_fournisseur_tenant_id_uk`, etc.) — DEUX contraintes
-- UNIQUE distinctes par table singleton, pas une seule : `(tenant_id, id)` pour être une cible
-- de FK valide, `(tenant_id, dossier_reprise_id)` pour l'invariant « un seul par dossier ».
-- Posée aussi sur `reprise_rapport`, non ciblée par une FK aujourd'hui mais par cohérence avec
-- les cinq autres tables de ce fichier.
--
-- SIX TABLES, UNE PAR PHASE (+ le dossier racine) :
--   1. `dossier_reprise`  — ressource racine, machine à états (STATUTS_DOSSIER_REPRISE, gelée
--      côté contrat), porte l'archive DÉCLARÉE (taille/empreinte annoncées) et son intégrité.
--   2. `reprise_tranche`  — métadonnées d'UNE tranche binaire déposée. Le contenu binaire lui-même
--      NE VA JAMAIS EN BASE (disque, voir `depot/stockage-archive-reprise.ts`) — cette table ne
--      porte que `chemin_stockage`, opaque, et sert à la reprise après interruption (numéro
--      contigu) et à l'idempotence par numéro (upsert `on conflict`).
--   3. `reprise_analyse`  — résultat COURANT de l'analyse asynchrone, singleton par dossier
--      (`unique (tenant_id, dossier_reprise_id)`). `moteur_detecte`/`fichiers`/`tables`/
--      `anomalies` en JSONB : c'est très exactement l'attribut « vraiment variable » que CONTRIBUTING.md
--      réserve au JSONB — un inventaire de tables détectées à la structure ouverte, jamais requêté
--      par colonne individuelle côté application (toujours relu en bloc pour `GET .../analyse`).
--      Une relance (`POST .../analyses`) SUPPRIME puis RÉINSÈRE la ligne (nouvel `id`) — le
--      contrat documente explicitement qu'un plan appartient à UNE analyse précise
--      (`TableDetecteeReprise.id` régénéré à chaque relance).
--   4. `reprise_plan`     — plan proposé, singleton par dossier. `elements`/`exclusions` en JSONB
--      (même raisonnement que 3.) ; `elements` est MUTÉ EN PLACE par `PATCH .../plan`
--      (`ajustements[].inclus`), jamais recréé — c'est pourquoi le champ n'est PAS un historique
--      mais l'état courant.
--   5. `reprise_import`   — avancement d'IMPORT, singleton par dossier, MÊME ligne conservée d'une
--      tentative à l'autre (`tentative` incrémenté par `POST .../import/rejouer`, jamais une
--      nouvelle ligne) — c'est ce qui rend `GET .../import` stable pendant un rejeu.
--   6. `reprise_rapport`  — rapport de réconciliation, singleton par dossier. `insere`/`ecarte`/
--      `anomalies`/`reconciliation` en JSONB : accumulés PAR LE WORKER D'IMPORT au fil de
--      l'écriture (jamais recalculés par agrégation sur les tables cibles au moment du GET — un
--      tenant peut avoir plusieurs dossiers de reprise dans le temps, `document_vente.origine`/
--      `numero_origine` ne portent aucune référence vers UN dossier précis, donc seul le worker
--      qui vient d'écrire une ligne sait à quel dossier/année/domaine l'imputer).
--
-- ÉTATS EN COLONNE, JAMAIS EN JSONB (doctrine CONTRIBUTING.md) : chaque `statut_*` est un enum Postgres
-- dédié, sous contrôle applicatif (`ServiceCycleVieDossierReprise`) — PAS de table
-- `transition_autorisee` dédiée ni de trigger SQLSTATE ZDFA1 comme `resiliation_tenant` (0062) :
-- la machine à états de la reprise est entièrement gelée côté contrat partagé
-- (`STATUTS_DOSSIER_REPRISE`, commentaire de tête) et testée unitairement côté service — un
-- dispositif SQL dédié n'apporterait rien qu'un test rouge ne couvre déjà, pour un coût de
-- migration disproportionné sur un chantier déjà large.
--
-- TAILLES EN `bigint`, JAMAIS `integer` : `TAILLE_MAX_ARCHIVE_REPRISE_OCTETS` (60 Go,
-- `contrats/reprise.ts`) dépasse largement le plafond `int4` (~2,1 Go) — `taille_octets_annoncee`,
-- `reprise_tranche.taille_octets`, `reprise_import.elements_traites/elements_total` (jusqu'à 9,4
-- millions de lignes mesurées sur un seul référentiel réel) sont donc tous `bigint`.
--
-- PURGE (RGPD/nLPD) : `reprise_tranche` est la SEULE table de cette migration où `dfa_app` obtient
-- DELETE — marqueur `[dfa:suppression-physique]` posé sur son commentaire, condition vérifiée par
-- `AccesBase.verifierPostureRls()` (0002). Les tranches sont des données personnelles de clients
-- réels d'un garage tiers : `dossier_reprise.purgee_le` + `ServicePurgeArchiveReprise` (code
-- applicatif) suppriment le contenu disque ET les lignes `reprise_tranche` après import terminé
-- (ou dossier annulé), sans attendre une résiliation de tenant. Les AUTRES tables (analyse/plan/
-- import/rapport) ne portent aucun octet brut de l'archive (JSONB structuré, dérivé) : elles
-- restent pour l'historique/audit, jamais purgées par ce mécanisme.
--
-- Réversible : migrations/down/0067_reprise_donnees.down.sql — up → down → up rejoué par la CI.
-- =============================================================================================


-- ---------------------------------------------------------------------------------------------
-- 1. Énumérations.
-- ---------------------------------------------------------------------------------------------

create type public.statut_dossier_reprise as enum (
  'depot_en_cours',
  'depot_receptionne',
  'analyse_en_cours',
  'analyse_echouee',
  'analyse_terminee',
  'plan_propose',
  'plan_valide',
  'import_en_cours',
  'import_termine',
  'import_echoue',
  'annule'
);

create type public.statut_analyse_reprise as enum (
  'en_cours',
  'terminee',
  'echouee'
);

create type public.statut_plan_reprise as enum (
  'propose',
  'valide'
);

create type public.statut_import_reprise as enum (
  'en_attente',
  'en_cours',
  'termine',
  'echoue',
  'annule'
);

create type public.domaine_reprise as enum (
  'clients',
  'vehicules',
  'ordres_reparation',
  'documents_vente',
  'paiements',
  'articles_stock',
  'fournisseurs',
  'documents_scannes'
);


-- ---------------------------------------------------------------------------------------------
-- 2. `dossier_reprise` — ressource racine.
-- ---------------------------------------------------------------------------------------------

create table public.dossier_reprise (
  id                                      uuid        not null default gen_random_uuid(),
  tenant_id                               uuid        not null,
  statut                                  public.statut_dossier_reprise not null default 'depot_en_cours',

  taille_octets_annoncee                  bigint      not null,
  empreinte_sha256_annoncee               bytea       not null,
  empreinte_sha256_verifiee               bytea       null,
  integrite_validee                       boolean     null,
  dernier_numero_tranche_recu_contigu     integer     null,
  nom_archive_original                    text        null,

  -- Chemin RELATIF, opaque, racine du répertoire de dépôt de ce dossier sur le stockage
  -- disque/objet (voir `depot/stockage-archive-reprise.ts`) — jamais un chemin absolu du serveur.
  stockage_chemin                         text        not null,
  purgee_le                               timestamptz null,

  annule_le                               timestamptz null,
  annule_motif                            text        null,

  cree_par_id                             uuid        not null,
  cree_le                                 timestamptz not null default now(),
  modifie_le                              timestamptz not null default now(),

  constraint dossier_reprise_pk primary key (id),
  constraint dossier_reprise_tenant_id_uk unique (tenant_id, id),

  constraint dossier_reprise_fk_tenant
    foreign key (tenant_id) references public.tenant (id) on delete restrict,
  constraint dossier_reprise_fk_cree_par
    foreign key (tenant_id, cree_par_id)
    references public.utilisateur (tenant_id, id) on delete restrict,

  constraint dossier_reprise_taille_chk
    check (taille_octets_annoncee > 0 and taille_octets_annoncee <= 60000000000),
  constraint dossier_reprise_empreinte_annoncee_longueur_chk
    check (octet_length(empreinte_sha256_annoncee) = 32),
  constraint dossier_reprise_empreinte_verifiee_longueur_chk
    check (empreinte_sha256_verifiee is null or octet_length(empreinte_sha256_verifiee) = 32),
  constraint dossier_reprise_integrite_coherente_chk
    check (integrite_validee is null or empreinte_sha256_verifiee is not null),
  constraint dossier_reprise_numero_tranche_contigu_chk
    check (dernier_numero_tranche_recu_contigu is null or dernier_numero_tranche_recu_contigu >= 0),
  constraint dossier_reprise_annulation_coherente_chk
    check ((statut = 'annule') = (annule_le is not null))
);

comment on table public.dossier_reprise is
  'Ressource racine de la reprise de données par dépôt d''archive (contrats/reprise.ts). Machine '
  'à états GELÉE côté contrat (STATUTS_DOSSIER_REPRISE), appliquée par '
  'ServiceCycleVieDossierReprise, pas par un trigger SQL dédié.';

create index dossier_reprise_pagination_idx
  on public.dossier_reprise (tenant_id, cree_le desc, id desc);
create index dossier_reprise_statut_idx on public.dossier_reprise (tenant_id, statut);

revoke all                     on public.dossier_reprise from dfa_app;
grant  select, insert, update  on public.dossier_reprise to   dfa_app;

alter table public.dossier_reprise enable row level security;
alter table public.dossier_reprise force  row level security;

create policy dossier_reprise_isolation_tenant on public.dossier_reprise
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy dossier_reprise_migrator on public.dossier_reprise
  to dfa_migrator
  using (true) with check (true);

create trigger dossier_reprise_touche_modifie_le
  before update on public.dossier_reprise
  for each row execute function public.touche_modifie_le();


-- ---------------------------------------------------------------------------------------------
-- 3. `reprise_tranche` — métadonnées d'une tranche binaire déposée. PURGEABLE.
-- ---------------------------------------------------------------------------------------------

create table public.reprise_tranche (
  id                    uuid        not null default gen_random_uuid(),
  tenant_id             uuid        not null,
  dossier_reprise_id    uuid        not null,
  numero                integer     not null,
  taille_octets         bigint      not null,
  -- Chemin RELATIF, opaque, du fichier de tranche sur le stockage disque/objet — jamais rejoué
  -- tel quel côté HTTP (aucun endpoint ne le renvoie, contrairement à
  -- StockageExportTenantDisqueLocal.lire dont le chemin vient d'une requête).
  chemin_stockage       text        not null,
  recue_le              timestamptz not null default now(),

  constraint reprise_tranche_pk primary key (id),
  constraint reprise_tranche_tenant_dossier_numero_uk unique (tenant_id, dossier_reprise_id, numero),

  constraint reprise_tranche_fk_dossier
    foreign key (tenant_id, dossier_reprise_id)
    references public.dossier_reprise (tenant_id, id) on delete restrict,

  constraint reprise_tranche_numero_chk check (numero >= 0 and numero <= 500000),
  constraint reprise_tranche_taille_chk check (taille_octets > 0)
);

comment on table public.reprise_tranche is
  'Métadonnées des tranches binaires déposées (PUT .../tranches/{numero}, idempotent par numéro '
  '— upsert on conflict). Le contenu binaire vit sur disque, jamais en base. '
  '[dfa:suppression-physique] purgée (contenu disque + lignes) après import terminé ou dossier '
  'annulé par ServicePurgeArchiveReprise : données personnelles de clients d''un garage tiers, '
  'jamais conservées indéfiniment.';

create index reprise_tranche_dossier_idx
  on public.reprise_tranche (tenant_id, dossier_reprise_id, numero);

revoke all                             on public.reprise_tranche from dfa_app;
grant  select, insert, update, delete  on public.reprise_tranche to   dfa_app;

alter table public.reprise_tranche enable row level security;
alter table public.reprise_tranche force  row level security;

create policy reprise_tranche_isolation_tenant on public.reprise_tranche
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy reprise_tranche_migrator on public.reprise_tranche
  to dfa_migrator
  using (true) with check (true);


-- ---------------------------------------------------------------------------------------------
-- 4. `reprise_analyse` — résultat courant de l'analyse, singleton par dossier.
-- ---------------------------------------------------------------------------------------------

create table public.reprise_analyse (
  id                    uuid        not null default gen_random_uuid(),
  tenant_id             uuid        not null,
  dossier_reprise_id    uuid        not null,
  statut                public.statut_analyse_reprise not null default 'en_cours',
  partielle             boolean     not null default false,

  -- JSONB : détail d'analyse, structure ouverte (voir en-tête de fichier). Formes exactes
  -- MoteurSourceDetecte / FichierArchiveReprise[] / TableDetecteeReprise[] /
  -- AnomalieAnalyseReprise[] — contrats/reprise.ts, appliquées côté service, pas en base.
  moteur_detecte        jsonb       not null default '{}'::jsonb,
  fichiers              jsonb       not null default '[]'::jsonb,
  tables                jsonb       not null default '[]'::jsonb,
  anomalies             jsonb       not null default '[]'::jsonb,

  demarree_le           timestamptz null,
  terminee_le           timestamptz null,
  cree_le               timestamptz not null default now(),
  modifie_le            timestamptz not null default now(),

  constraint reprise_analyse_pk primary key (id),
  constraint reprise_analyse_tenant_id_uk unique (tenant_id, id),
  constraint reprise_analyse_tenant_dossier_uk unique (tenant_id, dossier_reprise_id),

  constraint reprise_analyse_fk_dossier
    foreign key (tenant_id, dossier_reprise_id)
    references public.dossier_reprise (tenant_id, id) on delete restrict
);

comment on table public.reprise_analyse is
  'Résultat COURANT de l''analyse asynchrone (contrats/reprise.ts::ReponseAnalyseReprise), '
  'singleton par dossier. Une relance (POST .../analyses) supprime puis réinsère la ligne : un '
  'plan appartient à UNE analyse précise, l''historique des tentatives n''a pas de valeur métier.';

create index reprise_analyse_dossier_idx on public.reprise_analyse (tenant_id, dossier_reprise_id);

revoke all              on public.reprise_analyse from dfa_app;
grant  select, insert, update on public.reprise_analyse to   dfa_app;

alter table public.reprise_analyse enable row level security;
alter table public.reprise_analyse force  row level security;

create policy reprise_analyse_isolation_tenant on public.reprise_analyse
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy reprise_analyse_migrator on public.reprise_analyse
  to dfa_migrator
  using (true) with check (true);

create trigger reprise_analyse_touche_modifie_le
  before update on public.reprise_analyse
  for each row execute function public.touche_modifie_le();


-- ---------------------------------------------------------------------------------------------
-- 5. `reprise_plan` — plan proposé, singleton par dossier.
-- ---------------------------------------------------------------------------------------------

create table public.reprise_plan (
  id                          uuid        not null default gen_random_uuid(),
  tenant_id                   uuid        not null,
  dossier_reprise_id          uuid        not null,
  analyse_id                  uuid        not null,
  statut                      public.statut_plan_reprise not null default 'propose',

  -- JSONB : ElementPlanReprise[] / ExclusionPlanReprise[]. `elements` est MUTÉ EN PLACE par
  -- PATCH .../plan (ajustements[].inclus) — état courant, jamais un historique.
  elements                    jsonb       not null default '[]'::jsonb,
  exclusions                  jsonb       not null default '[]'::jsonb,

  propose_le                  timestamptz not null default now(),
  valide_le                   timestamptz null,
  valide_par_utilisateur_id   uuid        null,
  cree_le                     timestamptz not null default now(),
  modifie_le                  timestamptz not null default now(),

  constraint reprise_plan_pk primary key (id),
  constraint reprise_plan_tenant_id_uk unique (tenant_id, id),
  constraint reprise_plan_tenant_dossier_uk unique (tenant_id, dossier_reprise_id),

  constraint reprise_plan_fk_dossier
    foreign key (tenant_id, dossier_reprise_id)
    references public.dossier_reprise (tenant_id, id) on delete restrict,
  constraint reprise_plan_fk_analyse
    foreign key (tenant_id, analyse_id)
    references public.reprise_analyse (tenant_id, id) on delete restrict,
  constraint reprise_plan_fk_valide_par
    foreign key (tenant_id, valide_par_utilisateur_id)
    references public.utilisateur (tenant_id, id) on delete restrict,

  constraint reprise_plan_validation_coherente_chk
    check ((statut = 'valide') = (valide_le is not null and valide_par_utilisateur_id is not null))
);

comment on table public.reprise_plan is
  'Plan de reprise proposé (contrats/reprise.ts::ReponsePlanReprise), singleton par dossier, '
  'généré automatiquement à la fin d''une analyse réussie. elements[].inclus est LE seul levier '
  'd''ajustement client (PATCH .../plan) — jamais un éditeur de mapping.';

create index reprise_plan_dossier_idx on public.reprise_plan (tenant_id, dossier_reprise_id);

revoke all                     on public.reprise_plan from dfa_app;
grant  select, insert, update  on public.reprise_plan to   dfa_app;

alter table public.reprise_plan enable row level security;
alter table public.reprise_plan force  row level security;

create policy reprise_plan_isolation_tenant on public.reprise_plan
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy reprise_plan_migrator on public.reprise_plan
  to dfa_migrator
  using (true) with check (true);

create trigger reprise_plan_touche_modifie_le
  before update on public.reprise_plan
  for each row execute function public.touche_modifie_le();


-- ---------------------------------------------------------------------------------------------
-- 6. `reprise_import` — avancement d'import, singleton par dossier, même ligne rejouée.
-- ---------------------------------------------------------------------------------------------

create table public.reprise_import (
  id                    uuid        not null default gen_random_uuid(),
  tenant_id             uuid        not null,
  dossier_reprise_id    uuid        not null,
  plan_id               uuid        not null,
  statut                public.statut_import_reprise not null default 'en_attente',
  domaine_courant       public.domaine_reprise null,
  elements_traites      bigint      not null default 0,
  elements_total        bigint      not null default 0,
  tentative             integer     not null default 1,
  demarre_le            timestamptz null,
  termine_le            timestamptz null,
  cree_le               timestamptz not null default now(),
  modifie_le            timestamptz not null default now(),

  constraint reprise_import_pk primary key (id),
  constraint reprise_import_tenant_id_uk unique (tenant_id, id),
  constraint reprise_import_tenant_dossier_uk unique (tenant_id, dossier_reprise_id),

  constraint reprise_import_fk_dossier
    foreign key (tenant_id, dossier_reprise_id)
    references public.dossier_reprise (tenant_id, id) on delete restrict,
  constraint reprise_import_fk_plan
    foreign key (tenant_id, plan_id)
    references public.reprise_plan (tenant_id, id) on delete restrict,

  constraint reprise_import_tentative_chk check (tentative >= 1),
  constraint reprise_import_progression_chk
    check (elements_traites >= 0 and elements_total >= 0)
);

comment on table public.reprise_import is
  'Avancement d''import (contrats/reprise.ts::ReponseImportReprise), singleton par dossier, LA '
  'MÊME ligne d''une tentative à l''autre : tentative incrémenté par POST .../import/rejouer, '
  'jamais une nouvelle ligne — c''est ce qui rend GET .../import stable pendant un rejeu.';

create index reprise_import_dossier_idx on public.reprise_import (tenant_id, dossier_reprise_id);

revoke all                     on public.reprise_import from dfa_app;
grant  select, insert, update  on public.reprise_import to   dfa_app;

alter table public.reprise_import enable row level security;
alter table public.reprise_import force  row level security;

create policy reprise_import_isolation_tenant on public.reprise_import
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy reprise_import_migrator on public.reprise_import
  to dfa_migrator
  using (true) with check (true);

create trigger reprise_import_touche_modifie_le
  before update on public.reprise_import
  for each row execute function public.touche_modifie_le();


-- ---------------------------------------------------------------------------------------------
-- 7. `reprise_rapport` — rapport de réconciliation, singleton par dossier, accumulé par le worker.
-- ---------------------------------------------------------------------------------------------

create table public.reprise_rapport (
  id                    uuid        not null default gen_random_uuid(),
  tenant_id             uuid        not null,
  dossier_reprise_id    uuid        not null,
  import_id             uuid        not null,

  -- JSONB : InsereParDomaineReprise[] / EcarteParDomaineReprise[] / AnomalieImportReprise[]
  -- (plafonné à SEUIL_ANOMALIES_EMBARQUEES_IMPORT_REPRISE = 50, anomalies_total porte le compte
  -- réel) / ReconciliationAnneeReprise[] — ACCUMULÉS par le worker d'import ligne à ligne, jamais
  -- recalculés par agrégation sur les tables cibles au GET (document_vente ne porte aucune
  -- référence vers un dossier de reprise précis, voir en-tête de fichier).
  insere                jsonb       not null default '[]'::jsonb,
  ecarte                jsonb       not null default '[]'::jsonb,
  anomalies             jsonb       not null default '[]'::jsonb,
  anomalies_total       integer     not null default 0,
  reconciliation        jsonb       not null default '[]'::jsonb,

  genere_le             timestamptz not null default now(),
  cree_le               timestamptz not null default now(),
  modifie_le            timestamptz not null default now(),

  constraint reprise_rapport_pk primary key (id),
  constraint reprise_rapport_tenant_id_uk unique (tenant_id, id),
  constraint reprise_rapport_tenant_dossier_uk unique (tenant_id, dossier_reprise_id),

  constraint reprise_rapport_fk_dossier
    foreign key (tenant_id, dossier_reprise_id)
    references public.dossier_reprise (tenant_id, id) on delete restrict,
  constraint reprise_rapport_fk_import
    foreign key (tenant_id, import_id)
    references public.reprise_import (tenant_id, id) on delete restrict,

  constraint reprise_rapport_anomalies_total_chk check (anomalies_total >= 0)
);

comment on table public.reprise_rapport is
  'Rapport de réconciliation (contrats/reprise.ts::RapportImportReprise), singleton par dossier, '
  'lisible dès que l''import a démarré. reconciliation[] est LA preuve chiffrée par année, '
  'centimes entiers, que rien ne s''est perdu (nombre de documents + somme des totaux, source vs '
  'cible).';

create index reprise_rapport_dossier_idx on public.reprise_rapport (tenant_id, dossier_reprise_id);

revoke all                     on public.reprise_rapport from dfa_app;
grant  select, insert, update  on public.reprise_rapport to   dfa_app;

alter table public.reprise_rapport enable row level security;
alter table public.reprise_rapport force  row level security;

create policy reprise_rapport_isolation_tenant on public.reprise_rapport
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy reprise_rapport_migrator on public.reprise_rapport
  to dfa_migrator
  using (true) with check (true);

create trigger reprise_rapport_touche_modifie_le
  before update on public.reprise_rapport
  for each row execute function public.touche_modifie_le();


-- ---------------------------------------------------------------------------------------------
-- 8. Assertions de fin de migration.
-- ---------------------------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.dossier_reprise') is null then
    raise exception '0067 : table dossier_reprise absente après migration.';
  end if;
  if to_regclass('public.reprise_tranche') is null then
    raise exception '0067 : table reprise_tranche absente après migration.';
  end if;
  if to_regclass('public.reprise_analyse') is null then
    raise exception '0067 : table reprise_analyse absente après migration.';
  end if;
  if to_regclass('public.reprise_plan') is null then
    raise exception '0067 : table reprise_plan absente après migration.';
  end if;
  if to_regclass('public.reprise_import') is null then
    raise exception '0067 : table reprise_import absente après migration.';
  end if;
  if to_regclass('public.reprise_rapport') is null then
    raise exception '0067 : table reprise_rapport absente après migration.';
  end if;

  if not exists (
    select 1 from information_schema.role_table_grants
     where table_schema = 'public' and table_name = 'reprise_tranche'
       and grantee = 'dfa_app' and privilege_type = 'DELETE'
  ) then
    raise exception '0067 : dfa_app doit avoir DELETE sur reprise_tranche (purge nLPD).';
  end if;

  if exists (
    select 1 from information_schema.role_table_grants
     where table_schema = 'public'
       and table_name in ('dossier_reprise', 'reprise_analyse', 'reprise_plan', 'reprise_import', 'reprise_rapport')
       and grantee = 'dfa_app' and privilege_type = 'DELETE'
  ) then
    raise exception '0067 : dfa_app ne doit avoir DELETE que sur reprise_tranche.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'dossier_reprise' and c.relrowsecurity
  ) then
    raise exception '0067 : row level security non activée sur dossier_reprise.';
  end if;
end
$$;
