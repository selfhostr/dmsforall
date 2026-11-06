-- =============================================================================================
-- 0076_ligne_or_realisee_sans_pointage.sql
--
-- CONSTAT : 0046 n'ouvre `validee -> realisee` qu'à sept types de ligne (piece, fourniture,
-- produit_atelier, taxe, remise, texte, sous_traitance). Une ligne de main-d'oeuvre
-- (main_oeuvre_bareme, main_oeuvre_temps_reel) ou de forfait doit passer par `en_cours`, que seul
-- le pointage produit : un garage qui ne pointe pas ne peut jamais réaliser ses heures, donc ne
-- peut jamais terminer ni facturer son OR.
--
-- DÉCISION : `validee -> realisee` devient valable pour TOUS les types de ligne, sans pointage.
-- `en_cours -> realisee` (0003) est inchangée, le pointage continue de faire passer `validee` à
-- `en_cours` quand il est utilisé.
--
-- MÉCANISME : 0046 a posé la colonne `type_ligne` sur `transition_autorisee` et le filtre dans
-- `verifier_transition()`. Cette migration ne touche NI la colonne, NI les fonctions, NI le
-- trigger d'audit : elle ajoute la ligne générique ('ligne_or','validee','realisee','*') et retire
-- les 7 lignes type-spécifiques de 0046, devenues redondantes (le sentinel '*' les couvre).
--
-- Réversible : down/0076_ligne_or_realisee_sans_pointage.down.sql restaure les 7 lignes de 0046.
-- =============================================================================================

insert into public.transition_autorisee (entite, statut_depuis, statut_vers, exige_motif, type_ligne)
values ('ligne_or', 'validee', 'realisee', false, '*');

delete from public.transition_autorisee
 where entite = 'ligne_or' and statut_depuis = 'validee' and statut_vers = 'realisee'
   and type_ligne <> '*';

do $$
begin
  if (
    select count(*) from public.transition_autorisee
     where entite = 'ligne_or' and statut_depuis = 'validee' and statut_vers = 'realisee'
  ) <> 1 then
    raise exception '0076 : validee -> realisee doit exister une seule fois pour ligne_or.';
  end if;

  if not exists (
    select 1 from public.transition_autorisee
     where entite = 'ligne_or' and statut_depuis = 'validee' and statut_vers = 'realisee'
       and type_ligne = '*' and exige_motif = false
  ) then
    raise exception '0076 : la transition générique validee -> realisee est absente.';
  end if;

  if not exists (
    select 1 from public.transition_autorisee
     where entite = 'ligne_or' and statut_depuis = 'en_cours' and statut_vers = 'realisee'
  ) then
    raise exception '0076 : en_cours -> realisee doit rester autorisée.';
  end if;
end
$$;
