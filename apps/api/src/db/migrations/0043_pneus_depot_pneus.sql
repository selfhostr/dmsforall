-- =============================================================================================
-- 0043_pneus_depot_pneus.sql — Hangar à pneus, Lot A (schéma).
-- Spécification : docs/specification-parc-et-hangar-pneus.md §2 (RPP-01→RPP-08), §4.3
-- (modèle proposé). Contrat gelé : aucun encore — les DTOs (§5 de la spec) sont ajoutés par un
-- agent séparé sur `packages/shared/src/contrats/pneus/`, ce fichier ne pose que le schéma.
--
-- NUMÉROTATION : 0042 est la dernière migration existante au moment où cette tâche a été assignée
-- (`0042_ventes_financement_montants.sql`) — vérifié en exécution (`ls
-- apps/api/src/db/migrations/`) avant d'écrire ce fichier, aucun `0043_*` préexistant. Cette
-- migration prend 0043, la suivante (extension `vehicule`, Lot C) prend 0044.
--
-- CE QUI EST POSÉ ICI :
--   1. Trois types enum : `saison_pneu`, `statut_depot_pneus`, `motif_sortie_depot_pneus` —
--      valeurs miroir exact de `packages/shared/src/contrats/pneus/enums.ts` (SOURCE UNIQUE côté
--      TypeScript, doctrine `schema/pieces/enums.ts`).
--   2. `depot_pneus` — RPP-01→RPP-08. UUID, tenant_id NOT NULL + RLS, timestamptz, enums
--      Postgres, CHECK de cohérence, index de pagination/filtrage. Aucun JSONB : rien ici n'est
--      réellement variable par marque ou tenant (spec §4.3, dernier paragraphe).
--   3. `entite_auditee` gagne `depot_pneus` + trigger `depot_pneus_audit` — un jeu de pneus
--      engage la responsabilité du garage (spec §4.3 : « tout changement de statut doit être
--      reconstituable »). Même dispositif générique que `tenant_bloc_creancier` (0016) et
--      `vehicule_travail_reporte` (0033) : `ALTER TYPE ... ADD VALUE` PUIS `CREATE TRIGGER` dans
--      LA MÊME transaction — sûr ici pour la même raison qu'en 0033 : `depot_pneus` ne participe
--      PAS au dispositif `transition_autorisee` (0003), donc rien ne COMPARE la valeur neuve
--      avant le COMMIT de cette migration ; l'argument du trigger (`'depot_pneus'`) est stocké
--      comme texte brut (`pg_trigger.tgargs`) et casté vers `entite_auditee` uniquement à
--      l'exécution future du trigger (0004 §4), après ce COMMIT. Aucune colonne `auteur_id` sur
--      `depot_pneus` : le trigger générique lit `utilisateur_courant()` depuis la session, jamais
--      une colonne de la table (patron confirmé par le brief de cette tâche).
--
-- DÉCISIONS TRANCHÉES ICI (documentées, pas silencieuses) :
--
--   A. UNICITÉ PARTIELLE (RPP-02) — ne peut PAS être une contrainte `UNIQUE` de table : une clause
--      `WHERE` n'existe que sur un INDEX. Posée en `CREATE UNIQUE INDEX
--      depot_pneus_actif_uk ... WHERE statut IN ('en_depot', 'monte')` — même patron que
--      `dossier_vente_vehicule_engage_uk` (0032, `schema/ventes/dossier-vente.ts`).
--
--   B. GRANTS — `depot_pneus` N'EST PAS immuable comme `mouvement_stock` : elle a un vrai cycle
--      de vie via `statut` (RPP-02→RPP-05), donc `dfa_app` reçoit SELECT/INSERT/UPDATE. RPP-05
--      interdit explicitement toute suppression de ligne (« jamais par DELETE ») :
--      `revoke delete on public.depot_pneus from dfa_app` posé explicitement, ceinture-et-
--      bretelles, même style que `cle_idempotence` (0004 §5) — DELETE n'est déjà pas accordé par
--      défaut depuis 0002, mais le retrait explicite documente l'invariant au lieu de compter sur
--      un défaut qu'un lecteur futur pourrait ne pas connaître.
--
--   C. `code_case` — PAS de CHECK de longueur en base. Vérifié en exécution avant d'écrire cette
--      migration : `stock_article.emplacement` (schema/pieces/stock.ts, migrations/0025) est un
--      `text` NU, sans aucune contrainte de longueur — la borne `.trim().max(60)` que porte la
--      spec (RPP-07, « patron `stock_article.emplacement` ») y est purement applicative (zod),
--      jamais en base, dans ce dépôt. `code_case` suit exactement la même doctrine, par
--      cohérence : un champ d'étiquetage libre affiché à l'écran n'est pas un invariant métier
--      absolu (contrairement à un motif obligatoire conditionné par un statut, qui LUI reçoit
--      un CHECK — voir `depot_pneus_sorti_motif_chk` ci-dessous) — c'est une borne d'ergonomie de
--      saisie, du ressort du contrat d'entrée (zod), pas de l'intégrité relationnelle que la base
--      doit garantir même si l'applicatif a un bug. Le contrat zod (agent nestjs, hors périmètre
--      schéma) doit reprendre `.trim().max(60)` à l'identique de `stock_article.emplacement`.
--
--   D. FK COMPOSITE VERS `ligne_or` — `depot_pneus.ligne_or_dernier_changement_id` référence
--      `ligne_or(tenant_id, id)` (module atelier, `migrations/0008`), `on delete restrict` : une
--      ligne d'OR qui a réalisé un changement de saison ne doit jamais pouvoir disparaître sous
--      un dépôt qui la cite encore (même doctrine que `mouvement_stock_fk_ligne_or`, 0025).
--
--   E. `depot_pneus_tenant_id_uk unique (tenant_id, id)` — posée bien qu'aucune table ne
--      référence encore `depot_pneus` par FK composite : patron systématique de ce dépôt
--      (`vehicule_tenant_id_uk`, `site_tenant_id_uk`, `ligne_or_tenant_id_uk`, etc.), cible des
--      futures FK composites (ex. une ligne de facturation du forfait dépôt, RPP-08).
--
-- SIGNALÉ, PAS FAIT ICI (hors périmètre déclaré de cette tâche) :
--   - `ENTITES_AUDITEES` (packages/shared/src/contrats/atelier/enums.ts) doit gagner la valeur
--     EXACTE `'depot_pneus'` — miroir TypeScript de l'ajout Postgres ci-dessus (§3). La valeur
--     Postgres existe dès cette migration ; le contrat public (`GET .../journal` pour cette
--     entité) reste à ajouter séparément par le propriétaire de ce fichier.
--
-- Réversible : migrations/down/0043_pneus_depot_pneus.down.sql. Le DOWN retire le trigger d'audit,
-- la table (et ses index/contraintes avec elle), les trois types enum — mais NE PEUT PAS retirer
-- `depot_pneus` de `entite_auditee` (PostgreSQL n'offre aucun DROP VALUE sur un type enum), même
-- limite documentée et acceptée que 0010/0016/0033. `scripts/verifier-reversibilite-migrations.sh`
-- porte une exception documentée pour ce résidu (voir `obtenir_exception_down_partiel`, entrée
-- `0043_pneus_depot_pneus.sql`) — ajoutée dans ce même changement, seule façon de faire passer la
-- vérification de réversibilité pour une migration qui ajoute une valeur d'enum, comme toutes ses
-- devancières listées ci-dessus. Migration de DONNÉES : aucune — table neuve, aucune ligne
-- existante à transformer.
-- =============================================================================================


-- ---------------------------------------------------------------------------------------------
-- 1. Types enum — miroir exact de packages/shared/src/contrats/pneus/enums.ts.
-- ---------------------------------------------------------------------------------------------

create type public.saison_pneu as enum ('ete', 'hiver');

create type public.statut_depot_pneus as enum ('en_depot', 'monte', 'a_relancer', 'sorti');

create type public.motif_sortie_depot_pneus as enum (
  'rendu_au_client', 'vehicule_vendu', 'mis_au_rebut', 'autre'
);


-- ---------------------------------------------------------------------------------------------
-- 2. `depot_pneus` — RPP-01→RPP-08.
-- ---------------------------------------------------------------------------------------------

create table public.depot_pneus (
  id                              uuid                        not null default gen_random_uuid(),
  -- Pas de FK directe vers `tenant` (même patron que `stock_article`) : l'étanchéité multi-
  -- tenant passe par les FK composites (tenant_id, vehicule_id) / (tenant_id, site_id) ci-dessous,
  -- chacune scopée par tenant, plus la policy RLS posée en §4.
  tenant_id                       uuid                        not null,
  vehicule_id                     uuid                        not null,
  site_id                         uuid                        not null,

  saison                          public.saison_pneu          not null,
  -- Un jeu entre en dépôt par défaut — `changer-saison`/`sortir` (API, hors périmètre schéma)
  -- sont les seuls chemins vers les trois autres valeurs.
  statut                          public.statut_depot_pneus   not null default 'en_depot',

  -- RPP-07 : patron stock_article.emplacement, texte libre, borne applicative uniquement (§C).
  code_case                       text                        null,
  -- Recopié de vehicule.pneusEte/pneusHiver au moment de l'entrée, ex. "205/55 R16".
  dimension                       text                        null,
  -- Observation libre ("usure 4mm").
  etat                            text                        null,

  entre_le                        timestamptz                 not null default now(),
  dernier_mouvement_le            timestamptz                 not null default now(),

  -- Requis quand statut = 'sorti' (RPP-05) — voir depot_pneus_sorti_motif_chk.
  motif_sortie                    public.motif_sortie_depot_pneus null,

  -- Traçabilité RPP-03 : la ligne d'OR qui a réalisé le dernier changement de saison.
  ligne_or_dernier_changement_id  uuid                        null,

  cree_le                         timestamptz                 not null default now(),
  modifie_le                      timestamptz                 not null default now(),

  constraint depot_pneus_pk primary key (id),
  constraint depot_pneus_tenant_id_uk unique (tenant_id, id),

  constraint depot_pneus_fk_vehicule
    foreign key (tenant_id, vehicule_id) references public.vehicule (tenant_id, id) on delete restrict,
  constraint depot_pneus_fk_site
    foreign key (tenant_id, site_id) references public.site (tenant_id, id) on delete restrict,
  constraint depot_pneus_fk_ligne_or_dernier_changement
    foreign key (tenant_id, ligne_or_dernier_changement_id)
    references public.ligne_or (tenant_id, id) on delete restrict,

  -- RPP-05 : motif de sortie obligatoire, et seulement, quand statut = 'sorti'.
  constraint depot_pneus_sorti_motif_chk
    check ((statut = 'sorti') = (motif_sortie is not null))
);

comment on table public.depot_pneus is
  'Hangar à pneus (RPP-01→RPP-08) : un jeu de pneus en dépôt, rattaché à un véhicule — jamais de '
  'client_id direct (RPP-01), le client se lit via vehicule. Statuts actifs (en_depot, monte) '
  'protégés par unicité partielle par (tenant, véhicule, saison) — depot_pneus_actif_uk (RPP-02). '
  'sorti est TERMINAL, jamais atteint par DELETE (RPP-05) : dfa_app n''a pas ce droit sur cette '
  'table, voir les GRANT ci-dessous. Auditée (depot_pneus_audit) : tout changement de statut est '
  'reconstituable, qui/quoi/quand/avant/après via audit_atelier.';

-- Index de l'index unique (§A de l'en-tête) : ne peut pas être une contrainte UNIQUE de table.
create unique index depot_pneus_actif_uk on public.depot_pneus (tenant_id, vehicule_id, saison)
  where statut in ('en_depot', 'monte');

-- Vue hangar par site (GET /sites/{siteId}/hangar-pneus, spec §5).
create index depot_pneus_site_statut_idx on public.depot_pneus (tenant_id, site_id, statut);

-- Job de relance RPP-04 : jeux en_depot sans mouvement depuis le délai paramétrable.
create index depot_pneus_relance_idx on public.depot_pneus (tenant_id, dernier_mouvement_le)
  where statut = 'en_depot';

create trigger depot_pneus_touche_modifie_le
  before update on public.depot_pneus
  for each row execute function public.touche_modifie_le();

-- §B de l'en-tête : cycle de vie réel (pas immuable comme mouvement_stock), mais RPP-05 interdit
-- toute suppression de ligne.
revoke all                    on public.depot_pneus from dfa_app;
grant  select, insert, update on public.depot_pneus to   dfa_app;
revoke delete                 on public.depot_pneus from dfa_app;

alter table public.depot_pneus enable row level security;
alter table public.depot_pneus force  row level security;

create policy depot_pneus_isolation_tenant on public.depot_pneus
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy depot_pneus_migrator on public.depot_pneus
  to dfa_migrator
  using (true) with check (true);


-- ---------------------------------------------------------------------------------------------
-- 3. Audit — `entite_auditee` gagne `depot_pneus`, trigger générique posé dans la même
--    transaction (sûr, voir §3 de l'en-tête).
-- ---------------------------------------------------------------------------------------------

alter type public.entite_auditee add value if not exists 'depot_pneus';

create trigger depot_pneus_audit
  after insert or update or delete on public.depot_pneus
  for each row execute function public.auditer_atelier('depot_pneus');


-- ---------------------------------------------------------------------------------------------
-- 4. Assertions de fin de migration
-- ---------------------------------------------------------------------------------------------

do $$
begin
  -- 1. Table présente.
  if to_regclass('public.depot_pneus') is null then
    raise exception '0043 : table depot_pneus absente après migration.';
  end if;

  -- 2. Colonnes clés bien typées / nullables.
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'depot_pneus'
       and column_name = 'vehicule_id' and is_nullable = 'NO' and data_type = 'uuid'
  ) then
    raise exception '0043 : depot_pneus.vehicule_id absente, nullable, ou de mauvais type.';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'depot_pneus'
       and column_name = 'site_id' and is_nullable = 'NO' and data_type = 'uuid'
  ) then
    raise exception '0043 : depot_pneus.site_id absente, nullable, ou de mauvais type.';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'depot_pneus'
       and column_name = 'code_case' and is_nullable = 'YES' and data_type = 'text'
  ) then
    raise exception '0043 : depot_pneus.code_case absente, non-nullable, ou de mauvais type.';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'depot_pneus'
       and column_name = 'motif_sortie' and is_nullable = 'YES'
  ) then
    raise exception '0043 : depot_pneus.motif_sortie absente ou non-nullable.';
  end if;

  -- 3. CHECK posée.
  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conname = 'depot_pneus_sorti_motif_chk'
       and conrelid = 'public.depot_pneus'::regclass
  ) then
    raise exception '0043 : depot_pneus_sorti_motif_chk absente après migration.';
  end if;

  -- 4. Index unique partiel présent (RPP-02).
  if not exists (
    select 1 from pg_catalog.pg_indexes
     where schemaname = 'public' and tablename = 'depot_pneus'
       and indexname = 'depot_pneus_actif_uk'
  ) then
    raise exception '0043 : index depot_pneus_actif_uk absent après migration.';
  end if;

  -- 5. RLS activée ET forcée.
  if not exists (
    select 1 from pg_catalog.pg_class
     where relname = 'depot_pneus' and relnamespace = 'public'::regnamespace
       and relrowsecurity and relforcerowsecurity
  ) then
    raise exception '0043 : depot_pneus n''a pas RLS activée et forcée.';
  end if;

  -- 6. Policies présentes.
  if not exists (
    select 1 from pg_catalog.pg_policies
     where schemaname = 'public' and tablename = 'depot_pneus' and policyname = 'depot_pneus_isolation_tenant'
  ) then
    raise exception '0043 : policy depot_pneus_isolation_tenant absente après migration.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_policies
     where schemaname = 'public' and tablename = 'depot_pneus' and policyname = 'depot_pneus_migrator'
  ) then
    raise exception '0043 : policy depot_pneus_migrator absente après migration.';
  end if;

  -- 7. dfa_app n'a pas DELETE (RPP-05).
  if has_table_privilege('dfa_app', 'public.depot_pneus', 'DELETE') then
    raise exception '0043 : depot_pneus doit interdire DELETE à dfa_app (RPP-05).';
  end if;

  if not has_table_privilege('dfa_app', 'public.depot_pneus', 'UPDATE') then
    raise exception '0043 : depot_pneus doit accorder UPDATE à dfa_app (cycle de vie via statut).';
  end if;

  -- 8. Trigger d'audit présent, pointant vers auditer_atelier(), AFTER INSERT/UPDATE/DELETE FOR
  --    EACH ROW (tgtype bitmask : ROW=1, INSERT=4, DELETE=8, UPDATE=16 ; AFTER = absence BEFORE=2).
  if not exists (
    select 1
      from pg_catalog.pg_trigger tg
      join pg_catalog.pg_class c on c.oid = tg.tgrelid
      join pg_catalog.pg_proc p on p.oid = tg.tgfoid
     where c.relname = 'depot_pneus'
       and tg.tgname = 'depot_pneus_audit'
       and p.proname = 'auditer_atelier'
       and not tg.tgisinternal
       and (tg.tgtype & 1) = 1
       and (tg.tgtype & 2) = 0
       and (tg.tgtype & 4) = 4
       and (tg.tgtype & 8) = 8
       and (tg.tgtype & 16) = 16
  ) then
    raise exception '0043 : trigger depot_pneus_audit absent, ne pointe pas vers auditer_atelier(), ou n''est pas exactement AFTER INSERT OR UPDATE OR DELETE FOR EACH ROW.';
  end if;

  -- 9. entite_auditee porte la nouvelle valeur.
  if not exists (
    select 1
      from pg_catalog.pg_enum e
      join pg_catalog.pg_type t on t.oid = e.enumtypid
     where t.typname = 'entite_auditee' and e.enumlabel = 'depot_pneus'
  ) then
    raise exception '0043 : entite_auditee ne porte pas la valeur depot_pneus après migration.';
  end if;

  -- 10. touche_modifie_le posé.
  if not exists (
    select 1
      from pg_catalog.pg_trigger tg
      join pg_catalog.pg_class c on c.oid = tg.tgrelid
     where c.relname = 'depot_pneus' and tg.tgname = 'depot_pneus_touche_modifie_le'
       and not tg.tgisinternal
  ) then
    raise exception '0043 : trigger depot_pneus_touche_modifie_le absent après migration.';
  end if;
end
$$;
