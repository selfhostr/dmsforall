-- =============================================================================================
-- 0001_socle_rls.sql — étape 0 : privilèges, Row-Level Security, schéma `amorcage`
--
-- C'est LA migration de sécurité du projet. Elle établit la règle n°1 de dmsforall :
-- aucune requête applicative ne peut lire ou écrire les données d'un autre tenant, même si le
-- code métier oublie son `where tenant_id = ...`.
--
-- Modèle de menace couvert :
--   - bug applicatif (filtre tenant oublié dans un service ou une jointure) ;
--   - injection SQL réussie dans une requête métier ;
--   - fuite par pooling de connexions (voir §2 ci-dessous, le piège le plus vicieux) ;
--   - compromission d'une session : l'attaquant reste enfermé dans SON tenant.
--
-- NON couvert (et c'est explicite) : une compromission du rôle `dfa_migrator` ou du compte
-- superuser de l'instance. La frontière de sécurité est `dfa_app`.
--
-- Réversible : voir migrations/down/0001_socle_rls.down.sql.
-- =============================================================================================


-- ---------------------------------------------------------------------------------------------
-- 1. Vérification des rôles
--
-- Le RLS ne protège strictement RIEN si l'application se connecte en superuser, avec BYPASSRLS,
-- ou avec le propriétaire des tables. On échoue ici plutôt que de laisser croire à une
-- protection inexistante. (`ServiceAccesBase.verifierPostureRls()` refait la vérification au
-- démarrage de l'API, depuis la connexion réellement utilisée.)
-- ---------------------------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in select rolname, rolsuper, rolbypassrls
             from pg_catalog.pg_roles
            where rolname in ('dfa_app', 'dfa_migrator')
  loop
    if r.rolsuper or r.rolbypassrls then
      raise exception
        'Le rôle % est SUPERUSER ou BYPASSRLS : le RLS multi-tenant serait inopérant. Voir docker/postgres/init/01-roles.sql.',
        r.rolname;
    end if;
  end loop;

  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'dfa_app') then
    raise exception 'Le rôle dfa_app est absent. Exécuter docker/postgres/init/01-roles.sql.';
  end if;
end
$$;


-- ---------------------------------------------------------------------------------------------
-- 2. Transmission du tenant à la base
--
-- Le tenant courant voyage dans un paramètre de session PostgreSQL (`app.tenant_id`), posé par
-- `AccesBase.enTenant()` en PORTÉE TRANSACTION (3e argument `true` de set_config).
--
-- LE PIÈGE DU POOLING, qui justifie tout ce dispositif :
--   `SET app.tenant_id = ...` sans LOCAL a une portée SESSION, donc collée à la connexion
--   physique. Rendue au pool, cette connexion conserve le tenant du client précédent. Le tenant
--   suivant qui la récupère hérite du filtre du précédent → fuite inter-tenant non déterministe,
--   dépendante de la charge, invisible en test unitaire et pratiquement impossible à reproduire.
--   Avec la portée transaction, PostgreSQL réinitialise le paramètre au COMMIT comme au
--   ROLLBACK : la connexion revient au pool vierge. Compatible PgBouncer en mode transaction.
--
-- Le `nullif` est indispensable : `current_setting(..., true)` renvoie la CHAÎNE VIDE quand le
-- paramètre n'a jamais été posé, pas NULL. Sans lui, `''::uuid` lève une erreur de cast au lieu
-- de produire un filtre vide — l'application planterait au lieu de filtrer, et pire, le message
-- d'erreur inciterait à « corriger » en désactivant le RLS.
--
-- FAIL-CLOSED : GUC absent → tenant_courant() NULL → `tenant_id = NULL` est NULL, donc non vrai
-- → ZÉRO ligne. Jamais toutes. Une requête qui oublie le contexte ne fuite pas, elle ne trouve
-- rien — un bug bruyant et sans danger, exactement ce qu'on veut.
-- ---------------------------------------------------------------------------------------------

create function public.tenant_courant() returns uuid
language sql
stable
set search_path = pg_catalog
as $$
  select nullif(current_setting('app.tenant_id', true), '')::uuid
$$;

comment on function public.tenant_courant() is
  'Tenant du contexte transactionnel courant, ou NULL. Le nullif est indispensable : current_setting(..., true) rend la chaîne vide, pas NULL.';

-- Utilitaires de traçabilité, sans rôle de sécurité (utilisés par les futurs triggers d'audit).
create function public.utilisateur_courant() returns uuid
language sql
stable
set search_path = pg_catalog
as $$
  select nullif(current_setting('app.utilisateur_id', true), '')::uuid
$$;

comment on function public.utilisateur_courant() is
  'Utilisateur du contexte transactionnel courant, ou NULL (tâche système). Traçabilité uniquement, aucun rôle de sécurité.';

create function public.requete_courante() returns text
language sql
stable
set search_path = pg_catalog
as $$
  select nullif(current_setting('app.requete_id', true), '')
$$;

comment on function public.requete_courante() is
  'Identifiant de la requête HTTP courante, ou NULL. Corrélation logs / audit.';

-- Les fonctions sont EXECUTE pour PUBLIC par défaut : on ferme, puis on ouvre explicitement.
revoke all on function public.tenant_courant()     from public;
revoke all on function public.utilisateur_courant() from public;
revoke all on function public.requete_courante()   from public;

-- dfa_app DOIT pouvoir exécuter tenant_courant() : l'expression d'une politique RLS s'évalue
-- avec les droits du rôle qui exécute la requête. Sans ce GRANT, toute requête échouerait.
grant execute on function public.tenant_courant()      to dfa_app;
grant execute on function public.utilisateur_courant() to dfa_app;
grant execute on function public.requete_courante()    to dfa_app;


-- ---------------------------------------------------------------------------------------------
-- 3. Privilèges de table pour dfa_app
--
-- Volontairement fins et non uniformes. Le principe : dfa_app peut faire ce dont l'application a
-- besoin, rien de plus. Aucune table du socle ne donne DELETE à l'application, sauf `session`.
--   - tenant / site / utilisateur : pas de DELETE. La désactivation est logique (statut, actif).
--     Un DELETE sur ces tables est une opération d'exploitation, pas une opération produit.
--   - session : DELETE autorisé (purge des sessions expirées, révocation).
--   - journal_securite : SELECT + INSERT uniquement → append-only garanti par les privilèges,
--     pas par la bonne volonté du code. C'est ce qui donne sa valeur à une piste d'audit.
-- ---------------------------------------------------------------------------------------------

grant select, insert, update         on public.tenant           to dfa_app;
grant select, insert, update         on public.site             to dfa_app;
grant select, insert, update         on public.utilisateur      to dfa_app;
grant select, insert, update, delete on public.session          to dfa_app;
grant select, insert                 on public.journal_securite to dfa_app;

-- Filet de sécurité pour les tables des étapes suivantes : si une migration crée une table et
-- oublie son GRANT, l'application la voit quand même (et le RLS, lui, refuse tout tant qu'aucune
-- politique n'est posée — l'erreur reste donc fail-closed).
-- Tension assumée avec la règle « pas de DELETE » ci-dessus : ce défaut est plus permissif que
-- les GRANT explicites du socle. Les GRANT explicites restent la règle, table par table.
alter default privileges for role dfa_migrator in schema public
  grant select, insert, update, delete on tables to dfa_app;


-- ---------------------------------------------------------------------------------------------
-- 4. Row-Level Security
--
-- Deux politiques par table :
--   - `*_isolation_tenant` (TO dfa_app) : la vraie frontière de sécurité.
--   - `*_migrator` (TO dfa_migrator)    : voir la note en fin de section.
--
-- USING **et** WITH CHECK sur chacune, systématiquement :
--   - USING      filtre ce que la requête PEUT VOIR (SELECT, et les lignes candidates d'un
--                UPDATE/DELETE) ;
--   - WITH CHECK valide ce que la requête ÉCRIT (INSERT, et l'état APRÈS un UPDATE).
-- Sans WITH CHECK, un INSERT peut écrire n'importe quel tenant_id — y compris celui d'un autre
-- garage — et un UPDATE peut DÉPLACER une ligne vers un autre tenant. La ligne devient alors
-- invisible à son auteur (USING la masque), ce qui rend le bug indétectable côté application
-- tout en ayant corrompu les données d'un tiers. C'est le scénario à ne jamais laisser ouvert.
--
-- FORCE ROW LEVEL SECURITY : sans FORCE, le PROPRIÉTAIRE de la table ignore silencieusement les
-- politiques. On force donc partout... sauf sur trois tables, ci-dessous.
-- ---------------------------------------------------------------------------------------------

-- --- tenant ----------------------------------------------------------------------------------
-- Seule table dont la politique porte sur `id` : le tenant est son propre tenant.
alter table public.tenant enable row level security;
alter table public.tenant force  row level security;

create policy tenant_isolation_tenant on public.tenant
  to dfa_app
  using       (id = public.tenant_courant())
  with check  (id = public.tenant_courant());

-- --- site ------------------------------------------------------------------------------------
alter table public.site enable row level security;
alter table public.site force  row level security;

create policy site_isolation_tenant on public.site
  to dfa_app
  using       (tenant_id = public.tenant_courant())
  with check  (tenant_id = public.tenant_courant());

-- --- utilisateur -----------------------------------------------------------------------------
-- ENABLE sans FORCE. EXCEPTION DOCUMENTÉE, et elle est structurelle :
-- au moment de la connexion, on ne connaît PAS encore le tenant — c'est précisément ce que la
-- requête cherche à établir à partir d'un simple email. Il faut donc un chemin de lecture hors
-- contexte tenant. Ce chemin est le schéma `amorcage` (§5), dont les fonctions SECURITY DEFINER
-- s'exécutent avec les droits de leur propriétaire, dfa_migrator. Or un propriétaire ne
-- s'affranchit du RLS que si FORCE n'est PAS posé — et BYPASSRLS n'est pas une option, ni sur
-- une base managée, ni au regard du principe de moindre privilège.
-- Ce que cela n'affaiblit pas : dfa_app, lui, reste intégralement soumis à la politique
-- ci-dessous. La surface ouverte se limite aux 6 fonctions d'amorçage, dont le code est figé,
-- audité, à paramètres liés et à colonnes explicites.
alter table public.utilisateur enable row level security;

create policy utilisateur_isolation_tenant on public.utilisateur
  to dfa_app
  using       (tenant_id = public.tenant_courant())
  with check  (tenant_id = public.tenant_courant());

-- --- session ---------------------------------------------------------------------------------
-- Même exception, même raison : résoudre un cookie en principal authentifié se fait avant de
-- connaître le tenant.
alter table public.session enable row level security;

create policy session_isolation_tenant on public.session
  to dfa_app
  using       (tenant_id = public.tenant_courant())
  with check  (tenant_id = public.tenant_courant());

-- --- journal_securite ------------------------------------------------------------------------
-- Même exception : il faut pouvoir journaliser un échec de connexion sur un email inconnu, donc
-- sans tenant.
-- Note sur la politique : `tenant_id = tenant_courant()` vaut NULL — donc non vrai — pour les
-- lignes à tenant_id NULL. Ces lignes sont invisibles depuis l'application, ce qui est le
-- comportement voulu : elles n'appartiennent à aucun tenant. Elles restent lisibles par
-- l'exploitant via le rôle propriétaire.
alter table public.journal_securite enable row level security;

create policy journal_securite_isolation_tenant on public.journal_securite
  to dfa_app
  using       (tenant_id = public.tenant_courant())
  with check  (tenant_id = public.tenant_courant());

-- --- Politiques pour dfa_migrator sur les tables FORCE ----------------------------------------
-- Sur `tenant` et `site`, FORCE s'applique aussi au propriétaire : sans politique explicite,
-- dfa_migrator ne pourrait NI lire NI écrire ces tables. Deux conséquences inacceptables :
--   1. le seed de développement ne pourrait pas créer de tenant ;
--   2. surtout, une future migration de reprise de données (« backfill » d'expand/contract)
--      s'exécuterait sans erreur en ne touchant AUCUNE ligne. Une migration silencieusement
--      vide est bien plus dangereuse qu'une migration qui échoue.
-- Ces politiques ne créent aucun privilège nouveau : dfa_migrator est propriétaire du schéma,
-- il peut de toute façon retirer FORCE en une commande. Elles rendent explicite ce qui est déjà
-- vrai. La frontière de sécurité multi-tenant reste dfa_app, qui n'a AUCUNE politique de ce type
-- — et `verifierPostureRls()` refuse le démarrage de l'API si elle constate qu'elle tourne avec
-- un rôle propriétaire.
create policy tenant_migrator on public.tenant
  to dfa_migrator
  using (true) with check (true);

create policy site_migrator on public.site
  to dfa_migrator
  using (true) with check (true);


-- ---------------------------------------------------------------------------------------------
-- 5. Schéma `amorcage` — les 6 seules opérations hors contexte tenant
--
-- Toutes SECURITY DEFINER, propriétaire dfa_migrator.
--
-- `set search_path = pg_catalog, public` sur CHACUNE, sans exception : une fonction SECURITY
-- DEFINER sans search_path fixé est une escalade de privilèges classique. L'appelant pose
-- `search_path = son_schema, public`, y crée une table `utilisateur` ou une fonction `lower()`
-- de son cru, et la fonction — qui tourne avec les droits du propriétaire — les résout à sa
-- place. Le search_path figé, combiné à la qualification complète des objets (`public.xxx`),
-- ferme cette porte deux fois.
--
-- Chaque fonction retourne des COLONNES EXPLICITES, correspondant exactement aux types
-- UtilisateurAmorcage / SessionAmorcage du contrat §2.8. Jamais `select *` : un `select *`
-- ferait fuiter vers la couche applicative toute colonne ajoutée plus tard (jeton TOTP, secret
-- de récupération…) sans qu'aucune revue ne le remarque.
--
-- Aucune de ces fonctions ne construit de SQL dynamique : ce sont des corps SQL statiques à
-- paramètres liés. Il n'y a rien à injecter.
-- ---------------------------------------------------------------------------------------------

create schema amorcage authorization dfa_migrator;

comment on schema amorcage is
  'Opérations d''authentification exécutées hors contexte tenant. Surface volontairement réduite à 6 fonctions SECURITY DEFINER.';

revoke all on schema amorcage from public;
grant usage on schema amorcage to dfa_app;


-- --- 5.1 utilisateur_par_email ----------------------------------------------------------------
-- Chemin de connexion. Jointure sur `tenant` pour rapporter statut_tenant en une seule requête :
-- un compte actif dans un tenant suspendu ne doit pas pouvoir se connecter, et cette décision se
-- prend sur une donnée cohérente, lue au même instant.
create function amorcage.utilisateur_par_email(p_email text)
returns table (
  id                 uuid,
  tenant_id          uuid,
  email              text,
  mot_de_passe_hash  text,
  statut             statut_utilisateur,
  statut_tenant      statut_tenant,
  role               role_utilisateur,
  langue             langue,
  echecs_connexion   smallint,
  verrouille_jusqu_a timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select u.id,
         u.tenant_id,
         u.email,
         u.mot_de_passe_hash,
         u.statut,
         t.statut,
         u.role,
         u.langue,
         u.echecs_connexion,
         u.verrouille_jusqu_a
    from public.utilisateur u
    join public.tenant t on t.id = u.tenant_id
   where u.email = lower(btrim(p_email))
   limit 1
$$;

comment on function amorcage.utilisateur_par_email(text) is
  'Résolution d''un compte par email, hors contexte tenant (le tenant n''est pas encore connu à la connexion). Colonnes explicites : voir UtilisateurAmorcage.';


-- --- 5.2 session_par_empreinte ----------------------------------------------------------------
-- Exécutée à CHAQUE requête authentifiée. Accès par index unique sur empreinte_token.
-- Ne filtre volontairement NI l'expiration NI la révocation : ces décisions appartiennent à
-- `ServiceSession.resoudre()`, qui doit pouvoir distinguer AUTH_SESSION_EXPIREE de
-- AUTH_SESSION_ABSENTE — deux codes d'erreur distincts au contrat, donc deux cas à discriminer.
-- Une fonction qui renvoie NULL dans les deux cas rendrait cette distinction impossible.
create function amorcage.session_par_empreinte(p_empreinte bytea)
returns table (
  session_id         uuid,
  tenant_id          uuid,
  utilisateur_id     uuid,
  cree_le            timestamptz,
  expire_le          timestamptz,
  vu_le              timestamptz,
  revoquee_le        timestamptz,
  role               role_utilisateur,
  langue             langue,
  statut_utilisateur statut_utilisateur,
  statut_tenant      statut_tenant
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select s.id,
         s.tenant_id,
         s.utilisateur_id,
         s.cree_le,
         s.expire_le,
         s.vu_le,
         s.revoquee_le,
         u.role,
         u.langue,
         u.statut,
         t.statut
    from public.session s
    join public.utilisateur u on u.id = s.utilisateur_id and u.tenant_id = s.tenant_id
    join public.tenant t      on t.id = s.tenant_id
   where s.empreinte_token = p_empreinte
   limit 1
$$;

comment on function amorcage.session_par_empreinte(bytea) is
  'Résolution d''une session par empreinte SHA-256. Ne filtre ni expiration ni révocation : ServiceSession doit distinguer session absente et session expirée.';


-- --- 5.3 session_toucher ----------------------------------------------------------------------
-- Rafraîchit `vu_le` pour l'expiration glissante.
-- `vu_le < p_vu_le` : garde-fou contre un retour en arrière de l'horodatage (requêtes
-- concurrentes arrivant dans le désordre) ET évitement d'une écriture inutile quand la valeur
-- n'avance pas. Sur le chemin le plus chaud de l'application, un UPDATE évité est un tuple mort
-- évité, donc de l'autovacuum en moins.
-- `revoquee_le is null` : une session fermée ne se réanime pas.
create function amorcage.session_toucher(p_session_id uuid, p_vu_le timestamptz)
returns void
language sql
security definer
set search_path = pg_catalog, public
as $$
  update public.session
     set vu_le = p_vu_le
   where id = p_session_id
     and revoquee_le is null
     and vu_le < p_vu_le
$$;

comment on function amorcage.session_toucher(uuid, timestamptz) is
  'Rafraîchit session.vu_le (expiration glissante). Idempotent, ne recule jamais, ne réanime pas une session révoquée.';


-- --- 5.4 echec_connexion ----------------------------------------------------------------------
-- `least(..., 30000)` : echecs_connexion est un smallint (max 32767). Sans plafond, un attaquant
-- déterminé provoquerait un dépassement de capacité, donc une erreur SQL sur le chemin de
-- connexion — un déni de service à moindres frais. Le compteur sature au lieu de déborder.
-- `coalesce(p_verrouille_jusqu_a, verrouille_jusqu_a)` : passer NULL signifie « pas de nouveau
-- verrouillage cette fois », jamais « lève le verrou en cours ».
-- `modifie_le` est maintenu par le trigger, on ne le touche pas ici.
create function amorcage.echec_connexion(
  p_utilisateur_id     uuid,
  p_verrouille_jusqu_a timestamptz
)
returns void
language sql
security definer
set search_path = pg_catalog, public
as $$
  update public.utilisateur
     set echecs_connexion   = least(echecs_connexion + 1, 30000)::smallint,
         verrouille_jusqu_a = coalesce(p_verrouille_jusqu_a, verrouille_jusqu_a)
   where id = p_utilisateur_id
$$;

comment on function amorcage.echec_connexion(uuid, timestamptz) is
  'Incrémente le compteur d''échecs (saturant, pas de dépassement smallint) et pose un verrouillage. NULL = pas de nouveau verrou, jamais une levée de verrou.';


-- --- 5.5 reinitialiser_echecs -----------------------------------------------------------------
create function amorcage.reinitialiser_echecs(
  p_utilisateur_id uuid,
  p_connecte_le    timestamptz
)
returns void
language sql
security definer
set search_path = pg_catalog, public
as $$
  update public.utilisateur
     set echecs_connexion      = 0,
         verrouille_jusqu_a    = null,
         derniere_connexion_le = p_connecte_le
   where id = p_utilisateur_id
$$;

comment on function amorcage.reinitialiser_echecs(uuid, timestamptz) is
  'Connexion réussie : remet le compteur d''échecs à zéro, lève le verrou, horodate la connexion.';


-- --- 5.6 journaliser_securite -----------------------------------------------------------------
-- SECURITY DEFINER pour pouvoir écrire une ligne à tenant_id NULL (email inconnu), ce que la
-- politique RLS de dfa_app interdit — et doit interdire.
create function amorcage.journaliser_securite(
  p_type           type_evenement_securite,
  p_tenant_id      uuid,
  p_utilisateur_id uuid,
  p_email_tente    text,
  p_ip             inet,
  p_user_agent     text,
  p_details        jsonb
)
returns void
language sql
security definer
set search_path = pg_catalog, public
as $$
  insert into public.journal_securite
    (tenant_id, type, utilisateur_id, email_tente, ip, user_agent, details)
  values
    (p_tenant_id, p_type, p_utilisateur_id,
     -- nullif : une chaîne vide violerait la contrainte CHECK sur email_tente. Un email absent
     -- se représente par NULL, jamais par ''.
     nullif(left(btrim(p_email_tente), 320), ''),
     p_ip,
     nullif(left(p_user_agent, 1000), ''),
     p_details)
$$;

comment on function amorcage.journaliser_securite(type_evenement_securite, uuid, uuid, text, inet, text, jsonb) is
  'Écrit une ligne de journal de sécurité, y compris sans tenant (email inconnu). email_tente et user_agent tronqués : ce sont des entrées non fiables.';


-- --- 5.7 Privilèges d'exécution ---------------------------------------------------------------
-- Ordre important : les fonctions sont EXECUTE pour PUBLIC par défaut. On ferme d'abord, on
-- ouvre ensuite, nommément. Une fonction SECURITY DEFINER laissée exécutable par PUBLIC est
-- une porte ouverte à tout rôle créé plus tard sur l'instance.
revoke all on all functions in schema amorcage from public;

grant execute on function amorcage.utilisateur_par_email(text)                to dfa_app;
grant execute on function amorcage.session_par_empreinte(bytea)               to dfa_app;
grant execute on function amorcage.session_toucher(uuid, timestamptz)         to dfa_app;
grant execute on function amorcage.echec_connexion(uuid, timestamptz)         to dfa_app;
grant execute on function amorcage.reinitialiser_echecs(uuid, timestamptz)    to dfa_app;
grant execute on function amorcage.journaliser_securite(
  type_evenement_securite, uuid, uuid, text, inet, text, jsonb)               to dfa_app;
