-- =============================================================================================
-- 0052_rendez_vous_atelier.sql — Socle base de données de la prise de rendez-vous d'atelier.
-- Conception : docs/conception-rendez-vous-donnees.md. Fait foi, SAUF sur les trois points
-- arbitrés par @laupernoe pour cette tâche (voir §B ci-dessous) et sur la collision de noms §A, découverte
-- en exécution et non anticipée par la conception.
--
-- NUMÉROTATION : 0050 est la dernière migration existante au moment où cette tâche démarre
-- (`0050_referentiel_vehicules_ch.sql`) — vérifié en exécution (`ls apps/api/src/db/migrations/`).
-- 0051 est réservé au second développeur du dépôt (point de contact négocié, voir
-- docs/conception-rendez-vous-donnees.md en-tête) : cette migration prend 0052, PAS 0051, même si
-- 0051 n'existe pas encore sur ce poste au moment d'écrire ce fichier.
--
-- =============================================================================================
-- §A. COLLISION DE NOMS DÉCOUVERTE EN EXÉCUTION — DÉVIATION DE LA CONCEPTION, SIGNALÉE ICI EN TOUTES
--     LETTRES (pas seulement dans le rapport de livraison, pour qu'un lecteur futur de CE fichier
--     comprenne sans avoir à remonter la conversation).
--
-- La conception (§8, plan expand/contract) prévoit `create type public.statut_rendez_vous` et
-- `create type public.origine_rendez_vous`. Ces DEUX noms existent DÉJÀ en base depuis
-- `0005_parametrage.sql` (§ "Modules absents du lot 1 (rendez-vous, pointage, courtoisie) : enums
-- créés quand même") :
--   statut_rendez_vous  as enum ('demande','planifie','honore','absent','annule_client',
--                                 'annule_garage','reporte')          -- marqué **GELÉ** dans
--                                                                        @dfa/shared (StatutRendezVous)
--   origine_rendez_vous as enum ('telephone','comptoir','email','formulaire_web','importe',
--                                 'rappel_automatique')                -- canal d'origine, PAS
--                                                                        réservation/rétroactif
-- `CREATE TYPE` sur un nom déjà pris échoue net — cette migration ne peut donc PAS créer ces deux
-- types sous ces noms. Les valeurs elles-mêmes divergent aussi sémantiquement de l'arbitrage de
-- @laupernoe pour cette tâche (statuts confirme/honore/absent/annule à quatre valeurs, un seul état actif
-- — voir §B.3 ; origine reservation/retroactif, pas un canal) : réutiliser les types existants
-- changerait la machine à états au lieu de simplement la nommer différemment.
--
-- Aucune table ne consomme ces deux types aujourd'hui (vérifié : `grep` sur tout le dépôt ne trouve
-- STATUTS_RENDEZ_VOUS / statutRendezVousEnum / ORIGINES_RENDEZ_VOUS / origineRendezVousEnum que
-- dans `packages/shared/src/contrats/atelier/enums.ts`, `apps/api/src/db/schema/atelier/enums.ts`
-- — déclarations Drizzle sans table — et `docs/conception-rendez-vous-ecrans.md`, qui les traite
-- comme une question ouverte, pas un fait acquis). Le résidu reste donc inerte, pas cassé.
--
-- DÉCISION (dans le périmètre de cette tâche : apps/api/src/db/migrations, .../schema, .../seed —
-- `packages/shared/src/contrats/` appartient à l'agent parallèle sur `apps/api/src/rendezvous/`,
-- hors de portée d'écriture ici) : cette migration crée les DEUX types sous des noms voisins mais
-- distincts, `statut_prise_rendez_vous` et `origine_creation_rendez_vous`, avec les valeurs
-- arbitrées par @laupernoe. Les anciens types `statut_rendez_vous`/`origine_rendez_vous` (0005) restent en
-- place, inutilisés — les retirer toucherait `packages/shared`, hors périmètre. SIGNALÉ pour
-- réconciliation ultérieure par qui touche `packages/shared/src/contrats/atelier/enums.ts` :
-- soit aligner ce contrat sur les noms/valeurs posés ici, soit documenter formellement que les deux
-- couples coexistent pour des usages différents (canal de contact vs état de prise de RDV).
--
-- =============================================================================================
-- §B. LES TROIS ARBITRAGES DE @laupernoe POUR CETTE TÂCHE, TELS QU'APPLIQUÉS ICI :
--
--   1. SURBOOKING : avertir, jamais bloquer. Aucun plafond dur en base — ni CHECK, ni trigger de
--      comptage, ni contrainte d'exclusion. `rendez_vous_actifs_idx` (§6 de la conception) rend le
--      comptage de capacité bon marché pour l'AFFICHAGE ; rien ne refuse un INSERT au-delà d'un
--      seuil. Conforme à la conception (§2), rien à dévier ici.
--
--   2. MOTIF OBLIGATOIRE, ET C'EST LUI QUI PORTE LA DURÉE — DÉVIATION DE LA CONCEPTION. Le §3 de la
--      conception proposait `motif text NOT NULL` (verbatim libre, jamais un enum/référentiel).
--      L'arbitrage de @laupernoe change la nature de ce champ : le motif doit être un RENVOI au
--      référentiel `motif_rendez_vous` (existant depuis 0005, paramétrable par tenant, porte déjà
--      `duree_defaut_minutes`) — c'est lui qui « porte la durée estimée, donc la capacité
--      consommée ». Posé ici comme `motif_id uuid NOT NULL` (FK composite vers
--      `motif_rendez_vous(tenant_id, id)`, ON DELETE RESTRICT) plutôt qu'un texte libre. Le
--      verbatim libre de la conception (« bruit au freinage avant droit ») n'est pas perdu : il
--      devient `commentaire` (text, NULLABLE) — champ SECONDAIRE, jamais un substitut au motif
--      catalogué. `duree_estimee_minutes` (smallint NOT NULL, CHECK > 0, même unité que
--      `motif_rendez_vous.duree_defaut_minutes`) reste sur `rendez_vous` : la valeur est FIGÉE À LA
--      CRÉATION depuis le motif choisi (même doctrine que `ligne_or` — RM-65, « figés à la
--      création ») mais reste modifiable ligne par ligne par le garagiste (l'estimation au
--      téléphone peut différer du défaut catalogue) — un `NOT NULL` ici garantit que la capacité
--      affichée (§2) ne rencontre jamais un trou, y compris pour le motif générique « à déterminer »
--      posé au seed (voir seed-rendez-vous-demo.ts) : même une demande vague réserve un créneau
--      calculable.
--
--   3. PAS DE NUMÉROTATION SÉQUENTIELLE. Conforme à la conception (§3, « Pas de `numero` ») : rien
--      à dévier, aucune colonne `numero`, aucune séquence, aucun `compteur_document`.
--
-- Colonne `no_show_constate_le` de la conception (§3) renommée `absent_constate_le` : l'arbitrage de
-- @laupernoe nomme ce statut `absent` (pas `no_show`), la colonne d'horodatage suit le même mot.
--
-- =============================================================================================
-- CE QUI EST POSÉ ICI :
--   1. Trois types enum : `moment_rendez_vous` (libre, aucune collision), `statut_prise_rendez_vous`
--      et `origine_creation_rendez_vous` (renommés, §A).
--   2. `rendez_vous` — table, contraintes, index (docs/conception-rendez-vous-donnees.md §3/§6,
--      adapté §B.2).
--   3. `entite_auditee` gagne `rendez_vous` + trigger `rendez_vous_audit` — même dispositif que
--      `depot_pneus` (0043) : `rendez_vous` ne participe PAS à `transition_autorisee` (0003), donc
--      `ALTER TYPE ... ADD VALUE` puis `CREATE TRIGGER` dans LA MÊME transaction est sûr pour la
--      même raison qu'en 0033/0043.
--   4. Trigger `rendez_vous_empecher_reouverture` — le SEUL invariant de machine à états que la
--      base fait tenir (conception §4) : un état terminal (`honore`/`absent`/`annule`) ne redevient
--      jamais actif. Qui déclenche quelle transition, depuis quel geste métier, reste applicatif
--      (chantier `apps/api/src/rendezvous/`, hors périmètre de ce fichier).
--   5. `ordre_reparation.rendez_vous_id` — vraie FK composite, `NOT VALID` puis `VALIDATE` (table
--      vide aujourd'hui, coût nul, geste par défaut sur une table aussi chaude — même doctrine que
--      la conception §6). Index partiel `ordre_reparation_rendez_vous_idx`.
--
-- Migration de DONNÉES : aucune — `rendez_vous` est une table neuve, `rendez_vous_id` est NULL sur
-- toute ligne `ordre_reparation` existante (vérifié avant d'écrire cette migration).
--
-- Réversible : migrations/down/0052_rendez_vous_atelier.down.sql. NE PEUT PAS DÉFAIRE :
-- `entite_auditee ADD VALUE 'rendez_vous'` (aucun DROP VALUE en PostgreSQL), même limite acceptée
-- que 0010/0016/0025/0033/0043 — exception déclarée dans
-- `scripts/verifier-reversibilite-migrations.sh` (`obtenir_exception_down_partiel`, entrée
-- `0052_rendez_vous_atelier.sql`), ajoutée dans ce même changement.
-- =============================================================================================


-- ---------------------------------------------------------------------------------------------
-- 1. Types enum.
-- ---------------------------------------------------------------------------------------------

create type public.moment_rendez_vous as enum ('matin', 'apres_midi', 'toute_journee');

-- §A : nommé différemment de `statut_rendez_vous` (0005, GELÉ dans @dfa/shared, valeurs
-- différentes) pour éviter la collision de CREATE TYPE tout en respectant l'arbitrage de @laupernoe.
create type public.statut_prise_rendez_vous as enum ('confirme', 'honore', 'absent', 'annule');

-- §A : nommé différemment de `origine_rendez_vous` (0005, canal de contact) — ici, réservation vs
-- rétroactif, une distinction différente.
create type public.origine_creation_rendez_vous as enum ('reservation', 'retroactif');


-- ---------------------------------------------------------------------------------------------
-- 2. `rendez_vous`.
-- ---------------------------------------------------------------------------------------------

create table public.rendez_vous (
  id            uuid                                  not null default gen_random_uuid(),
  tenant_id     uuid                                  not null,
  site_id       uuid                                  not null,
  client_id     uuid                                  not null,
  -- Nullable : souvent connu au téléphone, pas toujours (client sans plaque sous la main, ou
  -- nouveau client sans fiche véhicule). Doit être renseigné avant conversion en OR
  -- (ordre_reparation.vehicule_id est NOT NULL) — garde APPLICATIVE, pas une contrainte ici :
  -- refuser une réservation légitime pour une donnée qui arrivera à l'accueil serait perdre un
  -- rendez-vous pour un défaut de saisie.
  vehicule_id   uuid                                  null,

  -- §B.2 : le motif est un renvoi au référentiel paramétrable (0005), pas un texte libre — c'est
  -- lui qui porte la durée par défaut, donc la capacité consommée (§2 de la conception).
  motif_id      uuid                                  not null,
  -- Détail verbatim optionnel, EN PLUS du motif catalogué (jamais un substitut) — même doctrine que
  -- `ordre_reparation_demande.verbatim` : texte libre, pas d'enum, mais ici NULLABLE puisque le
  -- motif obligatoire porte déjà l'essentiel.
  commentaire   text                                  null,

  type          public.type_ordre_reparation          not null,

  date          date                                  not null,
  moment        public.moment_rendez_vous              not null,
  -- NULL = « moment respecté, heure non fixée » — jamais confondu avec `moment = 'toute_journee'`
  -- (créneau volontairement large) ni `statut = 'annule'` (plus de rendez-vous du tout) : trois
  -- représentations distinctes, aucune ne se substitue à une autre.
  heure_souhaitee time                                 null,
  -- Figée à la création depuis `motif_rendez_vous.duree_defaut_minutes` (applicatif), modifiable
  -- ensuite par le garagiste. NOT NULL : §B.2, la capacité doit toujours être calculable.
  duree_estimee_minutes smallint                        not null,

  statut        public.statut_prise_rendez_vous        not null default 'confirme',
  -- Obligatoire seulement à l'annulation — même patron que `ordre_reparation_annulation_coherente_chk`.
  motif_annulation text                                null,
  origine       public.origine_creation_rendez_vous     not null default 'reservation',

  confirme_le           timestamptz not null default now(),
  honore_le              timestamptz null,
  absent_constate_le     timestamptz null,
  annule_le               timestamptz null,

  -- Qui a pris l'appel. Nullable : une reprise de données historique n'a pas toujours cette info.
  cree_par_id   uuid null,

  cree_le       timestamptz not null default now(),
  modifie_le    timestamptz not null default now(),

  constraint rendez_vous_pk primary key (id),
  constraint rendez_vous_tenant_id_uk unique (tenant_id, id),

  constraint rendez_vous_fk_site
    foreign key (tenant_id, site_id) references public.site (tenant_id, id) on delete restrict,
  constraint rendez_vous_fk_client
    foreign key (tenant_id, client_id) references public.client (tenant_id, id) on delete restrict,
  constraint rendez_vous_fk_vehicule
    foreign key (tenant_id, vehicule_id) references public.vehicule (tenant_id, id) on delete restrict,
  constraint rendez_vous_fk_motif
    foreign key (tenant_id, motif_id) references public.motif_rendez_vous (tenant_id, id) on delete restrict,
  constraint rendez_vous_fk_cree_par
    foreign key (tenant_id, cree_par_id) references public.utilisateur (tenant_id, id) on delete restrict,

  constraint rendez_vous_duree_positive_chk check (duree_estimee_minutes > 0),
  constraint rendez_vous_annulation_motif_chk
    check (statut <> 'annule' or motif_annulation is not null),
  constraint rendez_vous_terminal_le_coherent_chk check (
    (statut = 'honore')  = (honore_le is not null) and
    (statut = 'absent')  = (absent_constate_le is not null) and
    (statut = 'annule')  = (annule_le is not null)
  )
);

comment on table public.rendez_vous is
  'Prise de rendez-vous d''atelier (jour + moment, pas un intervalle exact — aucune ressource '
  'nommée réservée). motif_id NOT NULL (référentiel motif_rendez_vous) porte la durée estimée par '
  'défaut, donc la capacité consommée. Aucun plafond dur en base : la capacité se calcule et '
  's''affiche, elle ne refuse pas (surbooking = avertir, jamais bloquer). Statut terminal '
  '(honore/absent/annule) irréversible via rendez_vous_empecher_reouverture ; l''orchestration des '
  'transitions reste applicative. Un déplacement de créneau est un UPDATE ordinaire, tracé par '
  'rendez_vous_audit — pas un nouvel état.';

create trigger rendez_vous_touche_modifie_le
  before update on public.rendez_vous
  for each row execute function public.touche_modifie_le();

-- Vue planning du jour par site — requête la plus fréquente de l'écran agenda.
create index rendez_vous_agenda_idx on public.rendez_vous (tenant_id, site_id, date, moment);

-- Comptage de capacité (affiché, jamais bloquant) et rappels J-1 — partiel : les RDV terminaux ne
-- participent ni à l'un ni à l'autre.
create index rendez_vous_actifs_idx on public.rendez_vous (tenant_id, site_id, date, moment)
  where statut = 'confirme';

-- Historique de RDV d'un client (fiche client).
create index rendez_vous_client_idx on public.rendez_vous (tenant_id, client_id, date desc);

-- Historique de RDV d'un véhicule ; partiel car souvent NULL (§3 de la conception).
create index rendez_vous_vehicule_idx on public.rendez_vous (tenant_id, vehicule_id, date desc)
  where vehicule_id is not null;

-- Liste globale paginée par curseur (GET /rendez-vous), même patron que
-- ordre_reparation_pagination_idx. PIÈGE CONNU DU DÉPÔT (CONTRIBUTING.md) : `pg` réduit un timestamptz en
-- Date JS et perd la microseconde — l'endpoint de liste doit lire cree_le::text et construire son
-- curseur avec valeurCurseurTimestamptz(), JAMAIS comparer des Date JS. Contrainte sur le code de
-- lecture (apps/api/src/rendezvous/, hors périmètre de ce fichier), pas sur cet index.
create index rendez_vous_pagination_idx on public.rendez_vous (tenant_id, cree_le desc, id desc);

revoke all                    on public.rendez_vous from dfa_app;
grant  select, insert, update on public.rendez_vous to   dfa_app;
revoke delete                 on public.rendez_vous from dfa_app;

alter table public.rendez_vous enable row level security;
alter table public.rendez_vous force  row level security;

create policy rendez_vous_isolation_tenant on public.rendez_vous
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy rendez_vous_migrator on public.rendez_vous
  to dfa_migrator
  using (true) with check (true);


-- ---------------------------------------------------------------------------------------------
-- 3. Irréversibilité des états terminaux (conception §4). Seul invariant que la base fait tenir ;
--    l'orchestration (qui déclenche honore/absent/annule, depuis quel geste métier) est applicative.
-- ---------------------------------------------------------------------------------------------

create function public.rendez_vous_empecher_reouverture() returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $fn$
begin
  if old.statut in ('honore', 'absent', 'annule') and new.statut is distinct from old.statut then
    raise exception using
      errcode = 'ZDFA1',
      message = format(
        'rendez_vous : impossible de rouvrir un rendez-vous à l''état terminal (%s).',
        old.statut
      ),
      detail = format('entite=rendez_vous;entite_id=%s;statut_actuel=%s', old.id, old.statut);
  end if;
  return new;
end
$fn$;

comment on function public.rendez_vous_empecher_reouverture() is
  'Trigger BEFORE UPDATE : un état terminal (honore/absent/annule) ne redevient jamais actif '
  '(conception §4). N''interdit pas de corriger un autre champ après coup (ex. motif_annulation) — '
  'seule la résurrection du statut est bloquée. SQLSTATE ZDFA1.';

revoke all on function public.rendez_vous_empecher_reouverture() from public;

create trigger rendez_vous_empecher_reouverture
  before update on public.rendez_vous
  for each row execute function public.rendez_vous_empecher_reouverture();


-- ---------------------------------------------------------------------------------------------
-- 4. Audit — entite_auditee gagne rendez_vous, trigger posé dans la même transaction (sûr, voir
--    l'en-tête, même raisonnement que 0033/0043 : rendez_vous ne participe pas à
--    transition_autorisee).
-- ---------------------------------------------------------------------------------------------

alter type public.entite_auditee add value if not exists 'rendez_vous';

create trigger rendez_vous_audit
  after insert or update or delete on public.rendez_vous
  for each row execute function public.auditer_atelier('rendez_vous');


-- ---------------------------------------------------------------------------------------------
-- 5. ordre_reparation.rendez_vous_id — vraie FK, NOT VALID puis VALIDATE (conception §6/§8 : table
--    vide aujourd'hui, coût nul, geste par défaut sur une table aussi chaude).
-- ---------------------------------------------------------------------------------------------

alter table public.ordre_reparation
  add constraint ordre_reparation_fk_rendez_vous
  foreign key (tenant_id, rendez_vous_id)
  references public.rendez_vous (tenant_id, id)
  on delete restrict
  not valid;

alter table public.ordre_reparation
  validate constraint ordre_reparation_fk_rendez_vous;

create index ordre_reparation_rendez_vous_idx
  on public.ordre_reparation (tenant_id, rendez_vous_id)
  where rendez_vous_id is not null;


-- ---------------------------------------------------------------------------------------------
-- 6. Assertions de fin de migration.
-- ---------------------------------------------------------------------------------------------

do $$
begin
  -- 1. Table présente.
  if to_regclass('public.rendez_vous') is null then
    raise exception '0052 : table rendez_vous absente après migration.';
  end if;

  -- 2. Colonnes clés bien typées / nullables.
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'rendez_vous'
       and column_name = 'motif_id' and is_nullable = 'NO' and data_type = 'uuid'
  ) then
    raise exception '0052 : rendez_vous.motif_id absente, nullable, ou de mauvais type.';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'rendez_vous'
       and column_name = 'vehicule_id' and is_nullable = 'YES' and data_type = 'uuid'
  ) then
    raise exception '0052 : rendez_vous.vehicule_id absente, non-nullable, ou de mauvais type.';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'rendez_vous'
       and column_name = 'commentaire' and is_nullable = 'YES' and data_type = 'text'
  ) then
    raise exception '0052 : rendez_vous.commentaire absente, non-nullable, ou de mauvais type.';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'rendez_vous'
       and column_name = 'duree_estimee_minutes' and is_nullable = 'NO'
  ) then
    raise exception '0052 : rendez_vous.duree_estimee_minutes absente ou nullable.';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'rendez_vous'
       and column_name = 'heure_souhaitee' and is_nullable = 'YES' and data_type = 'time without time zone'
  ) then
    raise exception '0052 : rendez_vous.heure_souhaitee absente, non-nullable, ou de mauvais type.';
  end if;

  -- 3. CHECK posées.
  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conname = 'rendez_vous_duree_positive_chk' and conrelid = 'public.rendez_vous'::regclass
  ) then
    raise exception '0052 : rendez_vous_duree_positive_chk absente après migration.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conname = 'rendez_vous_annulation_motif_chk' and conrelid = 'public.rendez_vous'::regclass
  ) then
    raise exception '0052 : rendez_vous_annulation_motif_chk absente après migration.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conname = 'rendez_vous_terminal_le_coherent_chk' and conrelid = 'public.rendez_vous'::regclass
  ) then
    raise exception '0052 : rendez_vous_terminal_le_coherent_chk absente après migration.';
  end if;

  -- 4. Index présents.
  if not exists (
    select 1 from pg_catalog.pg_indexes
     where schemaname = 'public' and tablename = 'rendez_vous' and indexname = 'rendez_vous_agenda_idx'
  ) then
    raise exception '0052 : index rendez_vous_agenda_idx absent après migration.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_indexes
     where schemaname = 'public' and tablename = 'rendez_vous' and indexname = 'rendez_vous_actifs_idx'
  ) then
    raise exception '0052 : index rendez_vous_actifs_idx absent après migration.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_indexes
     where schemaname = 'public' and tablename = 'rendez_vous' and indexname = 'rendez_vous_pagination_idx'
  ) then
    raise exception '0052 : index rendez_vous_pagination_idx absent après migration.';
  end if;

  -- 5. RLS activée ET forcée.
  if not exists (
    select 1 from pg_catalog.pg_class
     where relname = 'rendez_vous' and relnamespace = 'public'::regnamespace
       and relrowsecurity and relforcerowsecurity
  ) then
    raise exception '0052 : rendez_vous n''a pas RLS activée et forcée.';
  end if;

  -- 6. Policies présentes.
  if not exists (
    select 1 from pg_catalog.pg_policies
     where schemaname = 'public' and tablename = 'rendez_vous' and policyname = 'rendez_vous_isolation_tenant'
  ) then
    raise exception '0052 : policy rendez_vous_isolation_tenant absente après migration.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_policies
     where schemaname = 'public' and tablename = 'rendez_vous' and policyname = 'rendez_vous_migrator'
  ) then
    raise exception '0052 : policy rendez_vous_migrator absente après migration.';
  end if;

  -- 7. dfa_app n'a pas DELETE.
  if has_table_privilege('dfa_app', 'public.rendez_vous', 'DELETE') then
    raise exception '0052 : rendez_vous doit interdire DELETE à dfa_app.';
  end if;

  if not has_table_privilege('dfa_app', 'public.rendez_vous', 'UPDATE') then
    raise exception '0052 : rendez_vous doit accorder UPDATE à dfa_app (déplacement de créneau).';
  end if;

  -- 8. Trigger d'audit présent, pointant vers auditer_atelier(), AFTER INSERT/UPDATE/DELETE FOR
  --    EACH ROW.
  if not exists (
    select 1
      from pg_catalog.pg_trigger tg
      join pg_catalog.pg_class c on c.oid = tg.tgrelid
      join pg_catalog.pg_proc p on p.oid = tg.tgfoid
     where c.relname = 'rendez_vous'
       and tg.tgname = 'rendez_vous_audit'
       and p.proname = 'auditer_atelier'
       and not tg.tgisinternal
       and (tg.tgtype & 1) = 1
       and (tg.tgtype & 2) = 0
       and (tg.tgtype & 4) = 4
       and (tg.tgtype & 8) = 8
       and (tg.tgtype & 16) = 16
  ) then
    raise exception '0052 : trigger rendez_vous_audit absent, ne pointe pas vers auditer_atelier(), ou n''est pas exactement AFTER INSERT OR UPDATE OR DELETE FOR EACH ROW.';
  end if;

  -- 9. entite_auditee porte la nouvelle valeur.
  if not exists (
    select 1
      from pg_catalog.pg_enum e
      join pg_catalog.pg_type t on t.oid = e.enumtypid
     where t.typname = 'entite_auditee' and e.enumlabel = 'rendez_vous'
  ) then
    raise exception '0052 : entite_auditee ne porte pas la valeur rendez_vous après migration.';
  end if;

  -- 10. touche_modifie_le posé.
  if not exists (
    select 1
      from pg_catalog.pg_trigger tg
      join pg_catalog.pg_class c on c.oid = tg.tgrelid
     where c.relname = 'rendez_vous' and tg.tgname = 'rendez_vous_touche_modifie_le'
       and not tg.tgisinternal
  ) then
    raise exception '0052 : trigger rendez_vous_touche_modifie_le absent après migration.';
  end if;

  -- 11. Trigger d'irréversibilité posé, BEFORE UPDATE FOR EACH ROW.
  if not exists (
    select 1
      from pg_catalog.pg_trigger tg
      join pg_catalog.pg_class c on c.oid = tg.tgrelid
      join pg_catalog.pg_proc p on p.oid = tg.tgfoid
     where c.relname = 'rendez_vous'
       and tg.tgname = 'rendez_vous_empecher_reouverture'
       and p.proname = 'rendez_vous_empecher_reouverture'
       and not tg.tgisinternal
       and (tg.tgtype & 1) = 1
       and (tg.tgtype & 2) = 2
       and (tg.tgtype & 16) = 16
  ) then
    raise exception '0052 : trigger rendez_vous_empecher_reouverture absent, ne pointe pas vers la bonne fonction, ou n''est pas exactement BEFORE UPDATE FOR EACH ROW.';
  end if;

  -- 12. FK ordre_reparation -> rendez_vous VALIDÉE (pas seulement posée).
  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conname = 'ordre_reparation_fk_rendez_vous'
       and conrelid = 'public.ordre_reparation'::regclass
       and convalidated
  ) then
    raise exception '0052 : ordre_reparation_fk_rendez_vous absente ou non validée après migration.';
  end if;

  -- 13. Index partiel ordre_reparation_rendez_vous_idx présent.
  if not exists (
    select 1 from pg_catalog.pg_indexes
     where schemaname = 'public' and tablename = 'ordre_reparation'
       and indexname = 'ordre_reparation_rendez_vous_idx'
  ) then
    raise exception '0052 : index ordre_reparation_rendez_vous_idx absent après migration.';
  end if;
end
$$;
