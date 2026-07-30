-- =============================================================================================
-- 0017_ligne_or_payeur_client_id.down.sql — annulation de 0017_ligne_or_payeur_client_id.sql
--
-- Ordre inverse de la migration up : commentaire de table restauré au texte de 0008 (mot pour
-- mot — down annule la CORRECTION de 0017, pas 0008 elle-même, déjà appliquée et immuable, même
-- logique que 0016.down), puis index, puis CHECK, puis FK, puis colonne. Migration de DONNÉES :
-- aucune — `payeur_client_id` n'a jamais porté que des NULL sur une base non-démo à ce stade
-- (étape 1, aucun tenant de production).
-- =============================================================================================


-- ---------------------------------------------------------------------------------------------
-- 1. Commentaire de table restauré au texte exact de 0008 (avant l'ajout de la phrase AC-08).
-- ---------------------------------------------------------------------------------------------

comment on table public.ligne_or is
  'Ligne d''un ordre de réparation. taux_horaire_centimes/prix_unitaire_centimes FIGÉS à la '
  'création (RM-65). Aucun DELETE (RM-71) : une ligne se corrige par annulation motivée.';


-- ---------------------------------------------------------------------------------------------
-- 2. Index partiel retiré.
-- ---------------------------------------------------------------------------------------------

drop index if exists public.ligne_or_payeur_client_idx;


-- ---------------------------------------------------------------------------------------------
-- 3. CHECK retiré.
-- ---------------------------------------------------------------------------------------------

alter table public.ligne_or
  drop constraint if exists ligne_or_payeur_client_coherent_chk;


-- ---------------------------------------------------------------------------------------------
-- 4. FK composite retirée.
-- ---------------------------------------------------------------------------------------------

alter table public.ligne_or
  drop constraint if exists ligne_or_fk_payeur_client;


-- ---------------------------------------------------------------------------------------------
-- 5. Colonne retirée — dernière étape, symétrique de la première étape du up.
-- ---------------------------------------------------------------------------------------------

alter table public.ligne_or
  drop column if exists payeur_client_id;
