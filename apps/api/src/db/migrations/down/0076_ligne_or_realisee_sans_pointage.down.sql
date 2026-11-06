-- =============================================================================================
-- 0076_ligne_or_realisee_sans_pointage.down.sql
-- Inverse de 0076 : retire la transition générique validee -> realisee et restaure les 7 lignes
-- type-spécifiques posées par 0046 (piece, fourniture, produit_atelier, taxe, remise, texte,
-- sous_traitance). Les lignes main-d'oeuvre/forfait retrouvent l'obligation de passer par
-- `en_cours` (pointage). Aucune donnée de ligne d'OR n'est modifiée.
-- =============================================================================================

delete from public.transition_autorisee
 where entite = 'ligne_or' and statut_depuis = 'validee' and statut_vers = 'realisee'
   and type_ligne = '*';

insert into public.transition_autorisee (entite, statut_depuis, statut_vers, exige_motif, type_ligne) values
  ('ligne_or', 'validee', 'realisee', false, 'piece'),
  ('ligne_or', 'validee', 'realisee', false, 'fourniture'),
  ('ligne_or', 'validee', 'realisee', false, 'produit_atelier'),
  ('ligne_or', 'validee', 'realisee', false, 'taxe'),
  ('ligne_or', 'validee', 'realisee', false, 'remise'),
  ('ligne_or', 'validee', 'realisee', false, 'texte'),
  ('ligne_or', 'validee', 'realisee', false, 'sous_traitance');
