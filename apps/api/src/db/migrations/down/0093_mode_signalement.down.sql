-- Inverse de 0093_mode_signalement.sql : le réglage est perdu, le bouton redevient celui par défaut.
alter table public.tenant drop column if exists mode_signalement;
drop type if exists public.mode_signalement;
