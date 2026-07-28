-- =============================================================================================
-- 0008_atelier.sql — L1-05 (4/4) : module atelier — l'ordre de réparation
--
-- `ordre_reparation`, `ordre_reparation_demande` (append-only), `ligne_or`,
-- `devis_complementaire`, `devis_complementaire_ligne`, `or_controle_qualite`.
--
-- DELTAS DU PLAN D'EXÉCUTION (priment sur `plan-etape-1-backend.md`) :
--   Δ1 — `ordre_reparation.plafond_centimes` NULLABLE (Q-02, §4) : NULL = aucun plafond convenu
--        (la garde RM-54 ne s'exécute pas), 0 = accord requis pour toute validation payante,
--        n>0 = plafond nominal.
--   Δ2 — `+ version integer not null default 1`, incrémentée par un trigger BEFORE UPDATE posé
--        SUR CETTE TABLE SEULE (§1.5) : l'ETag de `PATCH /ordres-reparation/{id}` couvre les
--        champs d'EN-TÊTE, pas les lignes. Le trigger compare NEW/OLD en EXCLUANT les colonnes
--        dérivées (`attente_*`, `total_valide_centimes`, `modifie_le`, `version` elle-même) :
--        sans cette exclusion, le trigger « drapeaux dérivés » (couche 5 ci-dessous), qui
--        UPDATE l'OR à chaque changement de ligne, ferait grimper la version en permanence et
--        le réceptionnaire recevrait 409 CONFLIT en boucle pendant que le technicien saisit.
--   Δ4 — `pointage*`, `rendez_vous*`, `*_courtoisie`, `or_signature`, `or_tache_suivi` : NON créées.
--   Δ6 — `revoke delete` explicite sur chaque table malgré 0002.
--
-- MACHINE À ÉTATS (plan backend §3.3) : couche 1 = `transition_autorisee` (0003) ; couche 2 =
-- `verifier_transition()` (0003), posé ici sur `ordre_reparation` et `ligne_or` ; couche 3 =
-- triggers d'immuabilité indépendants des transitions (I-15, RM-71, RM-79, §6.3) ; couche 4 =
-- le service (gardes conditionnelles, hors DB) ; couche 5 = drapeaux dérivés par trigger.
--
-- Deux FK vers `ordre_reparation`/`ligne_or` sont ajoutées en fin de fichier sur des tables déjà
-- créées par 0007 (`vehicule_kilometrage`, `vehicule_campagne`, `vehicule_travail_reporte`) :
-- ces colonnes existaient sans contrainte tant que la cible n'existait pas (§2.1 point 8).
--
-- Réversible : migrations/down/0008_atelier.down.sql.
-- =============================================================================================


-- ---------------------------------------------------------------------------------------------
-- 1. `ordre_reparation`
-- ---------------------------------------------------------------------------------------------

create table public.ordre_reparation (
  id        uuid not null default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,

  numero  text not null,
  site_id uuid not null,
  type    public.type_ordre_reparation not null,
  statut  public.statut_ordre_reparation not null,

  client_id   uuid not null,
  vehicule_id uuid not null,

  -- Valeurs figées (RM-50) : dénormalisation VOLONTAIRE, jamais recalculée après création. Écrite
  -- UNE SEULE FOIS par le service (ServiceSnapshotOr, plan backend §2.6) ; le trigger §5 ci-dessous
  -- l'interdit à quiconque d'autre.
  client_designation_figee    text  not null,
  adresse_facturation_figee   jsonb not null,
  conditions_figees           jsonb not null,
  plaque_figee                text  null,
  detenteur_fige_client_id    uuid  null,

  conducteur_present_nom text null,
  km_entree integer null,
  km_sortie integer null,

  -- Δ1 (Q-02) : NULLABLE, sémantique à trois états — voir l'en-tête de ce fichier.
  plafond_centimes     integer null,
  plafond_autorise_par text    null,

  restitution_promise_le  timestamptz null,
  restitution_initiale_le timestamptz null,

  localisation      public.localisation_vehicule not null default 'parc',
  sous_traitant_nom text null,

  ordre_reparation_parent_id uuid null,
  motif_lien public.motif_lien_or null,

  -- Accroche lot 3 (planning) : nullable, sans FK — la table `rendez_vous` n'existe pas au lot 1.
  rendez_vous_id uuid null,

  numero_commande_interne text null,
  receptionnaire_id       uuid null,

  retention_invoquee_le timestamptz null,
  litige_ouvert_le      timestamptz null,

  ouvert_le    timestamptz null,
  termine_le   timestamptz null,
  facture_le   timestamptz null,
  restitue_le  timestamptz null,
  cloture_le   timestamptz null,
  annule_le    timestamptz null,
  motif_annulation text null,

  -- Couche 5 (drapeaux dérivés, A-03) : maintenus par trigger depuis `ligne_or.blocage`, jamais
  -- écrits par le service directement.
  attente_accord  boolean not null default false,
  attente_pieces  boolean not null default false,
  attente_externe boolean not null default false,
  -- Dérivé, maintenu par trigger : sert RM-54 sans recompter les lignes à chaque validation.
  total_valide_centimes bigint not null default 0,

  -- Δ2 : portée de l'ETag = les colonnes d'EN-TÊTE seulement.
  version integer not null default 1,

  cree_le    timestamptz not null default now(),
  modifie_le timestamptz not null default now(),

  constraint ordre_reparation_pk primary key (id),
  constraint ordre_reparation_tenant_id_uk unique (tenant_id, id),
  constraint ordre_reparation_tenant_numero_uk unique (tenant_id, numero),

  constraint ordre_reparation_fk_site foreign key (tenant_id, site_id)
    references public.site (tenant_id, id) on delete restrict,
  constraint ordre_reparation_fk_client foreign key (tenant_id, client_id)
    references public.client (tenant_id, id) on delete restrict,
  constraint ordre_reparation_fk_vehicule foreign key (tenant_id, vehicule_id)
    references public.vehicule (tenant_id, id) on delete restrict,
  constraint ordre_reparation_fk_detenteur_fige foreign key (tenant_id, detenteur_fige_client_id)
    references public.client (tenant_id, id) on delete restrict,
  constraint ordre_reparation_fk_parent foreign key (tenant_id, ordre_reparation_parent_id)
    references public.ordre_reparation (tenant_id, id) on delete restrict,
  constraint ordre_reparation_fk_receptionnaire foreign key (tenant_id, receptionnaire_id)
    references public.utilisateur (tenant_id, id) on delete restrict,

  constraint ordre_reparation_numero_non_vide_chk check (length(btrim(numero)) > 0),
  constraint ordre_reparation_lien_coherent_chk
    check ((ordre_reparation_parent_id is null) = (motif_lien is null)),
  constraint ordre_reparation_plafond_chk
    check (plafond_centimes is null or plafond_centimes between 0 and 100000000),
  constraint ordre_reparation_km_entree_chk check (km_entree is null or km_entree >= 0),
  constraint ordre_reparation_km_sortie_chk check (km_sortie is null or km_sortie >= 0),
  constraint ordre_reparation_total_valide_chk check (total_valide_centimes >= 0),
  constraint ordre_reparation_version_chk check (version > 0),
  constraint ordre_reparation_annulation_coherente_chk
    check (statut <> 'annule' or motif_annulation is not null)
);

comment on table public.ordre_reparation is
  'Ordre de réparation — agrégat central de l''atelier. plafond_centimes NULLABLE (Δ1/Q-02). '
  'version incrémentée uniquement sur modification d''en-tête (Δ2/§1.5), pas sur les lignes.';

create trigger ordre_reparation_touche_modifie_le
  before update on public.ordre_reparation
  for each row execute function public.touche_modifie_le();

-- --- Immuabilité des champs figés et de vehicule_id après ouverture (couche 3, §6.3, RM-50) -----

create function public.ordre_reparation_verrouiller_figes() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $fn$
begin
  if new.vehicule_id is distinct from old.vehicule_id and old.statut <> 'planifie' then
    raise exception using
      errcode = 'ZDFA3',
      message = format('ordre_reparation.vehicule_id est figé après ouverture (statut %s).', old.statut),
      detail  = format('entite=ordre_reparation;entite_id=%s;champ=vehicule_id', old.id);
  end if;

  if new.client_designation_figee  is distinct from old.client_designation_figee
     or new.adresse_facturation_figee is distinct from old.adresse_facturation_figee
     or new.conditions_figees         is distinct from old.conditions_figees
     or new.plaque_figee              is distinct from old.plaque_figee
     or new.detenteur_fige_client_id  is distinct from old.detenteur_fige_client_id
  then
    raise exception using
      errcode = 'ZDFA3',
      message = 'ordre_reparation : les champs figés (RM-50) ne sont jamais modifiés après création.',
      detail  = format('entite=ordre_reparation;entite_id=%s', old.id);
  end if;

  return new;
end
$fn$;

comment on function public.ordre_reparation_verrouiller_figes() is
  'Trigger BEFORE UPDATE : rejette la modification de vehicule_id après ouverture (§6.3) et de tout champ *_fige* (RM-50), SQLSTATE ZDFA3.';

revoke all on function public.ordre_reparation_verrouiller_figes() from public;

create trigger ordre_reparation_verrouiller_figes
  before update on public.ordre_reparation
  for each row execute function public.ordre_reparation_verrouiller_figes();

-- --- Δ2 : version — portée EN-TÊTE seule -------------------------------------------------------

create function public.ordre_reparation_incrementer_version() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $fn$
declare
  colonnes_derivees text[] :=
    array['attente_accord', 'attente_pieces', 'attente_externe',
          'total_valide_centimes', 'version', 'modifie_le'];
begin
  if (to_jsonb(new) - colonnes_derivees) is distinct from (to_jsonb(old) - colonnes_derivees) then
    new.version := old.version + 1;
  else
    new.version := old.version;
  end if;
  return new;
end
$fn$;

comment on function public.ordre_reparation_incrementer_version() is
  'Trigger BEFORE UPDATE, posé UNIQUEMENT sur ordre_reparation (Δ2/§1.5) : incrémente version '
  'seulement quand une colonne autre que les drapeaux dérivés change — sans quoi le trigger '
  '« drapeaux dérivés » ferait grimper la version à chaque changement de ligne.';

revoke all on function public.ordre_reparation_incrementer_version() from public;

create trigger ordre_reparation_incrementer_version
  before update on public.ordre_reparation
  for each row execute function public.ordre_reparation_incrementer_version();

-- --- Couche 2 : machine à états (0003 §6) --------------------------------------------------------

create trigger ordre_reparation_verifier_transition
  before update on public.ordre_reparation
  for each row execute function public.verifier_transition('ordre_reparation');

create trigger ordre_reparation_audit
  after insert or update or delete on public.ordre_reparation
  for each row execute function public.auditer_atelier('ordre_reparation');

-- --- Index -----------------------------------------------------------------------------------

-- Tableau de bord du chef d'atelier : ~30 lignes à 62 500 en table (index PARTIEL, §6 du plan backend).
create index ordre_reparation_actifs_idx on public.ordre_reparation
  (tenant_id, site_id, statut)
  where statut in ('planifie', 'ouvert', 'en_cours', 'controle');

create index ordre_reparation_vehicule_idx  on public.ordre_reparation (tenant_id, vehicule_id, ouvert_le desc);
create index ordre_reparation_client_idx    on public.ordre_reparation (tenant_id, client_id, ouvert_le desc);

-- Véhicules facturés non retirés (§6.5, CT-50).
create index ordre_reparation_non_retire_idx on public.ordre_reparation
  (tenant_id, termine_le)
  where statut = 'facture';

create index ordre_reparation_pagination_idx on public.ordre_reparation (tenant_id, cree_le desc, id desc);

revoke all    on public.ordre_reparation from dfa_app;
grant  select, insert, update on public.ordre_reparation to dfa_app;
-- Δ6 + RM-110/I-05/I-06 : cloture/annule sont terminaux, aucune suppression physique.
revoke delete on public.ordre_reparation from dfa_app;

alter table public.ordre_reparation enable row level security;
alter table public.ordre_reparation force  row level security;

create policy ordre_reparation_isolation_tenant on public.ordre_reparation
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy ordre_reparation_migrator on public.ordre_reparation
  to dfa_migrator
  using (true) with check (true);


-- ---------------------------------------------------------------------------------------------
-- 2. `ordre_reparation_demande` — verbatim, append-only (RM-52)
-- ---------------------------------------------------------------------------------------------

create table public.ordre_reparation_demande (
  id                  uuid    not null default gen_random_uuid(),
  tenant_id           uuid    not null,
  ordre_reparation_id uuid    not null,
  ordre               smallint not null,
  verbatim            text    not null,
  saisi_le            timestamptz not null default now(),
  saisi_par_id        uuid    null,

  cree_le timestamptz not null default now(),

  constraint ordre_reparation_demande_pk primary key (id),
  constraint ordre_reparation_demande_tenant_id_uk unique (tenant_id, id),
  constraint ordre_reparation_demande_fk_or foreign key (tenant_id, ordre_reparation_id)
    references public.ordre_reparation (tenant_id, id) on delete restrict,
  constraint ordre_reparation_demande_fk_saisi_par foreign key (tenant_id, saisi_par_id)
    references public.utilisateur (tenant_id, id) on delete restrict,
  constraint ordre_reparation_demande_tenant_or_ordre_uk unique (tenant_id, ordre_reparation_id, ordre),
  constraint ordre_reparation_demande_verbatim_non_vide_chk check (length(btrim(verbatim)) > 0)
);

comment on table public.ordre_reparation_demande is
  'Demandes du client au verbatim (RM-52), append-only : pas de GRANT UPDATE, le verbatim est un fait.';

create index ordre_reparation_demande_or_idx
  on public.ordre_reparation_demande (tenant_id, ordre_reparation_id, ordre);

revoke all    on public.ordre_reparation_demande from dfa_app;
grant  select, insert on public.ordre_reparation_demande to dfa_app;

alter table public.ordre_reparation_demande enable row level security;
alter table public.ordre_reparation_demande force  row level security;

create policy ordre_reparation_demande_isolation_tenant on public.ordre_reparation_demande
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy ordre_reparation_demande_migrator on public.ordre_reparation_demande
  to dfa_migrator
  using (true) with check (true);


-- ---------------------------------------------------------------------------------------------
-- 3. `ligne_or`
-- ---------------------------------------------------------------------------------------------

create table public.ligne_or (
  id                  uuid not null default gen_random_uuid(),
  tenant_id           uuid not null,
  ordre_reparation_id uuid not null,
  numero_ordre        smallint not null,

  type    public.type_ligne_or not null,
  origine public.origine_ligne_or not null,
  statut  public.statut_ligne_or not null,
  payeur  public.payeur_ligne_or not null default 'client',
  blocage public.blocage_ligne_or not null default 'aucun',

  designation     text null,
  reference_texte text null,
  -- Accroche étape 3 (stock pièces) : nullable, sans FK.
  article_id uuid null,

  quantite_millieme integer null default 1000,
  temps_bareme_centiemes integer null,
  temps_bareme_constructeur_centiemes integer null,

  -- Figés à la création (RM-65) : une évolution du taux horaire ou du tarif après coup ne doit
  -- JAMAIS rejouer un OR déjà en cours.
  taux_horaire_centimes integer null,
  prix_unitaire_centimes integer null,
  rabais_pourmille smallint null,
  taux_tva_pourmille smallint not null default 81,

  -- Calculés côté service (A-04), stockés : jamais recalculés depuis le prix courant.
  montant_ht_centimes   integer not null,
  montant_tva_centimes  integer not null,
  montant_ttc_centimes  integer not null,

  technicien_id uuid null,
  code_operation text null,
  code_defaut    text null,
  numero_sinistre text null,
  numero_accord   text null,

  urgence  public.urgence_travail null,
  securite boolean not null default false,
  fournie_par_client boolean not null default false,
  a_restituer boolean not null default false,
  restituee   boolean not null default false,

  motif_annulation text null,
  -- Accroche étape 2 (facturation) : nullable, sans FK.
  facture_id uuid null,

  cree_le    timestamptz not null default now(),
  modifie_le timestamptz not null default now(),

  constraint ligne_or_pk primary key (id),
  constraint ligne_or_tenant_id_uk unique (tenant_id, id),
  constraint ligne_or_tenant_or_ordre_uk unique (tenant_id, ordre_reparation_id, numero_ordre),

  constraint ligne_or_fk_or foreign key (tenant_id, ordre_reparation_id)
    references public.ordre_reparation (tenant_id, id) on delete restrict,
  constraint ligne_or_fk_technicien foreign key (tenant_id, technicien_id)
    references public.utilisateur (tenant_id, id) on delete restrict,

  constraint ligne_or_montant_ht_chk  check (montant_ht_centimes  between -100000000 and 100000000),
  constraint ligne_or_montant_tva_chk check (montant_tva_centimes between -100000000 and 100000000),
  constraint ligne_or_montant_ttc_chk check (montant_ttc_centimes between -100000000 and 100000000),
  constraint ligne_or_montant_coherent_chk
    check (montant_ttc_centimes = montant_ht_centimes + montant_tva_centimes),
  constraint ligne_or_taux_tva_chk check (taux_tva_pourmille between 0 and 1000),
  constraint ligne_or_rabais_chk check (rabais_pourmille is null or rabais_pourmille between 0 and 1000),
  constraint ligne_or_annulation_motif_chk
    check (statut <> 'annulee' or motif_annulation is not null),
  constraint ligne_or_taux_horaire_requis_chk
    check (type not in ('main_oeuvre_bareme', 'main_oeuvre_temps_reel') or taux_horaire_centimes is not null)
);

comment on table public.ligne_or is
  'Ligne d''un ordre de réparation. taux_horaire_centimes/prix_unitaire_centimes FIGÉS à la '
  'création (RM-65). Aucun DELETE (RM-71) : une ligne se corrige par annulation motivée.';

create trigger ligne_or_touche_modifie_le
  before update on public.ligne_or
  for each row execute function public.touche_modifie_le();

-- --- Couche 3 : immuabilité indépendante des transitions (I-15, CT-30, RM-71, CT-27) ------------

create function public.ligne_or_verrouiller_or() returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $fn$
declare
  statut_or public.statut_ordre_reparation;
  cible_id  uuid := coalesce(new.ordre_reparation_id, old.ordre_reparation_id);
  cible_tenant uuid := coalesce(new.tenant_id, old.tenant_id);
begin
  select o.statut into statut_or
    from public.ordre_reparation o
   where o.tenant_id = cible_tenant and o.id = cible_id;

  if statut_or in ('facture', 'restitue', 'cloture', 'annule') then
    raise exception using
      errcode = 'ZDFA2',
      message = format('ligne_or : OR verrouillé (statut %s), plus aucune modification de ligne (I-15, CT-30).', statut_or),
      detail  = format('entite=ligne_or;entite_id=%s;ordre_reparation_id=%s', coalesce(new.id, old.id), cible_id);
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$fn$;

comment on function public.ligne_or_verrouiller_or() is
  'Trigger BEFORE INSERT/UPDATE/DELETE : refuse toute écriture sur une ligne dont l''OR est facture|restitue|cloture|annule (I-15, CT-30), SQLSTATE ZDFA2.';

revoke all on function public.ligne_or_verrouiller_or() from public;

create trigger ligne_or_verrouiller_or
  before insert or update or delete on public.ligne_or
  for each row execute function public.ligne_or_verrouiller_or();

-- RM-71/CT-27 — ceinture et bretelles : aucun GRANT DELETE n'est accordé à dfa_app (ci-dessous),
-- ce trigger refuse la suppression même si le privilège était accordé un jour « pour un script ».
create function public.ligne_or_interdire_suppression() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $fn$
begin
  raise exception using
    errcode = 'ZDFA2',
    message = 'ligne_or ne se supprime jamais : elle s''annule (statut=annulee, motif obligatoire) (RM-71, CT-27).',
    detail  = format('entite=ligne_or;entite_id=%s', old.id);
  return old;
end
$fn$;

revoke all on function public.ligne_or_interdire_suppression() from public;

create trigger ligne_or_interdire_suppression
  before delete on public.ligne_or
  for each row execute function public.ligne_or_interdire_suppression();

-- --- Couche 2 : machine à états -------------------------------------------------------------

create trigger ligne_or_verifier_transition
  before update on public.ligne_or
  for each row execute function public.verifier_transition('ligne_or');

create trigger ligne_or_audit
  after insert or update or delete on public.ligne_or
  for each row execute function public.auditer_atelier('ligne_or');

-- --- Index -----------------------------------------------------------------------------------

create index ligne_or_or_idx on public.ligne_or (tenant_id, ordre_reparation_id, numero_ordre);

-- Écran atelier du technicien : ses lignes accordées ou en cours.
create index ligne_or_technicien_idx on public.ligne_or
  (tenant_id, technicien_id)
  where statut in ('validee', 'en_cours');

-- Recalcul des drapeaux d'attente de l'OR.
create index ligne_or_blocage_idx on public.ligne_or
  (tenant_id, ordre_reparation_id)
  where blocage <> 'aucun';

revoke all    on public.ligne_or from dfa_app;
grant  select, insert, update on public.ligne_or to dfa_app;
revoke delete on public.ligne_or from dfa_app;

alter table public.ligne_or enable row level security;
alter table public.ligne_or force  row level security;

create policy ligne_or_isolation_tenant on public.ligne_or
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy ligne_or_migrator on public.ligne_or
  to dfa_migrator
  using (true) with check (true);


-- ---------------------------------------------------------------------------------------------
-- 4. Couche 5 — drapeaux dérivés de l'OR, maintenus par trigger
--
-- `attente_{accord,pieces,externe}` sont l'agrégation, PAR OR, du drapeau `blocage` porté par
-- chaque ligne (A-03) : une ligne change depuis au moins quatre chemins (réceptionnaire,
-- technicien, magasinier, réponse de devis) — recalculer en applicatif serait quatre endroits où
-- oublier. `total_valide_centimes` agrège les lignes dont le statut a dépassé la validation, pour
-- servir RM-54 sans recompter à chaque lecture.
--
-- Fonction partagée, appelée par deux triggers AFTER (sur `ligne_or` ET sur
-- `devis_complementaire`, cf. plan backend §3.3 couche 5) : un devis envoyé peut faire naître une
-- attente d'accord avant même qu'un service applicatif n'ait changé le `blocage` d'une ligne.
-- ---------------------------------------------------------------------------------------------

create function public.recalculer_drapeaux_ordre_reparation(p_tenant_id uuid, p_or_id uuid)
returns void
language plpgsql
security invoker
set search_path = pg_catalog, public
as $fn$
begin
  update public.ordre_reparation o
     set attente_accord = exists (
           select 1 from public.ligne_or l
            where l.tenant_id = p_tenant_id and l.ordre_reparation_id = p_or_id
              and l.blocage = 'accord' and l.statut not in ('facturee', 'annulee', 'refusee')
         )
         or exists (
           select 1 from public.devis_complementaire d
            where d.tenant_id = p_tenant_id and d.ordre_reparation_id = p_or_id
              and d.repondu_le is null
         ),
         attente_pieces = exists (
           select 1 from public.ligne_or l
            where l.tenant_id = p_tenant_id and l.ordre_reparation_id = p_or_id
              and l.blocage = 'pieces' and l.statut not in ('facturee', 'annulee', 'refusee')
         ),
         attente_externe = exists (
           select 1 from public.ligne_or l
            where l.tenant_id = p_tenant_id and l.ordre_reparation_id = p_or_id
              and l.blocage = 'externe' and l.statut not in ('facturee', 'annulee', 'refusee')
         ),
         total_valide_centimes = coalesce((
           select sum(l.montant_ttc_centimes) from public.ligne_or l
            where l.tenant_id = p_tenant_id and l.ordre_reparation_id = p_or_id
              and l.statut in ('validee', 'en_cours', 'realisee', 'facturee')
         ), 0)
   where o.tenant_id = p_tenant_id and o.id = p_or_id;
end
$fn$;

comment on function public.recalculer_drapeaux_ordre_reparation(uuid, uuid) is
  'Recalcule attente_{accord,pieces,externe} et total_valide_centimes depuis ligne_or.blocage et '
  'devis_complementaire.repondu_le. Appelée par les triggers AFTER sur ligne_or et '
  'devis_complementaire (couche 5, plan backend §3.3). Ne bouge PAS ordre_reparation.version '
  '(exclue du calcul de Δ2).';

revoke all     on function public.recalculer_drapeaux_ordre_reparation(uuid, uuid) from public;
grant  execute on function public.recalculer_drapeaux_ordre_reparation(uuid, uuid) to   dfa_app, dfa_migrator;

create function public.ligne_or_recalculer_drapeaux() returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $fn$
begin
  perform public.recalculer_drapeaux_ordre_reparation(
    coalesce(new.tenant_id, old.tenant_id),
    coalesce(new.ordre_reparation_id, old.ordre_reparation_id)
  );
  return null;
end
$fn$;

revoke all on function public.ligne_or_recalculer_drapeaux() from public;

create trigger ligne_or_recalculer_drapeaux
  after insert or update or delete on public.ligne_or
  for each row execute function public.ligne_or_recalculer_drapeaux();


-- ---------------------------------------------------------------------------------------------
-- 5. `devis_complementaire` (RM-79→83)
-- ---------------------------------------------------------------------------------------------

create table public.devis_complementaire (
  id                  uuid not null default gen_random_uuid(),
  tenant_id           uuid not null,
  ordre_reparation_id uuid not null,
  numero_ordre        smallint not null,

  montant_ttc_centimes     integer not null,
  nouveau_plafond_centimes integer null,
  impact_restitution_le    timestamptz null,

  envoye_le          timestamptz null,
  canal              public.canal_devis null,
  emetteur_id        uuid null,
  interlocuteur_nom  text null,

  repondu_le      timestamptz null,
  decision        public.decision_devis null,
  retranscription text null,
  -- IP, user-agent pour l'acceptation en ligne (§7, non livré au lot 1) — colonne présente, inerte.
  preuve jsonb null,

  cree_le    timestamptz not null default now(),
  modifie_le timestamptz not null default now(),

  constraint devis_complementaire_pk primary key (id),
  constraint devis_complementaire_tenant_id_uk unique (tenant_id, id),
  constraint devis_complementaire_tenant_or_ordre_uk unique (tenant_id, ordre_reparation_id, numero_ordre),

  constraint devis_complementaire_fk_or foreign key (tenant_id, ordre_reparation_id)
    references public.ordre_reparation (tenant_id, id) on delete restrict,
  constraint devis_complementaire_fk_emetteur foreign key (tenant_id, emetteur_id)
    references public.utilisateur (tenant_id, id) on delete restrict,

  constraint devis_complementaire_montant_chk
    check (montant_ttc_centimes between -100000000 and 100000000),
  constraint devis_complementaire_plafond_chk
    check (nouveau_plafond_centimes is null or nouveau_plafond_centimes between 0 and 100000000),
  constraint devis_complementaire_reponse_coherente_chk
    check (repondu_le is null or (decision is not null and interlocuteur_nom is not null))
);

comment on table public.devis_complementaire is
  'Devis complémentaire (RM-79→83). Immuable après réponse — voir le trigger '
  'devis_complementaire_verrouiller_apres_reponse (RM-79, CT-35).';

create trigger devis_complementaire_touche_modifie_le
  before update on public.devis_complementaire
  for each row execute function public.touche_modifie_le();

-- --- Immuabilité après réponse (RM-79, CT-35) ----------------------------------------------------

create function public.devis_complementaire_verrouiller_apres_reponse() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $fn$
begin
  if old.repondu_le is not null then
    raise exception using
      errcode = 'ZDFA2',
      message = 'devis_complementaire : immuable après réponse (RM-79, CT-35).',
      detail  = format('entite=devis_complementaire;entite_id=%s', old.id);
  end if;
  return new;
end
$fn$;

revoke all on function public.devis_complementaire_verrouiller_apres_reponse() from public;

create trigger devis_complementaire_verrouiller_apres_reponse
  before update on public.devis_complementaire
  for each row execute function public.devis_complementaire_verrouiller_apres_reponse();

create trigger devis_complementaire_audit
  after insert or update or delete on public.devis_complementaire
  for each row execute function public.auditer_atelier('devis_complementaire');

create function public.devis_complementaire_recalculer_drapeaux() returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $fn$
begin
  perform public.recalculer_drapeaux_ordre_reparation(
    coalesce(new.tenant_id, old.tenant_id),
    coalesce(new.ordre_reparation_id, old.ordre_reparation_id)
  );
  return null;
end
$fn$;

revoke all on function public.devis_complementaire_recalculer_drapeaux() from public;

create trigger devis_complementaire_recalculer_drapeaux
  after insert or update or delete on public.devis_complementaire
  for each row execute function public.devis_complementaire_recalculer_drapeaux();

revoke all    on public.devis_complementaire from dfa_app;
grant  select, insert, update on public.devis_complementaire to dfa_app;
revoke delete on public.devis_complementaire from dfa_app;

alter table public.devis_complementaire enable row level security;
alter table public.devis_complementaire force  row level security;

create policy devis_complementaire_isolation_tenant on public.devis_complementaire
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy devis_complementaire_migrator on public.devis_complementaire
  to dfa_migrator
  using (true) with check (true);


-- ---------------------------------------------------------------------------------------------
-- 6. `devis_complementaire_ligne`
-- ---------------------------------------------------------------------------------------------

create table public.devis_complementaire_ligne (
  id                      uuid not null default gen_random_uuid(),
  tenant_id               uuid not null,
  devis_complementaire_id uuid not null,
  ligne_or_id             uuid not null,
  -- Réponse PARTIELLE (RM-81, CT-33) : chaque ligne prend sa propre décision.
  decision public.decision_devis null,

  cree_le    timestamptz not null default now(),
  modifie_le timestamptz not null default now(),

  constraint devis_complementaire_ligne_pk primary key (id),
  constraint devis_complementaire_ligne_tenant_id_uk unique (tenant_id, id),
  constraint devis_complementaire_ligne_tenant_uk unique (tenant_id, devis_complementaire_id, ligne_or_id),

  constraint devis_complementaire_ligne_fk_devis foreign key (tenant_id, devis_complementaire_id)
    references public.devis_complementaire (tenant_id, id) on delete restrict,
  constraint devis_complementaire_ligne_fk_ligne foreign key (tenant_id, ligne_or_id)
    references public.ligne_or (tenant_id, id) on delete restrict
);

comment on table public.devis_complementaire_ligne is
  'Lignes rattachées à un devis complémentaire, avec décision individuelle (RM-81, CT-33).';

create trigger devis_complementaire_ligne_touche_modifie_le
  before update on public.devis_complementaire_ligne
  for each row execute function public.touche_modifie_le();

revoke all    on public.devis_complementaire_ligne from dfa_app;
grant  select, insert, update on public.devis_complementaire_ligne to dfa_app;
revoke delete on public.devis_complementaire_ligne from dfa_app;

alter table public.devis_complementaire_ligne enable row level security;
alter table public.devis_complementaire_ligne force  row level security;

create policy devis_complementaire_ligne_isolation_tenant on public.devis_complementaire_ligne
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy devis_complementaire_ligne_migrator on public.devis_complementaire_ligne
  to dfa_migrator
  using (true) with check (true);


-- ---------------------------------------------------------------------------------------------
-- 7. `or_controle_qualite`
-- ---------------------------------------------------------------------------------------------

create table public.or_controle_qualite (
  id                  uuid not null default gen_random_uuid(),
  tenant_id           uuid not null,
  ordre_reparation_id uuid not null,
  controleur_id       uuid null,
  controle_le         timestamptz not null default now(),
  conforme            boolean not null,
  motif_non_conformite text null,

  cree_le    timestamptz not null default now(),
  modifie_le timestamptz not null default now(),

  constraint or_controle_qualite_pk primary key (id),
  constraint or_controle_qualite_tenant_id_uk unique (tenant_id, id),
  constraint or_controle_qualite_fk_or foreign key (tenant_id, ordre_reparation_id)
    references public.ordre_reparation (tenant_id, id) on delete restrict,
  constraint or_controle_qualite_fk_controleur foreign key (tenant_id, controleur_id)
    references public.utilisateur (tenant_id, id) on delete restrict,
  constraint or_controle_qualite_motif_chk check (conforme or motif_non_conformite is not null)
);

comment on table public.or_controle_qualite is
  'Contrôle qualité simple d''un OR (T-12). Check-lists outillées = lot 2 (P-08 selon_type).';

create trigger or_controle_qualite_touche_modifie_le
  before update on public.or_controle_qualite
  for each row execute function public.touche_modifie_le();

create index or_controle_qualite_or_idx on public.or_controle_qualite (tenant_id, ordre_reparation_id);

revoke all    on public.or_controle_qualite from dfa_app;
grant  select, insert, update on public.or_controle_qualite to dfa_app;
revoke delete on public.or_controle_qualite from dfa_app;

alter table public.or_controle_qualite enable row level security;
alter table public.or_controle_qualite force  row level security;

create policy or_controle_qualite_isolation_tenant on public.or_controle_qualite
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy or_controle_qualite_migrator on public.or_controle_qualite
  to dfa_migrator
  using (true) with check (true);


-- ---------------------------------------------------------------------------------------------
-- 8. FK différées (expand, §2.1 point 8) — cible désormais créée
-- ---------------------------------------------------------------------------------------------

alter table public.vehicule_kilometrage
  add constraint vehicule_kilometrage_fk_or foreign key (tenant_id, ordre_reparation_id)
  references public.ordre_reparation (tenant_id, id) on delete restrict;

alter table public.vehicule_campagne
  add constraint vehicule_campagne_fk_or foreign key (tenant_id, ordre_reparation_id)
  references public.ordre_reparation (tenant_id, id) on delete restrict;

alter table public.vehicule_travail_reporte
  add constraint vehicule_travail_reporte_fk_or_origine foreign key (tenant_id, ordre_reparation_origine_id)
  references public.ordre_reparation (tenant_id, id) on delete restrict;

alter table public.vehicule_travail_reporte
  add constraint vehicule_travail_reporte_fk_ligne_origine foreign key (tenant_id, ligne_or_origine_id)
  references public.ligne_or (tenant_id, id) on delete restrict;

alter table public.vehicule_travail_reporte
  add constraint vehicule_travail_reporte_fk_or_reprise foreign key (tenant_id, ordre_reparation_reprise_id)
  references public.ordre_reparation (tenant_id, id) on delete restrict;


-- ---------------------------------------------------------------------------------------------
-- 9. Assertions de fin de migration
-- ---------------------------------------------------------------------------------------------

do $$
declare
  fautives text;
begin
  select string_agg(t.tbl, ', ') into fautives
    from (values
      ('ordre_reparation'), ('ligne_or'), ('devis_complementaire'),
      ('devis_complementaire_ligne'), ('or_controle_qualite')
    ) as t(tbl)
   where has_table_privilege('dfa_app', format('public.%I', t.tbl), 'DELETE');

  if fautives is not null then
    raise exception 'DELETE encore accordé à dfa_app sur % (Δ6 / RM-110 violé).', fautives;
  end if;

  if has_table_privilege('dfa_app', 'public.ordre_reparation_demande', 'UPDATE') then
    raise exception 'ordre_reparation_demande : UPDATE ne devrait pas être accordé (verbatim append-only, RM-52).';
  end if;
end
$$;
