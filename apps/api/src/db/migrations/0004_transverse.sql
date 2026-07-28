-- =============================================================================================
-- 0004_transverse.sql — L1-04 : audit générique, idempotence, outbox
--
-- Trois tables transverses dont toutes les migrations métier qui suivent (0005→0008) ont besoin :
--   1. `audit_atelier` — piste d'audit générique (RM-59, RM-111), PARTITIONNÉE PAR MOIS dès la
--      création (§5.3 du plan d'exécution) ;
--   2. `cle_idempotence` — rejeu sans double effet des créations sensibles (contrat §2.9) ;
--   3. `evenement_metier` — outbox (§1.6 du plan d'exécution) : l'écriture est livrée au lot 1,
--      l'émission HTTP ne l'est pas.
--
-- Les enums `entite_auditee` / `action_auditee` existent déjà (0003 §3). Créer ici uniquement
-- `type_evenement_metier`, propre à l'outbox.
--
-- NUMÉROTATION : L1-04 du plan d'exécution devient 0004 (0003 est déjà pris par les préalables).
-- Réversible : migrations/down/0004_transverse.down.sql.
-- =============================================================================================


-- ---------------------------------------------------------------------------------------------
-- 1. `type_evenement_metier` — catalogue complet de l'outbox
--
-- Dérivé de `packages/shared/src/contrats/atelier/evenement.ts` (TYPES_EVENEMENT_METIER),
-- SOURCE UNIQUE. Le catalogue contient des types non émis au lot 1 (rendez-vous, pointage) et
-- des types RÉSERVÉS à l'étape 2 (`facture.emise`, `facture.payee`, `avoir.emis`) : les nommer
-- ici réserve le nom, un type émis non déclaré serait un bug de contrat, un type déclaré non
-- émis ne coûte rien.
-- ---------------------------------------------------------------------------------------------

create type public.type_evenement_metier as enum (
  'ordre_reparation.ouvert',
  'ordre_reparation.termine',
  'ordre_reparation.restitue',
  'ordre_reparation.cloture',
  'ordre_reparation.annule',
  'ligne_or.constatee',
  'devis_complementaire.envoye',
  'devis_complementaire.repondu',
  'rendez_vous.honore',
  'rendez_vous.absent',
  'rendez_vous.reporte',
  'vehicule.detenteur_change',
  'vehicule.kilometrage_releve',
  'pointage.anomalie_detectee',
  'client.fusionne',
  'facture.emise',
  'facture.payee',
  'avoir.emis'
);


-- ---------------------------------------------------------------------------------------------
-- 2. `audit_atelier` — piste d'audit générique, PARTITIONNÉE PAR MOIS
--
-- PK `(id, cree_le)` et non `id` seul : une contrainte de PK/UNIQUE sur une table partitionnée
-- par `range` DOIT inclure la clé de partition. Conséquence assumée et documentée :
-- `audit_atelier` NE PORTE PAS `unique (tenant_id, id)` — impossible sans y inclure `cree_le`, et
-- de toute façon sans objet : cette table n'est la cible d'AUCUNE clé étrangère. Que personne ne
-- « corrige » cet écart à la convention 2.1 : c'est la table elle-même qui est l'exception.
--
-- Append-only par PRIVILÈGE, pas par discipline : `GRANT SELECT, INSERT` seul. Une piste d'audit
-- modifiable ne vaut rien.
-- ---------------------------------------------------------------------------------------------

create table public.audit_atelier (
  id             uuid              not null default gen_random_uuid(),
  tenant_id      uuid              not null references public.tenant (id) on delete restrict,
  entite         public.entite_auditee not null,
  entite_id      uuid              not null,
  action         public.action_auditee not null,
  -- NULL = snapshot de ligne entière (le cas courant, posé par le trigger générique §4). Un
  -- service qui veut journaliser UN champ précis (ex. changement de plafond, CT-31) le renseigne
  -- explicitement dans un INSERT direct.
  champ          text              null,
  valeur_avant   jsonb             null,
  valeur_apres   jsonb             null,
  utilisateur_id uuid              null,
  requete_id     text              null,
  cree_le        timestamptz       not null default now(),

  constraint audit_atelier_pk primary key (id, cree_le)
)
partition by range (cree_le);

comment on table public.audit_atelier is
  'Piste d''audit générique (RM-59, RM-111) : qui, quoi, quand, valeurs avant/après. '
  'PARTITIONNÉE PAR MOIS (cree_le) : voir 0004_transverse.sql §2-3. Pas de unique (tenant_id, id) '
  '— impossible sans inclure la clé de partition, et cette table n''est cible d''aucune FK. '
  'append-only par privilège : dfa_app n''a que SELECT, INSERT.';

revoke all    on public.audit_atelier from dfa_app;
grant  select, insert on public.audit_atelier to dfa_app;

alter table public.audit_atelier enable row level security;
alter table public.audit_atelier force  row level security;

create policy audit_atelier_isolation_tenant on public.audit_atelier
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

-- Sans elle, FORCE empêcherait dfa_migrator d'écrire dans cette table — or le trigger générique
-- (§4) s'exécute aussi bien lors d'un INSERT applicatif (dfa_app) que lors d'un seed ou d'une
-- migration de données exécutés en dfa_migrator (§4).
create policy audit_atelier_migrator on public.audit_atelier
  to dfa_migrator
  using (true) with check (true);


-- ---------------------------------------------------------------------------------------------
-- 3. Partitions — 24 mois pré-créés (2026-01 → 2027-12) + une partition DEFAULT
--
-- PIÈGE B du plan (§5.3), le plus sérieux de tout ce plan : une partition créée par
-- `create table … partition of` n'hérite NI des politiques de sa mère NI de FORCE — mais hérite
-- bien des PRIVILÈGES accordés par les `default privileges`. Sans le `revoke all` posé sur
-- CHACUNE, `select * from audit_atelier_2026_08` interrogé directement par dfa_app rendrait les
-- lignes de TOUS les tenants, RLS de la mère ou pas.
--
-- Chaque partition reçoit donc, à la création :
--   - `revoke all from dfa_app` (R3 — la vraie frontière, un privilège absent ne se contourne pas) ;
--   - `enable` + `force` + une politique isolante identique à celle de la mère (exigé par
--     `verifierPostureRls()`, qui juge une partition comme n'importe quelle table — voir
--     acces-base.service.ts) ;
--   - une politique `_migrator`, pour la même raison que sur la mère.
--
-- Bornes CALENDAIRES fixes et non relatives à `now()` : une migration doit produire EXACTEMENT
-- la même structure qu'elle soit appliquée aujourd'hui ou dans deux ans sur une base restaurée.
-- Un `now()`-relatif romprait l'immuabilité des migrations appliquées.
--
-- Aucun job mensuel n'est livré au lot 1 (il arrive au lot 3) : la partition DEFAULT garantit
-- qu'aucune écriture d'audit ne peut échouer au-delà de 2027-12, y compris si personne n'a créé
-- de nouvelle partition à temps — c'est le seul endroit du produit où une piste d'audit qui
-- échoue bloquerait un garage.
-- ---------------------------------------------------------------------------------------------

do $$
declare
  i           integer;
  debut_mois  date;
  fin_mois    date;
  nom         text;
begin
  for i in 0..23 loop
    debut_mois := (date '2026-01-01' + make_interval(months => i));
    fin_mois   := (debut_mois + interval '1 month')::date;
    nom        := 'audit_atelier_' || to_char(debut_mois, 'YYYY_MM');

    execute format(
      'create table public.%I partition of public.audit_atelier for values from (%L) to (%L)',
      nom, debut_mois, fin_mois
    );
    execute format('revoke all on public.%I from dfa_app', nom);
    execute format('alter table public.%I enable row level security', nom);
    execute format('alter table public.%I force row level security', nom);
    execute format(
      'create policy %I on public.%I to dfa_app using (tenant_id = public.tenant_courant()) with check (tenant_id = public.tenant_courant())',
      nom || '_isolation_tenant', nom
    );
    execute format(
      'create policy %I on public.%I to dfa_migrator using (true) with check (true)',
      nom || '_migrator', nom
    );
  end loop;
end
$$;

create table public.audit_atelier_default partition of public.audit_atelier default;
revoke all on public.audit_atelier_default from dfa_app;
alter table public.audit_atelier_default enable row level security;
alter table public.audit_atelier_default force  row level security;

create policy audit_atelier_default_isolation_tenant on public.audit_atelier_default
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy audit_atelier_default_migrator on public.audit_atelier_default
  to dfa_migrator
  using (true) with check (true);

-- Index posé APRÈS les partitions : sur une table partitionnée, `create index` sur le parent crée
-- récursivement l'index correspondant sur CHAQUE partition existante, et toute partition future
-- attachée avec `partition of` en hérite automatiquement. Le poser avant les partitions n'aurait
-- rien cassé, mais l'ordre choisi rend visible que l'index couvre bien les 25 partitions déjà là.
create index audit_atelier_recherche_idx
  on public.audit_atelier (tenant_id, entite, entite_id, cree_le desc);


-- ---------------------------------------------------------------------------------------------
-- 4. `auditer_atelier()` — trigger générique AFTER INSERT/UPDATE/DELETE
--
-- Posé table par table dans les migrations 0006→0008, avec l'entité en argument, sur le même
-- modèle que `verifier_transition()` (0003 §6) : `create trigger … execute function
-- public.auditer_atelier('<entite_auditee>')`.
--
-- Le `tenant_id` de la ligne d'audit vient de NEW/OLD, JAMAIS de `tenant_courant()` (consigne du
-- plan) : un trigger générique doit produire une ligne d'audit correcte même appelé hors contexte
-- applicatif (script de reprise, correction en dfa_migrator).
--
-- Action déduite : `creation` (INSERT), `annulation` (DELETE — chemin défensif, `dfa_app` n'a de
-- toute façon jamais GRANT DELETE sur les tables auditées), et pour UPDATE : `transition` si la
-- ligne porte une colonne `statut` qui a changé, `modification` sinon. `fusion` n'est JAMAIS émis
-- par ce trigger — c'est une action métier explicite, insérée par le service (RM-06/RM-32) qui a
-- SELECT+INSERT comme toute la couche applicative sur cette table.
--
-- SECURITY INVOKER (le défaut, explicite) : la ligne d'audit s'écrit avec les droits de
-- l'appelant (dfa_app ou dfa_migrator), soumise à la politique RLS d'`audit_atelier` — cohérent
-- puisque la ligne source a déjà satisfait la même politique sur sa propre table.
-- ---------------------------------------------------------------------------------------------

create function public.auditer_atelier() returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $fn$
declare
  entite_cible    public.entite_auditee;
  action_calculee public.action_auditee;
begin
  if tg_nargs < 1 or tg_argv[0] is null then
    raise exception
      'auditer_atelier() posée sans argument sur « % ». Attendu : create trigger … execute function public.auditer_atelier(''<entite_auditee>'').',
      tg_table_name;
  end if;
  entite_cible := tg_argv[0]::public.entite_auditee;

  if tg_op = 'INSERT' then
    insert into public.audit_atelier
      (tenant_id, entite, entite_id, action, valeur_avant, valeur_apres, utilisateur_id, requete_id)
    values
      (new.tenant_id, entite_cible, new.id, 'creation', null, to_jsonb(new),
       public.utilisateur_courant(), public.requete_courante());
    return new;

  elsif tg_op = 'UPDATE' then
    if (to_jsonb(new) ? 'statut')
       and (to_jsonb(old) ->> 'statut') is distinct from (to_jsonb(new) ->> 'statut') then
      action_calculee := 'transition';
    else
      action_calculee := 'modification';
    end if;

    insert into public.audit_atelier
      (tenant_id, entite, entite_id, action, valeur_avant, valeur_apres, utilisateur_id, requete_id)
    values
      (new.tenant_id, entite_cible, new.id, action_calculee, to_jsonb(old), to_jsonb(new),
       public.utilisateur_courant(), public.requete_courante());
    return new;

  elsif tg_op = 'DELETE' then
    -- Chemin défensif : aucune table auditée ne donne DELETE à dfa_app. S'il est emprunté malgré
    -- tout (script de reprise en dfa_migrator), la trace reste posée plutôt que silencieusement
    -- perdue.
    insert into public.audit_atelier
      (tenant_id, entite, entite_id, action, valeur_avant, valeur_apres, utilisateur_id, requete_id)
    values
      (old.tenant_id, entite_cible, old.id, 'annulation', to_jsonb(old), null,
       public.utilisateur_courant(), public.requete_courante());
    return old;
  end if;

  return null;
end
$fn$;

comment on function public.auditer_atelier() is
  'Trigger AFTER INSERT/UPDATE/DELETE générique : écrit une ligne dans audit_atelier. tenant_id '
  'pris de NEW/OLD, jamais de tenant_courant(). Voir 0004_transverse.sql §4.';

revoke all     on function public.auditer_atelier() from public;
-- dfa_migrator ET dfa_app : le seed (dfa_migrator) crée des clients et des véhicules dont les
-- INSERT font partir ce trigger dès que les tables 0006/0007 le posent.
grant  execute on function public.auditer_atelier() to   dfa_app, dfa_migrator;


-- ---------------------------------------------------------------------------------------------
-- 5. `cle_idempotence` — rejeu sans double effet (contrat §2.9)
--
-- Cycle de vie : INSERT à `en_cours` avant d'exécuter la commande (`on conflict … do nothing`,
-- atomique — c'est ce qui départage deux requêtes concurrentes sans verrou explicite), UPDATE vers
-- `termine` avec la réponse une fois l'écriture faite — d'où `GRANT UPDATE`, à la différence des
-- tables append-only ci-dessus. `empreinte_requete` permet de distinguer un rejeu identique (même
-- clé, même corps : on renvoie la réponse mémorisée) d'une réutilisation fautive de la clé (même
-- clé, corps différent : conflit).
--
-- `methode` + `chemin` séparés, et NON un `endpoint` unique : `ServiceIdempotenceImpl` (L1-06,
-- `common/idempotence/service-idempotence.ts`) pose `on conflict (tenant_id, methode, chemin,
-- cle) do nothing`, qui exige une contrainte UNIQUE portant EXACTEMENT ces colonnes — Postgres
-- refuse un `ON CONFLICT` qui ne correspond à aucune contrainte existante. Noms alignés sur
-- `plan-lot1-execution.md` §L1-04, dont ce service assume déjà le SQL brut.
-- ---------------------------------------------------------------------------------------------

create table public.cle_idempotence (
  id                uuid        not null default gen_random_uuid(),
  tenant_id         uuid        not null references public.tenant (id) on delete restrict,
  methode           text        not null,
  chemin            text        not null,
  cle               text        not null,
  empreinte_requete bytea       not null,
  statut            text        not null default 'en_cours',
  statut_http       smallint    null,
  reponse           jsonb       null,
  cree_le           timestamptz not null default now(),
  modifie_le        timestamptz not null default now(),
  expire_le         timestamptz not null,

  constraint cle_idempotence_pk primary key (id),
  constraint cle_idempotence_tenant_id_uk unique (tenant_id, id),
  -- Cible EXACTE du `on conflict` du service — voir le commentaire ci-dessus.
  constraint cle_idempotence_uk unique (tenant_id, methode, chemin, cle),
  constraint cle_idempotence_statut_chk check (statut in ('en_cours', 'termine')),
  constraint cle_idempotence_statut_http_chk
    check (statut_http is null or statut_http between 100 and 599),
  constraint cle_idempotence_reponse_coherente_chk
    check ((statut = 'en_cours') = (statut_http is null and reponse is null)),
  constraint cle_idempotence_cle_non_vide_chk check (length(btrim(cle)) > 0),
  constraint cle_idempotence_methode_non_vide_chk check (length(btrim(methode)) > 0),
  constraint cle_idempotence_chemin_non_vide_chk check (length(btrim(chemin)) > 0)
);

comment on table public.cle_idempotence is
  'Rejeu sans double effet des créations sensibles (contrat §2.9). GRANT UPDATE : le cycle passe '
  'de en_cours à termine une fois la commande exécutée. unique (tenant_id, methode, chemin, cle) '
  'est la cible du ON CONFLICT de ServiceIdempotenceImpl (L1-06) — ne pas renommer sans '
  'coordination.';

create trigger cle_idempotence_touche_modifie_le
  before update on public.cle_idempotence
  for each row execute function public.touche_modifie_le();

revoke all    on public.cle_idempotence from dfa_app;
grant  select, insert, update on public.cle_idempotence to dfa_app;
-- Δ6 : revoke delete explicite malgré 0002 (§5.2 du plan) — ceinture et bretelles.
revoke delete on public.cle_idempotence from dfa_app;

-- Sert la purge (job différé, hors lot 1) des clés expirées sans scanner toute la table.
create index cle_idempotence_expiration_idx on public.cle_idempotence (tenant_id, expire_le);

alter table public.cle_idempotence enable row level security;
alter table public.cle_idempotence force  row level security;

create policy cle_idempotence_isolation_tenant on public.cle_idempotence
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy cle_idempotence_migrator on public.cle_idempotence
  to dfa_migrator
  using (true) with check (true);


-- ---------------------------------------------------------------------------------------------
-- 6. `evenement_metier` — outbox (§1.6 du plan d'exécution)
--
-- Écrite dans la MÊME TRANSACTION que la transition qui la produit — `ServiceEvenementsImpl`
-- (L1-06, `common/evenements/service-evenements.ts`) reçoit la transaction APPELANTE (`tx:
-- TransactionDfa`) et n'en ouvre jamais la sienne : c'est ce qui garantit qu'un événement et la
-- donnée qu'il décrit sont commités ensemble ou pas du tout. Cette table n'a donc aucune
-- contrainte DIFFÉRÉE ni aucun trigger ouvrant une sous-transaction — l'un ou l'autre casserait
-- cette garantie. L'émission HTTP n'est pas livrée au lot 1. Append-only par privilège, comme
-- `audit_atelier` : un événement déjà écrit ne se corrige pas, il se complète par un suivant.
--
-- Noms `ressource_type` / `ressource_numero` / `donnees` — et non `ressource` / `charge_utile` —
-- alignés sur ce que `ServiceEvenementsImpl` écrit déjà (dérivés du contrat gelé
-- `EnveloppeEvenementMetier`, `@dfa/shared`). `id` n'est jamais fourni par ce service : le défaut
-- `gen_random_uuid()` fait foi.
-- ---------------------------------------------------------------------------------------------

create table public.evenement_metier (
  id              uuid        not null default gen_random_uuid(),
  tenant_id       uuid        not null references public.tenant (id) on delete restrict,
  -- Site d'origine, quand l'entité en porte un ; renseigné par le service producteur, sans FK :
  -- toutes les entités auditées n'ont pas un site_id direct (ex. client).
  site_id         uuid        null,
  type            public.type_evenement_metier not null,
  ressource_type  text        not null,
  ressource_id    uuid        not null,
  -- Numéro métier lisible (n° d'OR, n° de client) quand la ressource en porte un — miroir de
  -- `EnveloppeEvenementMetier.ressource.numero`, facultatif par nature.
  ressource_numero text       null,
  survenu_le      timestamptz not null default now(),
  version_schema  smallint    not null default 1,
  donnees         jsonb       not null,
  cree_le         timestamptz not null default now(),

  constraint evenement_metier_pk primary key (id),
  constraint evenement_metier_tenant_id_uk unique (tenant_id, id),
  constraint evenement_metier_ressource_type_non_vide_chk check (length(btrim(ressource_type)) > 0),
  constraint evenement_metier_version_schema_chk check (version_schema > 0)
);

comment on table public.evenement_metier is
  'Outbox transactionnelle des événements métier (§1.6 du plan d''exécution du lot 1). Écrite '
  'dans la transaction REÇUE par ServiceEvenementsImpl (L1-06), jamais dans une transaction '
  'propre — aucune contrainte différée, aucun trigger ne doit changer cela. Émission HTTP hors '
  'lot 1. append-only par privilège : dfa_app n''a que SELECT, INSERT.';

revoke all    on public.evenement_metier from dfa_app;
grant  select, insert on public.evenement_metier to dfa_app;

create index evenement_metier_pagination_idx
  on public.evenement_metier (tenant_id, cree_le desc, id desc);
create index evenement_metier_ressource_idx
  on public.evenement_metier (tenant_id, ressource_type, ressource_id, survenu_le desc);

alter table public.evenement_metier enable row level security;
alter table public.evenement_metier force  row level security;

create policy evenement_metier_isolation_tenant on public.evenement_metier
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy evenement_metier_migrator on public.evenement_metier
  to dfa_migrator
  using (true) with check (true);


-- ---------------------------------------------------------------------------------------------
-- 7. Assertions de fin de migration
-- ---------------------------------------------------------------------------------------------

do $$
declare
  n integer;
  fautives text;
begin
  -- 7.1 25 partitions attendues (24 mensuelles + DEFAULT).
  select count(*) into n
    from pg_catalog.pg_inherits h
    join pg_catalog.pg_class c on c.oid = h.inhrelid
   where h.inhparent = 'public.audit_atelier'::regclass;
  if n <> 25 then
    raise exception 'audit_atelier : % partitions trouvées, 25 attendues (24 mois + DEFAULT).', n;
  end if;

  -- 7.2 Aucune partition ne laisse le moindre privilège à dfa_app (R3).
  select string_agg(c.relname, ', ' order by c.relname) into fautives
    from pg_catalog.pg_inherits h
    join pg_catalog.pg_class c on c.oid = h.inhrelid
   where h.inhparent = 'public.audit_atelier'::regclass
     and (
       has_table_privilege('dfa_app', c.oid, 'SELECT') or
       has_table_privilege('dfa_app', c.oid, 'INSERT') or
       has_table_privilege('dfa_app', c.oid, 'UPDATE') or
       has_table_privilege('dfa_app', c.oid, 'DELETE')
     );
  if fautives is not null then
    raise exception 'audit_atelier : partitions avec un privilège résiduel pour dfa_app : %.', fautives;
  end if;

  -- 7.3 Chaque partition porte RLS + FORCE (jugée comme n'importe quelle table par
  -- verifierPostureRls() — voir acces-base.service.ts).
  select string_agg(c.relname, ', ' order by c.relname) into fautives
    from pg_catalog.pg_inherits h
    join pg_catalog.pg_class c on c.oid = h.inhrelid
   where h.inhparent = 'public.audit_atelier'::regclass
     and not (c.relrowsecurity and c.relforcerowsecurity);
  if fautives is not null then
    raise exception 'audit_atelier : partitions sans RLS+FORCE : %.', fautives;
  end if;

  if not has_table_privilege('dfa_app', 'public.cle_idempotence', 'SELECT')
     or not has_table_privilege('dfa_app', 'public.cle_idempotence', 'UPDATE') then
    raise exception 'cle_idempotence : privilèges attendus (SELECT, INSERT, UPDATE) manquants pour dfa_app.';
  end if;
  if has_table_privilege('dfa_app', 'public.cle_idempotence', 'DELETE') then
    raise exception 'cle_idempotence : DELETE ne devrait pas être accordé à dfa_app.';
  end if;

  if has_table_privilege('dfa_app', 'public.evenement_metier', 'UPDATE')
     or has_table_privilege('dfa_app', 'public.evenement_metier', 'DELETE') then
    raise exception 'evenement_metier : dfa_app ne devrait avoir que SELECT, INSERT.';
  end if;
end
$$;
