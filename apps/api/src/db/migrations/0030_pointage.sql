-- =============================================================================================
-- 0030_pointage.sql — lot 2 : module Pointage. RM-87 → RM-99, RM-113 → RM-123
-- (`docs/specification-pointage.md`). Contrats : `packages/shared/src/contrats/pointage/`.
--
-- Deux tables :
--   1. `pointage` — l'événement lui-même (démarrage/arrêt/correction/validation/verrouillage).
--   2. `pointage_verrouillage_site` — l'état de verrouillage de période PAR SITE (RM-95).
--
-- ENUMS DÉJÀ EXISTANTS, réutilisés SANS RECRÉATION (0005_parametrage.sql, « déclaré au lot 1,
-- servi au lot 2 ») : `statut_pointage`, `source_pointage`, `nature_activite_pointage`,
-- `statut_periode_pointage` (ce dernier reste NON CONSOMMÉ par cette migration — voir
-- schema/pointage/verrouillage-site.ts en-tête pour la décision de modèle).
--
-- DEUX ENUMS NOUVEAUX (§1) : `activite_indirecte_pointage`, `motif_anomalie_pointage`.
--
-- UNE VALEUR AJOUTÉE À `entite_auditee` (§2) : `periode_pointage` — PAS `pointage`, déjà présent
-- depuis 0003. Ajoutée et consommée dans LA MÊME migration (contrairement à
-- 0023_pieces_entite_auditee_commande_fournisseur.sql, qui a dû être séparée) : ici la valeur
-- n'est utilisée QUE comme argument texte de `auditer_atelier('periode_pointage')`, casté à
-- l'exécution future du trigger (une transaction ultérieure) — jamais comparée/insérée dans
-- `transition_autorisee` au sein de cette même transaction, donc aucun conflit « unsafe use of
-- new value ». `pointage_verrouillage_site` n'a pas de machine à états (§4), donc rien à insérer
-- dans `transition_autorisee` pour cette entité.
--
-- MACHINE À ÉTATS DE `pointage` (§3-4) : GELÉE (`STATUTS_POINTAGE`, `contrats/atelier/enums.ts`).
-- Cinq transitions déclarées dans `transition_autorisee` sous l'entité `pointage` — PAS sous
-- `ligne_or` : la transition `('ligne_or', 'validee', 'en_cours', false)` déjà posée en 0003
-- (ainsi que `en_cours → realisee` et `en_cours → annulee`) reste la machine de LA LIGNE D'OR
-- elle-même (empruntée par le SERVICE quand un pointage démarre/s'arrête sur une ligne précise),
-- distincte de la machine du POINTAGE posée ici.
--
-- RÉVERSIBILITÉ PARTIELLE — même famille que 0010/0016/0022/0023 : `alter type ... add value` ne
-- se défait pas. Voir migrations/down/0030_pointage.down.sql et
-- scripts/verifier-reversibilite-migrations.sh (EXCEPTIONS_DOWN_PARTIEL).
--
-- Réversible (schéma) : migrations/down/0030_pointage.down.sql.
-- =============================================================================================


-- ---------------------------------------------------------------------------------------------
-- 1. Nouveaux enums propres au pointage
-- ---------------------------------------------------------------------------------------------

create type public.activite_indirecte_pointage as enum (
  'nettoyage',
  'attente_pieces',
  'attente_accord',
  'magasin',
  'formation',
  'pause',
  'absence'
);

create type public.motif_anomalie_pointage as enum (
  'duree_trop',
  'nuit',
  'chevauchement',
  'periode_verrouillee',
  'or_facture',
  'ligne_non_pointable',
  'derive_horloge'
);


-- ---------------------------------------------------------------------------------------------
-- 2. `entite_auditee` — ajout de `periode_pointage` (voir en-tête)
-- ---------------------------------------------------------------------------------------------

alter type public.entite_auditee add value if not exists 'periode_pointage';


-- ---------------------------------------------------------------------------------------------
-- 3. `pointage`
--
-- `id` NON généré par défaut (pas de `default gen_random_uuid()`) : fourni PAR LE CLIENT
-- (uuid v4), c'est la clé qui garantit qu'un pointage rejoué depuis une tablette déconnectée ne
-- se dédouble jamais — un second INSERT portant le même `id` échoue avec une violation de
-- contrainte (23505). Voir schema/pointage/pointage.ts en-tête pour le raisonnement complet.
--
-- RM-87 (trois cibles) : `pointage_cible_coherente_chk` garantit qu'exactement le couple attendu
-- par `nature` est renseigné. Question du multi-technicien sur une même ligne/OR : NON TRANCHÉE,
-- volontairement — aucune contrainte ne l'interdit ici (voir schema/pointage/pointage.ts).
--
-- RM-89 (chevauchement, PORTÉE DIFFÉRENTE de RM-87) : un MÊME TECHNICIEN ne peut jamais avoir deux
-- pointages `en_cours` simultanés — `pointage_technicien_un_seul_en_cours_uk` (§3.3).
-- ---------------------------------------------------------------------------------------------

create table public.pointage (
  id             uuid not null,
  tenant_id      uuid not null references public.tenant (id) on delete restrict,
  site_id        uuid not null,
  technicien_id  uuid not null,

  statut public.statut_pointage         not null default 'en_cours',
  nature public.nature_activite_pointage not null,

  -- Les trois cibles de RM-87.
  ordre_reparation_id uuid null,
  ligne_or_id          uuid null,
  activite_indirecte   public.activite_indirecte_pointage null,

  source      public.source_pointage not null default 'ecran_atelier',
  appareil_id text null,

  debut_le timestamptz not null,
  fin_le   timestamptz null,

  -- RM-97 : brut conservé à la seconde, jamais recalculé après coup. GENERATED : voir §3.1.
  duree_brute_secondes integer generated always as (
    extract(epoch from (fin_le - debut_le))::integer
  ) stored,
  -- Arrondi selon P-19 (parametre_atelier.arrondi_pointage) — écrit UNE FOIS par le service,
  -- jamais dérivable de la seule ligne (le paramètre est extérieur à la table).
  duree_arrondie_centiemes integer null,

  decalage_horloge_ms_debut integer null,
  decalage_horloge_ms_fin   integer null,

  cloture_automatique boolean not null default false,

  -- Anomalie (RM-91, RM-96, RM-123).
  anomalie_motif       public.motif_anomalie_pointage null,
  anomalie_detectee_le timestamptz null,
  anomalie_traitee_le  timestamptz null,

  -- Dernière correction connue (RM-94) — l'historique complet vit dans audit_atelier.
  derniere_correction_motif                 text        null,
  derniere_correction_par_utilisateur_id    uuid        null,
  derniere_correction_le                    timestamptz null,
  debut_le_origine                          timestamptz null,
  fin_le_origine                            timestamptz null,

  cree_le    timestamptz not null default now(),
  modifie_le timestamptz not null default now(),

  constraint pointage_pk primary key (id),

  constraint pointage_fk_site foreign key (tenant_id, site_id)
    references public.site (tenant_id, id) on delete restrict,
  constraint pointage_fk_technicien foreign key (tenant_id, technicien_id)
    references public.utilisateur (tenant_id, id) on delete restrict,
  constraint pointage_fk_ordre_reparation foreign key (tenant_id, ordre_reparation_id)
    references public.ordre_reparation (tenant_id, id) on delete restrict,
  constraint pointage_fk_ligne_or foreign key (tenant_id, ligne_or_id)
    references public.ligne_or (tenant_id, id) on delete restrict,
  constraint pointage_fk_derniere_correction_par foreign key (tenant_id, derniere_correction_par_utilisateur_id)
    references public.utilisateur (tenant_id, id) on delete restrict,

  constraint pointage_cible_coherente_chk check (
    (nature = 'productif_ligne' and ordre_reparation_id is not null and ligne_or_id is not null and activite_indirecte is null)
    or (nature = 'productif_or' and ordre_reparation_id is not null and ligne_or_id is null and activite_indirecte is null)
    or (nature = 'indirect' and ordre_reparation_id is null and ligne_or_id is null and activite_indirecte is not null)
  ),
  constraint pointage_fin_coherente_chk check ((statut = 'en_cours') = (fin_le is null)),
  constraint pointage_periode_coherente_chk check (fin_le is null or fin_le >= debut_le),
  constraint pointage_appareil_id_non_vide_chk
    check (appareil_id is null or length(btrim(appareil_id)) between 1 and 100),
  constraint pointage_anomalie_coherente_chk check ((anomalie_motif is null) = (anomalie_detectee_le is null)),
  constraint pointage_anomalie_traitee_chk check (anomalie_traitee_le is null or anomalie_motif is not null),
  constraint pointage_derniere_correction_coherente_chk check (
    (derniere_correction_motif is null) = (derniere_correction_le is null)
    and (derniere_correction_le is null) = (derniere_correction_par_utilisateur_id is null)
    and (derniere_correction_par_utilisateur_id is null) = (debut_le_origine is null)
  )
);

comment on table public.pointage is
  'Événement de pointage (RM-87 → RM-99, RM-113 → RM-123). id fourni PAR LE CLIENT (idempotence '
  'hors ligne — un rejeu du même id échoue en 23505). pointage_cible_coherente_chk garantit '
  'RM-87 (exactement une cible). Aucune contrainte n''empêche plusieurs techniciens sur la même '
  'ligne/OR (question ouverte, remontée à @laupernoe) ; pointage_technicien_un_seul_en_cours_uk (index '
  'ci-dessous) empêche en revanche un MÊME technicien d''avoir deux pointages en_cours (RM-89).';

create trigger pointage_touche_modifie_le
  before update on public.pointage
  for each row execute function public.touche_modifie_le();

create trigger pointage_verifier_transition
  before update on public.pointage
  for each row execute function public.verifier_transition('pointage');

create trigger pointage_audit
  after insert or update or delete on public.pointage
  for each row execute function public.auditer_atelier('pointage');

-- Donnée sensible (temps de travail, droit du travail suisse) : aucun DELETE, une ligne se
-- corrige via POST /pointages/{id}/corriger (RM-94), jamais en la faisant disparaître.
create function public.pointage_interdire_suppression() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $fn$
begin
  raise exception using
    errcode = 'ZDFA2',
    message = 'pointage ne se supprime jamais : il se corrige (POST /pointages/{id}/corriger, RM-94).',
    detail  = format('entite=pointage;entite_id=%s', old.id);
  return old;
end
$fn$;

revoke all on function public.pointage_interdire_suppression() from public;

create trigger pointage_interdire_suppression
  before delete on public.pointage
  for each row execute function public.pointage_interdire_suppression();

-- --- 3.1 Index -----------------------------------------------------------------------------

-- RM-89 : un même technicien n'a jamais deux pointages en_cours simultanément — la clôture
-- automatique (RM-89) doit donc arrêter l'ancien AVANT que le service insère le nouveau, dans la
-- même transaction, sous peine de violer cet index. Index unique PARTIEL : non modélisable via
-- `unique()` de pg-core (pas de clause WHERE), posé ici en SQL brut — même limite documentée sur
-- `article_reference_remplacement_idx` (schema/pieces/article.ts).
create unique index pointage_technicien_un_seul_en_cours_uk
  on public.pointage (tenant_id, technicien_id)
  where statut = 'en_cours';

create index pointage_or_idx on public.pointage (tenant_id, ordre_reparation_id)
  where ordre_reparation_id is not null;
create index pointage_ligne_or_idx on public.pointage (tenant_id, ligne_or_id)
  where ligne_or_id is not null;
create index pointage_site_statut_idx on public.pointage (tenant_id, site_id, statut);
create index pointage_technicien_idx on public.pointage (tenant_id, technicien_id, debut_le desc);
-- GET /pointages, tri debutLe:asc|desc (TRIS_POINTAGES, contrats/pointage/pointage.ts).
create index pointage_pagination_idx on public.pointage (tenant_id, debut_le desc, id desc);
-- Corbeille d'anomalies non traitées (RM-96, ?anomalie=true).
create index pointage_anomalie_ouverte_idx on public.pointage (tenant_id, site_id)
  where anomalie_motif is not null and anomalie_traitee_le is null;

-- --- 3.2 Privilèges et RLS -------------------------------------------------------------------

revoke all    on public.pointage from dfa_app;
grant  select, insert, update on public.pointage to dfa_app;
revoke delete on public.pointage from dfa_app;

alter table public.pointage enable row level security;
alter table public.pointage force  row level security;

create policy pointage_isolation_tenant on public.pointage
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy pointage_migrator on public.pointage
  to dfa_migrator
  using (true) with check (true);

-- --- 3.3 Référentiel des transitions -----------------------------------------------------------
--
-- Cinq transitions légales de la machine `pointage` (STATUTS_POINTAGE — GELÉ) :
--   en_cours  → termine   (POST /pointages/{id}/arreter)
--   termine   → valide    (POST /pointages/{id}/valider ou /pointages/valider, en lot)
--   termine   → verrouille (POST /pointages/verrouiller-periode, en lot)
--   valide    → verrouille (idem)
--   verrouille→ valide    (POST /pointages/deverrouiller-periode, contre-passation, motif requis)
--
-- Interdits par absence : `en_cours → verrouille` (un pointage ouvert bloque le verrouillage,
-- 409 CONFLIT, jamais fermé de force — periode.ts) ; toute sortie de `en_cours` autre que
-- `termine` ; toute entrée dans `en_cours` (c'est l'état initial d'une création, pas une
-- transition).

insert into public.transition_autorisee (entite, statut_depuis, statut_vers, exige_motif) values
  ('pointage', 'en_cours',   'termine',    false),
  ('pointage', 'termine',    'valide',     false),
  ('pointage', 'termine',    'verrouille', false),
  ('pointage', 'valide',     'verrouille', false),
  -- Contre-passation (RM-95) : motif obligatoire — rouvrir une période verrouillée est un geste
  -- rare et sensible (pointages potentiellement déjà exportés vers une fiduciaire).
  ('pointage', 'verrouille', 'valide',     true);


-- ---------------------------------------------------------------------------------------------
-- 4. `pointage_verrouillage_site` — RM-95, état de verrouillage PAR SITE
--
-- Un seuil mutable, pas une collection de périodes — voir schema/pointage/verrouillage-site.ts
-- en-tête pour le raisonnement complet. Pas de machine à états (pas de colonne statut, donc rien
-- à déclarer dans transition_autorisee pour cette entité) : verrouiller/déverrouiller ne fait
-- qu'avancer/reculer verrouille_jusquau_le, sous la responsabilité du service (qui doit d'abord
-- vérifier qu'aucun pointage du site n'est en_cours dans la plage avant de verrouiller —
-- periode.ts, 409 CONFLIT sinon).
-- ---------------------------------------------------------------------------------------------

create table public.pointage_verrouillage_site (
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  site_id   uuid not null,

  -- null = aucun verrouillage n'a jamais eu lieu sur ce site. Borne INCLUSE (RM-95).
  verrouille_jusquau_le date null,

  dernier_motif           text        null,
  derniere_action_le      timestamptz null,
  dernier_utilisateur_id  uuid        null,

  cree_le    timestamptz not null default now(),
  modifie_le timestamptz not null default now(),

  constraint pointage_verrouillage_site_pk primary key (tenant_id, site_id),
  constraint pointage_verrouillage_site_fk_site foreign key (tenant_id, site_id)
    references public.site (tenant_id, id) on delete restrict,
  constraint pointage_verrouillage_site_fk_utilisateur foreign key (tenant_id, dernier_utilisateur_id)
    references public.utilisateur (tenant_id, id) on delete restrict,
  constraint pointage_verrouillage_site_derniere_action_coherente_chk
    check ((derniere_action_le is null) = (dernier_utilisateur_id is null))
);

comment on table public.pointage_verrouillage_site is
  'RM-95 : seuil de verrouillage du pointage, un par site. verrouille_jusquau_le null = jamais '
  'verrouillé. Motif optionnel au verrouillage, obligatoire à la contre-passation (porté par le '
  'service, pas par une contrainte NOT NULL ici — la même colonne sert les deux actions). Audité '
  'sous l''entité periode_pointage (distincte de pointage), voir auditer_atelier ci-dessous.';

create trigger pointage_verrouillage_site_touche_modifie_le
  before update on public.pointage_verrouillage_site
  for each row execute function public.touche_modifie_le();

create trigger pointage_verrouillage_site_audit
  after insert or update or delete on public.pointage_verrouillage_site
  for each row execute function public.auditer_atelier('periode_pointage');

revoke all    on public.pointage_verrouillage_site from dfa_app;
grant  select, insert, update on public.pointage_verrouillage_site to dfa_app;
revoke delete on public.pointage_verrouillage_site from dfa_app;

alter table public.pointage_verrouillage_site enable row level security;
alter table public.pointage_verrouillage_site force  row level security;

create policy pointage_verrouillage_site_isolation_tenant on public.pointage_verrouillage_site
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy pointage_verrouillage_site_migrator on public.pointage_verrouillage_site
  to dfa_migrator
  using (true) with check (true);
