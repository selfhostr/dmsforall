-- =============================================================================================
-- 0057_referentiel_vehicules_ch_etat_import.sql — traçabilité du contrôle/import quotidien ASTRA
--
-- BESOIN — l'import du référentiel (`type_approbation_ch`, 0050/0051) n'existait jusqu'ici qu'en
-- script manuel (`pnpm db:import:vehicules-ch`). Un `docker:reset` reparti à 0 ligne est passé
-- inaperçu : la recherche par code type rendait silencieusement une liste vide, personne ne l'a
-- su avant qu'un garagiste ne s'en aperçoive. Cette migration pose la table qui rend l'état du
-- contrôle/import OBSERVABLE — le déclenchement périodique lui-même (BullMQ, voir
-- `ordonnancement/`) et la logique de détection de changement (voir
-- `vehicules/referentiel/detecter-changement-source-tas.ts`) sont hors périmètre SQL, cette
-- migration ne fait que poser où ils écrivent leur résultat.
--
-- SINGLETON, PAS UN JOURNAL PAR EXÉCUTION — une seule ligne (`id boolean primary key default
-- true, check (id)`, patron singleton Postgres classique) : le besoin exprimé est « quel est
-- l'état ACTUEL du contrôle/import », pas un historique complet (qui grossirait sans purge et
-- n'est demandé par aucun écran). `echecs_consecutifs` porte à lui seul la notion de répétition
-- (« un échec répété doit être visible ») sans avoir besoin d'un journal ligne par ligne.
--
-- TROIS INFORMATIONS QUI NE DOIVENT JAMAIS SE CONFONDRE (piège du dépôt : absence de donnée ≠
-- valeur) :
--   - `derniere_verification_le` NULL = jamais vérifié depuis que cette table existe ;
--   - `derniere_verification_le` renseignée + `derniere_issue = 'inchange'` = vérifié, source
--     identique à la dernière fois, PAS réimporté (`dernier_import_reussi_le` inchangé) ;
--   - `dernier_import_reussi_le` renseignée = un import a RÉELLEMENT été appliqué à cette date,
--     jamais confondue avec une simple vérification.
--
-- PAS DE `tenant_id`, MÊME POSTURE QUE `type_approbation_ch` (0050) — cet état décrit le
-- référentiel PARTAGÉ, pas une donnée de garage. `[dfa:referentiel-partage]` : `dfa_app` n'a que
-- SELECT (une future console d'exploitation pourra afficher « vérifié il y a 3h » sans droit
-- d'écriture) ; seul `dfa_migrator` écrit, exactement comme pour `type_approbation_ch` elle-même
-- — le job d'import/contrôle se connecte avec `DATABASE_URL_MIGRATION`, jamais via `AccesBase`/
-- `dfa_app` (voir `vehicules/referentiel/etat-import-referentiel-vehicules-ch.ts`).
--
-- Réversible : migrations/down/0057_referentiel_vehicules_ch_etat_import.down.sql.
-- =============================================================================================


-- ---------------------------------------------------------------------------------------------
-- 1. Type enum — issue d'un passage du job (contrôle seul, ou contrôle + import).
-- ---------------------------------------------------------------------------------------------

create type public.referentiel_vehicules_ch_issue_import as enum (
  -- Source changée (signature ETag/Last-Modified/empreinte différente), import appliqué avec
  -- succès.
  'succes',
  -- Source contrôlée, signature identique à la dernière fois : aucun réimport déclenché.
  'inchange',
  -- Contrôle ou import en échec (réseau, HTTP non 2xx, CSV illisible…) — voir `dernier_motif_echec`.
  'echec'
);


-- ---------------------------------------------------------------------------------------------
-- 2. `referentiel_vehicules_ch_etat_import` — une ligne unique, réécrite à chaque passage.
-- ---------------------------------------------------------------------------------------------

create table public.referentiel_vehicules_ch_etat_import (
  -- Singleton : `true` est la seule valeur admise par la contrainte ci-dessous, donc au plus une
  -- ligne peut jamais exister (la PK empêche même une seconde ligne à `true`).
  id                          boolean       primary key default true,

  -- Dernière fois où le job a effectivement CONTRÔLÉ la source (HEAD, ou téléchargement en repli
  -- — voir `detecter-changement-source-tas.ts`), que la source ait changé ou non, que le contrôle
  -- ait réussi ou échoué. NULL tant qu'aucun passage n'a eu lieu depuis la création de la table.
  derniere_verification_le    timestamptz,

  -- Issue du DERNIER passage. NULL uniquement avant le tout premier passage (cohérent avec
  -- `derniere_verification_le` NULL au même moment).
  derniere_issue              public.referentiel_vehicules_ch_issue_import,

  -- Dernière fois où un import a RÉELLEMENT écrit dans `type_approbation_ch` (donc où
  -- `derniere_issue = 'succes'`). Reste NULL tant qu'aucun import n'a jamais réussi, y compris
  -- après plusieurs passages `inchange` ou `echec`.
  dernier_import_reussi_le    timestamptz,

  -- Nombre de lignes lues au total (les 3 sources TAS cumulées) lors du DERNIER import réussi.
  -- Reste à sa dernière valeur connue lors d'un passage `inchange` ou `echec` (ne redescend
  -- jamais à 0 pour un passage qui n'a rien importé).
  dernier_nombre_lignes       integer,

  -- Empreinte de la source au dernier CONTRÔLE (réussi) — ETag/Last-Modified concaténés des 3
  -- fichiers TAS, ou empreinte de contenu en repli si le serveur n'en fournit aucun (voir
  -- `detecter-changement-source-tas.ts`). Comparée au prochain passage pour décider `inchange`
  -- vs `succes`, sans avoir à retélécharger pour rien.
  signature_source            text,

  -- Motif du dernier échec — NULL tant que `derniere_issue` n'est pas `'echec'` ; texte libre
  -- (message d'exception), jamais affiché à un client final, réservé à l'exploitation.
  dernier_motif_echec         text,

  -- Compteur d'échecs consécutifs, remis à 0 dès qu'un passage réussit (`succes` ou `inchange`).
  -- C'est ce qui rend un échec RÉPÉTÉ visible plutôt qu'un simple échec isolé (transitoire,
  -- attendu sur une source tierce) — une future alerte d'exploitation pourra seuiller dessus.
  echecs_consecutifs          integer       not null default 0,

  modifie_le                  timestamptz   not null default now(),

  constraint referentiel_vehicules_ch_etat_import_id_singleton_chk check (id),
  constraint referentiel_vehicules_ch_etat_import_lignes_chk
    check (dernier_nombre_lignes is null or dernier_nombre_lignes >= 0),
  constraint referentiel_vehicules_ch_etat_import_echecs_chk
    check (echecs_consecutifs >= 0),
  -- Un motif d'échec n'a de sens QUE pour l'issue `echec` — jamais renseigné à côté d'un succès,
  -- jamais absent pour un échec constaté.
  constraint referentiel_vehicules_ch_etat_import_motif_coherent_chk
    check (
      (derniere_issue = 'echec' and dernier_motif_echec is not null)
      or (derniere_issue is distinct from 'echec' and dernier_motif_echec is null)
    )
);

create trigger referentiel_vehicules_ch_etat_import_touche_modifie_le
  before update on public.referentiel_vehicules_ch_etat_import
  for each row execute function public.touche_modifie_le();

comment on table public.referentiel_vehicules_ch_etat_import is
  'État courant (singleton) du contrôle/import quotidien du référentiel véhicules suisse ASTRA '
  '(type_approbation_ch, 0050). [dfa:referentiel-partage] Donnée produit partagée par tous les '
  'tenants, pas une donnée de garage — dfa_app n''y a que SELECT ; seul le job d''import '
  '(DATABASE_URL_MIGRATION) y écrit, comme pour type_approbation_ch elle-même.';

-- Posture : `dfa_app` ne reçoit QUE SELECT — même exigence que 0050 pour `type_approbation_ch`.
revoke all    on public.referentiel_vehicules_ch_etat_import from dfa_app;
grant  select on public.referentiel_vehicules_ch_etat_import to   dfa_app;

-- La ligne singleton existe dès la migration : le job n'a jamais à décider entre INSERT et
-- UPDATE (toujours un UPDATE sur `id = true`), et une lecture avant le tout premier passage rend
-- des colonnes NULL explicites plutôt qu'une absence de ligne à distinguer d'une erreur.
insert into public.referentiel_vehicules_ch_etat_import (id) values (true);


-- ---------------------------------------------------------------------------------------------
-- Assertions de fin de migration
-- ---------------------------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.referentiel_vehicules_ch_etat_import') is null then
    raise exception '0057 : table referentiel_vehicules_ch_etat_import introuvable après création.';
  end if;

  if (select count(*) from public.referentiel_vehicules_ch_etat_import) <> 1 then
    raise exception '0057 : la ligne singleton est absente ou dupliquée.';
  end if;

  if not has_table_privilege('dfa_app', 'public.referentiel_vehicules_ch_etat_import', 'SELECT') then
    raise exception '0057 : dfa_app n''a pas SELECT sur referentiel_vehicules_ch_etat_import.';
  end if;

  if has_table_privilege('dfa_app', 'public.referentiel_vehicules_ch_etat_import', 'INSERT')
     or has_table_privilege('dfa_app', 'public.referentiel_vehicules_ch_etat_import', 'UPDATE')
     or has_table_privilege('dfa_app', 'public.referentiel_vehicules_ch_etat_import', 'DELETE') then
    raise exception '0057 : dfa_app a un privilège d''écriture sur referentiel_vehicules_ch_etat_import.';
  end if;
end
$$;
