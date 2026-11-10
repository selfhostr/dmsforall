-- =============================================================================================
-- 0099_code_installation.sql -- code d'installation a usage unique (premier garage depuis le
-- navigateur).
--
-- Une instance neuve exposee sur internet n'a aucun compte : quiconque ouvre l'adresse en premier
-- pourrait creer le premier garage et en devenir le proprietaire. Au demarrage, tant qu'aucun
-- garage n'existe, l'API tire un code aleatoire, l'affiche dans ses journaux (lisibles par qui
-- administre le serveur) et n'en garde ici que l'empreinte salee. Le code est invalide des qu'un
-- garage existe.
--
-- Hors RLS et hors schema `public` a dessein : la table n'a pas de tenant (elle existe AVANT le
-- premier) et `dfa_app` n'y a aucun droit -- seul le role proprietaire (`dfa_migrator`), deja
-- utilise par le CLI `creer-garage`, la lit et l'ecrit. Une seule ligne possible (`singleton`).
-- =============================================================================================

create table amorcage.code_installation (
  singleton boolean     primary key default true,
  sel       bytea       not null,
  empreinte bytea       not null,
  cree_le   timestamptz not null default now(),
  constraint code_installation_singleton_chk check (singleton)
);

comment on table amorcage.code_installation is
  'Empreinte salee (sha-256) du code d''installation a usage unique (0099). Une ligne au plus ; videe des qu''un garage existe. Aucun droit pour dfa_app.';

revoke all on amorcage.code_installation from public;
revoke all on amorcage.code_installation from dfa_app;
