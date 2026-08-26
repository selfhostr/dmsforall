-- =============================================================================================
-- 0072_relance_planifiee_marqueur_reprise_sans_palier.sql — tranche la collision de conception
-- signalée SANS être corrigée par 0070 (§ « ÉCART AU PATRON 0066 — relance_planifiee.note_reprise »,
-- en-tête de 0070_ancrages_origine_reprise_pneus_ventes_relances.sql, non modifiée ici — migration
-- déjà écrite, pas rouverte).
--
-- LE PROBLÈME, MESURÉ (CodeGraph + lecture directe, pas supposé) :
--   - `relance_planifiee_tenant_type_objet_palier_uk` (0045) : `unique (tenant_id, type_relance,
--     objet_id, palier)` — LA garantie d'idempotence de la planification (RA-05, §6.1). Le
--     service de planification s'appuie EXCLUSIVEMENT dessus via
--     `ON CONFLICT (tenant_id, type_relance, objet_id, palier) DO NOTHING`.
--   - `palier smallint not null check (palier > 0)` (0045) : jamais 0, jamais NULL.
--   - D-45 (`docs/reprise/decisions.md`) : une créance reprise « déjà relancée N fois côté ancien
--     système » se signale via `relance_planifiee.note_reprise` (0070) SANS jamais réactiver de
--     relance — AUCUNE ligne active (`a_planifier`/`prete`/`en_cours_envoi`/`envoyee`) n'est
--     importée.
--   - Piste envisagée par 0070, explicitement NON tranchée : matérialiser ce signalement comme
--     une ligne `relance_planifiee` ordinaire, `statut = 'annulee'`, au palier 1. CASSE DEUX
--     CHOSES À LA FOIS : (a) si le job de planification tente plus tard le VRAI palier 1 pour ce
--     même `(tenant_id, type_relance, objet_id)`, son `ON CONFLICT ... DO NOTHING` le voit comme
--     déjà planifié et NE PLANIFIE JAMAIS la vraie relance — la créance reprise ne serait plus
--     jamais relancée, l'inverse de l'intention de D-45 ; (b) `relance_planifiee_annulee_raison_chk`
--     exigerait un `annule_raison` (0045 : `objet_traite`/`consentement_revoque`/`contact_absent`/
--     `client_ne_plus_contacter`/`vehicule_cede`) — aucune de ces cinq valeurs ne décrit
--     honnêtement « ligne de signalement d'un import, jamais une vraie relance annulée »,
--     fausserait tout futur rapport « raisons d'annulation ».
--
-- CORRECTIF — PURE PROPRIÉTÉ POSTGRESQL, PAS DE VALEUR SENTINELLE : une contrainte UNIQUE ne
-- considère JAMAIS deux NULL comme égaux (contrairement à `=`) — un `palier` NULL ne participe
-- donc structurellement PAS à `relance_planifiee_tenant_type_objet_palier_uk`, quel que soit le
-- nombre de lignes NULL pour le même `(tenant_id, type_relance, objet_id)`. Rendre `palier`
-- NULLABLE et réserver NULL au marqueur de reprise supprime la collision (a) SANS toucher à
-- `relance_planifiee_tenant_type_objet_palier_uk` ni à l'idempotence des VRAIS paliers
-- (`palier > 0`, inchangés, toujours couverts par la contrainte) — pas de convention numérique
-- (palier 0, etc.) à inventer ni à faire connaître au job de planification.
--
-- Pour (b) : `relance_planifiee_annulee_raison_chk` ne s'applique plus qu'aux VRAIES lignes
-- (`palier is not null`) — un marqueur de reprise (`palier is null`) n'a pas à produire une
-- fausse raison d'annulation. Une nouvelle CHECK, `relance_planifiee_palier_requis_actif_chk`,
-- rend IMPOSSIBLE en base ce que le commentaire de 0070 promettait sans l'imposer : « note_reprise
-- ne doit JAMAIS accompagner un statut actif » — en l'exprimant plus fort et plus général,
-- directement sur `palier` (`palier is not null or statut = 'annulee'`), qui couvre aussi bien un
-- marqueur SANS note qu'un marqueur avec. `relance_planifiee_note_reprise_marqueur_chk` referme la
-- boucle dans l'autre sens (`note_reprise` renseignée ⇒ `palier` NULL) : `note_reprise` ne peut
-- s'attacher qu'à un marqueur, jamais à une vraie ligne d'escalade — même esprit que
-- `financement_vente_comptant_sans_detail_chk` (0042), une CHECK qui verrouille deux colonnes
-- l'une par rapport à l'autre plutôt que de faire confiance au seul appelant.
--
-- CE QUI RESTE HORS DE CETTE MIGRATION, VOLONTAIREMENT : aucun écrivain d'import pour le domaine
-- `relances` n'existe encore (0070 le signale déjà) — cette migration pose seulement la place que
-- ce futur écrivain devra utiliser (`palier = null`, `statut = 'annulee'`, `note_reprise`
-- renseignée), pas l'écrivain lui-même.
--
-- EXPAND SEUL : `palier` devient nullable (relâchement pur, aucune ligne existante — toutes ont
-- `palier > 0` — n'est affectée) ; les deux CHECK modifiées/ajoutées sont plus permissives que
-- l'existant pour toute ligne `palier is not null` (le cas de TOUTES les lignes actuelles), donc
-- aucune ligne réelle ne peut les violer.
--
-- Réversible : migrations/down/0072_relance_planifiee_marqueur_reprise_sans_palier.down.sql —
-- up → down → up rejoué par la CI (vérification de réversibilité). Le down réimpose `palier not
-- null` : sûr tant qu'aucun marqueur (palier null) n'a encore été inséré — aucun écrivain
-- n'existe encore, voir ci-dessus — gardé par une assertion dure en cas contraire.
-- =============================================================================================

alter table public.relance_planifiee
  alter column palier drop not null;

alter table public.relance_planifiee
  drop constraint relance_planifiee_palier_positif_chk;

alter table public.relance_planifiee
  add constraint relance_planifiee_palier_positif_chk
  check (palier is null or palier > 0);

alter table public.relance_planifiee
  drop constraint relance_planifiee_annulee_raison_chk;

alter table public.relance_planifiee
  add constraint relance_planifiee_annulee_raison_chk
  check (palier is null or (statut = 'annulee') = (annule_raison is not null));

alter table public.relance_planifiee
  add constraint relance_planifiee_palier_requis_actif_chk
  check (palier is not null or statut = 'annulee');

alter table public.relance_planifiee
  add constraint relance_planifiee_note_reprise_marqueur_chk
  check (note_reprise is null or palier is null);

comment on column public.relance_planifiee.palier is
  'Palier 1, 2, 3… au sens de regle_relance.delaisJours pour une VRAIE ligne d''escalade (RA-05). '
  'NULL réservé au marqueur de reprise (0072, D-45) : porte note_reprise SANS jamais occuper de '
  'palier réel — une contrainte UNIQUE ne traite jamais deux NULL comme égaux, donc un marqueur '
  'n''entre jamais en collision avec relance_planifiee_tenant_type_objet_palier_uk ni avec la '
  'VRAIE relance palier 1 que le job de planification créera plus tard pour le même objet. '
  'palier is null implique statut = ''annulee'' (relance_planifiee_palier_requis_actif_chk) : un '
  'marqueur est TOUJOURS inerte, jamais un statut actif.';

comment on column public.relance_planifiee.note_reprise is
  'D-45 (docs/reprise/decisions.md) : signalement « déjà relancée N fois côté ancien système, à '
  'vérifier avant tout nouvel envoi » — texte libre, jamais structuré. Posée par 0070 ; depuis '
  '0072, réservée EN BASE (pas seulement documentée) au marqueur de reprise : renseignée '
  'seulement quand palier is null (relance_planifiee_note_reprise_marqueur_chk), donc jamais sur '
  'une vraie ligne d''escalade active ou passée. N''est PAS peuplée par cette migration : aucun '
  'écrivain d''import n''existe encore pour le domaine relances (voir @dfa/shared::'
  'DOMAINES_REPRISE).';


-- ---------------------------------------------------------------------------------------------
-- Assertions de fin — patron 0066/0070/0071.
-- ---------------------------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'relance_planifiee'
       and column_name = 'palier' and is_nullable = 'NO'
  ) then
    raise exception '0072 : relance_planifiee.palier encore NOT NULL après migration.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conname = 'relance_planifiee_palier_requis_actif_chk'
       and conrelid = 'public.relance_planifiee'::regclass
  ) then
    raise exception '0072 : relance_planifiee_palier_requis_actif_chk absente après migration.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conname = 'relance_planifiee_note_reprise_marqueur_chk'
       and conrelid = 'public.relance_planifiee'::regclass
  ) then
    raise exception '0072 : relance_planifiee_note_reprise_marqueur_chk absente après migration.';
  end if;

  -- Aucune ligne réelle ne doit être affectée : toute ligne aujourd'hui en base a palier > 0.
  if exists (select 1 from public.relance_planifiee where palier is null) then
    raise exception
      '0072 : au moins une ligne relance_planifiee.palier est NULL avant même qu''un écrivain '
      'n''existe — inattendu, à investiguer avant de continuer.';
  end if;
end
$$;
