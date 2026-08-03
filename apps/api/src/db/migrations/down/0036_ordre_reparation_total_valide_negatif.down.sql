-- =============================================================================================
-- 0036_ordre_reparation_total_valide_negatif.down.sql — inverse EXACT de la montante : ré-ajoute
-- `ordre_reparation_total_valide_chk` telle qu'elle existait en 0008, et restaure le commentaire
-- de colonne d'origine (0008 n'en posait aucun via `comment on column` — seul le commentaire de
-- TABLE existait ; ce down retire donc le commentaire de colonne posé par la montante plutôt que
-- de le remplacer par un texte inventé).
--
-- RÉ-APPLICATION DE LA CHECK : redonnerait EXACTEMENT le défaut d'origine (500 sur une ligne
-- `remise` seule) si des lignes négatives ont été insérées entre-temps sous la montante — c'est
-- attendu et voulu d'un down : il annule le correctif, pas seulement son symptôme. Si des données
-- réelles violent la contrainte au moment du down (OR déjà validé négatif), l'`ALTER TABLE ...
-- ADD CONSTRAINT` échouera bruyamment plutôt que de corrompre silencieusement l'état — comportement
-- Postgres standard, non contourné ici.
-- =============================================================================================

comment on column public.ordre_reparation.total_valide_centimes is null;

alter table public.ordre_reparation
  add constraint ordre_reparation_total_valide_chk check (total_valide_centimes >= 0);
