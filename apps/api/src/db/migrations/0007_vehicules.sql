-- =============================================================================================
-- 0007_vehicules.sql — L1-05 (3/4) : module véhicules
--
-- `vehicule`, `vehicule_plaque` (historisée, RM-17/18/19), `vehicule_detention` (historisée,
-- RM-20/21), `vehicule_kilometrage` (append-only, RM-23/24/25), `vehicule_expertise` (RM-28),
-- `vehicule_campagne` (RM-30), `vehicule_travail_reporte` (RM-73, matérialisé).
--
-- Trois colonnes d'accroche vers l'atelier (`vehicule_kilometrage.ordre_reparation_id`,
-- `vehicule_campagne.ordre_reparation_id`, `vehicule_travail_reporte.{ordre_reparation_origine_id,
-- ligne_or_origine_id, ordre_reparation_reprise_id}`) sont créées SANS FK ici — `ordre_reparation`
-- n'existe pas encore — et complétées par `alter table … add constraint` dans 0008, une fois la
-- cible créée (expand en deux temps, dans la même série de migrations).
--
-- Δ6 : `revoke delete` explicite sur chaque table malgré 0002.
-- Réversible : migrations/down/0007_vehicules.down.sql.
-- =============================================================================================


-- ---------------------------------------------------------------------------------------------
-- 1. `vehicule`
-- ---------------------------------------------------------------------------------------------

create table public.vehicule (
  id     uuid not null default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,

  vin    text null,
  marque text not null,
  modele text not null,
  version  text null,
  finition text null,
  code_type_ch text null,
  date_1re_circulation date null,

  carburant     text null,
  cylindree_cm3 integer null,
  puissance_kw  integer null,
  boite         text null,
  transmission  text null,
  norme_emission text null,

  couleur      text null,
  code_couleur text null,

  poids_vide_kg  integer null,
  poids_total_kg integer null,
  places         smallint null,

  pneus_ete      text null,
  pneus_hiver    text null,
  pression_pneus text null,

  huile_type         text    null,
  -- Décilitres, entier : pas de flottant (convention §2.1 point 5, étendue par prudence à toute
  -- grandeur fractionnaire du produit — une valeur comme 4,5 L se note 45 dl).
  huile_quantite_dl  integer null,

  batterie  text null,
  code_radio text null,
  code_cle   text null,

  intervalle_entretien_km   integer  null,
  intervalle_entretien_mois smallint null,

  importe        boolean not null default false,
  pays_origine   char(2) null,
  date_importation date  null,

  garantie_debut date     null,
  garantie_mois  smallint null,
  garantie_km    integer  null,

  proprietaire_economique_client_id uuid null,
  conducteur_habituel text null,
  identification_incomplete boolean not null default false,

  statut  public.statut_vehicule not null default 'actif',
  motif_archivage public.motif_archivage_vehicule null,
  fusionne_vers_vehicule_id uuid null,
  -- Accroche étape 4 (véhicules en stock) : nullable, SANS FK tant que la cible n'existe pas
  -- (convention §2.1 point 8).
  vehicule_stock_id uuid null,

  cree_le    timestamptz not null default now(),
  modifie_le timestamptz not null default now(),

  constraint vehicule_pk primary key (id),
  constraint vehicule_tenant_id_uk unique (tenant_id, id),

  constraint vehicule_fk_proprietaire_eco foreign key (tenant_id, proprietaire_economique_client_id)
    references public.client (tenant_id, id) on delete restrict,
  constraint vehicule_fk_fusionne_vers foreign key (tenant_id, fusionne_vers_vehicule_id)
    references public.vehicule (tenant_id, id) on delete restrict,

  -- RM-15 : I/O/Q refusés uniquement sur un VIN de 17 caractères ; les VIN courts (véhicules
  -- anciens, machines agricoles) restent acceptés tels quels.
  constraint vehicule_vin_format_chk
    check (vin is null or length(vin) <> 17 or vin ~ '^[A-HJ-NPR-Z0-9]{17}$'),
  constraint vehicule_marque_non_vide_chk check (length(btrim(marque)) > 0),
  constraint vehicule_modele_non_vide_chk check (length(btrim(modele)) > 0),
  constraint vehicule_pays_origine_chk check (pays_origine is null or pays_origine ~ '^[A-Z]{2}$'),
  constraint vehicule_archivage_coherent_chk
    check ((statut = 'archive') = (motif_archivage is not null)),
  constraint vehicule_fusionne_archive_chk
    check (fusionne_vers_vehicule_id is null or statut = 'archive')
);

comment on table public.vehicule is
  'Véhicule (RM-15→RM-33). Aucun DELETE (RM-31) : un véhicule cesse d''être actif par archivage.';

create trigger vehicule_touche_modifie_le
  before update on public.vehicule
  for each row execute function public.touche_modifie_le();

-- RM-32 : index PARTIEL — un véhicule archivé pour doublon ne bloque pas la ressaisie du VIN par
-- un nouveau véhicule actif.
create unique index vehicule_vin_actif_uk
  on public.vehicule (tenant_id, vin)
  where vin is not null and statut = 'actif';

-- RM-112 : recherche comptoir sur fragment de VIN, insensible casse/accents/séparateurs.
create index vehicule_vin_recherche_idx on public.vehicule
  using gin (tenant_id, public.normaliser_recherche(coalesce(vin, '')) gin_trgm_ops);

create index vehicule_marque_modele_idx on public.vehicule
  (tenant_id, public.normaliser_recherche(marque || ' ' || modele));

create index vehicule_pagination_idx on public.vehicule (tenant_id, cree_le desc, id desc);

revoke all    on public.vehicule from dfa_app;
grant  select, insert, update on public.vehicule to dfa_app;
revoke delete on public.vehicule from dfa_app;

alter table public.vehicule enable row level security;
alter table public.vehicule force  row level security;

create policy vehicule_isolation_tenant on public.vehicule
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy vehicule_migrator on public.vehicule
  to dfa_migrator
  using (true) with check (true);


-- ---------------------------------------------------------------------------------------------
-- 2. `vehicule_plaque` — historisée (RM-17/18/19)
--
-- L'EXCLUDE qui porte RM-18 : deux véhicules ne peuvent PAS porter la même plaque suisse sur des
-- périodes qui se chevauchent. La levée pour les plaques interchangeables/professionnelles (§6.9
-- de la spec) est DANS la contrainte (clause WHERE de l'EXCLUDE), pas dans un `if` du service.
-- ---------------------------------------------------------------------------------------------

create table public.vehicule_plaque (
  id          uuid    not null default gen_random_uuid(),
  tenant_id   uuid    not null,
  vehicule_id uuid    not null,
  valeur      text    not null,
  canton      char(2) null,
  pays        char(2) not null default 'CH',
  du          date    not null,
  au          date    null,
  interchangeable boolean not null default false,
  professionnelle boolean not null default false,

  cree_le    timestamptz not null default now(),
  modifie_le timestamptz not null default now(),

  constraint vehicule_plaque_pk primary key (id),
  constraint vehicule_plaque_tenant_id_uk unique (tenant_id, id),
  constraint vehicule_plaque_fk foreign key (tenant_id, vehicule_id)
    references public.vehicule (tenant_id, id) on delete restrict,
  constraint vehicule_plaque_valeur_non_vide_chk check (length(btrim(valeur)) > 0),
  constraint vehicule_plaque_periode_chk check (au is null or au > du),
  constraint vehicule_plaque_pays_chk check (pays ~ '^[A-Z]{2}$'),

  constraint vehicule_plaque_collision_excl
    exclude using gist (
      tenant_id with =,
      public.normaliser_recherche(valeur) with =,
      daterange(du, au, '[)') with &&
    ) where (not interchangeable and not professionnelle and pays = 'CH')
);

comment on table public.vehicule_plaque is
  'Historique des plaques d''un véhicule. EXCLUDE : deux véhicules ne portent jamais la même '
  'plaque suisse (non interchangeable, non professionnelle) sur des périodes qui se chevauchent '
  '(RM-18). CT-05 (réattribution) et CT-06 (collision) tombent des deux côtés de cette contrainte.';

create trigger vehicule_plaque_touche_modifie_le
  before update on public.vehicule_plaque
  for each row execute function public.touche_modifie_le();

-- RM-112 : point d'entrée n°1 du comptoir — l'index le plus sollicité du produit.
create index vehicule_plaque_recherche_idx on public.vehicule_plaque
  using gin (tenant_id, public.normaliser_recherche(valeur) gin_trgm_ops);

-- Résolution de la plaque courante d'un véhicule (contexte-atelier, figeage RM-50).
create index vehicule_plaque_courante_idx
  on public.vehicule_plaque (tenant_id, vehicule_id)
  where au is null;

revoke all    on public.vehicule_plaque from dfa_app;
grant  select, insert, update on public.vehicule_plaque to dfa_app;
revoke delete on public.vehicule_plaque from dfa_app;

alter table public.vehicule_plaque enable row level security;
alter table public.vehicule_plaque force  row level security;

create policy vehicule_plaque_isolation_tenant on public.vehicule_plaque
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy vehicule_plaque_migrator on public.vehicule_plaque
  to dfa_migrator
  using (true) with check (true);


-- ---------------------------------------------------------------------------------------------
-- 3. `vehicule_detention` — historisée (RM-20/21)
-- ---------------------------------------------------------------------------------------------

create table public.vehicule_detention (
  id          uuid    not null default gen_random_uuid(),
  tenant_id   uuid    not null,
  vehicule_id uuid    not null,
  client_id   uuid    not null,
  du          date    not null,
  au          date    null,
  motif_fin   public.motif_fin_detention null,

  cree_le    timestamptz not null default now(),
  modifie_le timestamptz not null default now(),

  constraint vehicule_detention_pk primary key (id),
  constraint vehicule_detention_tenant_id_uk unique (tenant_id, id),
  constraint vehicule_detention_fk_vehicule foreign key (tenant_id, vehicule_id)
    references public.vehicule (tenant_id, id) on delete restrict,
  constraint vehicule_detention_fk_client foreign key (tenant_id, client_id)
    references public.client (tenant_id, id) on delete restrict,
  constraint vehicule_detention_periode_chk check (au is null or au > du),
  constraint vehicule_detention_motif_fin_chk check ((au is null) = (motif_fin is null)),

  -- CT-47 : un seul détenteur courant. Un client rachetant le même véhicule après l'avoir revendu
  -- (période disjointe) reste possible ; deux détenteurs SIMULTANÉS ne le sont jamais.
  constraint vehicule_detention_unicite_excl
    exclude using gist (
      tenant_id with =,
      vehicule_id with =,
      daterange(du, au, '[)') with &&
    )
);

comment on table public.vehicule_detention is
  'Historique des détenteurs d''un véhicule. EXCLUDE : un seul détenteur courant à la fois '
  '(RM-20, CT-47).';

create trigger vehicule_detention_touche_modifie_le
  before update on public.vehicule_detention
  for each row execute function public.touche_modifie_le();

create trigger vehicule_detention_audit
  after insert or update or delete on public.vehicule_detention
  for each row execute function public.auditer_atelier('vehicule_detention');

create index vehicule_detention_courante_idx
  on public.vehicule_detention (tenant_id, vehicule_id)
  where au is null;
create index vehicule_detention_client_idx
  on public.vehicule_detention (tenant_id, client_id, du desc);

revoke all    on public.vehicule_detention from dfa_app;
grant  select, insert, update on public.vehicule_detention to dfa_app;
revoke delete on public.vehicule_detention from dfa_app;

alter table public.vehicule_detention enable row level security;
alter table public.vehicule_detention force  row level security;

create policy vehicule_detention_isolation_tenant on public.vehicule_detention
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy vehicule_detention_migrator on public.vehicule_detention
  to dfa_migrator
  using (true) with check (true);


-- ---------------------------------------------------------------------------------------------
-- 4. `vehicule_kilometrage` — append-only (RM-23/24/25)
--
-- `valeur_km` : SEULE dénormalisation CALCULÉE que ce plan accepte — la conversion mi→km est une
-- constante physique, pas une donnée métier qui peut diverger. Rend CT-08 (60 000 mi après
-- 90 000 km n'est pas une régression) trivial et impossible à contourner en lisant `valeur` seule.
-- ---------------------------------------------------------------------------------------------

create table public.vehicule_kilometrage (
  id          uuid        not null default gen_random_uuid(),
  tenant_id   uuid        not null,
  vehicule_id uuid        not null,
  valeur      integer     not null,
  unite       public.unite_distance not null,
  releve_le   timestamptz not null,
  source      public.source_kilometrage not null,
  motif_regression public.motif_kilometrage_regressif null,
  -- FK ajoutée dans 0008, une fois `ordre_reparation` créé (voir en-tête).
  ordre_reparation_id uuid null,
  saisi_par_id uuid null,

  valeur_km integer generated always as (
    case when unite = 'mi' then round(valeur * 1.609344)::integer else valeur end
  ) stored,

  cree_le timestamptz not null default now(),

  constraint vehicule_kilometrage_pk primary key (id),
  constraint vehicule_kilometrage_tenant_id_uk unique (tenant_id, id),
  constraint vehicule_kilometrage_fk_vehicule foreign key (tenant_id, vehicule_id)
    references public.vehicule (tenant_id, id) on delete restrict,
  constraint vehicule_kilometrage_fk_saisi_par foreign key (tenant_id, saisi_par_id)
    references public.utilisateur (tenant_id, id) on delete restrict,
  constraint vehicule_kilometrage_valeur_chk check (valeur >= 0)
);

comment on table public.vehicule_kilometrage is
  'Relevés kilométriques (RM-23/24/25), append-only par privilège : un relevé faux se corrige '
  'par un NOUVEAU relevé motivé, jamais par écrasement. valeur_km est la SEULE dénormalisation '
  'calculée acceptée par ce plan (conversion mi→km, constante physique).';

create trigger vehicule_kilometrage_audit
  after insert or update or delete on public.vehicule_kilometrage
  for each row execute function public.auditer_atelier('vehicule_kilometrage');

-- « Dernier km connu » : lu à CHAQUE ouverture de fiche véhicule et de RDV.
create index vehicule_kilometrage_dernier_idx
  on public.vehicule_kilometrage (tenant_id, vehicule_id, releve_le desc);

revoke all    on public.vehicule_kilometrage from dfa_app;
grant  select, insert on public.vehicule_kilometrage to dfa_app;

alter table public.vehicule_kilometrage enable row level security;
alter table public.vehicule_kilometrage force  row level security;

create policy vehicule_kilometrage_isolation_tenant on public.vehicule_kilometrage
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy vehicule_kilometrage_migrator on public.vehicule_kilometrage
  to dfa_migrator
  using (true) with check (true);


-- ---------------------------------------------------------------------------------------------
-- 5. `vehicule_expertise` (RM-28, §8.1)
-- ---------------------------------------------------------------------------------------------

create table public.vehicule_expertise (
  id          uuid    not null default gen_random_uuid(),
  tenant_id   uuid    not null,
  vehicule_id uuid    not null,
  date_expertise date not null,
  resultat    public.resultat_expertise not null,
  defauts     text    null,
  delai_contre_visite date null,
  date_contre_visite  date null,
  prochaine_echeance  date null,
  -- RM-28/CT-10 : une convocation cantonale prime TOUJOURS sur une périodicité calculée.
  source_echeance public.source_echeance_expertise null,

  cree_le    timestamptz not null default now(),
  modifie_le timestamptz not null default now(),

  constraint vehicule_expertise_pk primary key (id),
  constraint vehicule_expertise_tenant_id_uk unique (tenant_id, id),
  constraint vehicule_expertise_fk foreign key (tenant_id, vehicule_id)
    references public.vehicule (tenant_id, id) on delete restrict,
  constraint vehicule_expertise_echeance_source_chk
    check ((prochaine_echeance is null) = (source_echeance is null))
);

comment on table public.vehicule_expertise is
  'Expertises (MFK / contrôle technique cantonal) d''un véhicule (RM-28).';

create trigger vehicule_expertise_touche_modifie_le
  before update on public.vehicule_expertise
  for each row execute function public.touche_modifie_le();

-- RM-29 : liste de relance des expertises échues/à échéance proche.
create index vehicule_expertise_echeance_idx
  on public.vehicule_expertise (tenant_id, prochaine_echeance)
  where prochaine_echeance is not null;

revoke all    on public.vehicule_expertise from dfa_app;
grant  select, insert, update on public.vehicule_expertise to dfa_app;
revoke delete on public.vehicule_expertise from dfa_app;

alter table public.vehicule_expertise enable row level security;
alter table public.vehicule_expertise force  row level security;

create policy vehicule_expertise_isolation_tenant on public.vehicule_expertise
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy vehicule_expertise_migrator on public.vehicule_expertise
  to dfa_migrator
  using (true) with check (true);


-- ---------------------------------------------------------------------------------------------
-- 6. `vehicule_campagne` (RM-30)
-- ---------------------------------------------------------------------------------------------

create table public.vehicule_campagne (
  id          uuid    not null default gen_random_uuid(),
  tenant_id   uuid    not null,
  vehicule_id uuid    not null,
  code        text    not null,
  description text    null,
  obligatoire boolean not null default false,
  statut      public.statut_campagne not null default 'ouverte',
  close_le    timestamptz null,
  -- FK ajoutée dans 0008.
  ordre_reparation_id uuid null,

  cree_le    timestamptz not null default now(),
  modifie_le timestamptz not null default now(),

  constraint vehicule_campagne_pk primary key (id),
  constraint vehicule_campagne_tenant_id_uk unique (tenant_id, id),
  constraint vehicule_campagne_fk foreign key (tenant_id, vehicule_id)
    references public.vehicule (tenant_id, id) on delete restrict,
  constraint vehicule_campagne_code_non_vide_chk check (length(btrim(code)) > 0),
  constraint vehicule_campagne_close_chk check ((statut = 'close') = (close_le is not null))
);

comment on table public.vehicule_campagne is
  'Campagnes constructeur (rappels) applicables à un véhicule (RM-30).';

create trigger vehicule_campagne_touche_modifie_le
  before update on public.vehicule_campagne
  for each row execute function public.touche_modifie_le();

create index vehicule_campagne_ouverte_idx
  on public.vehicule_campagne (tenant_id, vehicule_id)
  where statut = 'ouverte';

revoke all    on public.vehicule_campagne from dfa_app;
grant  select, insert, update on public.vehicule_campagne to dfa_app;
revoke delete on public.vehicule_campagne from dfa_app;

alter table public.vehicule_campagne enable row level security;
alter table public.vehicule_campagne force  row level security;

create policy vehicule_campagne_isolation_tenant on public.vehicule_campagne
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy vehicule_campagne_migrator on public.vehicule_campagne
  to dfa_migrator
  using (true) with check (true);


-- ---------------------------------------------------------------------------------------------
-- 7. `vehicule_travail_reporte` (RM-73) — MATÉRIALISÉ, pas calculé
--
-- La spec exige qu'ils soient éditables (le réceptionnaire en écarte un que le client refuse deux
-- fois) et « éteignables » (statut). Une vue sur les lignes `refusee` ne permettrait ni l'un ni
-- l'autre, et perdrait le montant de l'époque quand le tarif change. Alimenté par le service
-- depuis `ligne_or` (pas de trigger : la mise à jour dépend d'une décision, pas d'un simple
-- changement d'état mécanique).
-- ---------------------------------------------------------------------------------------------

create table public.vehicule_travail_reporte (
  id          uuid     not null default gen_random_uuid(),
  tenant_id   uuid     not null,
  vehicule_id uuid     not null,
  designation text     not null,
  urgence     public.urgence_travail not null,
  montant_estime_centimes integer null,
  km_constat  integer  null,
  date_constat date    not null,
  -- FK ajoutées dans 0008.
  ordre_reparation_origine_id uuid null,
  ligne_or_origine_id         uuid null,
  securite    boolean  not null default false,
  statut      public.statut_travail_reporte not null default 'ouvert',
  ordre_reparation_reprise_id uuid null,

  cree_le    timestamptz not null default now(),
  modifie_le timestamptz not null default now(),

  constraint vehicule_travail_reporte_pk primary key (id),
  constraint vehicule_travail_reporte_tenant_id_uk unique (tenant_id, id),
  constraint vehicule_travail_reporte_fk foreign key (tenant_id, vehicule_id)
    references public.vehicule (tenant_id, id) on delete restrict,
  constraint vehicule_travail_reporte_designation_non_vide_chk check (length(btrim(designation)) > 0),
  constraint vehicule_travail_reporte_montant_chk
    check (montant_estime_centimes is null or montant_estime_centimes between 0 and 100000000),
  constraint vehicule_travail_reporte_km_chk check (km_constat is null or km_constat >= 0)
);

comment on table public.vehicule_travail_reporte is
  'Travaux reportés d''un véhicule (RM-73), MATÉRIALISÉS et éditables — pas une vue sur ligne_or.';

create trigger vehicule_travail_reporte_touche_modifie_le
  before update on public.vehicule_travail_reporte
  for each row execute function public.touche_modifie_le();

create index vehicule_travail_reporte_ouvert_idx
  on public.vehicule_travail_reporte (tenant_id, vehicule_id)
  where statut = 'ouvert';

revoke all    on public.vehicule_travail_reporte from dfa_app;
grant  select, insert, update on public.vehicule_travail_reporte to dfa_app;
revoke delete on public.vehicule_travail_reporte from dfa_app;

alter table public.vehicule_travail_reporte enable row level security;
alter table public.vehicule_travail_reporte force  row level security;

create policy vehicule_travail_reporte_isolation_tenant on public.vehicule_travail_reporte
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy vehicule_travail_reporte_migrator on public.vehicule_travail_reporte
  to dfa_migrator
  using (true) with check (true);


-- ---------------------------------------------------------------------------------------------
-- 8. Assertions de fin de migration
-- ---------------------------------------------------------------------------------------------

do $$
declare
  fautives text;
begin
  select string_agg(t.tbl, ', ') into fautives
    from (values
      ('vehicule'), ('vehicule_plaque'), ('vehicule_detention'),
      ('vehicule_expertise'), ('vehicule_campagne'), ('vehicule_travail_reporte')
    ) as t(tbl)
   where has_table_privilege('dfa_app', format('public.%I', t.tbl), 'DELETE');

  if fautives is not null then
    raise exception 'DELETE encore accordé à dfa_app sur % (Δ6 / RM-31 / RM-110 violé).', fautives;
  end if;

  if has_table_privilege('dfa_app', 'public.vehicule_kilometrage', 'UPDATE')
     or has_table_privilege('dfa_app', 'public.vehicule_kilometrage', 'DELETE') then
    raise exception 'vehicule_kilometrage : dfa_app ne devrait avoir que SELECT, INSERT (RM-23, append-only).';
  end if;
end
$$;
