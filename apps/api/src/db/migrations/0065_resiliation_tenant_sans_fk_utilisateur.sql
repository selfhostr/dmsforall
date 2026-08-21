-- =============================================================================================
-- 0065_resiliation_tenant_sans_fk_utilisateur.sql — retire les 4 clés étrangères de
-- `resiliation_tenant`/`resiliation_tenant_evenement` vers `public.utilisateur` (0062).
--
-- DÉFAUT RÉEL, TROUVÉ EN CI (forge, 21.08.2026) : `purger_donnees_tenant()` (0062) restait
-- bloqué EN PERMANENCE, pour TOUT tenant, dès la première tentative réelle de purge. Message
-- observé :
--
--   purger_donnees_tenant : aucune progression à la passe 2 pour le tenant …, tables bloquées :
--   utilisateur. Dernière erreur : update or delete on table "utilisateur" violates foreign key
--   constraint "resiliation_tenant_demandee_par_utilisateur_id_fkey" on table "resiliation_tenant"
--
-- POURQUOI C'ÉTAIT STRUCTUREL, PAS UN CAS LIMITE :
--   `resiliation_tenant` est la PREUVE que l'effacement d'un tenant a eu lieu (`statut =
--   'efface'`, `effacee_le`) — elle est donc EXCLUE À VIE du balayage dynamique de
--   `purger_donnees_tenant()` (`TABLES_CYCLE_VIE_TENANT`, `service-catalogue-tables-tenant.ts`,
--   §B de l'en-tête de 0062). Mais `resiliation_tenant.demandee_par_utilisateur_id` (et les deux
--   autres colonnes actrices) portait une contrainte `references public.utilisateur (id) on
--   delete restrict`. Or `utilisateur`, lui, EST balayé par la purge (il porte `tenant_id`,
--   aucune raison de l'exempter — un employé du garage est aussi une donnée personnelle à
--   effacer). Conséquence mécanique : la ligne `utilisateur` référencée par `resiliation_tenant`
--   ne pouvait PLUS JAMAIS être supprimée, puisque la table qui la référence avec `on delete
--   restrict` ne disparaît, elle, JAMAIS. Un tenant qui a un dossier de résiliation en a
--   FORCÉMENT un — la purge ne peut être appelée qu'après `demander()` (0062, contrainte
--   `resiliation_tenant_tenant_uk` + le garde-fou de `purger_donnees_tenant` lui-même, qui exige
--   `statut = 'en_conservation'`). Le blocage n'était donc pas un cas limite : il touchait
--   SYSTÉMATIQUEMENT tout tenant purgé.
--
-- POURQUOI PAS `on delete set null` (l'alternative qui évite le blocage sans supprimer la FK) :
--   ça résoudrait le blocage, mais en effaçant « qui a demandé la résiliation »/« qui a confirmé
--   la remise » EXACTEMENT au moment où `resiliation_tenant` doit prouver, de façon durable, que
--   l'effacement a eu lieu correctement — c'est-à-dire au pire moment possible pour perdre cette
--   information. Le mandat (§3/§4 de la tâche d'origine) exige explicitement une trace d'audit
--   « qui a demandé » qui survit à l'effacement, pas une trace qui s'efface EN MÊME TEMPS que les
--   données qu'elle documente.
--
-- CE QUE CETTE MIGRATION FAIT À LA PLACE : retire la contrainte de clé étrangère, garde la
-- colonne `uuid` telle quelle (même nom, même nullabilité). L'identifiant reste écrit, EN
-- PERMANENCE, dans `resiliation_tenant`/`resiliation_tenant_evenement` — y compris après la
-- suppression physique de la ligne `utilisateur` qu'il désignait. Ce n'est plus un lien
-- JOIGNABLE après coup, mais c'est une valeur STABLE : « qui » reste écrit, ce qui est
-- exactement ce que le mandat demande. MÊME COMPROMIS, déjà accepté dans ce dépôt, que
-- `relance_planifiee.objet_id` (0045, polymorphe, SANS FK, vérifié par le service applicatif —
-- voir §C de l'en-tête de 0045) : l'intégrité référentielle VIVANTE n'est pas toujours l'exigence
-- la plus forte. Ici, c'est la PERMANENCE de la trace d'audit qui prime sur la possibilité de
-- joindre `utilisateur` après coup — un compromis délibéré, pas un oubli.
--
-- DISCIPLINE EXPAND/CONTRACT DU DÉPÔT (CONTRIBUTING.md : « Jamais éditer une migration versionnée ») :
-- `0062_cycle_vie_resiliation_tenant.sql` est déjà committée et poussée sur `dev`/`main` — elle
-- N'A PAS été modifiée. Cette migration corrige PAR-DESSUS, comme toute correction de ce dépôt
-- une fois une migration publiée.
--
-- Réversible : migrations/down/0065_resiliation_tenant_sans_fk_utilisateur.down.sql — restaure
-- les 4 contraintes à l'identique (même nom, même `on delete restrict`). Aucune migration de
-- données : les 4 colonnes gardent leurs valeurs, seule la contrainte disparaît.
-- =============================================================================================


-- ---------------------------------------------------------------------------------------------
-- 1. `resiliation_tenant` — 3 des 4 FK
-- ---------------------------------------------------------------------------------------------

alter table public.resiliation_tenant
  drop constraint resiliation_tenant_demandee_par_utilisateur_id_fkey,
  drop constraint resiliation_tenant_remis_confirme_par_utilisateur_id_fkey,
  drop constraint resiliation_tenant_effacee_par_utilisateur_id_fkey;

comment on column public.resiliation_tenant.demandee_par_utilisateur_id is
  'Employé (rôle direction) qui a demandé la résiliation. SANS contrainte de clé étrangère '
  'vers public.utilisateur, VOLONTAIREMENT (0065) : resiliation_tenant survit à vie à la purge '
  '(0062 §B), qui efface elle-même public.utilisateur — une FK on delete restrict y bloquait '
  'purger_donnees_tenant() en permanence. La valeur reste écrite en PERMANENCE, y compris après '
  'suppression physique de la ligne utilisateur référencée — même compromis que '
  'relance_planifiee.objet_id (0045) : la permanence de la trace prime sur l''intégrité '
  'référentielle vivante.';

comment on column public.resiliation_tenant.remis_confirme_par_utilisateur_id is
  'Employé (rôle direction) qui a confirmé la remise. SANS FK vers public.utilisateur — voir le '
  'commentaire de demandee_par_utilisateur_id (même raison, 0065).';

comment on column public.resiliation_tenant.effacee_par_utilisateur_id is
  'TOUJOURS NULL en pratique (effacement exclusivement automatique, 0062). SANS FK vers '
  'public.utilisateur — voir le commentaire de demandee_par_utilisateur_id (même raison, 0065).';


-- ---------------------------------------------------------------------------------------------
-- 2. `resiliation_tenant_evenement` — la 4ᵉ FK
-- ---------------------------------------------------------------------------------------------

alter table public.resiliation_tenant_evenement
  drop constraint resiliation_tenant_evenement_declenche_par_utilisateur_id_fkey;

comment on column public.resiliation_tenant_evenement.declenche_par_utilisateur_id is
  'Employé à l''origine de cette transition (`null` = automatique, voir declenche_automatiquement). '
  'SANS FK vers public.utilisateur — resiliation_tenant_evenement est APPEND-ONLY et doit rester '
  'l''historique intact des transitions, y compris après la suppression physique de l''utilisateur '
  'référencé (0065, même raison que resiliation_tenant.demandee_par_utilisateur_id).';


-- ---------------------------------------------------------------------------------------------
-- 3. Assertions de fin de migration
-- ---------------------------------------------------------------------------------------------

do $$
declare
  v_nb integer;
begin
  select count(*) into v_nb
    from pg_catalog.pg_constraint
   where conname in (
     'resiliation_tenant_demandee_par_utilisateur_id_fkey',
     'resiliation_tenant_remis_confirme_par_utilisateur_id_fkey',
     'resiliation_tenant_effacee_par_utilisateur_id_fkey',
     'resiliation_tenant_evenement_declenche_par_utilisateur_id_fkey'
   );
  if v_nb > 0 then
    raise exception '0065 : % contrainte(s) vers utilisateur toujours présente(s) après migration.', v_nb;
  end if;

  -- Les colonnes elles-mêmes doivent survivre, avec leur nullabilité inchangée.
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'resiliation_tenant'
       and column_name = 'demandee_par_utilisateur_id' and is_nullable = 'NO' and data_type = 'uuid'
  ) then
    raise exception '0065 : resiliation_tenant.demandee_par_utilisateur_id absente, nullable, ou de mauvais type.';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'resiliation_tenant'
       and column_name = 'remis_confirme_par_utilisateur_id' and is_nullable = 'YES' and data_type = 'uuid'
  ) then
    raise exception '0065 : resiliation_tenant.remis_confirme_par_utilisateur_id absente, non-nullable, ou de mauvais type.';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'resiliation_tenant'
       and column_name = 'effacee_par_utilisateur_id' and is_nullable = 'YES' and data_type = 'uuid'
  ) then
    raise exception '0065 : resiliation_tenant.effacee_par_utilisateur_id absente, non-nullable, ou de mauvais type.';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'resiliation_tenant_evenement'
       and column_name = 'declenche_par_utilisateur_id' and is_nullable = 'YES' and data_type = 'uuid'
  ) then
    raise exception '0065 : resiliation_tenant_evenement.declenche_par_utilisateur_id absente, non-nullable, ou de mauvais type.';
  end if;

  -- resiliation_tenant_fk_tenant et resiliation_tenant_evenement_fk_resiliation (les DEUX autres
  -- FK de ces tables, sans rapport avec utilisateur) doivent, elles, être intactes.
  if not exists (
    select 1 from pg_catalog.pg_constraint where conname = 'resiliation_tenant_fk_tenant'
  ) then
    raise exception '0065 : resiliation_tenant_fk_tenant a disparu — ne devait pas être touchée.';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint where conname = 'resiliation_tenant_evenement_fk_resiliation'
  ) then
    raise exception '0065 : resiliation_tenant_evenement_fk_resiliation a disparu — ne devait pas être touchée.';
  end if;
end
$$;
