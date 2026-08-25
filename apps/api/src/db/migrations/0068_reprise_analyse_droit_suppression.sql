-- =============================================================================================
-- 0068_reprise_analyse_droit_suppression.sql — corrige un droit manquant qui bloque l'analyse de
-- reprise DÈS LE PREMIER APPEL, sur toute archive réelle.
--
-- DÉFAUT MESURÉ EN EXÉCUTION (archive réelle, mandat 24/25.08.2026) : `POST
-- /reprise/dossiers/{id}/analyses` rend 500, log `permission denied for table reprise_analyse`.
-- `ServiceAnalyseReprise.lancer()` (apps/api/src/reprise/analyse/service-analyse-reprise.ts)
-- exécute un `DELETE FROM public.reprise_analyse` INCONDITIONNEL à CHAQUE appel — y compris le
-- tout premier, où la table est vide pour ce dossier — pour garantir l'idempotence d'une relance
-- (§ commentaire de tête de 0067 : « une relance supprime puis réinsère la ligne »). Or 0067
-- n'accordait à `dfa_app` que `select, insert, update` sur `reprise_analyse` : AUCUNE archive
-- réelle n'a jamais pu dépasser l'étape d'analyse.
--
-- CORRECTIF : `grant delete` + déclaration `[dfa:suppression-physique]` sur le commentaire de
-- table (exigée par `ServiceAccesBase.verifierPostureRls()`, 0002 — sans elle, l'API refuserait
-- de démarrer avec DELETE accordé et non déclaré : « DELETE sans déclaration »). Justification :
-- `reprise_analyse` est un SINGLETON par dossier régénéré à chaque relance (nouvel `id`), jamais
-- un historique — la suppression physique de l'ancienne ligne est le comportement voulu, pas un
-- oubli de purge logique.
--
-- AUDIT DES CINQ AUTRES TABLES DE 0067 (dossier_reprise, reprise_tranche, reprise_plan,
-- reprise_import, reprise_rapport) : comparaison des GRANT réels aux opérations SQL réellement
-- exécutées par les services (`grep 'delete from' apps/api/src/reprise/**/*.ts`, hors specs) —
-- SEULES deux tables voient un DELETE dans le code : `reprise_tranche`
-- (`ServiceCycleVieDossierReprise.annuler`, déjà `[dfa:suppression-physique]` depuis 0067) et
-- `reprise_analyse` (ce correctif). Les quatre autres ne sont jamais supprimées :
--   - `dossier_reprise`  : insert (creer) + update (annuler/transiter) seulement — jamais delete.
--   - `reprise_plan`     : insert (généré une fois par analyse réussie) + update (ajuster/valider)
--                          — jamais recréé. Sûr : une relance d'analyse (delete reprise_analyse)
--                          n'est recevable QUE depuis `analyse_echouee` (transitions-dossier-
--                          reprise.ts), état atteint uniquement sur ÉCHEC, donc AVANT toute
--                          génération de plan (qui exige `analyse_terminee`) — aucun `reprise_plan`
--                          ne référence jamais l'analyse supprimée au moment du DELETE (la FK
--                          `reprise_plan_fk_analyse … on delete restrict` ne peut donc jamais
--                          bloquer ce DELETE en pratique).
--   - `reprise_import`   : une seule ligne insérée à la validation du plan, puis MISE À JOUR (statut,
--                          tentative incrémenté par rejouer(), progression) — jamais delete.
--   - `reprise_rapport`  : `insert … on conflict (tenant_id, dossier_reprise_id) do update` — jamais
--                          un delete explicite ; le upsert couvre le rejeu d'import.
-- Verdict : les droits des cinq autres tables correspondent exactement à ce que le code exécute,
-- aucun autre trou du même genre.
--
-- Réversible : migrations/down/0068_reprise_analyse_droit_suppression.down.sql.
-- =============================================================================================

grant delete on public.reprise_analyse to dfa_app;

comment on table public.reprise_analyse is
  'Résultat COURANT de l''analyse asynchrone (contrats/reprise.ts::ReponseAnalyseReprise), '
  'singleton par dossier. Une relance (POST .../analyses) supprime puis réinsère la ligne : un '
  'plan appartient à UNE analyse précise, l''historique des tentatives n''a pas de valeur métier. '
  '[dfa:suppression-physique] la relance DOIT supprimer physiquement l''ancienne ligne (nouvel id '
  'à chaque tentative) : ce n''est pas une purge de données personnelles comme reprise_tranche, '
  'mais l''idempotence de POST .../analyses l''exige — voir 0068.';


-- ---------------------------------------------------------------------------------------------
-- Assertions de fin de migration.
-- ---------------------------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from information_schema.role_table_grants
     where table_schema = 'public' and table_name = 'reprise_analyse'
       and grantee = 'dfa_app' and privilege_type = 'DELETE'
  ) then
    raise exception '0068 : dfa_app doit avoir DELETE sur reprise_analyse (idempotence de la relance).';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_description d
    join pg_catalog.pg_class c on c.oid = d.objoid
     where c.relname = 'reprise_analyse' and d.description like '%[dfa:suppression-physique]%'
  ) then
    raise exception '0068 : reprise_analyse doit déclarer [dfa:suppression-physique] (verifierPostureRls).';
  end if;
end
$$;
