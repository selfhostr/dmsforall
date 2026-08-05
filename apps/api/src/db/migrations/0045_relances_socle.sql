-- =============================================================================================
-- 0045_relances_socle.sql — Relances automatiques, Lot 1 (facturation, rappel #2), socle.
-- Spécification : docs/specification-relances-automatiques.md — §5 (modèle de données), §6
-- (idempotence/échec), §8 (machine à états).
--
-- NUMÉROTATION : 0044 est la dernière migration existante au moment où cette tâche a été
-- assignée (`0044_vehicule_emplacement_libre.sql`) — vérifié en exécution (`ls
-- apps/api/src/db/migrations/`, `git ls-tree` sur toutes les branches distantes) avant d'écrire
-- ce fichier : aucun `0045_*` préexistant nulle part. Cette migration prend 0045.
--
-- CE QUI EST POSÉ ICI :
--   1. Six types enum — miroir exact de `packages/shared/src/contrats/relances/enums.ts` :
--      `type_relance` (9 valeurs, tout le catalogue §2, même si seule `facture_echue` a un
--      service dans ce lot — évite une migration `ALTER TYPE` par lot suivant),
--      `objet_type_relance` (6), `statut_relance_planifiee` (6, §8), `raison_annulation_relance`
--      (5), `canal_relance` (2 — valeurs de `CANAUX_MESSAGE_CLIENT`, nom de type PG distinct,
--      voir `schema/relances/enums.ts` pour la justification), `statut_envoi_relance` (2).
--   1bis. `smallint_array_tous_positifs()` — fonction utilitaire, seul moyen d'exprimer « tous
--      les éléments de delais_jours sont positifs » en CHECK : constaté en exécution qu'une
--      sous-requête directement dans un CHECK échoue (« cannot use subquery in check
--      constraint ») — voir §F ci-dessous.
--   2. `regle_relance` — config par tenant, une ligne par type (§5, §4).
--   3. `relance_planifiee` — une ligne par occasion (type + objet + palier), SOURCE DE VÉRITÉ DE
--      L'IDEMPOTENCE (RA-05, §6.1) via `relance_planifiee_tenant_type_objet_palier_uk`.
--   4. `relance_envoi` — APPEND-ONLY, une ligne par tentative d'envoi (§6.2/§6.4, RA-12).
--   5. `client` gagne `plus_aucun_contact`/`motif` (RA-14, §5 : « pas de table séparée… une
--      colonne … sur client »). Voir §D de cet en-tête pour la justification de toucher une
--      table hors du répertoire `db/schema/relances/` de ce lot.
--   6. `entite_auditee` gagne `relance_planifiee` + trigger d'audit dans la même transaction —
--      même patron que `depot_pneus` (0043) : `relance_planifiee` ne participe PAS au dispositif
--      `transition_autorisee` (0003), donc rien ne COMPARE la valeur neuve avant le COMMIT de
--      cette migration.
--
-- DÉCISIONS TRANCHÉES ICI (documentées, pas silencieuses) :
--
--   A. POURQUOI `relance_envoi` N'EST PAS DANS `entite_auditee` — append-only par construction
--      (aucun UPDATE, aucun DELETE accordés à `dfa_app`, voir §D des GRANT ci-dessous) : le
--      bénéfice de l'audit générique (reconstituer un avant/après sur UPDATE/DELETE) n'existe
--      pas ici, la ligne EST déjà sa propre preuve. Même choix que `client_consentement`
--      (0006), qui n'est pas non plus dans `entite_auditee`.
--
--   B. POURQUOI `relance_planifiee` EST DANS `entite_auditee` — cycle de vie réel (§8 : six
--      statuts, quatre voies d'annulation automatique) et `annule_raison` seul ne dit pas QUI
--      (ou quel job) a déclenché la transition ni QUAND exactement au-delà de `modifie_le` — la
--      même remarque que `depot_pneus` (RPP-02→RPP-05, 0043) : un rappel envoyé à un client est
--      une entité sensible (consigne de la tâche : « un rappel envoyé deux fois est pire que pas
--      de rappel » — la preuve du contraire doit être reconstituable).
--
--   C. `objet_id` (relance_planifiee) SANS FK — polymorphe par construction (`objet_type` dit
--      quelle table), même patron que `audit_atelier.entite_id`. Une FK composite par valeur
--      d'`objet_type` n'existe pas en PostgreSQL (une FK cible UNE seule table) ; la vérification
--      de l'état réel de l'objet est de toute façon exigée À L'EXÉCUTION par RA-08/RA-09 (pas
--      seulement à la planification), donc portée par le service applicatif, pas par une
--      contrainte FK qui ne pourrait de toute façon pas être conditionnelle par type.
--
--   D. `client.plus_aucun_contact`/`client.motif` (RA-14) — POURQUOI CETTE MIGRATION Y TOUCHE
--      bien que `db/schema/atelier/client.ts` (le fichier Drizzle correspondant) soit HORS du
--      périmètre d'écriture déclaré de cet agent (`apps/api/src/db/schema/relances/**`
--      exclusivement) : la migration `0045` elle-même — TOUT son contenu SQL, quelle que soit la
--      table qu'elle touche — est explicitement assignée à cet agent (« la migration 0045 et
--      elle seule »), et RA-14 (« un interrupteur … plus fort que RA-01/RA-02 ») n'a, par
--      construction de la spec (§5, dernier paragraphe), pas d'autre emplacement que `client`
--      lui-même. SIGNALÉ, PAS FAIT ICI : le fichier `schema/atelier/client.ts` (mapping Drizzle
--      typé de ces deux colonnes) N'EST PAS mis à jour par cette migration — ce module lit/écrit
--      ces deux colonnes par `sql` brut (`apps/api/src/relances/service-relances-facture.ts`),
--      jamais via un `pgTable` étendu localement (aurait dupliqu la déclaration de `client`,
--      source de dérive). Voir le rapport de livraison pour la correction propre attendue de la
--      part du propriétaire de `clients`/`atelier`.
--
--   F. `smallint_array_tous_positifs()` — DÉCOUVERT EN EXÉCUTION en essayant d'abord
--      `check (coalesce((select bool_and(d > 0) from unnest(delais_jours) as d), true))`
--      directement dans la contrainte de table : PostgreSQL refuse toute sous-requête dans un
--      CHECK, quelle que soit sa forme (scalaire ou non, corrélée ou non). Un APPEL DE FONCTION
--      reste autorisé — le parseur de CHECK n'inspecte que la syntaxe de l'expression qu'on lui
--      donne, pas ce que la fonction appelée fait en interne. D'où l'ajout de cette fonction
--      `immutable parallel safe` en §1bis, seule différence avec une tentative naïve.
--
--   E. GRANTS — `regle_relance`/`relance_planifiee` ont un vrai cycle de vie (SELECT/INSERT/
--      UPDATE, jamais DELETE — une règle se désactive via `actif=false`, un rappel s'annule via
--      `statut='annulee'`, aucun des deux ne disparaît par DELETE). `relance_envoi` est
--      APPEND-ONLY (SELECT/INSERT seulement, §A ci-dessus).
--
-- Réversible : migrations/down/0045_relances_socle.down.sql. Le DOWN retire les trois tables (et
-- leurs index/contraintes avec elles), le trigger d'audit, les deux colonnes ajoutées à `client`,
-- et les six types enum — mais NE PEUT PAS retirer `relance_planifiee` de `entite_auditee`
-- (aucun DROP VALUE en PostgreSQL), même limite acceptée que 0010/0016/0033/0043. Résidu
-- enregistré dans `scripts/verifier-reversibilite-migrations.sh`
-- (`obtenir_exception_down_partiel`, entrée `0045_relances_socle.sql`). Migration de DONNÉES :
-- aucune — tables neuves, colonnes neuves à valeur par défaut, aucune ligne existante perdue.
-- =============================================================================================


-- ---------------------------------------------------------------------------------------------
-- 1. Types enum — miroir exact de packages/shared/src/contrats/relances/enums.ts.
-- ---------------------------------------------------------------------------------------------

create type public.type_relance as enum (
  'devis_sans_reponse',
  'facture_echue',
  'devis_complementaire_attente',
  'vehicule_pret_non_restitue',
  'depot_pneu_oublie',
  'travail_reporte_urgent',
  'pneus_saisonniers',
  'expertise_mfk',
  'campagne_constructeur'
);

create type public.objet_type_relance as enum (
  'document_vente',
  'ordre_reparation',
  'vehicule',
  'depot_pneu',
  'vehicule_campagne',
  'vehicule_travail_reporte'
);

create type public.statut_relance_planifiee as enum (
  'a_planifier', 'prete', 'en_cours_envoi', 'envoyee', 'annulee', 'echouee'
);

create type public.raison_annulation_relance as enum (
  'objet_traite', 'consentement_revoque', 'contact_absent', 'client_ne_plus_contacter',
  'vehicule_cede'
);

-- §D de l'en-tête (schema/relances/enums.ts) : valeurs de CANAUX_MESSAGE_CLIENT, nom de type PG
-- distinct puisqu'aucun type `canal_message_client` n'existe (ConnecteursModule ne persiste rien).
create type public.canal_relance as enum ('sms', 'email');

create type public.statut_envoi_relance as enum ('envoye', 'echoue');


-- ---------------------------------------------------------------------------------------------
-- 1bis. Fonction utilitaire — un CHECK ne peut pas contenir de sous-requête (`(select …)`),
--       constaté en exécution (« cannot use subquery in check constraint ») en tentant
--       `check (coalesce((select bool_and(d > 0) from unnest(delais_jours) as d), true))`
--       directement dans la contrainte. Un APPEL DE FONCTION reste autorisé, y compris quand la
--       fonction contient elle-même une requête sur `unnest()` — le parseur de CHECK ne regarde
--       que la forme syntaxique de l'expression qu'on lui donne, pas ce qu'une fonction appelée
--       fait en interne.
-- ---------------------------------------------------------------------------------------------

create function public.smallint_array_tous_positifs(valeurs smallint[]) returns boolean
language sql immutable parallel safe as $$
  select coalesce(bool_and(v > 0), true) from unnest(valeurs) as v;
$$;

comment on function public.smallint_array_tous_positifs(smallint[]) is
  'Vrai si tous les éléments de l''array sont strictement positifs, ou si l''array est vide/NULL '
  '(coalesce(…, true) : un tableau vide n''a par définition aucun élément non positif). Utilisée '
  'par regle_relance_delais_positifs_chk — un CHECK ne peut pas contenir de sous-requête, voir '
  'ci-dessus.';

revoke all     on function public.smallint_array_tous_positifs(smallint[]) from public;
grant  execute on function public.smallint_array_tous_positifs(smallint[]) to   dfa_app, dfa_migrator;


-- ---------------------------------------------------------------------------------------------
-- 2. `regle_relance` — config par tenant, une ligne par type (§5, §4).
-- ---------------------------------------------------------------------------------------------

create table public.regle_relance (
  id                      uuid                          not null default gen_random_uuid(),
  tenant_id               uuid                          not null,
  type_relance            public.type_relance           not null,
  actif                   boolean                       not null default true,
  delais_jours            smallint[]                    not null default '{}'::smallint[],
  canaux                  public.canal_relance[]        not null default '{}'::canal_relance[],
  texte_modele_id         uuid                          null,
  prereglage_applique_le  timestamptz                   null,

  cree_le                 timestamptz                   not null default now(),
  modifie_le              timestamptz                   not null default now(),

  constraint regle_relance_pk primary key (id),
  constraint regle_relance_tenant_id_uk unique (tenant_id, id),
  constraint regle_relance_tenant_type_uk unique (tenant_id, type_relance),
  constraint regle_relance_fk_tenant foreign key (tenant_id) references public.tenant (id)
    on delete restrict,

  constraint regle_relance_delais_positifs_chk
    check (public.smallint_array_tous_positifs(delais_jours))
);

comment on table public.regle_relance is
  'Configuration des relances automatiques par tenant (§4, §5) : une ligne par type_relance, '
  'actif/delais_jours/canaux modifiables librement, jamais supprimée (désactiver via actif=false). '
  'Absence de ligne pour un type = comportement inactif par défaut (fail-closed : rien ne se '
  'planifie tant qu''un garage n''a pas explicitement configuré ou activé le préréglage).';

create trigger regle_relance_touche_modifie_le
  before update on public.regle_relance
  for each row execute function public.touche_modifie_le();

revoke all                    on public.regle_relance from dfa_app;
grant  select, insert, update on public.regle_relance to   dfa_app;
revoke delete                 on public.regle_relance from dfa_app;

alter table public.regle_relance enable row level security;
alter table public.regle_relance force  row level security;

create policy regle_relance_isolation_tenant on public.regle_relance
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy regle_relance_migrator on public.regle_relance
  to dfa_migrator
  using (true) with check (true);


-- ---------------------------------------------------------------------------------------------
-- 3. `relance_planifiee` — une ligne par occasion, source de vérité de l'idempotence (RA-05).
-- ---------------------------------------------------------------------------------------------

create table public.relance_planifiee (
  id                uuid                              not null default gen_random_uuid(),
  tenant_id         uuid                              not null,
  type_relance      public.type_relance               not null,
  objet_type        public.objet_type_relance         not null,
  -- Polymorphe (§C de l'en-tête) : pas de FK, objet_type dit dans quelle table chercher.
  objet_id          uuid                              not null,
  palier            smallint                          not null,
  client_id         uuid                              not null,
  echeance_prevue   timestamptz                       not null,
  statut            public.statut_relance_planifiee   not null default 'a_planifier',
  -- Obligatoire ET UNIQUEMENT quand statut = 'annulee' — voir la CHECK ci-dessous.
  annule_raison     public.raison_annulation_relance  null,

  cree_le           timestamptz                       not null default now(),
  modifie_le        timestamptz                       not null default now(),

  constraint relance_planifiee_pk primary key (id),
  constraint relance_planifiee_tenant_id_uk unique (tenant_id, id),

  -- RA-05, §6.1 : LA garantie d'idempotence, pas la logique applicative.
  constraint relance_planifiee_tenant_type_objet_palier_uk
    unique (tenant_id, type_relance, objet_id, palier),

  constraint relance_planifiee_fk_client
    foreign key (tenant_id, client_id) references public.client (tenant_id, id)
    on delete restrict,

  constraint relance_planifiee_palier_positif_chk check (palier > 0),

  constraint relance_planifiee_annulee_raison_chk
    check ((statut = 'annulee') = (annule_raison is not null))
);

comment on table public.relance_planifiee is
  'Une ligne par OCCASION de rappel (type + objet + palier) — §5, §6.1, §8. L''unicité '
  '(tenant_id, type_relance, objet_id, palier) est LA garantie d''idempotence RA-05 : un job de '
  'planification rejoué (redémarrage worker) ne produit jamais de deuxième ligne pour le même '
  'palier, ON CONFLICT DO NOTHING absorbe le doublon. Machine à états statut (§8) : a_planifier → '
  'prete → en_cours_envoi → envoyee | echouee(retry→prete) | echouee(définitif), et a_planifier | '
  'prete → annulee (RA-02/07/08/09/14). envoyee/annulee/echouee(définitif) sont TERMINAUX.';

create trigger relance_planifiee_touche_modifie_le
  before update on public.relance_planifiee
  for each row execute function public.touche_modifie_le();

-- §E de l'en-tête : cycle de vie réel, jamais de DELETE.
revoke all                    on public.relance_planifiee from dfa_app;
grant  select, insert, update on public.relance_planifiee to   dfa_app;
revoke delete                 on public.relance_planifiee from dfa_app;

alter table public.relance_planifiee enable row level security;
alter table public.relance_planifiee force  row level security;

create policy relance_planifiee_isolation_tenant on public.relance_planifiee
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy relance_planifiee_migrator on public.relance_planifiee
  to dfa_migrator
  using (true) with check (true);

-- Requêtes du job de planification (WHERE statut = 'a_planifier') et du job d'envoi
-- (WHERE statut = 'prete'), toutes deux filtrées par échéance (§6.1).
create index relance_planifiee_statut_echeance_idx
  on public.relance_planifiee (tenant_id, statut, echeance_prevue);

-- RA-07/08/09/14 : retrouver toutes les relances actives d'un objet donné pour les annuler quand
-- il change d'état, sans scanner la table entière.
create index relance_planifiee_objet_idx
  on public.relance_planifiee (tenant_id, objet_type, objet_id);

-- RA-04/RA-10 : regroupement par CLIENT (pas par véhicule) des rappels dus le même jour.
create index relance_planifiee_client_echeance_idx
  on public.relance_planifiee (tenant_id, client_id, echeance_prevue);


-- ---------------------------------------------------------------------------------------------
-- 4. `relance_envoi` — APPEND-ONLY, une ligne par tentative (§6.2/§6.4, RA-12).
-- ---------------------------------------------------------------------------------------------

create table public.relance_envoi (
  id                       uuid                          not null default gen_random_uuid(),
  tenant_id                uuid                          not null,
  relance_planifiee_id     uuid                          not null,
  tentative                smallint                      not null,
  canal                    public.canal_relance          not null,
  -- RA-12 : figé, donnée personnelle — jamais recalculé après coup.
  destinataire_fige        text                          not null,
  langue_figee             public.langue                 not null,
  contenu_fige             text                          not null,
  statut_envoi             public.statut_envoi_relance   not null,
  fournisseur_message_id   text                          null,
  erreur                   text                          null,
  envoye_le                timestamptz                   not null default now(),

  cree_le                  timestamptz                   not null default now(),

  constraint relance_envoi_pk primary key (id),
  constraint relance_envoi_tenant_id_uk unique (tenant_id, id),
  constraint relance_envoi_tenant_planifiee_tentative_uk
    unique (tenant_id, relance_planifiee_id, tentative),

  constraint relance_envoi_fk_relance_planifiee
    foreign key (tenant_id, relance_planifiee_id)
    references public.relance_planifiee (tenant_id, id) on delete restrict,

  constraint relance_envoi_tentative_positive_chk check (tentative > 0),
  constraint relance_envoi_echoue_erreur_chk
    check ((statut_envoi = 'echoue') = (erreur is not null)),
  constraint relance_envoi_envoye_fournisseur_id_chk
    check ((statut_envoi = 'envoye') = (fournisseur_message_id is not null))
);

comment on table public.relance_envoi is
  'APPEND-ONLY (§A de l''en-tête) : une ligne par TENTATIVE d''envoi, jamais modifiée après coup. '
  'RA-12 : destinataire_fige/contenu_fige/langue_figee sont figés à l''instant de l''envoi, jamais '
  'recalculés — un modèle de texte ou une coordonnée client modifiés demain ne changent pas la '
  'preuve d''hier. C''est CETTE table qui répond, sans reconstruction, à « qu''est-ce qu''on a '
  'envoyé à ce client, quand, par quel canal, et est-ce que ça a marché ».';

-- §A/§E de l'en-tête : append-only, jamais de UPDATE ni de DELETE.
revoke all            on public.relance_envoi from dfa_app;
grant  select, insert on public.relance_envoi to   dfa_app;
revoke update, delete on public.relance_envoi from dfa_app;

alter table public.relance_envoi enable row level security;
alter table public.relance_envoi force  row level security;

create policy relance_envoi_isolation_tenant on public.relance_envoi
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy relance_envoi_migrator on public.relance_envoi
  to dfa_migrator
  using (true) with check (true);

-- Trace exploitable par tenant, triée dans le temps (§6.4).
create index relance_envoi_envoye_le_idx on public.relance_envoi (tenant_id, envoye_le);


-- ---------------------------------------------------------------------------------------------
-- 5. `client` gagne `plus_aucun_contact`/`motif` (RA-14, §5). Voir §D de l'en-tête.
-- ---------------------------------------------------------------------------------------------

alter table public.client
  add column plus_aucun_contact boolean not null default false,
  add column motif text null;

comment on column public.client.plus_aucun_contact is
  'RA-14 : interrupteur opérationnel (litige, mandataire) — suspend TOUS les rappels automatiques '
  'pour ce client, Famille A comprise, plus fort que tout consentement marketing (RA-01/RA-02). '
  'Pas un consentement nLPD : ne PAS confondre avec client_consentement (marketing_email/sms/'
  'appel), portée strictement disjointe.';

comment on column public.client.motif is
  'Motif de plus_aucun_contact — texte libre, requis dès que plus_aucun_contact = true (voir '
  'client_plus_aucun_contact_motif_chk). Sans rapport avec client_note (notes internes libres, '
  'non structurées) : ce champ documente spécifiquement la décision RA-14.';

alter table public.client
  add constraint client_plus_aucun_contact_motif_chk
  check (not plus_aucun_contact or motif is not null);


-- ---------------------------------------------------------------------------------------------
-- 6. Audit — `entite_auditee` gagne `relance_planifiee`, trigger posé dans la même transaction
--    (sûr, voir §B de l'en-tête : ne participe pas à `transition_autorisee`).
-- ---------------------------------------------------------------------------------------------

alter type public.entite_auditee add value if not exists 'relance_planifiee';

create trigger relance_planifiee_audit
  after insert or update or delete on public.relance_planifiee
  for each row execute function public.auditer_atelier('relance_planifiee');


-- ---------------------------------------------------------------------------------------------
-- 7. Assertions de fin de migration
-- ---------------------------------------------------------------------------------------------

do $$
begin
  -- 1. Tables présentes.
  if to_regclass('public.regle_relance') is null then
    raise exception '0045 : table regle_relance absente après migration.';
  end if;
  if to_regclass('public.relance_planifiee') is null then
    raise exception '0045 : table relance_planifiee absente après migration.';
  end if;
  if to_regclass('public.relance_envoi') is null then
    raise exception '0045 : table relance_envoi absente après migration.';
  end if;

  -- 2. Contrainte d'idempotence RA-05 présente.
  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conname = 'relance_planifiee_tenant_type_objet_palier_uk'
       and conrelid = 'public.relance_planifiee'::regclass
  ) then
    raise exception '0045 : contrainte unique d''idempotence RA-05 absente sur relance_planifiee.';
  end if;

  -- 3. CHECK de cohérence annule_raison.
  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conname = 'relance_planifiee_annulee_raison_chk'
       and conrelid = 'public.relance_planifiee'::regclass
  ) then
    raise exception '0045 : relance_planifiee_annulee_raison_chk absente après migration.';
  end if;

  -- 4. relance_envoi : append-only, aucun UPDATE/DELETE pour dfa_app.
  if has_table_privilege('dfa_app', 'public.relance_envoi', 'UPDATE') then
    raise exception '0045 : relance_envoi doit interdire UPDATE à dfa_app (append-only).';
  end if;
  if has_table_privilege('dfa_app', 'public.relance_envoi', 'DELETE') then
    raise exception '0045 : relance_envoi doit interdire DELETE à dfa_app (append-only).';
  end if;
  if not has_table_privilege('dfa_app', 'public.relance_envoi', 'INSERT') then
    raise exception '0045 : relance_envoi doit accorder INSERT à dfa_app.';
  end if;

  -- 5. regle_relance / relance_planifiee : pas de DELETE, mais UPDATE accordé.
  if has_table_privilege('dfa_app', 'public.regle_relance', 'DELETE') then
    raise exception '0045 : regle_relance doit interdire DELETE à dfa_app.';
  end if;
  if not has_table_privilege('dfa_app', 'public.regle_relance', 'UPDATE') then
    raise exception '0045 : regle_relance doit accorder UPDATE à dfa_app.';
  end if;
  if has_table_privilege('dfa_app', 'public.relance_planifiee', 'DELETE') then
    raise exception '0045 : relance_planifiee doit interdire DELETE à dfa_app.';
  end if;

  -- 6. RLS activée ET forcée sur les trois tables.
  if not exists (
    select 1 from pg_catalog.pg_class
     where relname = 'regle_relance' and relnamespace = 'public'::regnamespace
       and relrowsecurity and relforcerowsecurity
  ) then
    raise exception '0045 : regle_relance n''a pas RLS activée et forcée.';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_class
     where relname = 'relance_planifiee' and relnamespace = 'public'::regnamespace
       and relrowsecurity and relforcerowsecurity
  ) then
    raise exception '0045 : relance_planifiee n''a pas RLS activée et forcée.';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_class
     where relname = 'relance_envoi' and relnamespace = 'public'::regnamespace
       and relrowsecurity and relforcerowsecurity
  ) then
    raise exception '0045 : relance_envoi n''a pas RLS activée et forcée.';
  end if;

  -- 7. Policies présentes (isolation tenant + migrator) sur les trois tables.
  if (select count(*) from pg_catalog.pg_policies
       where schemaname = 'public' and tablename = 'regle_relance') <> 2 then
    raise exception '0045 : regle_relance doit porter exactement 2 policies.';
  end if;
  if (select count(*) from pg_catalog.pg_policies
       where schemaname = 'public' and tablename = 'relance_planifiee') <> 2 then
    raise exception '0045 : relance_planifiee doit porter exactement 2 policies.';
  end if;
  if (select count(*) from pg_catalog.pg_policies
       where schemaname = 'public' and tablename = 'relance_envoi') <> 2 then
    raise exception '0045 : relance_envoi doit porter exactement 2 policies.';
  end if;

  -- 8. client.plus_aucun_contact / client.motif présentes, bien typées.
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'client'
       and column_name = 'plus_aucun_contact' and is_nullable = 'NO' and data_type = 'boolean'
  ) then
    raise exception '0045 : client.plus_aucun_contact absente, nullable, ou de mauvais type.';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'client'
       and column_name = 'motif' and is_nullable = 'YES' and data_type = 'text'
  ) then
    raise exception '0045 : client.motif absente, non-nullable, ou de mauvais type.';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conname = 'client_plus_aucun_contact_motif_chk' and conrelid = 'public.client'::regclass
  ) then
    raise exception '0045 : client_plus_aucun_contact_motif_chk absente après migration.';
  end if;

  -- 9. Trigger d'audit sur relance_planifiee, pointant vers auditer_atelier(), AFTER
  --    INSERT/UPDATE/DELETE FOR EACH ROW (même bitmask que la vérification 0043).
  if not exists (
    select 1
      from pg_catalog.pg_trigger tg
      join pg_catalog.pg_class c on c.oid = tg.tgrelid
      join pg_catalog.pg_proc p on p.oid = tg.tgfoid
     where c.relname = 'relance_planifiee'
       and tg.tgname = 'relance_planifiee_audit'
       and p.proname = 'auditer_atelier'
       and not tg.tgisinternal
       and (tg.tgtype & 1) = 1
       and (tg.tgtype & 2) = 0
       and (tg.tgtype & 4) = 4
       and (tg.tgtype & 8) = 8
       and (tg.tgtype & 16) = 16
  ) then
    raise exception '0045 : trigger relance_planifiee_audit absent ou mal posé.';
  end if;

  -- 10. entite_auditee porte la nouvelle valeur.
  if not exists (
    select 1
      from pg_catalog.pg_enum e
      join pg_catalog.pg_type t on t.oid = e.enumtypid
     where t.typname = 'entite_auditee' and e.enumlabel = 'relance_planifiee'
  ) then
    raise exception '0045 : entite_auditee ne porte pas la valeur relance_planifiee après migration.';
  end if;

  -- 11. touche_modifie_le posé sur regle_relance et relance_planifiee.
  if not exists (
    select 1 from pg_catalog.pg_trigger tg join pg_catalog.pg_class c on c.oid = tg.tgrelid
     where c.relname = 'regle_relance' and tg.tgname = 'regle_relance_touche_modifie_le'
       and not tg.tgisinternal
  ) then
    raise exception '0045 : trigger regle_relance_touche_modifie_le absent après migration.';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_trigger tg join pg_catalog.pg_class c on c.oid = tg.tgrelid
     where c.relname = 'relance_planifiee' and tg.tgname = 'relance_planifiee_touche_modifie_le'
       and not tg.tgisinternal
  ) then
    raise exception '0045 : trigger relance_planifiee_touche_modifie_le absent après migration.';
  end if;
end
$$;
