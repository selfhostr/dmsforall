-- =============================================================================================
-- 0000_socle.sql — étape 0 : énumérations, tables du socle, contraintes, index, trigger
--
-- Appliquée par `src/db/migrer.ts` avec le rôle `dfa_migrator` (DATABASE_URL_MIGRATION),
-- dans une transaction unique. Le runner refuse de rejouer une migration dont le contenu a
-- changé depuis son application : ce fichier est immuable une fois parti en production.
--
-- Réversible : voir migrations/down/0000_socle.down.sql.
--
-- Le RLS, les GRANT et le schéma `amorcage` sont dans 0001_socle_rls.sql. La séparation est
-- volontaire : cette migration crée des structures, la suivante pose la politique de sécurité.
-- On peut relire l'une sans l'autre, et l'audit de sécurité porte sur un fichier unique.
-- =============================================================================================


-- ---------------------------------------------------------------------------------------------
-- 0. Prérequis serveur
--
-- Volontairement PAS de `create extension pgcrypto`. `gen_random_uuid()` fait partie du cœur de
-- PostgreSQL depuis la version 13 ; exiger pgcrypto imposerait un privilège d'installation
-- d'extension que `dfa_migrator` n'a pas (et que les bases managées suisses visées —
-- Infomaniak, Exoscale — n'accordent pas toujours). Moins de privilèges requis en production,
-- même résultat.
-- ---------------------------------------------------------------------------------------------
do $$
begin
  if current_setting('server_version_num')::int < 130000 then
    raise exception
      'PostgreSQL 13 ou supérieur requis (gen_random_uuid() intégré au cœur). Version détectée : %',
      current_setting('server_version');
  end if;
end
$$;


-- ---------------------------------------------------------------------------------------------
-- 1. Énumérations
--
-- Les valeurs sont celles de packages/shared/src/contrats/enums.ts, à l'identique. Un enum PG
-- plutôt qu'un `text` + CHECK : domaine documenté dans le catalogue, stockage compact, et la
-- base refuse la valeur inconnue. Ajouter une valeur plus tard = `alter type ... add value`
-- (transactionnel depuis PG 12) ; en retirer une = cycle expand/contract complet.
-- ---------------------------------------------------------------------------------------------

create type langue as enum ('fr', 'de', 'it');

create type statut_tenant as enum ('actif', 'suspendu', 'resilie');

create type statut_utilisateur as enum ('invite', 'actif', 'suspendu');

create type role_utilisateur as enum (
  'admin', 'direction', 'vendeur', 'receptionnaire', 'chef_atelier', 'technicien', 'magasinier', 'comptable'
);

create type type_evenement_securite as enum (
  'connexion_reussie', 'connexion_echouee', 'deconnexion',
  'compte_verrouille', 'session_expiree', 'session_revoquee'
);


-- ---------------------------------------------------------------------------------------------
-- 2. Fonction de trigger : maintien de `modifie_le`
--
-- Placée en base et non dans l'applicatif : un UPDATE venu d'une migration de données, d'un
-- script de maintenance ou d'un futur module met la colonne à jour de la même façon. Une seule
-- règle, un seul endroit.
--
-- `set search_path = pg_catalog` : la fonction ne résout aucun objet applicatif, on verrouille
-- quand même sa résolution de noms par principe (une fonction sans search_path fixé est un
-- vecteur classique de détournement).
-- ---------------------------------------------------------------------------------------------

create function public.touche_modifie_le() returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.modifie_le := now();
  return new;
end
$$;

comment on function public.touche_modifie_le() is
  'Trigger BEFORE UPDATE : met modifie_le à now(). Appliqué à tenant, site, utilisateur.';


-- ---------------------------------------------------------------------------------------------
-- 3. tenant — l''entreprise cliente, racine de l''isolation
-- ---------------------------------------------------------------------------------------------

create table public.tenant (
  id             uuid          not null default gen_random_uuid(),
  slug           text          not null,
  raison_sociale text          not null,
  numero_tva     text          null,
  pays           char(2)       not null default 'CH',
  langue_defaut  langue        not null default 'fr',
  statut         statut_tenant not null default 'actif',
  cree_le        timestamptz   not null default now(),
  modifie_le     timestamptz   not null default now(),

  constraint tenant_pk primary key (id),

  -- Le slug est l'identifiant humain du tenant (support, URL d'administration). Unicité globale.
  constraint tenant_slug_uk unique (slug),

  -- Contraint en base plutôt qu'espéré de l'applicatif : le slug entre dans des URL et des noms
  -- de fichiers d'export, une majuscule ou un espace qui passe en douce est un bug durable.
  constraint tenant_slug_format_chk
    check (slug = lower(slug) and slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),

  constraint tenant_raison_sociale_non_vide_chk check (length(btrim(raison_sociale)) > 0),

  constraint tenant_pays_format_chk check (pays ~ '^[A-Z]{2}$')
);

comment on table public.tenant is
  'Entreprise cliente. Seule table dont la politique RLS porte sur id (le tenant est son propre tenant).';
comment on column public.tenant.numero_tva is
  'N° TVA suisse (CHE-123.456.789 TVA). Nullable : un garage sous le seuil d''assujettissement n''en a pas.';
comment on column public.tenant.statut is
  'suspendu = accès bloqué, données intactes. resilie = fin de contrat. Aucun de ces états n''efface de données.';

create trigger tenant_touche_modifie_le
  before update on public.tenant
  for each row execute function public.touche_modifie_le();


-- ---------------------------------------------------------------------------------------------
-- 4. site — point de vente / atelier
-- ---------------------------------------------------------------------------------------------

create table public.site (
  id         uuid        not null default gen_random_uuid(),
  tenant_id  uuid        not null,
  code       text        not null,
  nom        text        not null,
  rue        text        null,
  npa        text        null,
  localite   text        null,
  pays       char(2)     not null default 'CH',
  actif      boolean     not null default true,
  cree_le    timestamptz not null default now(),
  modifie_le timestamptz not null default now(),

  constraint site_pk primary key (id),

  -- restrict : supprimer un tenant qui a encore des sites doit échouer bruyamment. La
  -- résiliation passe par tenant.statut, jamais par un DELETE en cascade.
  constraint site_tenant_fk foreign key (tenant_id)
    references public.tenant (id) on delete restrict,

  -- Le code identifie le site pour les humains DANS le tenant : deux garages distincts peuvent
  -- tous deux avoir un site « SION ».
  constraint site_tenant_code_uk unique (tenant_id, code),

  -- Cible des futures FK composites (OR, facture, mouvement de stock → site).
  -- Une FK (tenant_id, site_id) → site(tenant_id, id) rend structurellement impossible le
  -- rattachement d'un enfant au site d'un autre tenant : l'étanchéité devient une propriété du
  -- schéma et non une discipline du code applicatif. C'est le motif le plus important de cette
  -- contrainte en apparence redondante avec la clé primaire.
  constraint site_tenant_id_uk unique (tenant_id, id),

  constraint site_code_format_chk check (code ~ '^[A-Z0-9][A-Z0-9_-]{0,31}$'),
  constraint site_nom_non_vide_chk check (length(btrim(nom)) > 0),
  constraint site_pays_format_chk check (pays ~ '^[A-Z]{2}$')
);

comment on table public.site is
  'Point de vente / atelier d''un tenant. Maille de rattachement de toute donnée opérationnelle.';
comment on column public.site.actif is
  'Désactivation logique : un site fermé conserve tout son historique, il ne se supprime pas.';

-- Pagination par curseur de GET /api/v1/sites, tri stable (cree_le desc, id desc).
-- Indolore sur 3 sites, mais c'est le patron d'index que toutes les tables listables du produit
-- vont reprendre : autant l'établir dès la première.
create index site_tenant_pagination_idx
  on public.site (tenant_id, cree_le desc, id desc);

create trigger site_touche_modifie_le
  before update on public.site
  for each row execute function public.touche_modifie_le();


-- ---------------------------------------------------------------------------------------------
-- 5. utilisateur — compte de connexion
--
-- DÉCISION ASSUMÉE : email unique GLOBALEMENT, pas par tenant. L'écran de connexion ne demande
-- alors qu'un email et un mot de passe, sans sélecteur de société (contrat §4). Contrepartie
-- acceptée : une personne travaillant pour deux tenants a besoin de deux adresses. L'alternative
-- dégraderait le parcours quotidien de tous les utilisateurs pour un cas marginal.
-- ---------------------------------------------------------------------------------------------

create table public.utilisateur (
  id                    uuid               not null default gen_random_uuid(),
  tenant_id             uuid               not null,
  email                 text               not null,
  mot_de_passe_hash     text               not null,
  prenom                text               not null,
  nom                   text               not null,
  langue                langue             not null default 'fr',
  role                  role_utilisateur   not null,
  statut                statut_utilisateur not null default 'invite',
  echecs_connexion      smallint           not null default 0,
  verrouille_jusqu_a    timestamptz        null,
  derniere_connexion_le timestamptz        null,
  cree_le               timestamptz        not null default now(),
  modifie_le            timestamptz        not null default now(),

  constraint utilisateur_pk primary key (id),

  constraint utilisateur_tenant_fk foreign key (tenant_id)
    references public.tenant (id) on delete restrict,

  -- Unicité globale de l'email ET index servant LE chemin de connexion
  -- (amorcage.utilisateur_par_email) : accès index direct, constant que la table porte 100 ou
  -- 100 000 comptes.
  constraint utilisateur_email_uk unique (email),

  -- Cible de la FK composite de `session` : impose qu'une session porte le tenant_id de son
  -- utilisateur. Fournit accessoirement le préfixe (tenant_id, …) pour tout filtrage par tenant,
  -- ce qui rend inutile un index de liste dédié à ce stade.
  constraint utilisateur_tenant_id_uk unique (tenant_id, id),

  constraint utilisateur_email_format_chk
    check (email = lower(email) and email like '%@%' and length(email) between 3 and 320),

  constraint utilisateur_prenom_non_vide_chk check (length(btrim(prenom)) > 0),
  constraint utilisateur_nom_non_vide_chk    check (length(btrim(nom)) > 0),
  constraint utilisateur_echecs_connexion_chk check (echecs_connexion >= 0),
  constraint utilisateur_mot_de_passe_hash_non_vide_chk check (length(mot_de_passe_hash) > 0)
);

comment on table public.utilisateur is
  'Compte de connexion, rattaché à exactement un tenant. Email unique globalement (décision documentée).';
comment on column public.utilisateur.echecs_connexion is
  'Échecs consécutifs, remis à zéro à la première réussite. Persisté en base et non seulement en Redis : le verrouillage d''un compte doit survivre à un redémarrage ou à une purge du cache.';
comment on column public.utilisateur.statut is
  'invite = créé mais mot de passe jamais posé, ne peut pas se connecter.';

create trigger utilisateur_touche_modifie_le
  before update on public.utilisateur
  for each row execute function public.touche_modifie_le();


-- ---------------------------------------------------------------------------------------------
-- 6. session — sessions authentifiées adossées à un cookie opaque
--
-- La base ne stocke QUE l'empreinte SHA-256 du jeton (32 octets). Le jeton en clair n'existe que
-- dans la réponse de connexion et dans le cookie.
--
-- SHA-256 et non Argon2, contrairement aux mots de passe : un jeton porte 256 bits d'entropie
-- CSPRNG, il n'y a rien à deviner, et l'empreinte est vérifiée à CHAQUE requête authentifiée.
-- Argon2 sur ce chemin (19 MiB, 2 passes) serait un déni de service auto-infligé.
--
-- Pas de `modifie_le` ici : `vu_le` joue ce rôle, et c'est la ligne la plus fréquemment mise à
-- jour de toute l'application. On lui épargne un trigger PL/pgSQL par requête.
-- ---------------------------------------------------------------------------------------------

create table public.session (
  id              uuid        not null default gen_random_uuid(),
  tenant_id       uuid        not null,
  utilisateur_id  uuid        not null,
  empreinte_token bytea       not null,
  expire_le       timestamptz not null,
  vu_le           timestamptz not null default now(),
  revoquee_le     timestamptz null,
  ip              inet        null,
  user_agent      text        null,
  cree_le         timestamptz not null default now(),

  constraint session_pk primary key (id),

  constraint session_tenant_fk foreign key (tenant_id)
    references public.tenant (id) on delete restrict,

  -- FK COMPOSITE, et non (utilisateur_id) → utilisateur(id).
  -- Elle impose que le tenant_id de la session soit celui de son utilisateur : la base refuse
  -- physiquement une session « recollée » au mauvais tenant. C'est le garde-fou d'intégrité le
  -- plus important de cette table, et il ne dépend d'aucune ligne de code applicatif.
  -- cascade : supprimer un compte supprime ses sessions, jamais l'inverse.
  constraint session_utilisateur_fk foreign key (tenant_id, utilisateur_id)
    references public.utilisateur (tenant_id, id) on delete cascade,

  constraint session_empreinte_token_uk unique (empreinte_token),

  -- 32 octets exactement : une empreinte tronquée, ou un jeton stocké en clair par erreur, ne
  -- passe pas l'insertion.
  constraint session_empreinte_token_taille_chk check (octet_length(empreinte_token) = 32),

  constraint session_expire_le_coherent_chk check (expire_le > cree_le)
);

comment on table public.session is
  'Sessions authentifiées. Ne contient que l''empreinte SHA-256 du jeton, jamais le jeton.';
comment on column public.session.vu_le is
  'Dernière activité. Sert l''expiration glissante (SESSION_INACTIVITE_MINUTES), qui protège les tablettes d''atelier partagées.';

-- Révocation en masse (« déconnecter toutes les sessions de cet utilisateur » après un
-- changement de mot de passe ou une suspension) et écran « mes sessions actives ».
create index session_tenant_utilisateur_idx
  on public.session (tenant_id, utilisateur_id);

-- Purge périodique (`delete from session where expire_le < now()`). Sans cet index, le job de
-- purge scanne toute la table ; c'est la seule table du socle qu'on nettoie réellement et elle
-- grossit d'autant de lignes qu'il y a de connexions.
create index session_expire_le_idx
  on public.session (expire_le);


-- ---------------------------------------------------------------------------------------------
-- 7. journal_securite — piste d'audit de l'authentification
--
-- Table append-only : en 0001, `dfa_app` ne reçoit que SELECT et INSERT. Un journal modifiable
-- depuis l'application ne prouve rien le jour où il faut expliquer à un client ce qui s'est
-- passé sur son compte.
--
-- tenant_id NULLABLE : une tentative sur un email inconnu doit être tracée alors qu'aucun tenant
-- n'est identifiable. Conséquence RLS assumée — `tenant_id = tenant_courant()` vaut NULL donc
-- faux pour ces lignes : elles sont invisibles depuis l'application, ce qui est correct puisque
-- elles n'appartiennent à personne.
-- ---------------------------------------------------------------------------------------------

create table public.journal_securite (
  id             uuid                    not null default gen_random_uuid(),
  tenant_id      uuid                    null,
  type           type_evenement_securite not null,
  utilisateur_id uuid                    null,
  email_tente    text                    null,
  ip             inet                    null,
  user_agent     text                    null,
  details        jsonb                   null,
  cree_le        timestamptz             not null default now(),

  constraint journal_securite_pk primary key (id),

  -- restrict : un tenant ne se supprime pas, son journal non plus.
  constraint journal_securite_tenant_fk foreign key (tenant_id)
    references public.tenant (id) on delete restrict,

  -- set null (et non restrict) : le journal ne doit jamais bloquer une opération d'exploitation
  -- légitime sur les comptes. L'identité humaine reste lisible via email_tente, qui est une
  -- copie et non une référence.
  constraint journal_securite_utilisateur_fk foreign key (utilisateur_id)
    references public.utilisateur (id) on delete set null,

  constraint journal_securite_email_tente_format_chk
    check (email_tente is null or length(email_tente) between 1 and 320)
);

comment on table public.journal_securite is
  'Piste d''audit de l''authentification. Append-only (dfa_app n''a ni UPDATE ni DELETE). tenant_id nullable pour tracer les tentatives sur email inconnu.';
comment on column public.journal_securite.details is
  'Contexte variable selon le type d''événement. Ne doit JAMAIS contenir de mot de passe, de jeton ni d''empreinte.';

-- Consultation paginée du journal d'un tenant (écran sécurité côté admin), même tri stable que
-- partout ailleurs.
create index journal_securite_tenant_pagination_idx
  on public.journal_securite (tenant_id, cree_le desc, id desc);

-- Purge par rétention (`delete ... where cree_le < now() - interval '12 months'`).
-- C'est la table la plus volumineuse du socle : 200 tenants × ~50 comptes × quelques connexions
-- par jour place l'ordre de grandeur à la dizaine de millions de lignes par an. L'index
-- précédent ne sert pas la purge, car il ne couvre pas les lignes à tenant_id NULL — exactement
-- celles que génère une campagne de force brute.
create index journal_securite_cree_le_idx
  on public.journal_securite (cree_le);

-- Enquête : « pourquoi ce compte est-il verrouillé », « cet email est-il ciblé ».
-- Partiel : seules les lignes portant un email tenté ont un intérêt ici, et ce sont justement
-- celles dont le tenant_id est le plus souvent NULL.
create index journal_securite_email_tente_idx
  on public.journal_securite (email_tente, cree_le desc)
  where email_tente is not null;
