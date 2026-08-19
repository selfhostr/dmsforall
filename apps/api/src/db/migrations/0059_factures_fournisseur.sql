-- =============================================================================================
-- 0059_factures_fournisseur.sql — lecture automatique des factures fournisseurs. Périmètre :
-- apps/api/src/pieces/factures-fournisseur/.
--
-- NUMÉROTATION : 0058 est la dernière migration existante au moment où cette tâche démarre.
-- Numéro 0059 réservé par consigne de tâche (un autre agent construit les écrans EN PARALLÈLE,
-- ne touche à aucune migration ; quatre autres agents travaillent dans site/, sans rapport).
--
-- LE BESOIN, EN UNE PHRASE : le magasinier dépose la facture d'un fournisseur, le système la
-- rattache à la commande fournisseur correspondante et signale les écarts de prix/quantité —
-- c'est là qu'un garage perd de l'argent sans le voir.
--
-- QUATRE TABLES, ET POURQUOI QUATRE PAS UNE :
--
--   1. `facture_fournisseur_document` — le BINAIRE (bytea), SÉPARÉ de l'en-tête exprès : une
--      LISTE de factures ne doit jamais charger l'octet du PDF (§4 « pense au volume » de la
--      tâche — de l'ordre de 5 Go/dix ans par garage). `dfa_app` n'a ni UPDATE ni DELETE : une
--      pièce comptable déposée ne change jamais après coup (art. 958f CO, conservation dix ans —
--      c'est l'INVERSE de la carte grise du module OCR véhicules, jamais conservée elle).
--      `empreinte_sha256` UNIQUE par tenant : un second dépôt du même fichier est un doublon
--      détecté en base, pas une question de logique applicative fragile.
--
--   2. `facture_fournisseur` — l'en-tête : à quel fournisseur/commande elle a été rapprochée
--      (NULL = aucun, un rapprochement approximatif étant pire qu'aucun), ce que la chaîne de
--      lecture (QR → texte PDF → OCR) a trouvé, PAR QUEL MOYEN (`champs_origine`, JSONB —
--      attribut réellement variable document par document, pas un contournement de modélisation).
--      Machine à états SIMPLE, gérée applicativement (§6 de la tâche : « aucune validation
--      automatique, le magasinier confirme ») : `deposee` → `rapprochee` → `validee` | `rejetee`.
--      PAS de table `transition_autorisee` dédiée (contrairement à `commande_fournisseur`, 0024) :
--      quatre états, deux transitions non ambiguës, un CHECK suffit à empêcher les incohérences
--      terminales (`rejetee` sans motif, `validee` sans validateur) — une machine à états complète
--      serait une couche sans bénéfice mesurable à cette taille.
--
--   3. `facture_fournisseur_ligne` — écarts PRÉ-CALCULÉS à l'écriture (prix unitaire, quantité,
--      total — CENTIMES ENTIERS, jamais un flottant), jamais recalculés à la lecture. `origine`
--      par ligne (une ligne entière vient d'UN SEUL passage de la chaîne, contrairement à
--      l'en-tête où QR et texte PDF cohabitent souvent).
--
--   4. `facture_fournisseur_audit` — APPEND-ONLY, même patron que `vehicule_ocr_scan_journal`
--      (0058) : qui a déposé/rapproché/validé/rejeté, avant/après. PAS le dispositif générique
--      `audit_atelier` (0003/0004) : propriété du domaine atelier, `entite_auditee` n'énumère
--      aucune entité pièces — l'étendre est HORS PÉRIMÈTRE D'ÉCRITURE de ce lot (signalé au
--      rapport de livraison, pas modifié en douce).
--
-- SÉCURITÉ DU DÉPÔT : `type_mime` restreint à un CHECK fermé (PDF uniquement, v1) — la vérification du
-- type RÉEL du fichier (pas seulement l'extension/le Content-Type déclaré) est de la
-- responsabilité de l'application (`service-facture-fournisseur.ts`, signature binaire) avant
-- l'écriture ; la base ne peut qu'imposer que la VALEUR ÉCRITE soit dans la liste admise.
--
-- Réversible : migrations/down/0059_factures_fournisseur.down.sql.
-- =============================================================================================


-- ---------------------------------------------------------------------------------------------
-- 1. Énumérations.
-- ---------------------------------------------------------------------------------------------

create type public.statut_facture_fournisseur as enum (
  'deposee',
  'rapprochee',
  'validee',
  'rejetee'
);

create type public.origine_donnee_facture as enum (
  'qr',
  'texte_pdf',
  'ocr'
);

create type public.action_audit_facture_fournisseur as enum (
  'depot',
  'rapprochement',
  'validation',
  'rejet'
);


-- ---------------------------------------------------------------------------------------------
-- 2. `facture_fournisseur_document` — le binaire, immuable.
-- ---------------------------------------------------------------------------------------------

create table public.facture_fournisseur_document (
  id                 uuid        not null default gen_random_uuid(),
  tenant_id          uuid        not null,
  contenu            bytea       not null,
  type_mime          text        not null,
  taille_octets      integer     not null,
  empreinte_sha256   bytea       not null,
  depose_par_id      uuid        not null,
  depose_le          timestamptz not null default now(),

  constraint facture_fournisseur_document_pk primary key (id),
  constraint facture_fournisseur_document_tenant_id_uk unique (tenant_id, id),
  constraint facture_fournisseur_document_tenant_empreinte_uk unique (tenant_id, empreinte_sha256),

  constraint facture_fournisseur_document_fk_tenant
    foreign key (tenant_id) references public.tenant (id) on delete restrict,
  constraint facture_fournisseur_document_fk_depose_par
    foreign key (tenant_id, depose_par_id)
    references public.utilisateur (tenant_id, id) on delete restrict,

  -- v1 : PDF UNIQUEMENT (§1 de la tâche, chaîne QR + texte PDF + OCR entièrement pensée pour ce
  -- format). Le stockage (cette table) ne l'impose pas structurellement — restriction du LOT,
  -- pas de la modélisation ; à desserrer plus tard sans migration si un dépôt image devient réel.
  constraint facture_fournisseur_document_type_mime_chk
    check (type_mime = 'application/pdf'),
  constraint facture_fournisseur_document_taille_chk check (taille_octets > 0),
  constraint facture_fournisseur_document_empreinte_longueur_chk
    check (octet_length(empreinte_sha256) = 32)
);

comment on table public.facture_fournisseur_document is
  'Binaire de la facture fournisseur déposée, SÉPARÉ de l''en-tête (facture_fournisseur) pour '
  'qu''une liste ne charge jamais l''octet du PDF. Immuable : dfa_app n''a ni UPDATE ni DELETE '
  '(art. 958f CO, conservation dix ans).';

create index facture_fournisseur_document_depose_par_idx
  on public.facture_fournisseur_document (tenant_id, depose_par_id);

revoke all              on public.facture_fournisseur_document from dfa_app;
grant  select, insert   on public.facture_fournisseur_document to   dfa_app;

alter table public.facture_fournisseur_document enable row level security;
alter table public.facture_fournisseur_document force  row level security;

create policy facture_fournisseur_document_isolation_tenant on public.facture_fournisseur_document
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy facture_fournisseur_document_migrator on public.facture_fournisseur_document
  to dfa_migrator
  using (true) with check (true);


-- ---------------------------------------------------------------------------------------------
-- 3. `facture_fournisseur` — en-tête.
-- ---------------------------------------------------------------------------------------------

create table public.facture_fournisseur (
  id                        uuid        not null default gen_random_uuid(),
  tenant_id                 uuid        not null,
  document_id               uuid        not null,
  fournisseur_id            uuid        null,
  commande_fournisseur_id   uuid        null,
  statut                    public.statut_facture_fournisseur not null default 'deposee',

  iban_creancier            text        null,
  nom_creancier             text        null,
  numero_facture            text        null,
  date_facture              date        null,
  montant_total_centimes    integer     null,
  devise                    text        not null default 'CHF',
  reference_paiement        text        null,
  -- Provenance PAR CHAMP (Record<champ, 'qr'|'texte_pdf'|'ocr'> partiel) — attribut réellement
  -- variable document par document, l'usage que CONTRIBUTING.md réserve au JSONB.
  champs_origine            jsonb       not null default '{}',

  depose_par_id             uuid        not null,
  depose_le                 timestamptz not null default now(),
  valide_par_id             uuid        null,
  valide_le                 timestamptz null,
  motif_rejet                text        null,

  cree_le                   timestamptz not null default now(),
  modifie_le                 timestamptz not null default now(),

  constraint facture_fournisseur_pk primary key (id),
  constraint facture_fournisseur_tenant_id_uk unique (tenant_id, id),

  constraint facture_fournisseur_fk_tenant
    foreign key (tenant_id) references public.tenant (id) on delete restrict,
  constraint facture_fournisseur_fk_document
    foreign key (tenant_id, document_id)
    references public.facture_fournisseur_document (tenant_id, id) on delete restrict,
  constraint facture_fournisseur_fk_fournisseur
    foreign key (tenant_id, fournisseur_id)
    references public.fournisseur (tenant_id, id) on delete restrict,
  constraint facture_fournisseur_fk_commande
    foreign key (tenant_id, commande_fournisseur_id)
    references public.commande_fournisseur (tenant_id, id) on delete restrict,
  constraint facture_fournisseur_fk_depose_par
    foreign key (tenant_id, depose_par_id)
    references public.utilisateur (tenant_id, id) on delete restrict,
  constraint facture_fournisseur_fk_valide_par
    foreign key (tenant_id, valide_par_id)
    references public.utilisateur (tenant_id, id) on delete restrict,

  constraint facture_fournisseur_devise_chk check (devise in ('CHF', 'EUR')),
  constraint facture_fournisseur_montant_chk
    check (montant_total_centimes is null or montant_total_centimes >= 0),
  constraint facture_fournisseur_rejet_motif_chk
    check (statut <> 'rejetee' or motif_rejet is not null),
  constraint facture_fournisseur_validation_coherente_chk
    check (statut <> 'validee' or (valide_par_id is not null and valide_le is not null))
);

comment on table public.facture_fournisseur is
  'En-tête de facture fournisseur lue automatiquement (QR-facture -> texte du PDF -> OCR en '
  'dernier recours). Rattachement à fournisseur/commande_fournisseur EXACT uniquement (NULL si '
  'aucune correspondance certaine). Machine à états simple, gérée applicativement : deposee -> '
  'rapprochee -> validee | rejetee.';

create index facture_fournisseur_pagination_idx
  on public.facture_fournisseur (tenant_id, cree_le desc, id desc);
create index facture_fournisseur_statut_idx on public.facture_fournisseur (tenant_id, statut);
create index facture_fournisseur_fournisseur_idx
  on public.facture_fournisseur (tenant_id, fournisseur_id) where fournisseur_id is not null;
create index facture_fournisseur_commande_idx
  on public.facture_fournisseur (tenant_id, commande_fournisseur_id)
  where commande_fournisseur_id is not null;

revoke all                     on public.facture_fournisseur from dfa_app;
grant  select, insert, update  on public.facture_fournisseur to   dfa_app;

alter table public.facture_fournisseur enable row level security;
alter table public.facture_fournisseur force  row level security;

create policy facture_fournisseur_isolation_tenant on public.facture_fournisseur
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy facture_fournisseur_migrator on public.facture_fournisseur
  to dfa_migrator
  using (true) with check (true);

create trigger facture_fournisseur_touche_modifie_le
  before update on public.facture_fournisseur
  for each row execute function public.touche_modifie_le();


-- ---------------------------------------------------------------------------------------------
-- 4. `facture_fournisseur_ligne`.
-- ---------------------------------------------------------------------------------------------

create table public.facture_fournisseur_ligne (
  id                              uuid        not null default gen_random_uuid(),
  tenant_id                       uuid        not null,
  facture_fournisseur_id          uuid        not null,
  numero_ordre                    smallint    not null,
  reference_article                text        null,
  designation                      text        null,
  quantite_millieme                integer     not null,
  prix_unitaire_centimes           integer     null,
  total_ligne_centimes             integer     null,
  origine                          public.origine_donnee_facture not null,
  article_id                       uuid        null,
  commande_fournisseur_ligne_id    uuid        null,
  ecart_prix_unitaire_centimes     integer     null,
  ecart_quantite_millieme          integer     null,
  ecart_total_centimes             integer     null,

  cree_le                         timestamptz not null default now(),
  modifie_le                       timestamptz not null default now(),

  constraint facture_fournisseur_ligne_pk primary key (id),
  constraint facture_fournisseur_ligne_tenant_id_uk unique (tenant_id, id),
  constraint facture_fournisseur_ligne_tenant_facture_ordre_uk
    unique (tenant_id, facture_fournisseur_id, numero_ordre),

  constraint facture_fournisseur_ligne_fk_facture
    foreign key (tenant_id, facture_fournisseur_id)
    references public.facture_fournisseur (tenant_id, id) on delete restrict,
  constraint facture_fournisseur_ligne_fk_article
    foreign key (tenant_id, article_id)
    references public.article (tenant_id, id) on delete restrict,
  constraint facture_fournisseur_ligne_fk_commande_ligne
    foreign key (tenant_id, commande_fournisseur_ligne_id)
    references public.commande_fournisseur_ligne (tenant_id, id) on delete restrict,

  constraint facture_fournisseur_ligne_quantite_chk check (quantite_millieme > 0),
  constraint facture_fournisseur_ligne_prix_chk
    check (prix_unitaire_centimes is null or prix_unitaire_centimes >= 0),
  constraint facture_fournisseur_ligne_total_chk
    check (total_ligne_centimes is null or total_ligne_centimes >= 0)
  -- Pas de contrainte couplant ecart_* à commande_fournisseur_ligne_id : une ligne peut être
  -- rapprochée SANS qu'un écart soit calculable (prix attendu jamais renseigné côté commande,
  -- RP-33/QP-04) — nuance métier légitime, pas une incohérence de données à policer en base.
);

comment on table public.facture_fournisseur_ligne is
  'Ligne de facture fournisseur, écarts prix/quantité/total PRÉ-CALCULÉS contre la ligne de '
  'commande fournisseur rapprochée (centimes entiers). commande_fournisseur_ligne_id NULL = rien '
  'à comparer (pas de commande rapprochée, ou référence d''article sans correspondance exacte).';

create index facture_fournisseur_ligne_facture_idx
  on public.facture_fournisseur_ligne (tenant_id, facture_fournisseur_id, numero_ordre);
create index facture_fournisseur_ligne_commande_ligne_idx
  on public.facture_fournisseur_ligne (tenant_id, commande_fournisseur_ligne_id)
  where commande_fournisseur_ligne_id is not null;

revoke all              on public.facture_fournisseur_ligne from dfa_app;
grant  select, insert   on public.facture_fournisseur_ligne to   dfa_app;

alter table public.facture_fournisseur_ligne enable row level security;
alter table public.facture_fournisseur_ligne force  row level security;

create policy facture_fournisseur_ligne_isolation_tenant on public.facture_fournisseur_ligne
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy facture_fournisseur_ligne_migrator on public.facture_fournisseur_ligne
  to dfa_migrator
  using (true) with check (true);


-- ---------------------------------------------------------------------------------------------
-- 5. `facture_fournisseur_audit` — append-only.
-- ---------------------------------------------------------------------------------------------

create table public.facture_fournisseur_audit (
  id                       uuid        not null default gen_random_uuid(),
  tenant_id                uuid        not null,
  facture_fournisseur_id   uuid        not null,
  utilisateur_id           uuid        not null,
  action                   public.action_audit_facture_fournisseur not null,
  valeur_avant             jsonb       null,
  valeur_apres             jsonb       null,
  cree_le                  timestamptz not null default now(),

  constraint facture_fournisseur_audit_pk primary key (id),

  constraint facture_fournisseur_audit_fk_facture
    foreign key (tenant_id, facture_fournisseur_id)
    references public.facture_fournisseur (tenant_id, id) on delete restrict,
  constraint facture_fournisseur_audit_fk_utilisateur
    foreign key (tenant_id, utilisateur_id)
    references public.utilisateur (tenant_id, id) on delete restrict
);

comment on table public.facture_fournisseur_audit is
  'Piste d''audit APPEND-ONLY de facture_fournisseur (dépôt/rapprochement/validation/rejet), '
  'qui/quoi/quand/avant-après. Même patron que vehicule_ocr_scan_journal (0058) : dfa_app en '
  'select/insert seulement, aucun UPDATE ni DELETE.';

create index facture_fournisseur_audit_facture_idx
  on public.facture_fournisseur_audit (tenant_id, facture_fournisseur_id, cree_le);

revoke all              on public.facture_fournisseur_audit from dfa_app;
grant  select, insert   on public.facture_fournisseur_audit to   dfa_app;

alter table public.facture_fournisseur_audit enable row level security;
alter table public.facture_fournisseur_audit force  row level security;

create policy facture_fournisseur_audit_isolation_tenant on public.facture_fournisseur_audit
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy facture_fournisseur_audit_migrator on public.facture_fournisseur_audit
  to dfa_migrator
  using (true) with check (true);


-- ---------------------------------------------------------------------------------------------
-- 6. Assertions de fin de migration.
-- ---------------------------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.facture_fournisseur_document') is null then
    raise exception '0059 : table facture_fournisseur_document absente après migration.';
  end if;
  if to_regclass('public.facture_fournisseur') is null then
    raise exception '0059 : table facture_fournisseur absente après migration.';
  end if;
  if to_regclass('public.facture_fournisseur_ligne') is null then
    raise exception '0059 : table facture_fournisseur_ligne absente après migration.';
  end if;
  if to_regclass('public.facture_fournisseur_audit') is null then
    raise exception '0059 : table facture_fournisseur_audit absente après migration.';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'facture_fournisseur_document'
       and column_name = 'contenu' and data_type = 'bytea'
  ) then
    raise exception '0059 : facture_fournisseur_document.contenu absente ou de mauvais type.';
  end if;

  if exists (
    select 1 from information_schema.role_table_grants
     where table_schema = 'public' and table_name = 'facture_fournisseur_document'
       and grantee = 'dfa_app' and privilege_type in ('UPDATE', 'DELETE')
  ) then
    raise exception '0059 : dfa_app ne doit avoir ni UPDATE ni DELETE sur facture_fournisseur_document.';
  end if;

  if exists (
    select 1 from information_schema.role_table_grants
     where table_schema = 'public' and table_name = 'facture_fournisseur_audit'
       and grantee = 'dfa_app' and privilege_type in ('UPDATE', 'DELETE')
  ) then
    raise exception '0059 : dfa_app ne doit avoir ni UPDATE ni DELETE sur facture_fournisseur_audit (append-only).';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'facture_fournisseur' and c.relrowsecurity
  ) then
    raise exception '0059 : row level security non activée sur facture_fournisseur.';
  end if;

end
$$;
