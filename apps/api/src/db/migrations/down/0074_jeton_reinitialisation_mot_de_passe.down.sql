-- =============================================================================================
-- 0074_jeton_reinitialisation_mot_de_passe.down.sql — inverse de
-- 0074_jeton_reinitialisation_mot_de_passe.sql.
--
-- PARTIELLEMENT réversible, même limite que 0010/0016/0022/0023/0025/0027/0030/0031/0033/0043/
-- 0045/0047/0052/0055 (voir leurs en-têtes down/*.sql respectifs) : les 3
-- `ALTER TYPE public.type_evenement_securite ADD VALUE` de la montante n'ont AUCUN `DROP VALUE`
-- en PostgreSQL — recréer le type sans ces 3 valeurs serait plus risqué que le résidu qu'il
-- corrigerait (aucune ligne ne les référence jamais si l'API applicative reste inchangée après ce
-- rollback). Enregistrée dans scripts/verifier-reversibilite-migrations.sh
-- (`obtenir_exception_down_partiel`).
--
-- La table, elle, se défait intégralement : neuve dans la montante, aucune ligne préexistante à
-- perdre, aucune colonne d'une table préexistante touchée.
-- =============================================================================================

drop table public.jeton_reinitialisation_mot_de_passe;
