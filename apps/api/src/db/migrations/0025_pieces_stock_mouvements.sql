-- =============================================================================================
-- 0025_pieces_stock_mouvements.sql — étape 3 (Pièces) : `stock_article`, `mouvement_stock`.
-- Spécification : RP-09→RP-18. Contrats gelés : packages/shared/src/contrats/pieces/{stock,
-- mouvement}.ts.
--
-- CE QUI EST POSÉ ICI :
--   1. `entite_auditee` gagne `mouvement_stock` — usage UNIQUEMENT comme argument de trigger
--      (`auditer_atelier('mouvement_stock')`), donc sûr dans LA MÊME transaction que l'ADD VALUE
--      (doctrine 0016/0022, pas le cas 0023/0024 : aucun INSERT typé ne compare cette valeur ici).
--   2. `stock_article` — quantité PHYSIQUE par (tenant, article, site), RP-09→RP-15. PK naturelle
--      composite (tenant_id, article_id, site_id) — pas de surrogate uuid, aucune table n'a
--      besoin de désigner une ligne de stock autrement que par ce triplet (même esprit que
--      `parametre_site`/`parametre_atelier`, clé confondue avec l'objet qu'elles paramètrent).
--      Porte aussi `quantite_reservee_millieme`, colonne dont la maintenance appartient à 0026
--      (reservation_piece) — posée ICI (valeur par défaut 0) parce que c'est cette table qui la
--      possède, mais AUCUN trigger de ce fichier n'y touche.
--   3. `mouvement_stock` — RP-16→RP-18 : IMMUABLE (aucun GRANT UPDATE ni DELETE — demande
--      explicite de l'orchestrateur, même doctrine que `ligne_document`/`audit_atelier`). Chaque
--      INSERT fait progresser `stock_article.quantite_physique_millieme` par un trigger AFTER
--      INSERT (`mouvement_stock_appliquer_physique`), jamais par l'applicatif directement — le
--      applicatif n'écrit QUE `mouvement_stock`, la quantité physique est un solde DÉRIVÉ, tenu
--      par la base, exactement pour qu'aucun mouvement ne puisse être enregistré sans que le
--      solde n'avance avec lui (ou l'inverse).
--   4. AUCUNE contrainte n'empêche `quantite_physique_millieme` de devenir négatif : RP-15 admet
--      explicitement un forçage journalisé au-delà du DISPONIBLE (physique − réservé), pas
--      seulement du physique — verrouiller le physique à `>= 0` en base interdirait ce forçage
--      que la spec autorise nommément. Le contrôle « refuse sauf forçage » (PP-02) reste une
--      garde APPLICATIVE (le service lit le disponible AVANT d'insérer le mouvement) : la base
--      n'impose que ce qui est un invariant ABSOLU du métier, jamais une politique de rôle.
--      Le contre-exemple qui EST un invariant absolu — la RÉSERVATION ne peut jamais dépasser le
--      disponible, y compris sous concurrence — est posé en 0026, pas ici : c'est
--      `reservation_piece`, pas `mouvement_stock`, qui porte CP-02.
--
-- INDEX : `mouvement_stock_article_idx` sert le seul pattern de lecture du contrat
-- (`GET /articles/{id}/mouvements`, filtré ensuite en mémoire/SQL par type/site/date sur ce
-- même préfixe — le volume par article reste borné, pas besoin d'un index par filtre).
-- =============================================================================================


-- ---------------------------------------------------------------------------------------------
-- 1. `entite_auditee` gagne `mouvement_stock`
-- ---------------------------------------------------------------------------------------------

alter type public.entite_auditee add value if not exists 'mouvement_stock';


-- ---------------------------------------------------------------------------------------------
-- 2. Type enum
-- ---------------------------------------------------------------------------------------------

create type public.type_mouvement_stock as enum (
  'entree_livraison', 'sortie_or', 'sortie_comptoir', 'retour_fournisseur', 'retour_client',
  'transfert', 'ajustement_inventaire', 'casse', 'perte', 'retour_consigne'
);


-- ---------------------------------------------------------------------------------------------
-- 3. `stock_article` — RP-09→RP-15
-- ---------------------------------------------------------------------------------------------

create table public.stock_article (
  tenant_id                            uuid        not null,
  article_id                           uuid        not null,
  site_id                              uuid        not null,
  quantite_physique_millieme           integer     not null default 0,
  -- Maintenue par le trigger de 0026 (reservation_piece), jamais par l'applicatif directement ni
  -- par ce fichier — colonne possédée ici, comportement possédé là-bas.
  quantite_reservee_millieme           integer     not null default 0,
  emplacement                          text        null,
  stock_minimum_millieme               integer     null,
  quantite_commande_standard_millieme  integer     null,
  cree_le                              timestamptz not null default now(),
  modifie_le                           timestamptz not null default now(),

  constraint stock_article_pk primary key (tenant_id, article_id, site_id),
  constraint stock_article_fk_article
    foreign key (tenant_id, article_id) references public.article (tenant_id, id) on delete restrict,
  constraint stock_article_fk_site
    foreign key (tenant_id, site_id) references public.site (tenant_id, id) on delete restrict,
  -- RP-14 : la réservée ne dépasse jamais le physique — invariant ABSOLU (voir le trigger de
  -- 0026, qui l'applique sous verrou de ligne — CP-02). Posé ici comme filet de dernier recours :
  -- même un bug dans le trigger de 0026 ne pourrait pas laisser la table dans un état incohérent.
  constraint stock_article_reservee_non_negative_chk check (quantite_reservee_millieme >= 0),
  constraint stock_article_reservee_leq_physique_chk
    check (quantite_reservee_millieme <= quantite_physique_millieme),
  constraint stock_article_stock_minimum_chk
    check (stock_minimum_millieme is null or stock_minimum_millieme >= 0),
  constraint stock_article_quantite_commande_standard_chk
    check (quantite_commande_standard_millieme is null or quantite_commande_standard_millieme > 0)
);

comment on table public.stock_article is
  'Stock physique par (tenant, article, site) — RP-09→RP-15. quantite_disponible = '
  'quantite_physique_millieme - quantite_reservee_millieme (RP-14, calculé côté lecture, jamais '
  'stocké). quantite_reservee_millieme est maintenue par le trigger de reservation_piece (0026), '
  'sous verrou de ligne — c''est ce qui rend CP-02 sûr sous concurrence, voir 0026. '
  'stock_article_reservee_leq_physique_chk est le filet ultime : la réservée ne dépasse jamais le '
  'physique, quel que soit le chemin d''écriture.';

create trigger stock_article_touche_modifie_le
  before update on public.stock_article
  for each row execute function public.touche_modifie_le();

revoke all    on public.stock_article from dfa_app;
grant  select, insert, update on public.stock_article to dfa_app;

alter table public.stock_article enable row level security;
alter table public.stock_article force  row level security;

create policy stock_article_isolation_tenant on public.stock_article
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy stock_article_migrator on public.stock_article
  to dfa_migrator
  using (true) with check (true);

-- Sert GET /stock/reapprovisionnement?siteId= (RP-12) : la PK démarre par article_id, ce
-- deuxième index sert le préfixe (tenant, site) sans scanner tous les articles du tenant.
create index stock_article_site_idx on public.stock_article (tenant_id, site_id);


-- ---------------------------------------------------------------------------------------------
-- 4. `mouvement_stock` — RP-16→RP-18, IMMUABLE
-- ---------------------------------------------------------------------------------------------

create table public.mouvement_stock (
  id                            uuid                          not null default gen_random_uuid(),
  tenant_id                     uuid                          not null,
  article_id                    uuid                          not null,
  type                          public.type_mouvement_stock    not null,
  -- RP-17 : signée (positive à l'entrée, négative à la sortie) — SAUF transfert, toujours
  -- positive (contrat mouvement.ts) : le sens y est porté par site_source/site_destination, pas
  -- par le signe.
  quantite_millieme             integer                       not null,
  site_id                       uuid                          null,
  site_source_id                uuid                          null,
  site_destination_id           uuid                          null,
  prix_achat_reel_centimes      integer                       null,
  auteur_id                     uuid                          null,
  motif                         text                          null,
  ligne_or_id                   uuid                          null,
  document_vente_ligne_id       uuid                          null,
  commande_fournisseur_ligne_id uuid                          null,
  inventaire_reference_id       uuid                          null,
  reservation_id                uuid                          null,
  cree_le                       timestamptz                   not null default now(),

  constraint mouvement_stock_pk primary key (id),
  constraint mouvement_stock_tenant_id_uk unique (tenant_id, id),
  constraint mouvement_stock_fk_article
    foreign key (tenant_id, article_id) references public.article (tenant_id, id) on delete restrict,
  constraint mouvement_stock_fk_site
    foreign key (tenant_id, site_id) references public.site (tenant_id, id) on delete restrict,
  constraint mouvement_stock_fk_site_source
    foreign key (tenant_id, site_source_id) references public.site (tenant_id, id) on delete restrict,
  constraint mouvement_stock_fk_site_destination
    foreign key (tenant_id, site_destination_id) references public.site (tenant_id, id) on delete restrict,
  -- Accroche atelier (module existant depuis l'étape 1) — composite avec tenant, règle n°1.
  constraint mouvement_stock_fk_ligne_or
    foreign key (tenant_id, ligne_or_id) references public.ligne_or (tenant_id, id) on delete restrict,
  -- Accroche facturation (module existant depuis l'étape 2).
  constraint mouvement_stock_fk_document_vente_ligne
    foreign key (tenant_id, document_vente_ligne_id) references public.ligne_document (tenant_id, id) on delete restrict,
  constraint mouvement_stock_fk_commande_fournisseur_ligne
    foreign key (tenant_id, commande_fournisseur_ligne_id)
    references public.commande_fournisseur_ligne (tenant_id, id) on delete restrict,
  -- `auteur_id` référence utilisateur SANS FK composite déclarée ici volontairement en dur sur la
  -- table utilisateur : même style que ligne_or_fk_technicien (0008), qui EST composite — donc on
  -- l'aligne aussi en composite, par cohérence.
  constraint mouvement_stock_fk_auteur
    foreign key (tenant_id, auteur_id) references public.utilisateur (tenant_id, id) on delete restrict,

  constraint mouvement_stock_quantite_non_nulle_chk check (quantite_millieme <> 0),
  -- RP-17 : transfert TOUJOURS positif, porte les deux sites et jamais site_id seul ; tout autre
  -- type porte site_id seul et jamais les deux sites de transfert.
  constraint mouvement_stock_transfert_signe_chk
    check (type <> 'transfert' or quantite_millieme > 0),
  constraint mouvement_stock_transfert_sites_chk
    check (
      (type = 'transfert' and site_id is null and site_source_id is not null and site_destination_id is not null
         and site_source_id <> site_destination_id)
      or
      (type <> 'transfert' and site_id is not null and site_source_id is null and site_destination_id is null)
    ),
  constraint mouvement_stock_prix_reel_type_chk
    check (type = 'entree_livraison' or prix_achat_reel_centimes is null),
  constraint mouvement_stock_prix_reel_signe_chk
    check (prix_achat_reel_centimes is null or prix_achat_reel_centimes >= 0),
  -- RP-17 : motif OBLIGATOIRE pour casse/perte/ajustement_inventaire/retour_fournisseur/
  -- retour_client — miroir exact des schémas d'entrée (schemaCreationMouvementCasse.motif:
  -- schemaMotif, non optional, etc., mouvement.ts).
  constraint mouvement_stock_motif_requis_chk
    check (
      type not in ('casse', 'perte', 'ajustement_inventaire', 'retour_fournisseur', 'retour_client')
      or motif is not null
    )
);

comment on table public.mouvement_stock is
  'Mouvement de stock (RP-16→RP-18) : IMMUABLE (dfa_app n''a ni UPDATE ni DELETE — une correction '
  'est un mouvement INVERSE tracé, jamais une édition, même doctrine que ligne_document). Chaque '
  'INSERT fait progresser stock_article.quantite_physique_millieme via '
  'mouvement_stock_appliquer_physique (trigger AFTER INSERT ci-dessous). Auditée '
  '(mouvement_stock_audit).';

-- IMMUABILITÉ : ni UPDATE ni DELETE, au-delà du défaut (0002 a déjà retiré DELETE par défaut ;
-- UPDATE reste accordé par défaut à toute nouvelle table — on le retire explicitement, ceinture
-- et bretelles, même style que cle_idempotence Δ6 (0004 §5).
revoke all on public.mouvement_stock from dfa_app;
grant  select, insert on public.mouvement_stock to dfa_app;
revoke update, delete on public.mouvement_stock from dfa_app;

alter table public.mouvement_stock enable row level security;
alter table public.mouvement_stock force  row level security;

create policy mouvement_stock_isolation_tenant on public.mouvement_stock
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy mouvement_stock_migrator on public.mouvement_stock
  to dfa_migrator
  using (true) with check (true);

create trigger mouvement_stock_audit
  after insert or update or delete on public.mouvement_stock
  for each row execute function public.auditer_atelier('mouvement_stock');

-- GET /articles/{id}/mouvements (mouvement.ts, schemaFiltresMouvementsStock) : seul pattern de
-- lecture du contrat, filtré ensuite en mémoire/SQL par type/site/date sur ce même préfixe.
create index mouvement_stock_article_idx on public.mouvement_stock (tenant_id, article_id, cree_le desc);
-- RP-21 : depuis une réservation satisfaite, retrouver son mouvement de sortie (et l'inverse :
-- depuis une ligne d'OR, tout ce qui a été sorti pour elle).
create index mouvement_stock_ligne_or_idx on public.mouvement_stock (tenant_id, ligne_or_id)
  where ligne_or_id is not null;


-- ---------------------------------------------------------------------------------------------
-- 5. `mouvement_stock_appliquer_physique()` — trigger AFTER INSERT
--
-- Fait progresser stock_article.quantite_physique_millieme du montant signé du mouvement.
-- `transfert` est le seul type à toucher DEUX lignes de stock_article dans le même trigger (site
-- source −, site destination +) — cohérent avec RP-13 : « un mouvement UNIQUE, jamais deux
-- mouvements indépendants ».
--
-- `INSERT ... ON CONFLICT DO UPDATE SET quantite_physique_millieme = stock_article.
-- quantite_physique_millieme + excluded.quantite_physique_millieme` : fait naître la ligne
-- stock_article si elle n'existe pas encore (première réception d'un article jamais stocké sur ce
-- site) tout en restant l'écriture ATOMIQUE et VERROUILLANTE habituelle sur la ligne existante —
-- un UPDATE simple échouerait silencieusement (0 ligne affectée) si la ligne n'existe pas encore
-- — cas réel : la toute première réception d'un article jamais stocké sur ce site.
-- ---------------------------------------------------------------------------------------------

create function public.mouvement_stock_appliquer_physique() returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $fn$
begin
  if new.type = 'transfert' then
    insert into public.stock_article (tenant_id, article_id, site_id, quantite_physique_millieme)
    values (new.tenant_id, new.article_id, new.site_source_id, -new.quantite_millieme)
    on conflict (tenant_id, article_id, site_id)
    do update set quantite_physique_millieme =
      public.stock_article.quantite_physique_millieme - new.quantite_millieme;

    insert into public.stock_article (tenant_id, article_id, site_id, quantite_physique_millieme)
    values (new.tenant_id, new.article_id, new.site_destination_id, new.quantite_millieme)
    on conflict (tenant_id, article_id, site_id)
    do update set quantite_physique_millieme =
      public.stock_article.quantite_physique_millieme + new.quantite_millieme;
  else
    insert into public.stock_article (tenant_id, article_id, site_id, quantite_physique_millieme)
    values (new.tenant_id, new.article_id, new.site_id, new.quantite_millieme)
    on conflict (tenant_id, article_id, site_id)
    do update set quantite_physique_millieme =
      public.stock_article.quantite_physique_millieme + new.quantite_millieme;
  end if;

  -- RP-29 : le prix réellement payé à réception devient le prix d'achat courant de l'article
  -- (dernier prix connu — QP-04 laisse ouverte la méthode de valorisation, mais l'article DOIT
  -- porter UNE valeur lisible ; « dernier prix » est le seul choix que ce trigger peut faire sans
  -- préjuger de QP-04, une moyenne pondérée nécessiterait un historique que ce module ne tient
  -- pas). Jamais réécrit par ailleurs (RP-33).
  if new.type = 'entree_livraison' and new.prix_achat_reel_centimes is not null then
    update public.article
       set prix_achat_centimes = new.prix_achat_reel_centimes
     where tenant_id = new.tenant_id and id = new.article_id;
  end if;

  return null;
end
$fn$;

comment on function public.mouvement_stock_appliquer_physique() is
  'Trigger AFTER INSERT sur mouvement_stock : fait progresser stock_article.'
  'quantite_physique_millieme (RP-16). transfert touche DEUX lignes (source −, destination +), '
  'RP-13. entree_livraison avec prix_achat_reel_centimes met à jour article.prix_achat_centimes '
  '(dernier prix connu, RP-29/RP-33/QP-04).';

revoke all     on function public.mouvement_stock_appliquer_physique() from public;
grant  execute on function public.mouvement_stock_appliquer_physique() to   dfa_app, dfa_migrator;

create trigger mouvement_stock_appliquer_physique
  after insert on public.mouvement_stock
  for each row execute function public.mouvement_stock_appliquer_physique();


-- ---------------------------------------------------------------------------------------------
-- 6. Assertions de fin de migration
-- ---------------------------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_enum e join pg_catalog.pg_type t on t.oid = e.enumtypid
     where t.typname = 'entite_auditee' and e.enumlabel = 'mouvement_stock'
  ) then
    raise exception '0025 : entite_auditee ne porte pas la valeur mouvement_stock après migration.';
  end if;

  if has_table_privilege('dfa_app', 'public.mouvement_stock', 'UPDATE')
     or has_table_privilege('dfa_app', 'public.mouvement_stock', 'DELETE') then
    raise exception '0025 : mouvement_stock doit être IMMUABLE — ni UPDATE ni DELETE pour dfa_app.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_trigger tg
      join pg_catalog.pg_class c on c.oid = tg.tgrelid
     where c.relname = 'mouvement_stock' and tg.tgname = 'mouvement_stock_appliquer_physique'
       and not tg.tgisinternal
  ) then
    raise exception '0025 : trigger mouvement_stock_appliquer_physique absent.';
  end if;
end
$$;
