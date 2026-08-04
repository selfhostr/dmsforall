-- =============================================================================================
-- 0039_poste_atelier_compte_de_service.sql — identité durable de la borne d'atelier.
--
-- CONTEXTE : `docs/specification-pointage-borne.md` §0 relève deux trous d'architecture qui
-- bloquent le mode « borne partagée » du pointage :
--   §0.1  aucune affectation utilisateur↔site n'existe (`GET /auth/moi` rend TOUS les sites du
--         tenant, identiques pour tout compte) ;
--   §0.2  « la session de la borne (compte de service scopé au site, rôle poste atelier) » est
--         une PHRASE, pas un mécanisme : `role_utilisateur` ne porte aucune valeur `poste_atelier`.
--
-- CE QUE CETTE MIGRATION TRANCHE (raisonnement complet dans le rapport d'expert-auth) :
--
--  A. PAS de table d'affectation générale `utilisateur_site`. Elle toucherait l'auth de tout le
--     produit (filtrage de `session.sites`, donc de tous les sélecteurs de site des écrans
--     existants), exigerait un backfill « chaque utilisateur × chaque site de son tenant » qui
--     n'exprimerait RIEN le jour de son écriture, et n'a aucun consommateur : pas un seul contrôle
--     d'autorisation du produit n'est scopé par site aujourd'hui (la matrice est rôle × action,
--     l'étanchéité est tenant). Une table qui ne gouverne rien mais qu'un futur lecteur croira
--     gouvernante est un piège, pas une fondation.
--
--  B. À la place, un rattachement de compte ÉTROIT et fail-closed : `utilisateur.site_id`,
--     obligatoire pour un compte de service, INTERDIT pour un compte de personne
--     (`utilisateur_site_compte_de_service_chk`, biconditionnelle). Aucune personne ne change de
--     périmètre, aucun écran ne change de comportement ; seule la borne gagne une portée.
--     Relâcher cette contrainte plus tard (si une vraie affectation devient nécessaire) est un
--     simple `drop constraint` + politique nouvelle, jamais une reprise de données destructive.
--
--  C. La borne s'authentifie comme un `utilisateur` ORDINAIRE (mot de passe Argon2id, cookie de
--     session, `GardeSession`, journal de sécurité, révocation) avec un rôle dédié
--     `poste_atelier`. Décisif contre un « jeton d'appareil » séparé : TOUTES les colonnes
--     `cree_par_utilisateur_id` du produit (pointage inclus) sont des FK vers `public.utilisateur`
--     — un acteur qui n'est pas une ligne de cette table ne peut RIEN écrire d'auditable.
--
-- ENUM RECRÉÉ, PAS `ALTER TYPE ... ADD VALUE` — divergence assumée avec 0010/0016/0022/0023/0025/
-- 0027/0030/0031/0033. Ces migrations élargissent `entite_auditee`, un catalogue d'audit inerte :
-- la valeur résiduelle après un `down` n'a aucun effet observable, et les auteurs ont accepté
-- l'exception documentée dans `scripts/verifier-reversibilite-migrations.sh`. `role_utilisateur`
-- n'est PAS ce cas : la recréation complète est possible ici parce que le type n'a que TROIS
-- dépendants dans tout le schéma (`utilisateur.role`, et le type de retour des deux fonctions
-- `amorcage.utilisateur_par_email` / `amorcage.session_par_empreinte`) — dont les deux fonctions
-- que cette migration doit de toute façon recréer (`session_par_empreinte` gagne `site_id`).
-- Le surcoût est donc quasi nul, et le down redevient EXACT : aucune nouvelle exception à ajouter
-- à la liste du script de réversibilité, qui reste stricte sur cette migration.
--
-- VERROUS : `alter table ... alter column role type` réécrit `public.utilisateur` sous ACCESS
-- EXCLUSIVE. La table compte quelques dizaines de lignes par tenant (comptes d'un garage) —
-- opération instantanée. À réévaluer seulement si le produit dépassait un jour l'ordre de
-- grandeur du million de comptes, ce que son modèle métier exclut.
-- =============================================================================================


-- ---------------------------------------------------------------------------------------------
-- 1. Les deux fonctions d'amorçage qui dépendent de `role_utilisateur` sont retirées.
--
-- Il n'existe AUCUN moyen de changer le type de retour d'une fonction par `create or replace` :
-- un `drop` + `create` est obligatoire. Elles sont recréées à l'identique en §5 (à l'ajout de
-- `site_id` près pour `session_par_empreinte`), y compris commentaires et privilèges.
-- ---------------------------------------------------------------------------------------------

drop function amorcage.utilisateur_par_email(text);
drop function amorcage.session_par_empreinte(bytea);


-- ---------------------------------------------------------------------------------------------
-- 2. `role_utilisateur` recréé avec `poste_atelier` en dernière position.
--
-- L'ordre reproduit `packages/shared/src/contrats/enums.ts` (ROLES_UTILISATEUR) à l'identique —
-- c'est ce tableau que `apps/api/src/db/schema/enums.ts` passe à `pgEnum()`.
-- ---------------------------------------------------------------------------------------------

alter type public.role_utilisateur rename to role_utilisateur_avant_0039;

create type public.role_utilisateur as enum (
  'admin', 'direction', 'vendeur', 'receptionnaire', 'chef_atelier', 'technicien', 'magasinier', 'comptable', 'poste_atelier'
);

alter table public.utilisateur
  alter column role type public.role_utilisateur
  using role::text::public.role_utilisateur;

drop type public.role_utilisateur_avant_0039;


-- ---------------------------------------------------------------------------------------------
-- 3. `utilisateur.site_id` — rattachement de compte, réservé aux comptes de service.
--
-- FK COMPOSITE avec le tenant (règle n°1 du projet) : rattacher une borne au site d'un AUTRE
-- tenant devient structurellement impossible, pas seulement improbable.
--
-- `on delete restrict` : supprimer un site sur lequel une borne est déclarée doit échouer
-- bruyamment. Un site se désactive (`site.actif = false`), il ne se supprime pas.
-- ---------------------------------------------------------------------------------------------

alter table public.utilisateur
  add column site_id uuid;

comment on column public.utilisateur.site_id is
  'Site de rattachement du COMPTE (0039). NOT NULL pour un compte de service (role = ''poste_atelier''), '
  'obligatoirement NULL pour un compte de personne — biconditionnelle imposée par '
  'utilisateur_site_compte_de_service_chk. C''est la SOURCE du site de la borne d''atelier : il est '
  'résolu depuis la session (PrincipalAuthentifie.siteId), jamais depuis un paramètre de requête, '
  'même doctrine que le tenant. N''est PAS une affectation utilisateur↔site généralisée : aucune '
  'autorisation du produit n''est scopée par site, et aucun compte de personne n''en porte.';

alter table public.utilisateur
  add constraint utilisateur_fk_site
  foreign key (tenant_id, site_id)
  references public.site (tenant_id, id) on delete restrict;

-- Biconditionnelle, pas une simple implication : elle interdit AUSSI de rattacher un compte de
-- personne à un site, ce qui donnerait l'illusion d'une affectation générale qui n'existe pas et
-- que rien n'appliquerait (voir §A de l'en-tête).
alter table public.utilisateur
  add constraint utilisateur_site_compte_de_service_chk
  check ((role = 'poste_atelier') = (site_id is not null));

-- Sert la vérification du `on delete restrict` ci-dessus (sans index, chaque suppression de site
-- provoque un parcours complet de `utilisateur`) et la question « quelles bornes sont déclarées
-- sur ce site ? ». Partiel : l'écrasante majorité des comptes sont des personnes, `site_id` NULL.
create index utilisateur_site_idx on public.utilisateur (tenant_id, site_id)
  where site_id is not null;


-- ---------------------------------------------------------------------------------------------
-- 4. Garde-fou de cohérence des données (avant recréation des fonctions).
-- ---------------------------------------------------------------------------------------------

do $$
declare
  n integer;
begin
  select count(*) into n
    from public.utilisateur
   where (role = 'poste_atelier') <> (site_id is not null);
  if n <> 0 then
    raise exception
      '0039 : % compte(s) violent la biconditionnelle role=poste_atelier <=> site_id renseigne.', n;
  end if;
end
$$;


-- ---------------------------------------------------------------------------------------------
-- 5. Fonctions d'amorçage recréées.
--
-- `utilisateur_par_email` : texte STRICTEMENT identique à 0001 §5.1 — elle n'est retirée en §1 que
-- parce qu'elle dépend du type recréé, rien de son contrat ne change. `role` y suffit à décider de
-- la durée de session (voir ServiceSessionImpl.ouvrir) ; elle n'a pas besoin de `site_id`.
--
-- `session_par_empreinte` : identique à 0001 §5.2 PLUS `site_id`, ajouté EN DERNIÈRE POSITION.
-- C'est le seul chemin par lequel le serveur apprend le site d'une borne — le résoudre ici, à
-- CHAQUE requête, à partir du seul cookie, est ce qui rend impossible qu'un client le déclare.
-- ---------------------------------------------------------------------------------------------

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
  statut_tenant      statut_tenant,
  site_id            uuid
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
         t.statut,
         u.site_id
    from public.session s
    join public.utilisateur u on u.id = s.utilisateur_id and u.tenant_id = s.tenant_id
    join public.tenant t      on t.id = s.tenant_id
   where s.empreinte_token = p_empreinte
   limit 1
$$;

comment on function amorcage.session_par_empreinte(bytea) is
  'Résolution d''une session par empreinte SHA-256. Ne filtre ni expiration ni révocation : ServiceSession doit distinguer session absente et session expirée.';


-- ---------------------------------------------------------------------------------------------
-- 6. Privilèges des deux fonctions recréées.
--
-- OBLIGATOIRE, PAS COSMÉTIQUE : une fonction fraîchement créée est EXECUTE pour PUBLIC par
-- défaut. Sans ces deux lignes, deux fonctions SECURITY DEFINER qui lisent des hachages de mot de
-- passe et des sessions redeviendraient exécutables par tout rôle de l'instance — exactement le
-- risque que 0001 §5.7 documente.
-- ---------------------------------------------------------------------------------------------

revoke all on function amorcage.utilisateur_par_email(text)  from public;
revoke all on function amorcage.session_par_empreinte(bytea) from public;

grant execute on function amorcage.utilisateur_par_email(text)  to dfa_app;
grant execute on function amorcage.session_par_empreinte(bytea) to dfa_app;


-- ---------------------------------------------------------------------------------------------
-- 7. Assertions de fin de migration.
-- ---------------------------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_enum e
      join pg_catalog.pg_type t on t.oid = e.enumtypid
     where t.typname = 'role_utilisateur' and e.enumlabel = 'poste_atelier'
  ) then
    raise exception '0039 : la valeur poste_atelier est absente du type role_utilisateur.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conname = 'utilisateur_site_compte_de_service_chk'
       and conrelid = 'public.utilisateur'::regclass
  ) then
    raise exception '0039 : contrainte utilisateur_site_compte_de_service_chk absente.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conname = 'utilisateur_fk_site' and conrelid = 'public.utilisateur'::regclass
  ) then
    raise exception '0039 : contrainte utilisateur_fk_site absente.';
  end if;

  if has_function_privilege('public', 'amorcage.session_par_empreinte(bytea)', 'execute') then
    raise exception '0039 : amorcage.session_par_empreinte est restée exécutable par PUBLIC.';
  end if;

  if has_function_privilege('public', 'amorcage.utilisateur_par_email(text)', 'execute') then
    raise exception '0039 : amorcage.utilisateur_par_email est restée exécutable par PUBLIC.';
  end if;
end
$$;
