-- =============================================================================================
-- 0068_reprise_analyse_droit_suppression.down.sql — inverse de 0068 : schéma après ce down
-- identique bit à bit au schéma d'avant la migration montante (droit retiré, commentaire restauré
-- tel qu'issu de 0067, sans le marqueur [dfa:suppression-physique]).
-- =============================================================================================

revoke delete on public.reprise_analyse from dfa_app;

comment on table public.reprise_analyse is
  'Résultat COURANT de l''analyse asynchrone (contrats/reprise.ts::ReponseAnalyseReprise), '
  'singleton par dossier. Une relance (POST .../analyses) supprime puis réinsère la ligne : un '
  'plan appartient à UNE analyse précise, l''historique des tentatives n''a pas de valeur métier.';


-- ---------------------------------------------------------------------------------------------
-- Assertions de fin de down
-- ---------------------------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1 from information_schema.role_table_grants
     where table_schema = 'public' and table_name = 'reprise_analyse'
       and grantee = 'dfa_app' and privilege_type = 'DELETE'
  ) then
    raise exception '0068 down : dfa_app détient encore DELETE sur reprise_analyse.';
  end if;

  if exists (
    select 1 from pg_catalog.pg_description d
    join pg_catalog.pg_class c on c.oid = d.objoid
     where c.relname = 'reprise_analyse' and d.description like '%[dfa:suppression-physique]%'
  ) then
    raise exception '0068 down : reprise_analyse déclare encore [dfa:suppression-physique].';
  end if;
end
$$;
