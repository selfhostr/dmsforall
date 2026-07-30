-- =============================================================================================
-- 0029_ligne_or_article_fk.down.sql — inverse de 0029_ligne_or_article_fk.sql.
-- Entièrement réversible : ni colonne ni donnée touchée, seulement une contrainte, un index, et
-- le commentaire de table restauré au texte exact de 0017.
-- =============================================================================================

drop index public.ligne_or_article_idx;
alter table public.ligne_or drop constraint ligne_or_fk_article;

comment on table public.ligne_or is
  'Ligne d''un ordre de réparation. taux_horaire_centimes/prix_unitaire_centimes FIGÉS à la '
  'création (RM-65). Aucun DELETE (RM-71) : une ligne se corrige par annulation motivée. '
  '`payeur_client_id` (0017, AC-08) désigne le tiers payeur (constructeur/assurance/tiers) quand '
  '`payeur` n''est pas `client`/`garage` — voir ligne_or_payeur_client_coherent_chk et MD-62 '
  '(regroupement des documents par (payeur, payeur_client_id)).';
