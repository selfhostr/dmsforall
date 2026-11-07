-- Inverse de 0092_modules_activables.sql. Le choix de modules retirés est perdu : tous les modules
-- redeviennent actifs (aucune donnée métier n'a été supprimée par ce réglage).
alter table public.tenant drop column if exists modules_desactives;
drop type if exists public.module_app;
