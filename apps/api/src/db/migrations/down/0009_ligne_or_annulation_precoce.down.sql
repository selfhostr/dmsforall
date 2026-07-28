-- =============================================================================================
-- 0009_ligne_or_annulation_precoce.down.sql — annulation de 0009_ligne_or_annulation_precoce.sql
--
-- Migration de DONNÉES pure (aucun objet de schéma créé par 0009) : le down se limite à retirer
-- les deux lignes insérées, identifiées par leur clé primaire exacte (entite, statut_depuis,
-- statut_vers) — jamais un DELETE large qui risquerait d'emporter une ligne ajoutée entre-temps
-- par une migration ultérieure.
--
-- Remet `transition_autorisee` dans l'état exact où 0003 l'a laissé pour `ligne_or` (11 lignes,
-- aucune sortie depuis `proposee`/`a_valider` vers `annulee`) — la lacune redevient réelle, ce
-- qui est le but d'un « down » : défaire, pas défaire à moitié.
-- =============================================================================================

delete from public.transition_autorisee
 where entite = 'ligne_or' and statut_depuis = 'proposee'  and statut_vers = 'annulee';

delete from public.transition_autorisee
 where entite = 'ligne_or' and statut_depuis = 'a_valider' and statut_vers = 'annulee';
