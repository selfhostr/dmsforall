-- =============================================================================================
-- 0071_financement_vente_organisme_nom_libre.down.sql — inverse de la montante.
--
-- Restaure `financement_vente_organisme_requis_chk` MOT POUR MOT à sa définition de 0032
-- (`type = 'comptant' or organisme_id is not null`, sans échappatoire nom libre), retire
-- `financement_vente_organisme_nom_non_vide_chk`, puis DROP la colonne `organisme_nom` —
-- même patron que 0047 (drop constraint / add constraint, même nom) pour la CHECK.
--
-- ⚠️ Redescendre RÉINTRODUIT le défaut corrigé par 0071 : un dossier `credit`/`leasing` dont
-- l'organisme n'est pas déjà une fiche client résolue redevient impossible à faire aboutir
-- (`D-42` inapplicable). Attendu et voulu d'un down. Perte de données également attendue : toute
-- valeur `organisme_nom` déjà saisie disparaît avec la colonne — aucun écrivain n'existe encore
-- pour ce champ à ce stade (voir l'en-tête de la montante), donc aucune perte réelle possible
-- avant qu'un tel écrivain ne soit livré.
-- =============================================================================================

alter table public.financement_vente
  drop constraint financement_vente_organisme_requis_chk;

alter table public.financement_vente
  add constraint financement_vente_organisme_requis_chk
  check (type = 'comptant' or organisme_id is not null);

alter table public.financement_vente
  drop constraint financement_vente_organisme_nom_non_vide_chk;

alter table public.financement_vente
  drop column organisme_nom;


-- ---------------------------------------------------------------------------------------------
-- Assertions de fin de down
-- ---------------------------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'financement_vente'
       and column_name = 'organisme_nom'
  ) then
    raise exception '0071 down : financement_vente.organisme_nom toujours présente après le down.';
  end if;

  if exists (
    select 1 from pg_catalog.pg_constraint
     where conname = 'financement_vente_organisme_requis_chk'
       and conrelid = 'public.financement_vente'::regclass
       and pg_get_constraintdef(oid) ilike '%organisme_nom%'
  ) then
    raise exception
      '0071 down : financement_vente_organisme_requis_chk référence encore organisme_nom après le down.';
  end if;
end
$$;
