-- =============================================================================================
-- 0024_pieces_commande_fournisseur.sql — étape 3 (Pièces) : `commande_fournisseur`,
-- `commande_fournisseur_ligne`. Spécification : RP-26→RP-31, machine à états §6.2. Contrat gelé :
-- packages/shared/src/contrats/pieces/commande-fournisseur.ts.
--
-- PRÉALABLE 0023 : `entite_auditee` gagne `commande_fournisseur` dans une migration SÉPARÉE et
-- ANTÉRIEURE (0023_pieces_entite_auditee_commande_fournisseur.sql), pas ici. Constaté en
-- exécution en écrivant cette migration : `insert into transition_autorisee (entite, ...) values
-- ('commande_fournisseur', ...)` (§4 ci-dessous) COMPARE la nouvelle valeur — contrairement à
-- `auditer_atelier('commande_fournisseur')`/`verifier_transition('commande_fournisseur')`, qui ne
-- font que STOCKER l'argument comme texte brut (tgargs), casté seulement à l'exécution future du
-- trigger (doctrine 0016, sûre same-transaction). PostgreSQL refuse explicitement qu'une valeur
-- ajoutée par `ALTER TYPE ... ADD VALUE` soit COMPARÉE dans LA MÊME transaction
-- (« unsafe use of new value » — erreur réellement obtenue en testant ce fichier avant ce
-- découpage). D'où la migration 0023, strictement limitée à l'ADD VALUE, committée avant que
-- celle-ci n'insère dans transition_autorisee.
--
-- MACHINE À ÉTATS : réutilise le dispositif GÉNÉRIQUE déjà en place depuis 0003
-- (`transition_autorisee` + `verifier_transition()`), pas une nouvelle implémentation — même
-- doctrine que `document_vente`/`ordre_reparation`/`ligne_or`. `statut_commande_fournisseur` est
-- GELÉ côté contrat (contrats/pieces/enums.ts) : 6 valeurs, correspondance 1:1 avec le diagramme
-- §6.2 de la spec, y compris le double départ de `partiellement_recue` (vers `recue` ET
-- directement vers `cloturee` quand le reliquat est annulé plutôt que livré, RP-27/28).
--
-- `commande_fournisseur_ligne` — RP-27/RP-28 : « soldé par livraison » et « annulé
-- explicitement » sont DEUX COLONNES distinctes (`quantite_recue_cumulee_millieme`,
-- `reliquat_annule_le`/`reliquat_motif_annulation`), jamais un seul drapeau — c'est ce qui
-- permet à `quantite_reliquat_millieme` (colonne GÉNÉRÉE, §3) de distinguer « livré en entier »
-- de « abandonné » même quand les deux ramènent le reliquat à zéro. Même doctrine que
-- `document_vente.numero_normalise` (0010) pour les colonnes GENERATED : posées en SQL brut, non
-- modélisées côté Drizzle (voir schema/pieces/commande-fournisseur.ts).
--
-- AUDIT : `entite_auditee` gagne `commande_fournisseur` (RP-31 explicite). Pas de valeur ajoutée
-- pour `commande_fournisseur_ligne` : RP-31 cite la commande, pas ses lignes séparément — même
-- granularité que `document_vente`/`ligne_document` (seul le document est audité en 0010, pas
-- chaque ligne) et `ordre_reparation`/`ligne_or` (les DEUX sont audités, mais parce que 0008 le
-- fait explicitement pour ligne_or — ici RP-31 ne demande que la commande). Le contenu de chaque
-- ligne (quantité reçue au cumul, reliquat) reste néanmoins traçable via `mouvement_stock`
-- (0025, chaque réception génère un mouvement audité) — pas une lacune, une redondance évitée.
-- =============================================================================================


-- ---------------------------------------------------------------------------------------------
-- 1. Types enum
-- ---------------------------------------------------------------------------------------------

create type public.statut_commande_fournisseur as enum (
  'brouillon', 'envoyee', 'partiellement_recue', 'recue', 'cloturee', 'annulee'
);

create type public.origine_commande_fournisseur as enum (
  'manuelle', 'reservation_rupture', 'reapprovisionnement'
);


-- ---------------------------------------------------------------------------------------------
-- 2. `commande_fournisseur`
-- ---------------------------------------------------------------------------------------------

create table public.commande_fournisseur (
  id             uuid                                  not null default gen_random_uuid(),
  tenant_id      uuid                                  not null references public.tenant (id) on delete restrict,
  fournisseur_id uuid                                  not null,
  site_id        uuid                                  not null,
  statut         public.statut_commande_fournisseur     not null default 'brouillon',
  origine        public.origine_commande_fournisseur    not null default 'manuelle',
  date_commande  date                                  not null default current_date,
  envoyee_le     timestamptz                           null,
  reference      text                                  null,
  cree_le        timestamptz                           not null default now(),
  modifie_le     timestamptz                           not null default now(),

  constraint commande_fournisseur_pk primary key (id),
  constraint commande_fournisseur_tenant_id_uk unique (tenant_id, id),
  constraint commande_fournisseur_fk_fournisseur
    foreign key (tenant_id, fournisseur_id) references public.fournisseur (tenant_id, id) on delete restrict,
  constraint commande_fournisseur_fk_site
    foreign key (tenant_id, site_id) references public.site (tenant_id, id) on delete restrict,
  -- §6.2 : une commande encore en brouillon n'a jamais été envoyée. L'inverse n'est PAS imposé
  -- (brouillon -> annulee est une transition légale sans passage par envoyee, §4) : une commande
  -- non-brouillon peut donc légitimement garder envoyee_le à null si elle a été annulée avant
  -- tout envoi.
  constraint commande_fournisseur_envoyee_coherente_chk
    check (statut <> 'brouillon' or envoyee_le is null)
);

comment on table public.commande_fournisseur is
  'Commande fournisseur (RP-26→RP-31). Machine à états portée par transition_autorisee '
  '(entite=''commande_fournisseur'') + verifier_transition() — dispositif générique de '
  '0003_prealables_etape1.sql, pas une réimplémentation. Auditée (RP-31).';

create trigger commande_fournisseur_touche_modifie_le
  before update on public.commande_fournisseur
  for each row execute function public.touche_modifie_le();

create trigger commande_fournisseur_verifier_transition
  before update on public.commande_fournisseur
  for each row execute function public.verifier_transition('commande_fournisseur');

create trigger commande_fournisseur_audit
  after insert or update or delete on public.commande_fournisseur
  for each row execute function public.auditer_atelier('commande_fournisseur');

revoke all    on public.commande_fournisseur from dfa_app;
grant  select, insert, update on public.commande_fournisseur to dfa_app;

alter table public.commande_fournisseur enable row level security;
alter table public.commande_fournisseur force  row level security;

create policy commande_fournisseur_isolation_tenant on public.commande_fournisseur
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy commande_fournisseur_migrator on public.commande_fournisseur
  to dfa_migrator
  using (true) with check (true);

create index commande_fournisseur_pagination_idx
  on public.commande_fournisseur (tenant_id, cree_le desc, id desc);
create index commande_fournisseur_fournisseur_idx
  on public.commande_fournisseur (tenant_id, fournisseur_id);
-- Sert à la fois « commandes ouvertes sur mon site » et le filtre avecReliquat=true du contrat
-- (statut in envoyee/partiellement_recue), qui se réduit à ce même préfixe (tenant, statut).
create index commande_fournisseur_site_statut_idx
  on public.commande_fournisseur (tenant_id, site_id, statut);


-- ---------------------------------------------------------------------------------------------
-- 3. `commande_fournisseur_ligne` — RP-27, RP-28, RP-29
-- ---------------------------------------------------------------------------------------------

create table public.commande_fournisseur_ligne (
  id                             uuid        not null default gen_random_uuid(),
  tenant_id                      uuid        not null,
  commande_fournisseur_id        uuid        not null,
  numero_ordre                   smallint    not null,
  article_id                     uuid        not null,
  quantite_commandee_millieme    integer     not null,
  -- RP-27 : cumul des réceptions déjà enregistrées (0025 les incrémente par trigger, jamais
  -- l'applicatif directement — même doctrine que stock_article, voir 0025/0026).
  quantite_recue_cumulee_millieme integer    not null default 0,
  -- RP-28 : DEUX colonnes distinctes pour « soldé par livraison » / « annulé explicitement »,
  -- jamais un seul drapeau (demande explicite de l'orchestrateur, relayant l'agent contrat).
  reliquat_annule_le             timestamptz null,
  reliquat_motif_annulation      text        null,
  prix_achat_attendu_centimes    integer     null,
  -- RP-24/RP-26 : fil vers la ligne d'OR qui attend cette pièce, quand la commande naît d'une
  -- rupture de réservation. Nullable : les deux autres origines (manuelle, réapprovisionnement)
  -- n'ont pas de ligne d'OR d'origine.
  ligne_or_origine_id            uuid        null,
  cree_le                        timestamptz not null default now(),
  modifie_le                     timestamptz not null default now(),

  constraint commande_fournisseur_ligne_pk primary key (id),
  constraint commande_fournisseur_ligne_tenant_id_uk unique (tenant_id, id),
  constraint commande_fournisseur_ligne_tenant_cmd_ordre_uk unique (tenant_id, commande_fournisseur_id, numero_ordre),
  constraint commande_fournisseur_ligne_fk_commande
    foreign key (tenant_id, commande_fournisseur_id)
    references public.commande_fournisseur (tenant_id, id) on delete restrict,
  constraint commande_fournisseur_ligne_fk_article
    foreign key (tenant_id, article_id) references public.article (tenant_id, id) on delete restrict,
  -- Accroche vers ligne_or (module atelier, existe depuis l'étape 1) — composite avec tenant,
  -- règle n°1 du projet.
  constraint commande_fournisseur_ligne_fk_ligne_or
    foreign key (tenant_id, ligne_or_origine_id)
    references public.ligne_or (tenant_id, id) on delete restrict,
  constraint commande_fournisseur_ligne_quantite_commandee_chk check (quantite_commandee_millieme > 0),
  constraint commande_fournisseur_ligne_quantite_recue_chk check (quantite_recue_cumulee_millieme >= 0),
  constraint commande_fournisseur_ligne_prix_attendu_chk
    check (prix_achat_attendu_centimes is null or prix_achat_attendu_centimes >= 0),
  constraint commande_fournisseur_ligne_reliquat_motif_chk
    check ((reliquat_annule_le is null) = (reliquat_motif_annulation is null))
);

comment on table public.commande_fournisseur_ligne is
  'Ligne de commande fournisseur (RP-27→RP-29). quantite_reliquat_millieme (colonne GÉNÉRÉE, '
  'posée juste après ce create table) distingue « soldé par livraison » (reliquat_annule_le '
  'null, cumul = commandé) de « annulé explicitement » (reliquat_annule_le renseigné) — deux '
  'colonnes sources, jamais un seul drapeau (RP-28).';

-- Colonne GÉNÉRÉE, même doctrine que document_vente.numero_normalise (0010) : non modélisée côté
-- Drizzle (voir schema/pieces/commande-fournisseur.ts). max(0, commandee - recue_cumulee), sauf
-- reliquat_annule_le renseigné => 0 quel que soit le cumul reçu (RP-28).
alter table public.commande_fournisseur_ligne
  add column quantite_reliquat_millieme integer generated always as (
    case
      when reliquat_annule_le is not null then 0
      else greatest(0, quantite_commandee_millieme - quantite_recue_cumulee_millieme)
    end
  ) stored;

revoke all    on public.commande_fournisseur_ligne from dfa_app;
grant  select, insert, update on public.commande_fournisseur_ligne to dfa_app;

alter table public.commande_fournisseur_ligne enable row level security;
alter table public.commande_fournisseur_ligne force  row level security;

create policy commande_fournisseur_ligne_isolation_tenant on public.commande_fournisseur_ligne
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy commande_fournisseur_ligne_migrator on public.commande_fournisseur_ligne
  to dfa_migrator
  using (true) with check (true);

create index commande_fournisseur_ligne_commande_idx
  on public.commande_fournisseur_ligne (tenant_id, commande_fournisseur_id, numero_ordre);
create index commande_fournisseur_ligne_article_idx
  on public.commande_fournisseur_ligne (tenant_id, article_id);
-- RP-24 : depuis une ligne d'OR bloquée « pieces », retrouver la commande qui la couvre (date
-- d'arrivée annoncée). Partiel : la grande majorité des lignes de commande n'ont pas d'origine OR
-- (manuelle, réapprovisionnement).
create index commande_fournisseur_ligne_or_origine_idx
  on public.commande_fournisseur_ligne (tenant_id, ligne_or_origine_id)
  where ligne_or_origine_id is not null;


-- ---------------------------------------------------------------------------------------------
-- 4. Contenu du référentiel de transitions — §6.2 de la spec, littéralement
-- ---------------------------------------------------------------------------------------------

insert into public.transition_autorisee (entite, statut_depuis, statut_vers, exige_motif) values
  ('commande_fournisseur', 'brouillon',            'envoyee',              false),
  ('commande_fournisseur', 'brouillon',            'annulee',              true),
  ('commande_fournisseur', 'envoyee',              'partiellement_recue',  false),
  ('commande_fournisseur', 'envoyee',              'recue',                false),
  ('commande_fournisseur', 'envoyee',              'annulee',              true),
  ('commande_fournisseur', 'partiellement_recue',  'recue',                false),
  -- Reliquat soldé par annulation explicite (RP-28) plutôt que par livraison : le motif réel vit
  -- sur commande_fournisseur_ligne.reliquat_motif_annulation (NOT NULL-cohérent via CHECK
  -- ci-dessus), pas dupliqué au niveau de la transition de la commande elle-même.
  ('commande_fournisseur', 'partiellement_recue',  'cloturee',             false),
  ('commande_fournisseur', 'recue',                'cloturee',             false);


-- ---------------------------------------------------------------------------------------------
-- 5. Assertions de fin de migration
-- ---------------------------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_enum e join pg_catalog.pg_type t on t.oid = e.enumtypid
     where t.typname = 'entite_auditee' and e.enumlabel = 'commande_fournisseur'
  ) then
    raise exception '0024 : entite_auditee ne porte pas la valeur commande_fournisseur après migration.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_trigger tg
      join pg_catalog.pg_class c on c.oid = tg.tgrelid
      join pg_catalog.pg_proc p on p.oid = tg.tgfoid
     where c.relname = 'commande_fournisseur' and tg.tgname = 'commande_fournisseur_verifier_transition'
       and p.proname = 'verifier_transition' and not tg.tgisinternal
  ) then
    raise exception '0024 : trigger commande_fournisseur_verifier_transition absent ou mal câblé.';
  end if;

  if (select count(*) from public.transition_autorisee where entite = 'commande_fournisseur') <> 8 then
    raise exception '0024 : transition_autorisee attend exactement 8 lignes pour commande_fournisseur.';
  end if;

  if has_table_privilege('dfa_app', 'public.commande_fournisseur', 'DELETE')
     or has_table_privilege('dfa_app', 'public.commande_fournisseur_ligne', 'DELETE') then
    raise exception '0024 : DELETE ne devrait être accordé à dfa_app sur aucune des deux tables.';
  end if;
end
$$;
