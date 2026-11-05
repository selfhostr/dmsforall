-- =============================================================================================
-- 0072_relance_planifiee_marqueur_reprise_sans_palier.down.sql — inverse de la montante.
--
-- Retire les deux CHECK ajoutées par 0072, restaure `relance_planifiee_annulee_raison_chk` et
-- `relance_planifiee_palier_positif_chk` MOT POUR MOT à leur définition de 0045, puis restaure
-- `palier not null` — même patron que 0047 (drop constraint / add constraint, même nom).
--
-- ⚠️ Redescendre RÉINTRODUIT la collision corrigée par 0072 : un marqueur de reprise
-- (`palier = null`) redevient impossible à représenter sans collision avec
-- `relance_planifiee_tenant_type_objet_palier_uk` ni avec le vrai palier 1. Attendu et voulu d'un
-- down. `set not null` échoue fort (message Postgres explicite) si un marqueur (`palier is null`)
-- a déjà été inséré entre-temps — aucun écrivain n'existe encore à ce stade (voir l'en-tête de la
-- montante), donc aucune perte de données silencieuse possible avant qu'un tel écrivain ne soit
-- livré.
-- =============================================================================================

alter table public.relance_planifiee
  drop constraint relance_planifiee_note_reprise_marqueur_chk;

alter table public.relance_planifiee
  drop constraint relance_planifiee_palier_requis_actif_chk;

alter table public.relance_planifiee
  drop constraint relance_planifiee_annulee_raison_chk;

alter table public.relance_planifiee
  add constraint relance_planifiee_annulee_raison_chk
  check ((statut = 'annulee') = (annule_raison is not null));

alter table public.relance_planifiee
  drop constraint relance_planifiee_palier_positif_chk;

alter table public.relance_planifiee
  add constraint relance_planifiee_palier_positif_chk
  check (palier > 0);

alter table public.relance_planifiee
  alter column palier set not null;

-- `palier` n'avait AUCUN commentaire avant 0072 (0045 n'en pose pas) : on le retire pour que le
-- schéma redescendu soit identique octet pour octet.
comment on column public.relance_planifiee.palier is null;

comment on column public.relance_planifiee.note_reprise is
  'D-45 (docs/reprise/decisions.md) : signalement « déjà relancée N fois côté ancien système, à '
  'vérifier avant tout nouvel envoi » — texte libre, jamais structuré (aucune garantie qu''un '
  'compte fiable existe côté source). N''est PAS peuplée par cette migration : aucun écrivain '
  'd''import n''existe encore pour le domaine relances (extension seam, voir '
  '@dfa/shared::DOMAINES_REPRISE). Ne doit JAMAIS accompagner un statut actif '
  '(a_planifier/prete/en_cours_envoi/envoyee) — voir avertissement de conception en en-tête de '
  'fichier avant d''implémenter l''écrivain qui la peuplera.';


-- ---------------------------------------------------------------------------------------------
-- Assertions de fin de down
-- ---------------------------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'relance_planifiee'
       and column_name = 'palier' and is_nullable = 'YES'
  ) then
    raise exception '0072 down : relance_planifiee.palier encore nullable après le down.';
  end if;

  if exists (
    select 1 from pg_catalog.pg_constraint
     where conname in (
       'relance_planifiee_palier_requis_actif_chk',
       'relance_planifiee_note_reprise_marqueur_chk'
     )
       and conrelid = 'public.relance_planifiee'::regclass
  ) then
    raise exception '0072 down : au moins une CHECK ajoutée par 0072 subsiste après le down.';
  end if;
end
$$;
