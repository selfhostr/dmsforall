-- =============================================================================================
-- 0093_mode_signalement.sql — `tenant.mode_signalement` : réglage du bouton « Signaler un problème ».
--
--   via_site    (défaut) : le signalement se termine sur le site public (nouvel onglet).
--   copie_seule          : seul « Copier le rapport » est proposé (instance sans internet).
--   desactive            : l'entrée de menu disparaît.
--
-- Les garages existants prennent `via_site` : le bouton est nouveau, aucun comportement à préserver.
-- =============================================================================================

create type public.mode_signalement as enum ('via_site', 'copie_seule', 'desactive');

alter table public.tenant
  add column mode_signalement public.mode_signalement not null default 'via_site';

comment on column public.tenant.mode_signalement is
  'Comportement du bouton « Signaler un problème » : via_site, copie_seule ou desactive.';
