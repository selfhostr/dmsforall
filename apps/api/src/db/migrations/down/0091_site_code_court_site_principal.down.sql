-- Inverse de 0091_site_code_court_site_principal.sql. Perte assumée : codes courts et sites
-- principaux saisis depuis le up (données de présentation, recalculables au prochain up).

drop index if exists public.utilisateur_site_principal_idx;
alter table public.utilisateur drop constraint if exists utilisateur_site_principal_personne_chk;
alter table public.utilisateur drop constraint if exists utilisateur_fk_site_principal;
alter table public.utilisateur drop column if exists site_principal_id;

drop trigger if exists site_code_court_defaut_trg on public.site;
drop function if exists public.site_code_court_defaut();
alter table public.site drop constraint if exists site_tenant_code_court_uk;
alter table public.site drop constraint if exists site_code_court_format_chk;
alter table public.site drop column if exists code_court;
drop function if exists public.site_code_court_base(text, text);
