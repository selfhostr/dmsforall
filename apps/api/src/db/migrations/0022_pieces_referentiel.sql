-- =============================================================================================
-- 0022_pieces_referentiel.sql — étape 3 (Pièces), premier étage : `fournisseur`, `article`,
-- `article_reference`. Spécification : docs/specification-etape-3-pieces.md, RP-01→RP-08,
-- RP-26 (fournisseur minimal). Contrats gelés : packages/shared/src/contrats/pieces/{article,
-- fournisseur}.ts, enums.ts, primitives.ts.
--
-- CE QUI EST POSÉ ICI :
--   1. Trois types enum (`statut_fournisseur`, `statut_article`, `type_reference_article`,
--      `categorie_article`) — miroir exact des tableaux `@dfa/shared` (contrats/pieces/enums.ts).
--   2. `fournisseur` — minimal (RP-26 : nom, coordonnées, délai habituel ; pas de fiche complète,
--      hors périmètre étape 3).
--   3. `article` — le référentiel pièce (RP-01, RP-04, RP-06, RP-08, RP-32→36). Numérotation
--      interne automatique (RP-08) par une SEQUENCE globale (pas de reset annuel/par site,
--      contrairement à `compteur_document` — aucune règle métier ne l'exige ici) : plus simple et
--      non bloquant qu'un compteur par tenant, et l'unicité PAR TENANT (contrainte réelle) en
--      découle trivialement puisqu'une séquence globale est *a fortiori* unique par tenant.
--   4. `article_reference` — 0..n références alternatives par article, typées (RP-02, RP-03).
--      DÉCISION DE CONCEPTION (hors périmètre métier, assumée ici comme le prévoit §8 de la
--      spec) : `reference` est UNIQUE PAR TENANT, tous types confondus — pas seulement
--      `(article_id, type, reference)`. C'est ce qui rend RP-03 vrai EN BASE : « la recherche
--      d'article doit aboutir quelle que soit la référence saisie… jamais créer de doublon » n'a
--      de sens que si une même chaîne de référence ne peut jamais désigner deux articles
--      différents. Cette contrainte est plus stricte que ce que le commentaire du contrat
--      (`article.ts`) décrit littéralement (« upsert sur (articleId, type, reference) ») —
--      SIGNALÉ à l'orchestrateur : le service d'écriture doit upsert sur `(tenant_id,
--      reference)`, pas sur le triplet, et un article DIFFÉRENT qui tente la même référence doit
--      lire un 409 ARTICLE_REFERENCE_COLLISION avant d'écrire, pas compter sur un ON CONFLICT
--      DO UPDATE qui écraserait silencieusement l'article propriétaire.
--   5. `article.reference_remplacement_id` — FK vers `article_reference` (PAS vers un autre
--      article) : RP-04 dit littéralement qu'un article obsolète porte une « référence de
--      remplacement… si elle existe (`remplace_par`) » — c'est la ligne `article_reference` de
--      type `remplace_par` qui documente CETTE référence de succession, pas nécessairement un
--      second article DFA (la pièce de remplacement peut n'avoir jamais été commandée par ce
--      garage). La cohérence « appartient au même article, type = remplace_par » N'EST PAS
--      vérifiée en base (nécessiterait un trigger de validation croisée) : contrôle SERVEUR,
--      comme l'exige déjà `schemaMarquageObsolete` (contrat, contrôle conditionnel à l'état des
--      références) — assumé et documenté, pas un oubli.
--
-- AUDIT : `entite_auditee` gagne `article` (RP sensible : référentiel pièce, prix, statut
-- obsolète/désactivé). `fournisseur` et `article_reference` NE SONT PAS ajoutés : ni RP-31 ni
-- CONTRIBUTING.md ne les citent, et l'orchestrateur n'a demandé que article/mouvement_stock/
-- commande_fournisseur/consigne_echange_standard — ajouter au-delà serait inventer une valeur.
--
-- RÉVERSIBILITÉ : le DOWN retire triggers, tables, séquence et les TROIS nouveaux types SAUF
-- `entite_auditee` : PostgreSQL n'a pas de DROP VALUE sur un enum existant, même limite acceptée
-- que 0010/0016 — voir down/0022_pieces_referentiel.down.sql.
-- =============================================================================================


-- ---------------------------------------------------------------------------------------------
-- 1. Types enum — miroir exact de contrats/pieces/enums.ts
-- ---------------------------------------------------------------------------------------------

create type public.statut_fournisseur as enum ('actif', 'inactif');

create type public.statut_article as enum ('actif', 'obsolete', 'desactive');

create type public.type_reference_article as enum ('equivalente', 'remplace_par', 'fournisseur');

create type public.categorie_article as enum (
  'piece_mecanique', 'piece_carrosserie', 'pneu', 'lubrifiant', 'produit_atelier', 'fourniture'
);

-- `entite_auditee` gagne `article` — même dispositif que 0010/0016 (ALTER TYPE ... ADD VALUE dans
-- la même transaction que le trigger qui l'utilise, sûr : voir 0016 §tête pour la preuve détaillée
-- déjà faite sur cette base, non reproduite ici).
alter type public.entite_auditee add value if not exists 'article';


-- ---------------------------------------------------------------------------------------------
-- 2. `fournisseur` — RP-26, minimal
-- ---------------------------------------------------------------------------------------------

create table public.fournisseur (
  id                   uuid                     not null default gen_random_uuid(),
  tenant_id            uuid                     not null references public.tenant (id) on delete restrict,
  nom                  text                     not null,
  email                text                     null,
  telephone            text                     null,
  delai_habituel_jours smallint                 null,
  statut               public.statut_fournisseur not null default 'actif',
  cree_le              timestamptz              not null default now(),
  modifie_le           timestamptz              not null default now(),

  constraint fournisseur_pk primary key (id),
  constraint fournisseur_tenant_id_uk unique (tenant_id, id),
  constraint fournisseur_nom_non_vide_chk check (length(btrim(nom)) > 0),
  -- Même motif que client_telephone_e164_chk (0006) : schemaTelephoneE164 valide déjà ce format
  -- côté contrat, la base le garantit aussi (RM-01 : la base ne fait jamais confiance seule à
  -- l'applicatif pour une contrainte de forme qu'elle peut vérifier elle-même).
  constraint fournisseur_telephone_e164_chk
    check (telephone is null or telephone ~ '^\+[1-9][0-9]{6,14}$'),
  constraint fournisseur_delai_habituel_chk
    check (delai_habituel_jours is null or delai_habituel_jours between 0 and 3650)
);

comment on table public.fournisseur is
  'Fournisseur minimal (RP-26, §1 spec étape 3) : nom, coordonnées, délai habituel. La fiche '
  'complète (conditions cadre, EDI constructeur) est hors périmètre étape 3.';

create trigger fournisseur_touche_modifie_le
  before update on public.fournisseur
  for each row execute function public.touche_modifie_le();

revoke all    on public.fournisseur from dfa_app;
grant  select, insert, update on public.fournisseur to dfa_app;

alter table public.fournisseur enable row level security;
alter table public.fournisseur force  row level security;

create policy fournisseur_isolation_tenant on public.fournisseur
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy fournisseur_migrator on public.fournisseur
  to dfa_migrator
  using (true) with check (true);

create index fournisseur_nom_idx on public.fournisseur (tenant_id, nom);
create index fournisseur_pagination_idx on public.fournisseur (tenant_id, cree_le desc, id desc);


-- ---------------------------------------------------------------------------------------------
-- 3. Numérotation d'article — séquence globale + trigger d'attribution
--
-- Format arbitraire, non prescrit par la spec (RP-08 exige seulement « unique par tenant, généré
-- automatiquement ») : `P-######`. Aucun préfixe/portée paramétrable façon `parametre_atelier.
-- or_prefixe` n'est demandé par la spec pour l'article — ne pas en inventer un.
-- ---------------------------------------------------------------------------------------------

create sequence public.article_numero_seq as bigint start with 1 increment by 1;

create function public.attribuer_numero_article() returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $fn$
begin
  if new.numero_article is null then
    new.numero_article := 'P-' || lpad(nextval('public.article_numero_seq')::text, 6, '0');
  end if;
  return new;
end
$fn$;

comment on function public.attribuer_numero_article() is
  'Trigger BEFORE INSERT sur article : attribue numero_article depuis article_numero_seq si '
  'absent (RP-08). Séquence GLOBALE (pas de reset annuel/par tenant, aucune règle métier ne '
  'l''exige) : l''unicité PAR TENANT (contrainte réelle, article_tenant_numero_uk) en découle '
  'trivialement.';

revoke all     on function public.attribuer_numero_article() from public;
grant  execute on function public.attribuer_numero_article() to   dfa_app, dfa_migrator;


-- ---------------------------------------------------------------------------------------------
-- 4. `article` — RP-01, RP-04, RP-06, RP-08, RP-32→36
-- ---------------------------------------------------------------------------------------------

create table public.article (
  id                          uuid                       not null default gen_random_uuid(),
  tenant_id                   uuid                       not null references public.tenant (id) on delete restrict,
  numero_article              text                       null, -- attribué par trigger si absent
  designation                 text                       not null,
  marque                      text                       null,
  categorie                   public.categorie_article   not null,
  statut                      public.statut_article       not null default 'actif',
  reference_principale        text                       not null,
  code_barres                 text                       null,
  -- RP-33 : jamais réécrit par une saisie manuelle, uniquement par un mouvement d'entrée
  -- (entree_livraison) — voir 0024. NULL tant qu'aucune réception n'a eu lieu.
  prix_achat_centimes         integer                    null,
  prix_vente_ttc_centimes     integer                    not null,
  taux_tva_pourmille          smallint                   not null default 81,
  est_echange_standard        boolean                    not null default false,
  montant_consigne_ttc_centimes integer                  null,
  -- RP-04 : FK vers article_reference (voir §1 en-tête), pas vers un autre article. Ajoutée par
  -- ALTER après création de article_reference (§5) — ordre de création, pas de contrainte
  -- circulaire.
  reference_remplacement_id   uuid                       null,
  cree_le                     timestamptz                not null default now(),
  modifie_le                  timestamptz                not null default now(),

  constraint article_pk primary key (id),
  constraint article_tenant_id_uk unique (tenant_id, id),
  constraint article_designation_non_vide_chk check (length(btrim(designation)) > 0),
  constraint article_reference_principale_non_vide_chk check (length(btrim(reference_principale)) > 0),
  constraint article_prix_vente_chk check (prix_vente_ttc_centimes >= 0),
  constraint article_prix_achat_chk check (prix_achat_centimes is null or prix_achat_centimes >= 0),
  constraint article_taux_tva_chk check (taux_tva_pourmille between 0 and 1000),
  -- RP-37/RP-38 : montant de consigne obligatoire et UNIQUEMENT si est_echange_standard — miroir
  -- exact du .refine() de schemaCreationArticle.
  constraint article_consigne_coherente_chk
    check (est_echange_standard = (montant_consigne_ttc_centimes is not null)),
  constraint article_montant_consigne_chk
    check (montant_consigne_ttc_centimes is null or montant_consigne_ttc_centimes >= 0)
);

comment on table public.article is
  'Référentiel pièce (RP-01→RP-08) : existe indépendamment de tout stock. numero_article généré '
  'par attribuer_numero_article() si absent à l''INSERT. prix_achat_centimes n''est jamais écrit '
  'par une saisie manuelle : uniquement par un mouvement entree_livraison (0024). Auditée '
  '(article_audit, auditer_atelier(''article'')).';

create trigger article_attribuer_numero
  before insert on public.article
  for each row execute function public.attribuer_numero_article();

create trigger article_touche_modifie_le
  before update on public.article
  for each row execute function public.touche_modifie_le();

create trigger article_audit
  after insert or update or delete on public.article
  for each row execute function public.auditer_atelier('article');

revoke all    on public.article from dfa_app;
grant  select, insert, update on public.article to dfa_app;

alter table public.article enable row level security;
alter table public.article force  row level security;

create policy article_isolation_tenant on public.article
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy article_migrator on public.article
  to dfa_migrator
  using (true) with check (true);

-- Unique PARTIEL (numero_article NULL tant que le trigger n'a pas tourné — impossible en
-- pratique après INSERT, mais la colonne reste nullable pour une reprise verbatim future, même
-- doctrine que ordre_reparation.numero_origine, 0011) : posé en SQL brut, non modélisable par
-- `unique()` de Drizzle pg-core (pas de clause WHERE).
create unique index article_tenant_numero_uk on public.article (tenant_id, numero_article)
  where numero_article is not null;

-- Recherche/filtrage (RP-03, schemaFiltresArticles : q sur designation/référence, categorie[],
-- statut[]) — designation en tête : c'est le tri par défaut (TRI_DEFAUT_ARTICLES) ET le champ le
-- plus discriminant pour une recherche texte préfixée côté service.
create index article_designation_idx on public.article (tenant_id, designation);
create index article_reference_principale_idx on public.article (tenant_id, reference_principale);
create index article_statut_idx on public.article (tenant_id, statut);
create index article_pagination_idx on public.article (tenant_id, cree_le desc, id desc);


-- ---------------------------------------------------------------------------------------------
-- 5. `article_reference` — RP-02, RP-03
-- ---------------------------------------------------------------------------------------------

create table public.article_reference (
  id             uuid                            not null default gen_random_uuid(),
  tenant_id      uuid                            not null,
  article_id     uuid                            not null,
  type           public.type_reference_article    not null,
  reference      text                            not null,
  fournisseur_id uuid                            null,
  cree_le        timestamptz                     not null default now(),

  constraint article_reference_pk primary key (id),
  constraint article_reference_tenant_id_uk unique (tenant_id, id),
  constraint article_reference_fk_article
    foreign key (tenant_id, article_id) references public.article (tenant_id, id) on delete restrict,
  constraint article_reference_fk_fournisseur
    foreign key (tenant_id, fournisseur_id) references public.fournisseur (tenant_id, id) on delete restrict,
  constraint article_reference_non_vide_chk check (length(btrim(reference)) > 0),
  -- RP-02 : fournisseur_id obligatoire et UNIQUEMENT pour type = 'fournisseur' — miroir du
  -- .refine() de schemaCreationReferenceArticle.
  constraint article_reference_fournisseur_coherent_chk
    check ((type = 'fournisseur') = (fournisseur_id is not null)),
  -- Voir §1 en-tête : unique PAR TENANT, tous types/articles confondus — c'est ce qui rend
  -- RP-03 vrai en base et ce que le service doit cibler par son ON CONFLICT (signalé, pas le
  -- (article_id, type, reference) que le commentaire du contrat évoque littéralement).
  constraint article_reference_tenant_reference_uk unique (tenant_id, reference)
);

comment on table public.article_reference is
  'Références alternatives d''un article (RP-02) : equivalente/remplace_par/fournisseur. '
  'reference est UNIQUE PAR TENANT (article_reference_tenant_reference_uk), tous types '
  'confondus — une référence n''appartient jamais qu''à un seul article, c''est ce qui rend RP-03 '
  '(recherche par n''importe quelle référence connue, jamais de doublon) vrai en base.';

revoke all    on public.article_reference from dfa_app;
grant  select, insert, update on public.article_reference to dfa_app;

alter table public.article_reference enable row level security;
alter table public.article_reference force  row level security;

create policy article_reference_isolation_tenant on public.article_reference
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy article_reference_migrator on public.article_reference
  to dfa_migrator
  using (true) with check (true);

create index article_reference_article_idx on public.article_reference (tenant_id, article_id);
create index article_reference_fournisseur_idx on public.article_reference (tenant_id, fournisseur_id)
  where fournisseur_id is not null;

-- Maintenant que article_reference existe : la FK de RP-04 sur article.reference_remplacement_id.
alter table public.article
  add constraint article_fk_reference_remplacement
  foreign key (tenant_id, reference_remplacement_id)
  references public.article_reference (tenant_id, id) on delete restrict;

create index article_reference_remplacement_idx on public.article (tenant_id, reference_remplacement_id)
  where reference_remplacement_id is not null;


-- ---------------------------------------------------------------------------------------------
-- 6. Assertions de fin de migration
-- ---------------------------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_enum e join pg_catalog.pg_type t on t.oid = e.enumtypid
     where t.typname = 'entite_auditee' and e.enumlabel = 'article'
  ) then
    raise exception '0022 : entite_auditee ne porte pas la valeur article après migration.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_trigger tg
      join pg_catalog.pg_class c on c.oid = tg.tgrelid
      join pg_catalog.pg_proc p on p.oid = tg.tgfoid
     where c.relname = 'article' and tg.tgname = 'article_audit' and p.proname = 'auditer_atelier'
       and not tg.tgisinternal
  ) then
    raise exception '0022 : trigger article_audit absent ou ne pointe pas vers auditer_atelier().';
  end if;

  if has_table_privilege('dfa_app', 'public.article', 'DELETE')
     or has_table_privilege('dfa_app', 'public.article_reference', 'DELETE')
     or has_table_privilege('dfa_app', 'public.fournisseur', 'DELETE') then
    raise exception '0022 : DELETE ne devrait être accordé à dfa_app sur aucune des trois tables (RP-07, désactivation logique).';
  end if;
end
$$;
