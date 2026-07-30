-- =============================================================================================
-- 0014_bloc_creancier_tenant.down.sql — annulation de 0014_bloc_creancier_tenant.sql
--
-- Dans l'ordre inverse de la création : la table (avec ses policies, trigger, contraintes —
-- toutes tombent avec `drop table`), puis la colonne ajoutée à `client_adresse`, puis restauration
-- du commentaire de `client_adresse` tel qu'il existait avant 0014 (texte de 0006, mot pour mot —
-- down annule la CORRECTION, pas 0006 elle-même, déjà appliquée et immuable, même logique que
-- 0012.down/0013.down).
--
-- Rien d'autre n'est touché : `document_vente` (0010) n'a jamais été câblée à cette table (voir
-- tête de fichier de 0014), donc rien n'y référence `tenant_bloc_creancier` à défaire.
-- =============================================================================================

drop table if exists public.tenant_bloc_creancier;

alter table public.client_adresse
  drop column if exists numero;

comment on table public.client_adresse is
  'Adresses d''un client (principale/facturation/livraison). RM-03 : une seule principale et une '
  'seule de facturation actives à la fois — voir les index partiels ci-dessous.';
