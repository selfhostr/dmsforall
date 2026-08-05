-- =============================================================================================
-- 0043_pneus_depot_pneus.down.sql — inverse de 0043_pneus_depot_pneus.sql.
--
-- `drop table` cascade sur les contraintes, index, policies RLS et triggers restants
-- (depot_pneus_touche_modifie_le, depot_pneus_isolation_tenant, depot_pneus_migrator) — seul
-- depot_pneus_audit est retiré explicitement avant, par symétrie avec le up (trigger posé APRÈS
-- la table dans le up, retiré AVANT elle ici).
--
-- NE PEUT PAS DÉFAIRE : `entite_auditee` gagne `depot_pneus` en montante — aucun DROP VALUE en
-- PostgreSQL, même limite acceptée que 0010/0016/0025/0033. Résidu documenté dans
-- `scripts/verifier-reversibilite-migrations.sh` (`obtenir_exception_down_partiel`, entrée
-- `0043_pneus_depot_pneus.sql`). Migration de DONNÉES : aucune — la table n'a jamais existé avant
-- ce up, donc aucune perte d'information possible à ce DROP TABLE.
-- =============================================================================================

drop trigger depot_pneus_audit on public.depot_pneus;

drop table public.depot_pneus;

drop type public.motif_sortie_depot_pneus;
drop type public.statut_depot_pneus;
drop type public.saison_pneu;


-- ---------------------------------------------------------------------------------------------
-- Assertions de fin de down
-- ---------------------------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.depot_pneus') is not null then
    raise exception '0043 down : table depot_pneus toujours présente après le down.';
  end if;

  if exists (select 1 from pg_catalog.pg_type where typname = 'saison_pneu') then
    raise exception '0043 down : type saison_pneu toujours présent après le down.';
  end if;

  if exists (select 1 from pg_catalog.pg_type where typname = 'statut_depot_pneus') then
    raise exception '0043 down : type statut_depot_pneus toujours présent après le down.';
  end if;

  if exists (select 1 from pg_catalog.pg_type where typname = 'motif_sortie_depot_pneus') then
    raise exception '0043 down : type motif_sortie_depot_pneus toujours présent après le down.';
  end if;
end
$$;
