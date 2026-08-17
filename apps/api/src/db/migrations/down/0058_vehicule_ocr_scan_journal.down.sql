-- =============================================================================================
-- 0058_vehicule_ocr_scan_journal.down.sql — inverse de 0058_vehicule_ocr_scan_journal.sql.
--
-- Schéma après ce down identique bit à bit au schéma d'avant la migration montante. Migration de
-- données : aucune (table neuve, append-only, jamais alimentée avant cette migration montante).
-- =============================================================================================

drop table if exists public.vehicule_ocr_scan_journal;
drop type  if exists public.resultat_scan_ocr_permis;


-- ---------------------------------------------------------------------------------------------
-- Assertions de fin de down
-- ---------------------------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.vehicule_ocr_scan_journal') is not null then
    raise exception '0058 down : table vehicule_ocr_scan_journal toujours présente après le down.';
  end if;

  if exists (select 1 from pg_catalog.pg_type where typname = 'resultat_scan_ocr_permis') then
    raise exception '0058 down : type resultat_scan_ocr_permis toujours présent après le down.';
  end if;
end
$$;
