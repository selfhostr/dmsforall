-- =============================================================================================
-- 0026_pieces_reservation.sql — étape 3 (Pièces) : `reservation_piece`. LE CŒUR DU SUJET
-- (RP-19→RP-25, §6.3, CP-02/CP-03). Contrat gelé : packages/shared/src/contrats/pieces/
-- reservation.ts.
--
-- LA GARANTIE, ET COMMENT ELLE EST TENUE EN BASE (pas seulement en applicatif) :
--
--   « stock disponible = stock physique − réservations actives » (RP-14), et deux transactions
--   concurrentes qui veulent le DERNIER exemplaire ne doivent jamais pouvoir réserver toutes les
--   deux (CP-02). Mécanisme retenu : ni CHECK seul, ni EXCLUDE — un VERROU DE LIGNE explicite
--   (`select … for update` sur `stock_article`) posé par un trigger BEFORE INSERT
--   (`reservation_piece_verrouiller_stock`, §3), qui SÉRIALISE toute paire de créations
--   concurrentes sur le MÊME (tenant, article, site) : la seconde transaction attend que la
--   première commit (ou rollback) avant même de pouvoir LIRE le disponible, donc avant de décider
--   si sa réservation tient. C'est la même technique que le transfert bancaire canonique
--   (`UPDATE comptes SET solde = solde - x WHERE id = ...`) — le verrou de ligne PostgreSQL
--   garantit qu'aucune second writer ne peut fonder sa décision sur une valeur périmée.
--
--   `stock_article_reservee_leq_physique_chk` (0025) reste le filet de dernier recours : même un
--   bug dans ce trigger ne pourrait pas laisser `quantite_reservee_millieme` dépasser
--   `quantite_physique_millieme` sans faire échouer l'UPDATE en base.
--
--   PAS de CHECK permanent « réservée ≤ physique » appliqué à `mouvement_stock` (RP-15 autorise
--   explicitement un forçage qui fait passer le disponible sous zéro, décision déjà actée en
--   0025 §tête) — la garantie absolue ne porte QUE sur la création d'une réservation NOUVELLE,
--   pas sur l'état du stock à tout instant. C'est exactement ce que RP-19/RP-24 demandent : une
--   ligne qui ne PEUT PAS obtenir de réservation bascule `blocage = 'pieces'`, elle n'obtient
--   jamais une réservation partielle ou optimiste.
--
-- MACHINE À ÉTATS (§6.3) : `active → satisfaite | liberee`, deux états TERMINAUX. PAS câblée sur
-- le dispositif générique `transition_autorisee`/`verifier_transition()` (0003) — décision de
-- conception assumée : cette machine a EXACTEMENT deux issues depuis un seul état de départ, sa
-- légalité tient en une ligne de PL/pgSQL (`old.statut = 'active'`), et la coupler au référentiel
-- générique aurait exigé d'ajouter `reservation_piece` à `entite_auditee` pour la seule table de
-- transitions — sans bénéfice réel (`GET /referentiel/transitions` n'est pas consommé par le
-- contrat `reservation.ts`, qui n'expose que deux actions nommées). Le garde-fou est posé ICI,
-- dans `reservation_piece_transition()` (§4), avec le même SQLSTATE `ZDFA1` que le dispositif
-- générique, pour que la couche applicative le traduise de la même façon.
--
-- NOUVEAU SQLSTATE : `ZDFA4` — capacité de réservation insuffisante (CP-02). Famille du produit
-- (voir 0003 §6) : ZDFA1 transition interdite, ZDFA2 écriture sur entité verrouillée, ZDFA3 champ
-- figé, **ZDFA4 capacité insuffisante (nouveau, posé ici)**.
--
-- PAS D'AUDIT : `reservation_piece` n'est pas dans la liste explicite (article, mouvement_stock,
-- commande_fournisseur, consigne_echange_standard) — ajouter une valeur `entite_auditee`
-- supplémentaire ici serait inventer une exigence. Sa propre ligne EST déjà une trace complète
-- (créée une fois, deux colonnes de bornage `satisfaite_le`/`liberee_le`, jamais réécrite après
-- son premier état terminal — voir §4) : la table se lit elle-même comme un journal.
-- =============================================================================================


-- ---------------------------------------------------------------------------------------------
-- 1. Types enum
-- ---------------------------------------------------------------------------------------------

create type public.statut_reservation_piece as enum ('active', 'satisfaite', 'liberee');

create type public.motif_liberation_reservation as enum (
  'annulation_ligne', 'refus_devis', 'liberation_manuelle'
);


-- ---------------------------------------------------------------------------------------------
-- 2. `reservation_piece`
-- ---------------------------------------------------------------------------------------------

create table public.reservation_piece (
  id                          uuid                                not null default gen_random_uuid(),
  tenant_id                   uuid                                not null,
  article_id                  uuid                                not null,
  site_id                     uuid                                not null,
  ligne_or_id                 uuid                                not null,
  ordre_reparation_id         uuid                                not null,
  quantite_millieme           integer                             not null,
  statut                      public.statut_reservation_piece      not null default 'active',
  cree_le                     timestamptz                         not null default now(),
  satisfaite_le               timestamptz                         null,
  mouvement_sortie_id         uuid                                null,
  liberee_le                  timestamptz                         null,
  motif_liberation            public.motif_liberation_reservation  null,
  motif_liberation_texte      text                                null,
  liberee_par_utilisateur_id  uuid                                null,

  constraint reservation_piece_pk primary key (id),
  constraint reservation_piece_tenant_id_uk unique (tenant_id, id),
  -- RP-19 : une ligne d'OR pièce produit AU PLUS une réservation, jamais deux.
  constraint reservation_piece_tenant_ligne_or_uk unique (tenant_id, ligne_or_id),

  constraint reservation_piece_fk_stock
    foreign key (tenant_id, article_id, site_id)
    references public.stock_article (tenant_id, article_id, site_id) on delete restrict,
  constraint reservation_piece_fk_ligne_or
    foreign key (tenant_id, ligne_or_id) references public.ligne_or (tenant_id, id) on delete restrict,
  constraint reservation_piece_fk_ordre_reparation
    foreign key (tenant_id, ordre_reparation_id) references public.ordre_reparation (tenant_id, id) on delete restrict,
  constraint reservation_piece_fk_mouvement_sortie
    foreign key (tenant_id, mouvement_sortie_id) references public.mouvement_stock (tenant_id, id) on delete restrict,
  constraint reservation_piece_fk_liberee_par
    foreign key (tenant_id, liberee_par_utilisateur_id) references public.utilisateur (tenant_id, id) on delete restrict,

  constraint reservation_piece_quantite_chk check (quantite_millieme > 0),

  -- Cohérence stricte par état (§6.3) : chaque état terminal renseigne exactement ses propres
  -- colonnes, jamais celles de l'autre issue.
  constraint reservation_piece_active_coherente_chk
    check (statut <> 'active' or (
      satisfaite_le is null and mouvement_sortie_id is null and
      liberee_le is null and motif_liberation is null and motif_liberation_texte is null
    )),
  constraint reservation_piece_satisfaite_coherente_chk
    check (statut <> 'satisfaite' or (
      satisfaite_le is not null and mouvement_sortie_id is not null and
      liberee_le is null and motif_liberation is null
    )),
  constraint reservation_piece_liberee_coherente_chk
    check (statut <> 'liberee' or (
      liberee_le is not null and motif_liberation is not null and
      satisfaite_le is null and mouvement_sortie_id is null
    )),
  -- RP-23 : motif_liberation_texte obligatoire ET UNIQUEMENT pour le geste manuel du magasinier
  -- (troisième cas) — miroir du commentaire de reservation.ts::ReponseReservationPiece.
  constraint reservation_piece_motif_texte_chk
    check ((motif_liberation = 'liberation_manuelle') = (motif_liberation_texte is not null))
);

comment on table public.reservation_piece is
  'Réservation d''une pièce pour une ligne d''OR précise (RP-19→RP-25, §6.3) — LE cœur du sujet '
  '(CP-02). active retire quantite_millieme du disponible (stock_article.'
  'quantite_reservee_millieme, maintenue par reservation_piece_verrouiller_stock/'
  '_liberer_stock ci-dessous, sous verrou de ligne). satisfaite/liberee sont TERMINALES. Pas '
  'd''UPDATE au-delà de la transition unique active -> {satisfaite,liberee} — voir '
  'reservation_piece_transition().';

revoke all    on public.reservation_piece from dfa_app;
grant  select, insert, update on public.reservation_piece to dfa_app;

alter table public.reservation_piece enable row level security;
alter table public.reservation_piece force  row level security;

create policy reservation_piece_isolation_tenant on public.reservation_piece
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy reservation_piece_migrator on public.reservation_piece
  to dfa_migrator
  using (true) with check (true);

-- ReponseDisponibiliteArticle.reservationsActives (stock.ts) : lister les réservations actives
-- d'un (article, site) — le pattern de lecture le plus chaud de tout ce module.
create index reservation_piece_disponibilite_idx
  on public.reservation_piece (tenant_id, article_id, site_id, statut);
-- schemaFiltresReservations.ordreReparationId (reservation.ts) : vue transverse par OR.
create index reservation_piece_ordre_reparation_idx
  on public.reservation_piece (tenant_id, ordre_reparation_id, statut);
create index reservation_piece_pagination_idx
  on public.reservation_piece (tenant_id, cree_le desc, id desc);


-- ---------------------------------------------------------------------------------------------
-- 3. `reservation_piece_verrouiller_stock()` — BEFORE INSERT, LA PREUVE DE CP-02
--
-- `select … for update` verrouille la ligne stock_article AVANT toute décision : une seconde
-- transaction concurrente sur le MÊME (tenant, article, site) reste bloquée sur ce SELECT jusqu'à
-- ce que la première commit (le disponible qu'elle lit alors est donc à jour) ou rollback (le
-- verrou est libéré sans avoir rien changé). Aucune fenêtre entre « lire le disponible » et
-- « incrémenter le réservé » où un second writer pourrait s'insérer : les deux opérations sont
-- dans LA MÊME transaction, sous LE MÊME verrou de ligne.
-- ---------------------------------------------------------------------------------------------

create function public.reservation_piece_verrouiller_stock() returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $fn$
declare
  v_physique  integer;
  v_reservee  integer;
  v_disponible integer;
begin
  select s.quantite_physique_millieme, s.quantite_reservee_millieme
    into v_physique, v_reservee
    from public.stock_article s
   where s.tenant_id = new.tenant_id and s.article_id = new.article_id and s.site_id = new.site_id
     for update;

  if not found then
    raise exception using
      errcode = 'ZDFA4',
      message = format(
        'Aucune ligne de stock pour l''article %s sur le site %s : réservation impossible.',
        new.article_id, new.site_id
      ),
      hint = 'Créer la ligne stock_article (PATCH /articles/{id}/stock/{siteId}) avant de réserver, ou laisser la ligne d''OR basculer blocage=''pieces''.';
  end if;

  v_disponible := v_physique - v_reservee;

  if new.quantite_millieme > v_disponible then
    raise exception using
      errcode = 'ZDFA4',
      message = format(
        'Stock insuffisant pour réserver l''article %s sur le site %s : disponible %s, demandé %s.',
        new.article_id, new.site_id, v_disponible, new.quantite_millieme
      ),
      detail = format(
        'tenant=%s;article=%s;site=%s;disponible=%s;demande=%s',
        new.tenant_id, new.article_id, new.site_id, v_disponible, new.quantite_millieme
      ),
      hint = 'La ligne d''OR doit basculer blocage=''pieces'' plutôt que de forcer cette réservation (RP-24).';
  end if;

  -- Toujours sous le même verrou : aucune fenêtre de concurrence entre la lecture ci-dessus et
  -- cette écriture.
  update public.stock_article
     set quantite_reservee_millieme = quantite_reservee_millieme + new.quantite_millieme
   where tenant_id = new.tenant_id and article_id = new.article_id and site_id = new.site_id;

  return new;
end
$fn$;

comment on function public.reservation_piece_verrouiller_stock() is
  'Trigger BEFORE INSERT sur reservation_piece : verrouille (select … for update) la ligne '
  'stock_article ciblée, vérifie que le disponible couvre quantite_millieme, incrémente '
  'quantite_reservee_millieme SOUS LE MÊME VERROU. C''est ce qui rend CP-02 sûr sous concurrence '
  '— voir la preuve de livraison (deux transactions concurrentes, une échoue).';

revoke all     on function public.reservation_piece_verrouiller_stock() from public;
grant  execute on function public.reservation_piece_verrouiller_stock() to   dfa_app, dfa_migrator;

create trigger reservation_piece_verrouiller_stock
  before insert on public.reservation_piece
  for each row execute function public.reservation_piece_verrouiller_stock();


-- ---------------------------------------------------------------------------------------------
-- 4. `reservation_piece_transition()` — BEFORE UPDATE : légalité de la transition + libération
--
-- Deux responsabilités dans un seul trigger, volontairement : la libération de
-- `quantite_reservee_millieme` ne doit JAMAIS pouvoir se produire sans que la transition qui la
-- déclenche soit elle-même légale — les découpler en deux triggers séparés créerait une fenêtre
-- où l'un s'exécute sans l'autre selon l'ordre d'exécution des triggers (non garanti au-delà de
-- l'ordre alphabétique des noms, fragile).
-- ---------------------------------------------------------------------------------------------

create function public.reservation_piece_transition() returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $fn$
begin
  if old.statut is not distinct from new.statut then
    return new;
  end if;

  if old.statut <> 'active' then
    raise exception using
      errcode = 'ZDFA1',
      message = format('Transition %s → %s interdite sur reservation_piece : %s est un état terminal.', old.statut, new.statut, old.statut),
      table   = 'reservation_piece';
  end if;

  if new.statut not in ('satisfaite', 'liberee') then
    raise exception using
      errcode = 'ZDFA1',
      message = format('Transition active → %s interdite sur reservation_piece.', new.statut),
      hint    = 'Depuis active, seules satisfaite et liberee sont atteignables (§6.3).',
      table   = 'reservation_piece';
  end if;

  -- Libère la quantité réservée, sous verrou de ligne (UPDATE classique = verrou), quelle que
  -- soit l'issue (satisfaite = mouvement de sortie réel généré côté service AVANT cet UPDATE ;
  -- liberee = rendue au disponible sans mouvement).
  update public.stock_article
     set quantite_reservee_millieme = quantite_reservee_millieme - old.quantite_millieme
   where tenant_id = old.tenant_id and article_id = old.article_id and site_id = old.site_id;

  return new;
end
$fn$;

comment on function public.reservation_piece_transition() is
  'Trigger BEFORE UPDATE sur reservation_piece : garde-fou de légalité (active -> '
  '{satisfaite,liberee} uniquement, ZDFA1) ET libération de stock_article.'
  'quantite_reservee_millieme dans le MÊME trigger — jamais l''une sans l''autre. Pas câblé sur '
  'transition_autorisee/verifier_transition (0003) : décision assumée, voir l''en-tête de '
  '0026_pieces_reservation.sql.';

revoke all     on function public.reservation_piece_transition() from public;
grant  execute on function public.reservation_piece_transition() to   dfa_app;

create trigger reservation_piece_transition
  before update on public.reservation_piece
  for each row execute function public.reservation_piece_transition();


-- ---------------------------------------------------------------------------------------------
-- 5. Assertions de fin de migration
-- ---------------------------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_trigger tg join pg_catalog.pg_class c on c.oid = tg.tgrelid
     where c.relname = 'reservation_piece' and tg.tgname = 'reservation_piece_verrouiller_stock'
       and not tg.tgisinternal
  ) then
    raise exception '0026 : trigger reservation_piece_verrouiller_stock absent.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_trigger tg join pg_catalog.pg_class c on c.oid = tg.tgrelid
     where c.relname = 'reservation_piece' and tg.tgname = 'reservation_piece_transition'
       and not tg.tgisinternal
  ) then
    raise exception '0026 : trigger reservation_piece_transition absent.';
  end if;
end
$$;
