-- =============================================================================================
-- 0006_clients.down.sql — annulation de 0006_clients.sql
--
-- Ordre inverse. `client` en dernier : `client_adresse`, `client_contact`, `client_condition`,
-- `client_consentement`, `client_note` la référencent toutes, et `client` se référence lui-même
-- (groupe_client_id, fusionne_vers_client_id).
-- =============================================================================================

drop table if exists public.client_note;
drop table if exists public.client_consentement;
drop table if exists public.client_condition;
drop table if exists public.client_contact;
drop table if exists public.client_adresse;

drop trigger if exists client_audit             on public.client;
drop trigger if exists client_verrouiller_type   on public.client;
drop function if exists public.client_verrouiller_type();

drop table if exists public.client;
