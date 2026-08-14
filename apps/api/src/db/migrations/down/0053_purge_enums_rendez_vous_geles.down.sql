-- =============================================================================================
-- 0053_purge_enums_rendez_vous_geles.down.sql — inverse de 0053_purge_enums_rendez_vous_geles.sql.
--
-- Recrée les deux types EXACTEMENT comme posés par `0005_parametrage.sql` — mêmes noms, mêmes
-- valeurs, même ordre d'énumération. Aucune donnée n'est perdue par ce down : 0053 n'a fait que
-- retirer deux types déjà orphelins (vérifié en exécution, voir l'en-tête du up).
-- =============================================================================================

create type public.statut_rendez_vous as enum (
  'demande', 'planifie', 'honore', 'absent', 'annule_client', 'annule_garage', 'reporte'
);

create type public.origine_rendez_vous as enum (
  'telephone', 'comptoir', 'email', 'formulaire_web', 'importe', 'rappel_automatique'
);


-- ---------------------------------------------------------------------------------------------
-- Assertions de fin de down
-- ---------------------------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_catalog.pg_type where typname = 'statut_rendez_vous') then
    raise exception '0053 down : type statut_rendez_vous absent après le down.';
  end if;

  if not exists (select 1 from pg_catalog.pg_type where typname = 'origine_rendez_vous') then
    raise exception '0053 down : type origine_rendez_vous absent après le down.';
  end if;

  if (
    select array_agg(enumlabel::text order by enumsortorder)
      from pg_enum join pg_type on pg_type.oid = enumtypid
     where typname = 'statut_rendez_vous'
  ) <> array['demande', 'planifie', 'honore', 'absent', 'annule_client', 'annule_garage', 'reporte']::text[] then
    raise exception '0053 down : valeurs de statut_rendez_vous ne correspondent pas à l''état d''origine (0005).';
  end if;

  if (
    select array_agg(enumlabel::text order by enumsortorder)
      from pg_enum join pg_type on pg_type.oid = enumtypid
     where typname = 'origine_rendez_vous'
  ) <> array['telephone', 'comptoir', 'email', 'formulaire_web', 'importe', 'rappel_automatique']::text[] then
    raise exception '0053 down : valeurs de origine_rendez_vous ne correspondent pas à l''état d''origine (0005).';
  end if;
end
$$;
