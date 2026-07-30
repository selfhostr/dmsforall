-- =============================================================================================
-- 0027_pieces_consigne.sql — étape 3 (Pièces) : `consigne_echange_standard`. Spécification :
-- RP-37→RP-42, §6.4, CP-06. Contrat gelé : packages/shared/src/contrats/pieces/consigne.ts.
-- Débloque RF-100 (spec étape 2, non résolue sur QP-05→07) : ce module produit l'information
-- physique, la facturation en découle (hors périmètre de cette migration).
--
-- CRÉATION : pas de `POST /consignes` public (contrat) — la ligne naît comme EFFET DE BORD
-- serveur de la réalisation d'une ligne d'OR de dépose (hors périmètre `db/`, signalé côté
-- contrat comme point d'intégration cross-module). Ce fichier pose seulement la table et ses
-- garanties ; `statut` par défaut `en_attente_retour_fournisseur` — `deposee_par_client` (conservé
-- dans l'enum pour fidélité au diagramme §6.4 et un futur flux en deux temps, voir enums.ts) n'est
-- ATTEINT PAR AUCUN chemin ici, exactement comme documenté côté contrat.
--
-- RP-40 : le retour de la vieille pièce ET l'avoir partiel côté facturation doivent arriver
-- ENSEMBLE — « jamais l'un sans l'autre ». `consigne_transition_terminale_chk` (§2) impose déjà
-- CETTE MOITIÉ en base (statut = retournee_fournisseur ⟺ retournee_fournisseur_le ET
-- mouvement_retour_id renseignés, tous deux ou aucun) : la moitié FACTURATION (avoir_document_id)
-- reste hors d'atteinte d'une contrainte de CETTE table, comme le signale déjà consigne.ts —
-- l'atomicité complète du GESTE (mouvement + avoir) est une responsabilité TRANSACTIONNELLE
-- cross-module (facturation appelle pieces dans la même transaction), pas quelque chose qu'un
-- CHECK sur cette seule table peut garantir.
--
-- AUDIT : `entite_auditee` gagne `consigne_echange_standard` (demande explicite de
-- l'orchestrateur). Usage UNIQUEMENT comme argument de trigger (`auditer_atelier(...)`) — sûr
-- dans la même transaction (doctrine 0016/0022/0025), AUCUN insert dans `transition_autorisee`
-- ici : la légalité de l'unique transition (`en_attente_retour_fournisseur -> '
-- retournee_fournisseur`) est portée par un trigger DÉDIÉ (§3), même décision de conception que
-- `reservation_piece` (0026) et pour la même raison (machine triviale, non consommée par
-- `GET /referentiel/transitions`).
-- =============================================================================================


-- ---------------------------------------------------------------------------------------------
-- 1. Type enum + entite_auditee
-- ---------------------------------------------------------------------------------------------

create type public.statut_consigne_echange_standard as enum (
  'deposee_par_client', 'en_attente_retour_fournisseur', 'retournee_fournisseur'
);

alter type public.entite_auditee add value if not exists 'consigne_echange_standard';


-- ---------------------------------------------------------------------------------------------
-- 2. `consigne_echange_standard` — RP-37→RP-42
-- ---------------------------------------------------------------------------------------------

create table public.consigne_echange_standard (
  id                               uuid                                     not null default gen_random_uuid(),
  tenant_id                        uuid                                     not null,
  ligne_or_id                      uuid                                     not null,
  ordre_reparation_id              uuid                                     not null,
  article_id                       uuid                                     not null,
  site_id                          uuid                                     not null,
  statut                           public.statut_consigne_echange_standard   not null default 'en_attente_retour_fournisseur',
  -- RP-38/RP-42 : figé TTC au moment de la pose, jamais recalculé — copie de
  -- article.montant_consigne_ttc_centimes À CET INSTANT.
  montant_consigne_ttc_centimes    integer                                  not null,
  -- Alimenté hors périmètre (facturation, RF-100) : nullable jusqu'à l'émission de la facture.
  document_vente_ligne_consigne_id uuid                                     null,
  mouvement_entree_id              uuid                                     not null,
  retournee_fournisseur_le         timestamptz                              null,
  mouvement_retour_id              uuid                                     null,
  -- Alimenté hors périmètre (facturation, RF-100) : nullable jusqu'à l'émission de l'avoir.
  avoir_document_id                uuid                                     null,
  cree_le                          timestamptz                              not null default now(),
  modifie_le                       timestamptz                              not null default now(),

  constraint consigne_echange_standard_pk primary key (id),
  constraint consigne_echange_standard_tenant_id_uk unique (tenant_id, id),
  -- RP-38 : une ligne de dépose porte AU PLUS une consigne.
  constraint consigne_echange_standard_tenant_ligne_or_uk unique (tenant_id, ligne_or_id),

  constraint consigne_echange_standard_fk_ligne_or
    foreign key (tenant_id, ligne_or_id) references public.ligne_or (tenant_id, id) on delete restrict,
  constraint consigne_echange_standard_fk_ordre_reparation
    foreign key (tenant_id, ordre_reparation_id) references public.ordre_reparation (tenant_id, id) on delete restrict,
  constraint consigne_echange_standard_fk_article
    foreign key (tenant_id, article_id) references public.article (tenant_id, id) on delete restrict,
  constraint consigne_echange_standard_fk_site
    foreign key (tenant_id, site_id) references public.site (tenant_id, id) on delete restrict,
  constraint consigne_echange_standard_fk_mouvement_entree
    foreign key (tenant_id, mouvement_entree_id) references public.mouvement_stock (tenant_id, id) on delete restrict,
  constraint consigne_echange_standard_fk_mouvement_retour
    foreign key (tenant_id, mouvement_retour_id) references public.mouvement_stock (tenant_id, id) on delete restrict,
  constraint consigne_echange_standard_fk_document_ligne
    foreign key (tenant_id, document_vente_ligne_consigne_id) references public.ligne_document (tenant_id, id) on delete restrict,
  constraint consigne_echange_standard_fk_avoir
    foreign key (tenant_id, avoir_document_id) references public.document_vente (tenant_id, id) on delete restrict,

  constraint consigne_echange_standard_montant_chk check (montant_consigne_ttc_centimes >= 0),
  -- RP-40, la moitié « stock » de la garantie « jamais l'un sans l'autre » (voir en-tête) :
  -- retournee_fournisseur ⟺ les DEUX colonnes de retour renseignées ensemble.
  constraint consigne_echange_standard_terminal_coherent_chk
    check (
      (statut = 'retournee_fournisseur')
      = (retournee_fournisseur_le is not null and mouvement_retour_id is not null)
    )
);

comment on table public.consigne_echange_standard is
  'Consigne d''échange standard (RP-37→RP-42, débloque RF-100). statut par défaut '
  'en_attente_retour_fournisseur : le dépôt et la réception en stock de la vieille pièce sont LE '
  'MÊME geste (RP-38), deposee_par_client n''est atteint par aucun chemin actuel (conservé pour '
  'fidélité au diagramme §6.4). Transition unique (en_attente_retour_fournisseur -> '
  'retournee_fournisseur) gardée par consigne_echange_standard_transition(), pas par '
  'transition_autorisee (décision assumée, voir l''en-tête de cette migration). Auditée '
  '(consigne_echange_standard_audit).';

create trigger consigne_echange_standard_touche_modifie_le
  before update on public.consigne_echange_standard
  for each row execute function public.touche_modifie_le();

create trigger consigne_echange_standard_audit
  after insert or update or delete on public.consigne_echange_standard
  for each row execute function public.auditer_atelier('consigne_echange_standard');

revoke all    on public.consigne_echange_standard from dfa_app;
grant  select, insert, update on public.consigne_echange_standard to dfa_app;

alter table public.consigne_echange_standard enable row level security;
alter table public.consigne_echange_standard force  row level security;

create policy consigne_echange_standard_isolation_tenant on public.consigne_echange_standard
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy consigne_echange_standard_migrator on public.consigne_echange_standard
  to dfa_migrator
  using (true) with check (true);

-- GET /consignes (schemaFiltresConsignes) : statut[], siteId, ancienneteJoursMin (sur cree_le) —
-- §7.7, liste des consignes non soldées.
create index consigne_echange_standard_statut_idx
  on public.consigne_echange_standard (tenant_id, statut, cree_le);
create index consigne_echange_standard_site_idx
  on public.consigne_echange_standard (tenant_id, site_id, statut);


-- ---------------------------------------------------------------------------------------------
-- 3. `consigne_echange_standard_transition()` — BEFORE UPDATE, légalité de l'unique transition
-- ---------------------------------------------------------------------------------------------

create function public.consigne_echange_standard_transition() returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $fn$
begin
  if old.statut is not distinct from new.statut then
    return new;
  end if;

  if old.statut <> 'en_attente_retour_fournisseur' or new.statut <> 'retournee_fournisseur' then
    raise exception using
      errcode = 'ZDFA1',
      message = format('Transition %s → %s interdite sur consigne_echange_standard.', old.statut, new.statut),
      hint    = 'Seule en_attente_retour_fournisseur -> retournee_fournisseur est autorisée (§6.4).',
      table   = 'consigne_echange_standard';
  end if;

  return new;
end
$fn$;

comment on function public.consigne_echange_standard_transition() is
  'Trigger BEFORE UPDATE : refuse toute transition hors en_attente_retour_fournisseur -> '
  'retournee_fournisseur (ZDFA1). Décision de ne pas passer par transition_autorisee : voir '
  'l''en-tête de 0027_pieces_consigne.sql.';

revoke all     on function public.consigne_echange_standard_transition() from public;
grant  execute on function public.consigne_echange_standard_transition() to   dfa_app;

create trigger consigne_echange_standard_transition
  before update on public.consigne_echange_standard
  for each row execute function public.consigne_echange_standard_transition();


-- ---------------------------------------------------------------------------------------------
-- 4. Assertions de fin de migration
-- ---------------------------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_enum e join pg_catalog.pg_type t on t.oid = e.enumtypid
     where t.typname = 'entite_auditee' and e.enumlabel = 'consigne_echange_standard'
  ) then
    raise exception '0027 : entite_auditee ne porte pas la valeur consigne_echange_standard après migration.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_trigger tg
      join pg_catalog.pg_class c on c.oid = tg.tgrelid
      join pg_catalog.pg_proc p on p.oid = tg.tgfoid
     where c.relname = 'consigne_echange_standard' and tg.tgname = 'consigne_echange_standard_audit'
       and p.proname = 'auditer_atelier' and not tg.tgisinternal
  ) then
    raise exception '0027 : trigger consigne_echange_standard_audit absent ou mal câblé.';
  end if;

  if has_table_privilege('dfa_app', 'public.consigne_echange_standard', 'DELETE') then
    raise exception '0027 : DELETE ne devrait pas être accordé à dfa_app sur consigne_echange_standard.';
  end if;
end
$$;
