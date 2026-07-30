-- =============================================================================================
-- 0018_plafond_avoir_receptionnaire.down.sql — annulation de
-- 0018_plafond_avoir_receptionnaire.sql
--
-- Ordre inverse de la migration up : commentaire de table restauré au texte exact de 0005 (down
-- annule la CORRECTION de 0018, pas 0005 elle-même, déjà appliquée et immuable — même logique
-- que 0016.down/0017.down), puis CHECK, puis colonne. Migration de DONNÉES : aucune — la colonne
-- n'a jamais porté que des NULL (voir assertion §3 du up), donc aucune perte d'information
-- possible à ce DROP COLUMN, contrairement à un DROP qui suivrait un paramétrage réel en
-- production.
-- =============================================================================================


-- ---------------------------------------------------------------------------------------------
-- 1. Commentaire de table restauré au texte exact de 0005 (avant l'ajout de la phrase RF-117).
-- ---------------------------------------------------------------------------------------------

comment on table public.parametre_atelier is
  'Paramètres structurants du tenant (P-xx de la spécification). Une ligne par tenant, id = '
  'tenant_id. controle_qualite restreint à jamais|toujours au lot 1 (Δ3 du plan d''exécution) ; '
  'fonctionnalites n''est PAS une colonne, calculé côté service.';


-- ---------------------------------------------------------------------------------------------
-- 2. CHECK retirée.
-- ---------------------------------------------------------------------------------------------

alter table public.parametre_atelier
  drop constraint if exists parametre_atelier_plafond_avoir_receptionnaire_chk;


-- ---------------------------------------------------------------------------------------------
-- 3. Colonne retirée — dernière étape, symétrique de la première étape du up.
-- ---------------------------------------------------------------------------------------------

alter table public.parametre_atelier
  drop column if exists plafond_avoir_receptionnaire_centimes;
