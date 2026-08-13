-- =============================================================================================
-- 0054_gestion_utilisateurs.sql — Socle base de données de la gestion des employés par le
-- garage lui-même (issue #137). Jusqu'ici, un compte se créait uniquement par insertion directe
-- en base (`db/seed/seed-dev.ts`) — aucun endpoint, aucun écran. Cette migration pose les DEUX
-- tables neuves dont a besoin `apps/api/src/socle/service-utilisateur.ts` :
--
--   1. `utilisateur_site` — affectation N:N employé ↔ site, PUREMENT DESCRIPTIVE. Arbitrage @laupernoe
--      (13.08.2026) : sert l'affichage (« sur quels sites travaille cet employé ? ») et le
--      planning, RIEN D'AUTRE. La variante « rôle PAR site » suggérée par le commentaire de
--      `db/schema/utilisateur.ts` (§ role, ligne 51) a été explicitement écartée — elle toucherait
--      la matrice des droits et l'isolation tenant, chantier séparé et plus lourd. Le rôle d'un
--      utilisateur reste unique et vaut sur tout le tenant (`utilisateur.role`,
--      `auth/matrice-droits.ts`) : AUCUNE action de la matrice n'est scopée par site, et cette
--      table ne doit JAMAIS devenir un mécanisme d'autorisation — voir le commentaire posé sur la
--      table elle-même ci-dessous, pour qu'un lecteur futur ne la prenne pas pour ça.
--
--   2. `audit_utilisateur` — piste d'audit dédiée à la gestion des comptes (création,
--      changement de rôle, changement de sites, désactivation/réactivation, réinitialisation
--      d'accès). PAS une extension de `journal_securite` (0001) : son type d'événement
--      (`type_evenement_securite`) est un enum PostgreSQL généré depuis
--      `packages/shared/src/contrats/enums.ts` (`TYPES_EVENEMENT_SECURITE`), hors du périmètre
--      d'écriture de cette tâche (contrats racine, propriété transverse). PAS non plus une entrée
--      dans `audit_atelier` (0004) : son enum `entite_auditee`/`action_auditee` vit sous
--      `db/schema/atelier/`, domaine possédé par un autre agent en ce moment. Table dédiée,
--      même patron append-only que les deux précédentes (SELECT + INSERT seulement pour
--      `dfa_app`, jamais UPDATE ni DELETE) : « qui a fait quoi, quand, sur qui » ne se corrige
--      jamais après coup, il se complète par une nouvelle ligne.
--
-- NUMÉROTATION : 0053 est la dernière migration existante au moment où cette tâche démarre
-- (`0053_purge_enums_rendez_vous_geles.sql`) — vérifié en exécution. Cette migration prend 0054.
--
-- Réversible : migrations/down/0054_gestion_utilisateurs.down.sql (up→down→up rejoué par la CI).
-- Migration de données : aucune — deux tables neuves, aucune ligne existante affectée.
-- =============================================================================================

create type public.action_audit_utilisateur as enum (
  'creation',
  'modification_role',
  'modification_sites',
  'desactivation',
  'reactivation',
  'reinitialisation_acces'
);

-- -------------------------------------------------------------------------------------------
-- 1. `utilisateur_site` — affectation descriptive employé ↔ site (PAS un mécanisme d'autorisation)
-- -------------------------------------------------------------------------------------------

create table public.utilisateur_site (
  id             uuid        not null default gen_random_uuid(),
  tenant_id      uuid        not null,
  utilisateur_id uuid        not null,
  site_id        uuid        not null,
  cree_le        timestamptz not null default now(),

  constraint utilisateur_site_pk primary key (id),
  constraint utilisateur_site_tenant_utilisateur_site_uk unique (tenant_id, utilisateur_id, site_id),

  constraint utilisateur_site_fk_utilisateur foreign key (tenant_id, utilisateur_id)
    references public.utilisateur (tenant_id, id) on delete cascade,
  constraint utilisateur_site_fk_site foreign key (tenant_id, site_id)
    references public.site (tenant_id, id) on delete cascade
);

-- `verifierPostureRls()` (démarrage, 0002_posture_declaree.sql) refuse tout DELETE accordé à
-- `dfa_app` sans marqueur `[dfa:suppression-physique]` explicite dans le commentaire de table —
-- sinon l'API refuse de démarrer. Légitime ici, contrairement à la doctrine « suppression
-- logique » du reste du produit (documents de vente, mouvements de stock, pointages) : une ligne
-- `utilisateur_site` n'est qu'une AFFECTATION COURANTE, pas un fait historique à préserver — retirer
-- un site de la liste d'un employé qui change de poste (`ServiceUtilisateur.modifier`, remplacement
-- complet de l'ensemble) n'est la perte d'aucune preuve, contrairement à un document ou un mouvement
-- de stock. Voir `db/migrations/0002_posture_declaree.sql` (table `session`) pour le précédent
-- exact de cette exception.
comment on table public.utilisateur_site is
  'Affectation N:N employé <-> site, PUREMENT DESCRIPTIVE (RF-137, arbitrage @laupernoe 13.08.2026) : '
  'sert l''affichage et le planning, JAMAIS l''autorisation. Le rôle d''un utilisateur reste '
  'unique et vaut sur tout le tenant (utilisateur.role, auth/matrice-droits.ts) : aucune action '
  'de la matrice des droits ne doit jamais se scoper depuis cette table. Une ligne absente ne '
  'restreint aucun droit ; elle dit seulement « pas encore renseigné où travaille cette personne ». '
  '[dfa:suppression-physique] DELETE accordé à dfa_app : une ligne est une AFFECTATION COURANTE '
  '(pas un fait historique) — ServiceUtilisateur.modifier() remplace intégralement l''ensemble des '
  'sites d''un employé (delete + insert), aucune valeur d''audit ne serait gagnée à conserver une '
  'affectation retirée.';

create index utilisateur_site_utilisateur_idx on public.utilisateur_site (tenant_id, utilisateur_id);
create index utilisateur_site_site_idx on public.utilisateur_site (tenant_id, site_id);

revoke all             on public.utilisateur_site from dfa_app;
grant  select, insert,
       delete          on public.utilisateur_site to   dfa_app;
revoke update          on public.utilisateur_site from dfa_app;

alter table public.utilisateur_site enable row level security;
alter table public.utilisateur_site force  row level security;

create policy utilisateur_site_isolation_tenant on public.utilisateur_site
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy utilisateur_site_migrator on public.utilisateur_site
  to dfa_migrator
  using (true) with check (true);

-- -------------------------------------------------------------------------------------------
-- 2. `audit_utilisateur` — APPEND-ONLY, piste d'audit dédiée à la gestion des comptes
-- -------------------------------------------------------------------------------------------

create table public.audit_utilisateur (
  id                    uuid                              not null default gen_random_uuid(),
  tenant_id             uuid                              not null,
  utilisateur_cible_id  uuid                              not null,
  action_par_id         uuid                              not null,
  action                public.action_audit_utilisateur   not null,
  -- Instantané avant/après (ex. {"role":"technicien"}, {"siteIds":[...]}) — JAMAIS de mot de
  -- passe ni de hash, en clair ou non : la réinitialisation d'accès n'écrit aucune valeur ici,
  -- seul le fait qu'elle ait eu lieu (qui, quand, sur qui) est tracé.
  avant                 jsonb,
  apres                 jsonb,
  cree_le               timestamptz                       not null default now(),

  constraint audit_utilisateur_pk primary key (id),

  constraint audit_utilisateur_fk_cible foreign key (tenant_id, utilisateur_cible_id)
    references public.utilisateur (tenant_id, id) on delete cascade,
  -- `restrict`, pas `cascade` : l'auteur d'un geste d'administration ne doit jamais pouvoir
  -- entraîner la disparition de la preuve de ce geste en étant lui-même retiré plus tard —
  -- « retiré » n'existe de toute façon pas pour `utilisateur` (désactivation seule, jamais DELETE).
  constraint audit_utilisateur_fk_acteur foreign key (tenant_id, action_par_id)
    references public.utilisateur (tenant_id, id) on delete restrict
);

comment on table public.audit_utilisateur is
  'APPEND-ONLY : une ligne par geste d''administration de compte (création, changement de rôle '
  'ou de sites, désactivation/réactivation, réinitialisation d''accès), jamais modifiée après '
  'coup. Ne contient JAMAIS de mot de passe ni de hash — seuls qui/quoi/quand/sur qui sont tracés.';

create index audit_utilisateur_cible_idx
  on public.audit_utilisateur (tenant_id, utilisateur_cible_id, cree_le desc);

revoke all            on public.audit_utilisateur from dfa_app;
grant  select, insert on public.audit_utilisateur to   dfa_app;
revoke update, delete  on public.audit_utilisateur from dfa_app;

alter table public.audit_utilisateur enable row level security;
alter table public.audit_utilisateur force  row level security;

create policy audit_utilisateur_isolation_tenant on public.audit_utilisateur
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy audit_utilisateur_migrator on public.audit_utilisateur
  to dfa_migrator
  using (true) with check (true);
