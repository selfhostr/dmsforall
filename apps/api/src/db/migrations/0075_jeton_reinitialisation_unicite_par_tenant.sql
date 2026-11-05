-- =============================================================================================
-- 0075_jeton_reinitialisation_unicite_par_tenant.sql — met la table des jetons de réinitialisation
-- de mot de passe en conformité avec la règle R-9 (toute contrainte UNIQUE d'une table métier
-- commence par tenant_id ; seules `utilisateur.email` et `session.empreinte_token` y échappent).
--
-- 0074 posait `unique (empreinte_jeton)`. Le flux de réinitialisation résout toujours le tenant
-- AVANT de lire cette table (via l'email) et filtre par (tenant_id, utilisateur_id,
-- empreinte_jeton) : l'unicité globale n'est utilisée par aucune requête. Une empreinte SHA-256
-- de 32 octets aléatoires ne collisionne pas en pratique ; l'unicité par tenant suffit.
--
-- Migration neuve plutôt que modification de 0074 (déjà versionnée). Réversible :
-- down/0075_jeton_reinitialisation_unicite_par_tenant.down.sql.
-- =============================================================================================

alter table public.jeton_reinitialisation_mot_de_passe
  drop constraint jeton_reinitialisation_mot_de_passe_empreinte_uk;

alter table public.jeton_reinitialisation_mot_de_passe
  add constraint jeton_reinitialisation_mot_de_passe_empreinte_uk
  unique (tenant_id, empreinte_jeton);
