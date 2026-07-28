-- =============================================================================================
-- 0005_parametrage.sql — L1-05 (1/4) : tous les enums du lot 1 + module paramétrage
--
-- Deux responsabilités volontairement regroupées dans une seule migration :
--
--   1. TOUS les enums PG restants de `plan-etape-1-backend.md` §2.3, Δ5 du plan d'exécution :
--      y compris ceux des modules ABSENTS du lot 1 (rendez-vous, pointage, courtoisie). Un type
--      déclaré et non utilisé ne coûte rien ; ajouter une valeur à un enum PG existant est plus
--      coûteux que de le créer complet dès maintenant. `entite_auditee`, `action_auditee`,
--      `statut_ordre_reparation`, `statut_ligne_or` existent déjà (0003) et sont SAUTÉS ici —
--      un `create type` dessus échouerait. Toutes les valeurs sont dérivées de
--      `packages/shared/src/contrats/atelier/enums.ts`, SOURCE UNIQUE.
--   2. Le module paramétrage : `parametre_atelier` (une ligne par tenant), `parametre_site`,
--      `compteur_document` (numérotation continue, PAS une SEQUENCE), `taux_horaire`,
--      `prestation`/`prestation_prix`, `motif_rendez_vous`, `poste_travail`,
--      `activite_indirecte`.
--
-- DELTAS DU PLAN D'EXÉCUTION appliqués ici (ils priment sur `plan-etape-1-backend.md`) :
--   Δ3 — `parametre_atelier.controle_qualite` contraint à `jamais|toujours` au lot 1 (CHECK en
--        plus du type PG à 4 valeurs, qui reste complet pour le lot 2) ; `fonctionnalites` n'est
--        PAS une colonne — calculé côté service.
--   Δ6 — `revoke delete` explicite sur chaque table, malgré le retrait du défaut par 0002.
--
-- Convention reprise de 0001/0003 sur CHAQUE table : `enable` + `force row level security`,
-- politique `<t>_isolation_tenant` (USING et WITH CHECK via `tenant_courant()`) et politique
-- `<t>_migrator` (`to dfa_migrator using (true) with check (true)`, nécessaire dès que FORCE est
-- posé, sans quoi le seed ne pourrait rien écrire).
--
-- R-9 (§5.5 du plan d'exécution) : toute contrainte UNIQUE/EXCLUDE commence par `tenant_id`.
-- Réversible : migrations/down/0005_parametrage.down.sql.
-- =============================================================================================


-- ---------------------------------------------------------------------------------------------
-- 1. Enums — clients, véhicules, atelier, lignes, devis, rdv/planning, pointage, courtoisie
-- ---------------------------------------------------------------------------------------------

create type public.type_client                as enum ('particulier', 'entreprise');
create type public.statut_client               as enum ('actif', 'inactif', 'bloque');
create type public.type_adresse                as enum ('principale', 'facturation', 'livraison');
create type public.role_contact                as enum (
  'conducteur', 'gestionnaire_flotte', 'signataire', 'comptabilite'
);
create type public.type_consentement           as enum (
  'marketing_email', 'marketing_sms', 'marketing_appel'
);
create type public.nature_note                 as enum ('interne', 'alerte');

create type public.unite_distance              as enum ('km', 'mi');
create type public.source_kilometrage          as enum (
  'reception', 'ordre_reparation', 'expertise', 'vente', 'declaratif', 'import'
);
create type public.motif_kilometrage_regressif as enum (
  'compteur_remplace', 'erreur_saisie', 'changement_unite', 'correction'
);
create type public.motif_fin_detention         as enum ('vente', 'reprise', 'deces', 'correction', 'export');
create type public.resultat_expertise          as enum ('accepte', 'accepte_avec_defauts', 'refuse');
create type public.source_echeance_expertise   as enum ('calculee', 'convocation');
create type public.statut_campagne             as enum ('ouverte', 'close');
create type public.statut_vehicule             as enum ('actif', 'archive');
create type public.motif_archivage_vehicule    as enum (
  'detruit', 'exporte', 'vendu_hors_clientele', 'doublon'
);
create type public.urgence_travail             as enum ('urgent', 'a_faire', 'a_surveiller');
create type public.statut_travail_reporte      as enum ('ouvert', 'repris', 'abandonne');

create type public.type_ordre_reparation       as enum (
  'service', 'reparation', 'diagnostic', 'expertise', 'pneus', 'carrosserie', 'retouche', 'interne'
);
create type public.localisation_vehicule       as enum (
  'parc', 'atelier', 'sous_traitant', 'essai_routier', 'lavage', 'pret_au_retrait',
  'sorti_provisoirement', 'restitue'
);
create type public.motif_lien_or               as enum ('retouche', 'suite');

create type public.type_ligne_or               as enum (
  'main_oeuvre_bareme', 'main_oeuvre_temps_reel', 'forfait', 'piece', 'fourniture',
  'sous_traitance', 'produit_atelier', 'taxe', 'remise', 'texte'
);
create type public.origine_ligne_or            as enum (
  'commandee', 'constatee', 'campagne', 'garantie', 'retouche', 'interne'
);
create type public.payeur_ligne_or             as enum ('client', 'constructeur', 'assurance', 'tiers', 'garage');
create type public.blocage_ligne_or            as enum ('aucun', 'accord', 'pieces', 'externe');

create type public.canal_devis                 as enum ('telephone', 'sms', 'email', 'comptoir', 'lien');
create type public.decision_devis              as enum ('accepte', 'refuse', 'partiel');

-- --- Modules absents du lot 1 (rendez-vous, pointage, courtoisie) : enums créés quand même ------
-- (Δ5 du plan d'exécution). Aucune table ne les utilise encore.

create type public.statut_rendez_vous          as enum (
  'demande', 'planifie', 'honore', 'absent', 'annule_client', 'annule_garage', 'reporte'
);
create type public.mode_attente_rdv            as enum (
  'attend_sur_place', 'depose', 'depose_la_veille', 'navette', 'prise_en_charge'
);
create type public.origine_rendez_vous         as enum (
  'telephone', 'comptoir', 'email', 'formulaire_web', 'importe', 'rappel_automatique'
);
create type public.type_ressource_planning     as enum ('technicien', 'poste_travail', 'vehicule_courtoisie');

create type public.statut_pointage             as enum ('en_cours', 'termine', 'valide', 'verrouille');
create type public.source_pointage             as enum ('ecran_atelier', 'badge', 'mobile', 'saisie');
create type public.nature_activite_pointage    as enum ('productif_ligne', 'productif_or', 'indirect');
create type public.statut_periode_pointage     as enum ('ouverte', 'verrouillee');

create type public.etat_vehicule_courtoisie    as enum ('disponible', 'prete', 'en_entretien', 'hors_service');
create type public.statut_pret_courtoisie      as enum ('reserve', 'en_cours', 'retourne', 'cloture', 'annule');

-- --- Enums propres aux paramètres d'atelier (P-xx) -----------------------------------------------
-- Tous extensibles (contrats-api-etape-1.md §11.2) — seul le CONTENU de `controle_qualite` est
-- restreint au lot 1, par CHECK (Δ3), pas par le type lui-même : le type reste complet pour que
-- le lot 2 n'ait pas à le recréer.

create type public.portee_numerotation           as enum ('tenant', 'site');
create type public.unite_temps                    as enum ('heures_decimales', 'unites_constructeur');
create type public.politique_controle_qualite     as enum (
  'jamais', 'toujours', 'selon_type', 'au_dela_montant'
);
create type public.politique_signature_reception  as enum ('obligatoire', 'recommandee', 'desactivee');
create type public.arrondi_pointage               as enum ('minute', 'dixieme', 'quart');
create type public.politique_langue_document      as enum ('client', 'site');
create type public.politique_demontage_refuse     as enum ('facturer', 'offrir', 'au_dela_seuil');
create type public.visibilite_historique_vehicule as enum ('tout', 'technique', 'rien');
create type public.politique_mention_securite     as enum ('obligatoire', 'desactivee');
create type public.politique_deux_or_meme_vehicule as enum ('bloquer', 'avertir', 'autoriser');


-- ---------------------------------------------------------------------------------------------
-- 2. `parametre_atelier` — une ligne par tenant, PK confondue avec `tenant_id`
-- ---------------------------------------------------------------------------------------------

create table public.parametre_atelier (
  tenant_id uuid not null references public.tenant (id) on delete restrict,

  or_prefixe                              text    null,
  or_portee_numerotation                  public.portee_numerotation not null default 'tenant',
  or_reset_annuel                         boolean not null default true,
  unite_temps                             public.unite_temps not null default 'heures_decimales',

  -- Q-02 (§4 du plan d'exécution) : NULL = aucun plafond convenu, la garde RM-54 ne s'exécute
  -- jamais ; 0 = accord requis pour toute validation payante ; n>0 = plafond nominal. Défaut NULL
  -- en production ; le seed pose 30000 (300.—), le scénario §3.1 en a besoin.
  plafond_defaut_centimes                 integer null,

  chevauchement_pointage_autorise         boolean not null default false,
  pointage_obligatoire_pour_terminer      boolean not null default false,

  -- Δ3 : le type PG reste complet (4 valeurs, pour le lot 2), le CHECK restreint le lot 1.
  controle_qualite                        public.politique_controle_qualite not null default 'jamais',

  signature_reception                     public.politique_signature_reception not null default 'recommandee',
  km_entree_obligatoire                   boolean not null default true,
  km_sortie_obligatoire                   boolean not null default false,
  restitution_avant_paiement              boolean not null default true,
  multi_payeurs_autorise                  boolean not null default false,
  arrondi_pointage                        public.arrondi_pointage not null default 'quart',
  or_sans_rdv_autorise                    boolean not null default true,
  rdv_retroactif_auto                     boolean not null default false,
  etat_planifie_actif                     boolean not null default false,
  langue_documents                        public.politique_langue_document not null default 'client',
  politique_demontage_refuse              public.politique_demontage_refuse not null default 'offrir',
  visibilite_historique_nouveau_detenteur public.visibilite_historique_vehicule not null default 'technique',

  -- P-27 : pas de source `packages/shared` (aucune valeur au-delà de « A »/« B » dans la spec) —
  -- `char(1)` contraint en dur plutôt qu'un enum PG à inventer.
  attente_pieces_longue_defaut            char(1) not null default 'A',

  mention_securite                        public.politique_mention_securite not null default 'obligatoire',
  deux_or_meme_vehicule                   public.politique_deux_or_meme_vehicule not null default 'avertir',

  expertise_alerte_mois                   smallint not null default 2,
  no_show_seuil_alerte                    smallint not null default 2,
  blocage_jours_alerte                    smallint not null default 3,
  pointage_duree_max_heures               smallint not null default 12,
  tampon_pret_minutes                     smallint not null default 30,

  -- JSONB réservé aux paramètres à structure réellement variable (P-04, P-13, P-14, P-15) : pas
  -- de magasin clé/valeur, un CHECK par paramètre resterait possible sur les colonnes ci-dessus.
  produits_atelier                        jsonb not null default '{}'::jsonb,
  rabais_max_par_role                     jsonb not null default '{}'::jsonb,
  periodicites_expertise                  jsonb not null default '{}'::jsonb,
  relance_non_retire                      jsonb not null default '{}'::jsonb,

  cree_le    timestamptz not null default now(),
  modifie_le timestamptz not null default now(),

  constraint parametre_atelier_pk primary key (tenant_id),
  constraint parametre_atelier_controle_qualite_lot1_chk
    check (controle_qualite in ('jamais', 'toujours')),
  constraint parametre_atelier_attente_pieces_chk
    check (attente_pieces_longue_defaut in ('A', 'B')),
  constraint parametre_atelier_plafond_defaut_chk
    check (plafond_defaut_centimes is null
           or plafond_defaut_centimes between 0 and 100000000),
  constraint parametre_atelier_expertise_alerte_mois_chk check (expertise_alerte_mois > 0),
  constraint parametre_atelier_no_show_seuil_chk         check (no_show_seuil_alerte >= 0),
  constraint parametre_atelier_blocage_jours_chk         check (blocage_jours_alerte >= 0),
  constraint parametre_atelier_pointage_duree_max_chk    check (pointage_duree_max_heures > 0),
  constraint parametre_atelier_tampon_pret_chk           check (tampon_pret_minutes >= 0)
);

comment on table public.parametre_atelier is
  'Paramètres structurants du tenant (P-xx de la spécification). Une ligne par tenant, id = '
  'tenant_id. controle_qualite restreint à jamais|toujours au lot 1 (Δ3 du plan d''exécution) ; '
  'fonctionnalites n''est PAS une colonne, calculé côté service.';

create trigger parametre_atelier_touche_modifie_le
  before update on public.parametre_atelier
  for each row execute function public.touche_modifie_le();

revoke all    on public.parametre_atelier from dfa_app;
grant  select, insert, update on public.parametre_atelier to dfa_app;
-- Δ6 : explicite malgré 0002.
revoke delete on public.parametre_atelier from dfa_app;

alter table public.parametre_atelier enable row level security;
alter table public.parametre_atelier force  row level security;

create policy parametre_atelier_isolation_tenant on public.parametre_atelier
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy parametre_atelier_migrator on public.parametre_atelier
  to dfa_migrator
  using (true) with check (true);


-- ---------------------------------------------------------------------------------------------
-- 3. `parametre_site` — une ligne par site, PK confondue avec `site_id`
-- ---------------------------------------------------------------------------------------------

create table public.parametre_site (
  tenant_id uuid not null,
  site_id   uuid not null,

  heure_ouverture                 time    null,
  heure_fermeture                 time    null,
  heure_cloture_pointage           time    null,
  capacite_heures_jour_centiemes  integer null,
  jours_fermeture                 jsonb   not null default '[]'::jsonb,

  cree_le    timestamptz not null default now(),
  modifie_le timestamptz not null default now(),

  constraint parametre_site_pk primary key (site_id),
  constraint parametre_site_tenant_id_uk unique (tenant_id, site_id),
  constraint parametre_site_fk foreign key (tenant_id, site_id)
    references public.site (tenant_id, id) on delete restrict,
  constraint parametre_site_capacite_chk check (capacite_heures_jour_centiemes >= 0)
);

comment on table public.parametre_site is
  'Paramètres par site (P-20, P-31). Une ligne par site, id = site_id.';

create trigger parametre_site_touche_modifie_le
  before update on public.parametre_site
  for each row execute function public.touche_modifie_le();

revoke all    on public.parametre_site from dfa_app;
grant  select, insert, update on public.parametre_site to dfa_app;
-- Δ6 : explicite malgré 0002.
revoke delete on public.parametre_site from dfa_app;

alter table public.parametre_site enable row level security;
alter table public.parametre_site force  row level security;

create policy parametre_site_isolation_tenant on public.parametre_site
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy parametre_site_migrator on public.parametre_site
  to dfa_migrator
  using (true) with check (true);


-- ---------------------------------------------------------------------------------------------
-- 4. `compteur_document` — numérotation continue, PAS une SEQUENCE PostgreSQL
--
-- Une SEQUENCE n'est ni scopable par tenant/année/site, ni remise à zéro annuellement (P-01), et
-- laisse des trous au ROLLBACK — RM-49 (n° d'OR) et RM-11 (n° de client) exigent une numérotation
-- CONTINUE. Le protocole d'incrémentation (`select … for update` dans la transaction de création
-- du document, `plan-etape-1-backend.md` §6) appartient au service ; cette table ne porte que la
-- contrainte qui empêche deux documents concurrents de recevoir le même numéro.
-- ---------------------------------------------------------------------------------------------

create table public.compteur_document (
  id            uuid        not null default gen_random_uuid(),
  tenant_id     uuid        not null references public.tenant (id) on delete restrict,
  type_document text        not null,
  annee         smallint    not null,
  site_id       uuid        null,
  valeur        integer     not null default 0,

  cree_le    timestamptz not null default now(),
  modifie_le timestamptz not null default now(),

  constraint compteur_document_pk primary key (id),
  constraint compteur_document_tenant_id_uk unique (tenant_id, id),
  constraint compteur_document_fk_site foreign key (tenant_id, site_id)
    references public.site (tenant_id, id) on delete restrict,
  constraint compteur_document_annee_chk check (annee between 2000 and 2100),
  constraint compteur_document_valeur_chk check (valeur >= 0),
  constraint compteur_document_type_non_vide_chk check (length(btrim(type_document)) > 0)
);

comment on table public.compteur_document is
  'Numérotation continue par tenant/année/[site] des documents (n° d''OR RM-49, n° de client '
  'RM-11). Volontairement PAS une SEQUENCE PostgreSQL : scopable, remise à zéro annuelle (P-01), '
  'sans trou au rollback. Incrémentée par le service via select … for update.';

-- `site_id` peut être NULL (portée tenant, P-01) : `coalesce` dans l'index d'unicité, pas dans un
-- `unique()` de table (qui n'accepte pas d'expression). Commence par tenant_id (R-9).
create unique index compteur_document_uk
  on public.compteur_document (
    tenant_id, type_document, annee,
    coalesce(site_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

create trigger compteur_document_touche_modifie_le
  before update on public.compteur_document
  for each row execute function public.touche_modifie_le();

revoke all    on public.compteur_document from dfa_app;
grant  select, insert, update on public.compteur_document to dfa_app;
-- Δ6 : explicite malgré 0002.
revoke delete on public.compteur_document from dfa_app;

alter table public.compteur_document enable row level security;
alter table public.compteur_document force  row level security;

create policy compteur_document_isolation_tenant on public.compteur_document
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy compteur_document_migrator on public.compteur_document
  to dfa_migrator
  using (true) with check (true);


-- ---------------------------------------------------------------------------------------------
-- 5. `taux_horaire`, `prestation`, `prestation_prix` — référentiels historisés
--
-- `taux_horaire` et `prestation_prix` utilisent le même patron que `client_condition` (0006) et
-- `vehicule_plaque`/`vehicule_detention` (0007) : EXCLUDE GiST garantissant qu'il n'existe JAMAIS
-- deux enregistrements valides concurrents à une même date (§2.6 du plan backend).
-- ---------------------------------------------------------------------------------------------

create table public.taux_horaire (
  id               uuid        not null default gen_random_uuid(),
  tenant_id        uuid        not null references public.tenant (id) on delete restrict,
  code             text        not null,
  libelle          text        not null,
  montant_centimes integer     not null,
  valide_du        date        not null,
  valide_au        date        null,

  cree_le    timestamptz not null default now(),
  modifie_le timestamptz not null default now(),

  constraint taux_horaire_pk primary key (id),
  constraint taux_horaire_tenant_id_uk unique (tenant_id, id),
  constraint taux_horaire_montant_chk check (montant_centimes between 0 and 100000000),
  constraint taux_horaire_code_non_vide_chk check (length(btrim(code)) > 0),
  constraint taux_horaire_periode_chk check (valide_au is null or valide_au > valide_du),
  constraint taux_horaire_periode_excl
    exclude using gist (
      tenant_id with =,
      code with =,
      daterange(valide_du, valide_au, '[)') with &&
    )
);

comment on table public.taux_horaire is
  'Taux horaires datés (code, montant). EXCLUDE : deux périodes valides du même code ne peuvent '
  'jamais se chevaucher pour un tenant.';

create trigger taux_horaire_touche_modifie_le
  before update on public.taux_horaire
  for each row execute function public.touche_modifie_le();

revoke all    on public.taux_horaire from dfa_app;
grant  select, insert, update on public.taux_horaire to dfa_app;
revoke delete on public.taux_horaire from dfa_app;

alter table public.taux_horaire enable row level security;
alter table public.taux_horaire force  row level security;

create policy taux_horaire_isolation_tenant on public.taux_horaire
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy taux_horaire_migrator on public.taux_horaire
  to dfa_migrator
  using (true) with check (true);


create table public.prestation (
  id                     uuid        not null default gen_random_uuid(),
  tenant_id              uuid        not null references public.tenant (id) on delete restrict,
  code                   text        not null,
  designation_fr         text        not null,
  designation_de         text        null,
  designation_it         text        null,
  type_ligne             public.type_ligne_or not null default 'forfait',
  temps_bareme_centiemes integer     null,
  taux_horaire_code      text        null,
  taux_tva_pourmille     smallint    not null default 81,
  actif                  boolean     not null default true,

  cree_le    timestamptz not null default now(),
  modifie_le timestamptz not null default now(),

  constraint prestation_pk primary key (id),
  constraint prestation_tenant_id_uk unique (tenant_id, id),
  constraint prestation_tenant_code_uk unique (tenant_id, code),
  constraint prestation_code_non_vide_chk check (length(btrim(code)) > 0),
  constraint prestation_designation_non_vide_chk check (length(btrim(designation_fr)) > 0),
  constraint prestation_temps_bareme_chk check (temps_bareme_centiemes is null or temps_bareme_centiemes >= 0),
  constraint prestation_taux_tva_chk check (taux_tva_pourmille between 0 and 1000)
);

comment on table public.prestation is
  'Catalogue de forfaits/prestations (§7.9 de la spécification).';

create trigger prestation_touche_modifie_le
  before update on public.prestation
  for each row execute function public.touche_modifie_le();

revoke all    on public.prestation from dfa_app;
grant  select, insert, update on public.prestation to dfa_app;
revoke delete on public.prestation from dfa_app;

alter table public.prestation enable row level security;
alter table public.prestation force  row level security;

create policy prestation_isolation_tenant on public.prestation
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy prestation_migrator on public.prestation
  to dfa_migrator
  using (true) with check (true);


create table public.prestation_prix (
  id             uuid        not null default gen_random_uuid(),
  tenant_id      uuid        not null,
  prestation_id  uuid        not null,
  prix_centimes  integer     not null,
  valide_du      date        not null,
  valide_au      date        null,

  cree_le    timestamptz not null default now(),
  modifie_le timestamptz not null default now(),

  constraint prestation_prix_pk primary key (id),
  constraint prestation_prix_tenant_id_uk unique (tenant_id, id),
  constraint prestation_prix_fk foreign key (tenant_id, prestation_id)
    references public.prestation (tenant_id, id) on delete restrict,
  constraint prestation_prix_montant_chk check (prix_centimes between 0 and 100000000),
  constraint prestation_prix_periode_chk check (valide_au is null or valide_au > valide_du),
  constraint prestation_prix_periode_excl
    exclude using gist (
      tenant_id with =,
      prestation_id with =,
      daterange(valide_du, valide_au, '[)') with &&
    )
);

comment on table public.prestation_prix is
  'Prix datés d''une prestation. EXCLUDE : deux prix valides de la même prestation ne peuvent '
  'jamais se chevaucher.';

create trigger prestation_prix_touche_modifie_le
  before update on public.prestation_prix
  for each row execute function public.touche_modifie_le();

revoke all    on public.prestation_prix from dfa_app;
grant  select, insert, update on public.prestation_prix to dfa_app;
revoke delete on public.prestation_prix from dfa_app;

alter table public.prestation_prix enable row level security;
alter table public.prestation_prix force  row level security;

create policy prestation_prix_isolation_tenant on public.prestation_prix
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy prestation_prix_migrator on public.prestation_prix
  to dfa_migrator
  using (true) with check (true);


-- ---------------------------------------------------------------------------------------------
-- 6. `motif_rendez_vous`, `poste_travail`, `activite_indirecte` — référentiels simples
--
-- Motifs de RDV et activités indirectes sont des TABLES (chaque garage a les siens) et non des
-- enums PG : la frontière retenue est « ce qui se paramètre » vs « ce qui se migre » (types d'OR,
-- eux, restent un enum fermé, structurant pour les statistiques).
-- ---------------------------------------------------------------------------------------------

create table public.motif_rendez_vous (
  id                              uuid        not null default gen_random_uuid(),
  tenant_id                       uuid        not null references public.tenant (id) on delete restrict,
  code                            text        not null,
  libelle_fr                      text        not null,
  libelle_de                      text        null,
  libelle_it                      text        null,
  duree_defaut_minutes            smallint    null,
  heures_atelier_defaut_centiemes integer     null,
  actif                           boolean     not null default true,

  cree_le    timestamptz not null default now(),
  modifie_le timestamptz not null default now(),

  constraint motif_rendez_vous_pk primary key (id),
  constraint motif_rendez_vous_tenant_id_uk unique (tenant_id, id),
  constraint motif_rendez_vous_tenant_code_uk unique (tenant_id, code),
  constraint motif_rendez_vous_duree_chk check (duree_defaut_minutes is null or duree_defaut_minutes > 0),
  constraint motif_rendez_vous_heures_chk
    check (heures_atelier_defaut_centiemes is null or heures_atelier_defaut_centiemes >= 0)
);

comment on table public.motif_rendez_vous is
  'Motifs de rendez-vous paramétrables par tenant. Table servie au lot 4 (planning) ; créée au '
  'lot 1 car le référentiel appartient au module paramétrage.';

create trigger motif_rendez_vous_touche_modifie_le
  before update on public.motif_rendez_vous
  for each row execute function public.touche_modifie_le();

revoke all    on public.motif_rendez_vous from dfa_app;
grant  select, insert, update on public.motif_rendez_vous to dfa_app;
revoke delete on public.motif_rendez_vous from dfa_app;

alter table public.motif_rendez_vous enable row level security;
alter table public.motif_rendez_vous force  row level security;

create policy motif_rendez_vous_isolation_tenant on public.motif_rendez_vous
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy motif_rendez_vous_migrator on public.motif_rendez_vous
  to dfa_migrator
  using (true) with check (true);


create table public.poste_travail (
  id        uuid    not null default gen_random_uuid(),
  tenant_id uuid    not null,
  site_id   uuid    not null,
  code      text    not null,
  libelle   text    not null,
  actif     boolean not null default true,

  cree_le    timestamptz not null default now(),
  modifie_le timestamptz not null default now(),

  constraint poste_travail_pk primary key (id),
  constraint poste_travail_tenant_id_uk unique (tenant_id, id),
  constraint poste_travail_fk_site foreign key (tenant_id, site_id)
    references public.site (tenant_id, id) on delete restrict,
  constraint poste_travail_tenant_site_code_uk unique (tenant_id, site_id, code)
);

comment on table public.poste_travail is
  'Postes de travail d''un site. Table servie au lot 4 (planning) ; créée au lot 1.';

create trigger poste_travail_touche_modifie_le
  before update on public.poste_travail
  for each row execute function public.touche_modifie_le();

revoke all    on public.poste_travail from dfa_app;
grant  select, insert, update on public.poste_travail to dfa_app;
revoke delete on public.poste_travail from dfa_app;

alter table public.poste_travail enable row level security;
alter table public.poste_travail force  row level security;

create policy poste_travail_isolation_tenant on public.poste_travail
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy poste_travail_migrator on public.poste_travail
  to dfa_migrator
  using (true) with check (true);


create table public.activite_indirecte (
  id          uuid        not null default gen_random_uuid(),
  tenant_id   uuid        not null references public.tenant (id) on delete restrict,
  code        text        not null,
  libelle_fr  text        not null,
  libelle_de  text        null,
  libelle_it  text        null,
  -- Une retouche interne est « productive non vendue » (RM-99) : productif = true.
  productif   boolean     not null default false,
  actif       boolean     not null default true,

  cree_le    timestamptz not null default now(),
  modifie_le timestamptz not null default now(),

  constraint activite_indirecte_pk primary key (id),
  constraint activite_indirecte_tenant_id_uk unique (tenant_id, id),
  constraint activite_indirecte_tenant_code_uk unique (tenant_id, code)
);

comment on table public.activite_indirecte is
  'Activités indirectes de pointage (RM-99). Table servie au lot 2 (pointage) ; créée au lot 1.';

create trigger activite_indirecte_touche_modifie_le
  before update on public.activite_indirecte
  for each row execute function public.touche_modifie_le();

revoke all    on public.activite_indirecte from dfa_app;
grant  select, insert, update on public.activite_indirecte to dfa_app;
revoke delete on public.activite_indirecte from dfa_app;

alter table public.activite_indirecte enable row level security;
alter table public.activite_indirecte force  row level security;

create policy activite_indirecte_isolation_tenant on public.activite_indirecte
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy activite_indirecte_migrator on public.activite_indirecte
  to dfa_migrator
  using (true) with check (true);


-- ---------------------------------------------------------------------------------------------
-- 7. Assertions de fin de migration
-- ---------------------------------------------------------------------------------------------

do $$
declare
  fautives text;
begin
  select string_agg(t.tbl, ', ') into fautives
    from (values
      ('parametre_atelier'), ('parametre_site'), ('compteur_document'),
      ('taux_horaire'), ('prestation'), ('prestation_prix'),
      ('motif_rendez_vous'), ('poste_travail'), ('activite_indirecte')
    ) as t(tbl)
   where has_table_privilege('dfa_app', format('public.%I', t.tbl), 'DELETE');

  if fautives is not null then
    raise exception 'DELETE encore accordé à dfa_app sur % (Δ6 violé).', fautives;
  end if;
end
$$;
