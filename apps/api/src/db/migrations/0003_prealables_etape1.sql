-- =============================================================================================
-- 0003_prealables_etape1.sql — préalables base de l'étape 1 (atelier + clients)
--
-- Cette migration ne crée AUCUNE table métier. Elle pose les cinq briques dont toutes les
-- migrations métier qui suivent (0004→0007) dépendent, et que chacune d'elles supposerait
-- silencieusement présentes :
--
--   1. les extensions PostgreSQL (btree_gist, btree_gin, pg_trgm, unaccent) ;
--   2. `normaliser_recherche(text)`, la fonction d'indexation de la recherche comptoir ;
--   3. les enums transverses (audit + statuts des deux machines à états du lot 1) ;
--   4. `transition_autorisee`, référentiel produit des transitions légales, et son contrôle
--      d'intégrité ;
--   5. `verifier_transition()`, le garde-fou générique en base, et la famille SQLSTATE `ZDFA*`.
--
-- NUMÉROTATION — le plan d'exécution du lot 1 nomme cette migration « 0002 ». Le numéro 0002 est
-- déjà pris par `0002_posture_declaree.sql`, appliquée et immuable. Toute la série du lot 1 est
-- donc décalée d'une unité : préalables = 0003, transverse (audit/idempotence) = 0004, métier =
-- 0005→0008.
--
-- CE QUI N'EST PAS ICI, ET POURQUOI — le point (c) du plan, `alter default privileges … revoke
-- delete on tables from dfa_app`, est DÉJÀ POSÉ par `0002_posture_declaree.sql` §1. Le rejouer
-- n'aurait aucun effet et laisserait croire à un lecteur futur que la règle est née ici. Le
-- triple dispositif du plan §5.2 est donc complet : défaut retiré (0002), `revoke delete`
-- explicite dans chaque migration métier (0005→0008), refus de démarrage si l'un des deux
-- manque (`verifierPostureRls()`, règle R2).
--
-- Réversible : migrations/down/0003_prealables_etape1.down.sql.
-- =============================================================================================


-- ---------------------------------------------------------------------------------------------
-- 1. Extensions
--
-- Toutes TRUSTED depuis PostgreSQL 13 : `dfa_migrator` les installe sans être superuser, du seul
-- fait qu'il détient CREATE sur la base (docker/postgres/init/01-roles.sql). Vérifié en exécution
-- sur PostgreSQL 16.14 avec le rôle `dfa_migrator` avant d'écrire cette migration — ce n'est pas
-- une déduction depuis la documentation.
--
--   btree_gist : contraintes EXCLUDE mêlant égalité (uuid, text) et chevauchement (daterange,
--                tstzrange). Sans elle, « une seule plaque active par véhicule » et « un seul
--                détenteur à la fois » retombent en applicatif, donc faux sous concurrence.
--   pg_trgm    : recherche comptoir sur fragment (« 123456 » doit trouver « VD 123'456 »).
--   btree_gin  : index GIN COMPOSITE (tenant_id, expression gin_trgm_ops). Sans elle, l'index
--                trigram perd son préfixe tenant et scanne les plaques de tous les tenants avant
--                que le RLS ne filtre — à 200 tenants, c'est la différence entre 1 ms et 200 ms.
--   unaccent   : « Müller » doit trouver « Muller », « Rossì » doit trouver « Rossi ».
--
-- `if not exists` : ces extensions peuvent préexister sur une base restaurée ou fournie par
-- l'hébergeur. Leur présence n'est jamais un échec.
-- ---------------------------------------------------------------------------------------------

create extension if not exists btree_gist;
create extension if not exists btree_gin;
create extension if not exists pg_trgm;
create extension if not exists unaccent;


-- ---------------------------------------------------------------------------------------------
-- 2. `normaliser_recherche(text)` — la clé de la recherche comptoir
--
-- Une seule règle de normalisation, en base, utilisée à la fois dans les INDEX D'EXPRESSION et
-- dans les requêtes du service. Aucune colonne « normalisée » dupliquée : une colonne dupliquée
-- se désynchronise (un UPDATE qui oublie de la recalculer) et pèse sur chaque écriture, alors
-- qu'un index d'expression ne peut pas mentir. Changer la règle = un REINDEX, pas une réécriture
-- de table.
--
-- Ce qu'elle fait : minuscules, suppression des accents, puis suppression des séparateurs
-- (espaces, apostrophes typographiques comprises, tirets, points, barres, esperluette…).
-- Vérifié en exécution :
--     'VD 123''456'                  → 'vd123456'
--     'Müller-Rossì'                 → 'mullerrossi'
--     'O''Neill'                     → 'oneill'
--     'Garage Dupont & Fils S.à r.l.'→ 'garagedupontfilssarl'
-- Ces valeurs sont réassertées en §7 : si le dictionnaire unaccent ou la classe de caractères
-- change, la migration échoue sur une base neuve au lieu de produire des index incohérents.
--
-- LE MENSONGE ASSUMÉ — `IMMUTABLE` alors que `unaccent()` ne l'est pas.
-- Mesuré sur cette base (PostgreSQL 16, extension unaccent 1.1) : les DEUX surcharges
-- `unaccent(text)` et `unaccent(regdictionary, text)` sont déclarées STABLE (`provolatile = 's'`).
-- L'immutabilité de cette fonction est donc une déclaration de l'auteur, pas une propriété
-- démontrée — c'est la recette officielle de la documentation PostgreSQL pour indexer unaccent,
-- et elle a un prix, à lire avant d'y toucher :
--   >>> MODIFIER LE DICTIONNAIRE `unaccent` (ou la classe de caractères ci-dessous) IMPOSE UN
--   >>> `REINDEX` DE TOUS LES INDEX QUI APPELLENT CETTE FONCTION. Sans REINDEX, les index
--   >>> contiennent l'ancienne normalisation et les recherches renvoient silencieusement des
--   >>> résultats faux — aucune erreur, aucun avertissement.
--
-- La surcharge à DEUX arguments est utilisée volontairement : elle épingle le dictionnaire par
-- son nom qualifié au lieu de le résoudre via la configuration de recherche plein texte
-- courante. Sans cela, la valeur indexée dépendrait de `default_text_search_config`, c'est-à-dire
-- d'un paramètre de session — la pire dépendance possible pour une expression indexée.
--
-- STRICT : NULL entre, NULL sort. Les index et les requêtes enveloppent donc l'argument dans un
-- `coalesce(...)`, ce qui rend le traitement du NULL visible au point d'appel plutôt que caché
-- ici.
-- ---------------------------------------------------------------------------------------------

create function public.normaliser_recherche(valeur text) returns text
language sql
immutable
strict
parallel safe
set search_path = pg_catalog, public
as $fn$
  select regexp_replace(
           lower(public.unaccent('public.unaccent'::regdictionary, valeur)),
           '[ \t\n\r''’‘´`._,;:/\\()&+–—-]+',
           '',
           'g')
$fn$;

comment on function public.normaliser_recherche(text) is
  'Normalisation de recherche : minuscules, sans accents, sans séparateurs. IMMUTABLE par '
  'déclaration et non par démonstration (unaccent est STABLE) : toute modification du '
  'dictionnaire unaccent ou de la classe de caractères impose un REINDEX des index qui '
  'l''appellent. Voir 0003_prealables_etape1.sql §2.';

-- Convention du socle (0001 §2) : une fonction n'est exécutable que par qui en a besoin.
revoke all     on function public.normaliser_recherche(text) from public;
grant  execute on function public.normaliser_recherche(text) to   dfa_app;


-- ---------------------------------------------------------------------------------------------
-- 3. Enums transverses
--
-- QUATRE enums seulement, et pas les vingt-cinq du lot 1 : ceux dont CETTE migration a besoin.
-- Les autres appartiennent aux migrations métier, au plus près de la table qui les porte.
--
--   entite_auditee / action_auditee — utilisés ici par `transition_autorisee` et en 0004 par
--     `audit_atelier`. Ils sont transverses par nature : les créer dans une migration métier
--     ferait dépendre l'audit du module qui se trouve avoir été écrit en premier.
--   statut_ordre_reparation / statut_ligne_or — les deux machines à états du lot 1. Ils sont
--     créés ICI et non en 0005 parce que le contenu de `transition_autorisee` chargé en §5 est
--     VÉRIFIÉ contre eux (§4.3). Charger 27 transitions en texte libre sans que rien ne
--     confronte ces textes aux valeurs réelles reviendrait à écrire le référentiel qui commande
--     toute la machine à états sans filet : une faute de frappe (« terminé » pour « termine »)
--     ne se manifesterait qu'au premier garage qui tente la transition, en production.
--
-- >>> POUR LES MIGRATIONS MÉTIER QUI SUIVENT : ces quatre types EXISTENT DÉJÀ. Un
-- >>> `create type public.statut_ordre_reparation …` en 0005 échouerait. <<<
--
-- Ordre des valeurs = ordre du cycle de vie, jamais alphabétique : `order by statut` doit
-- classer un OR de « planifie » à « cloture », et l'ordre d'un enum est figé à sa création
-- (le changer plus tard impose de recréer le type, donc de réécrire toutes les tables qui
-- l'utilisent).
-- ---------------------------------------------------------------------------------------------

create type public.entite_auditee as enum (
  'ordre_reparation',
  'ligne_or',
  'devis_complementaire',
  'pointage',
  'vehicule_detention',
  'vehicule_kilometrage',
  'client',
  'rendez_vous',
  'pret_courtoisie'
);

create type public.action_auditee as enum (
  'creation',
  'modification',
  'transition',
  'annulation',
  'fusion'
);

create type public.statut_ordre_reparation as enum (
  'planifie',
  'ouvert',
  'en_cours',
  'controle',
  'termine',
  'facture',
  'restitue',
  'cloture',
  'annule'
);

create type public.statut_ligne_or as enum (
  'proposee',
  'a_valider',
  'validee',
  'en_cours',
  'realisee',
  'facturee',
  'refusee',
  'annulee'
);


-- ---------------------------------------------------------------------------------------------
-- 4. `transition_autorisee` — source unique de vérité des machines à états
--
-- Une ligne par transition LÉGALE. Ce qui n'y figure pas est interdit : la table est une liste
-- blanche, pas une liste noire. Trois consommateurs, un seul contenu :
--   - le trigger `verifier_transition()` (§6), qui refuse en base ce qui n'y figure pas ;
--   - `GET /referentiel/transitions`, qui permet à l'UI de griser les boutons impossibles sans
--     réimplémenter la règle en TypeScript ;
--   - `actionsDisponibles` sur la lecture d'un OR.
-- Trois endroits qui, sans cette table, contiendraient trois copies de la même règle — et
-- divergeraient à la première évolution.
--
-- PAS DE `tenant_id`, ET C'EST VOULU : les transitions légales sont une propriété du PRODUIT, pas
-- du garage. Un garage qui pourrait s'autoriser `facture → en_cours` casserait l'immuabilité de
-- la chaîne documentaire pour lui seul, et le premier export fiduciaire s'en apercevrait trop
-- tard. La table est donc déclarée `[dfa:referentiel-partage]` et l'application n'y a que SELECT
-- — vérifié au démarrage de l'API (règle R1 de `verifierPostureRls()`), ce qui fait que la
-- déclaration ci-dessous n'ouvre rien par elle-même.
-- ---------------------------------------------------------------------------------------------

create table public.transition_autorisee (
  entite        public.entite_auditee not null,
  statut_depuis text                  not null,
  statut_vers   text                  not null,

  -- Le service exige un motif non vide sur la commande correspondante, et l'audit l'enregistre.
  -- Porté par le référentiel plutôt que codé en dur : « quelles transitions exigent un motif »
  -- est exactement le même genre de règle que « quelles transitions existent ».
  exige_motif   boolean               not null default false,

  constraint transition_autorisee_pk primary key (entite, statut_depuis, statut_vers),

  -- Une transition d'un état vers lui-même n'est pas une transition. Le trigger ne la verrait
  -- jamais (il ne se déclenche que si le statut CHANGE) : une telle ligne serait donc morte, et
  -- une ligne morte dans un référentiel finit par être lue comme une autorisation.
  constraint transition_autorisee_pas_de_boucle check (statut_depuis <> statut_vers),

  constraint transition_autorisee_statuts_non_vides
    check (length(btrim(statut_depuis)) > 0 and length(btrim(statut_vers)) > 0)
);

comment on table public.transition_autorisee is
  'Transitions d''états autorisées, par entité. Liste blanche : ce qui n''y figure pas est '
  'refusé par le trigger verifier_transition(). [dfa:referentiel-partage] Les machines à états '
  'sont une propriété du produit et non du garage — un tenant qui pourrait s''autoriser '
  '« facture → en_cours » casserait l''immuabilité de la chaîne documentaire. Alimentée '
  'exclusivement par migration ; dfa_app n''y a que SELECT.';

comment on column public.transition_autorisee.statut_depuis is
  'Valeur textuelle d''un label du type public.statut_<entite>. Le type exact varie selon '
  'l''entité, d''où le stockage en text — l''intégrité est assurée par le trigger '
  'transition_autorisee_valide_contenu, pas par une contrainte de type.';


-- --- 4.1 Privilèges ---------------------------------------------------------------------------
-- INDISPENSABLE, et pas seulement par prudence : les privilèges par défaut posés en 0001 §3
-- accordent SELECT, INSERT et UPDATE à dfa_app sur toute table créée par dfa_migrator. Sans le
-- `revoke all` ci-dessous, ce référentiel naîtrait INSCRIPTIBLE par l'application — c'est-à-dire
-- qu'un tenant pourrait s'ajouter une transition et l'ouvrir à tous les autres. L'API refuserait
-- d'ailleurs de démarrer (règle R1), ce qui est le comportement voulu : la faute est bruyante.

revoke all    on public.transition_autorisee from dfa_app;
grant  select on public.transition_autorisee to   dfa_app;

-- --- 4.2 RLS ----------------------------------------------------------------------------------
-- `verifierPostureRls()` exige `relrowsecurity` sur TOUTE table de `public`, sans exception à
-- maintenir. Une table sans `tenant_id` n'offre aucune colonne sur laquelle discriminer :
-- `using (true)` est la seule politique écrivable, et elle est inoffensive ici parce que le seul
-- privilège accordé est SELECT sur un contenu identique pour tous les tenants.
--
-- Ni WITH CHECK ni FORCE, volontairement : il n'y a aucune écriture applicative à contrôler, et
-- FORCE empêcherait dfa_migrator d'alimenter le référentiel dans cette migration même.

alter table public.transition_autorisee enable row level security;

create policy transition_autorisee_lecture on public.transition_autorisee
  for select to dfa_app
  using (true);

-- --- 4.3 Contrôle d'intégrité du contenu ------------------------------------------------------
-- `statut_depuis`/`statut_vers` sont du texte : une seule table doit décrire des machines dont
-- les statuts appartiennent à des types différents (statut_ordre_reparation, statut_ligne_or,
-- et demain statut_rendez_vous, statut_pointage…). Aucune FK, aucun CHECK ne peut donc valider
-- ces colonnes : `enum_range()` est STABLE, ce qu'un CHECK n'accepte pas.
--
-- Sans contrôle, une faute de frappe dans une migration produit une transition qui n'existera
-- jamais — le trigger refusera la transition réelle, et le diagnostic sera « le code est faux »
-- alors que c'est le référentiel qui l'est. Ce trigger reporte la faute au bon endroit :
-- l'INSERT de la migration fautive, qui échoue immédiatement.
--
-- La convention exploitée est `statut_<entite>` : entite « ordre_reparation » ⇒ type
-- « public.statut_ordre_reparation ». Elle vaut pour les cinq machines du produit. Une entité
-- sans type de statut (vehicule_detention, vehicule_kilometrage…) n'a pas de transition à
-- déclarer, et se voit refuser l'insertion avec un message qui le dit.
--
-- Ce trigger ne s'exécute jamais en production courante : dfa_app n'a pas INSERT sur cette
-- table. Il ne coûte donc rien et ne protège qu'une chose — les migrations.

create function public.transition_autorisee_valide_contenu() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $fn$
declare
  nom_type  text;
  type_oid  oid;
begin
  nom_type := 'public.statut_' || new.entite::text;
  type_oid := to_regtype(nom_type)::oid;

  if type_oid is null then
    raise exception
      'transition_autorisee : aucun type % pour l''entité « % ». Une entité sans type de statut n''a pas de machine à états à déclarer.',
      nom_type, new.entite;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_enum e
     where e.enumtypid = type_oid and e.enumlabel = new.statut_depuis
  ) then
    raise exception
      'transition_autorisee : « % » n''est pas une valeur de %. Valeurs admises : %.',
      new.statut_depuis, nom_type,
      (select string_agg(e.enumlabel, ', ' order by e.enumsortorder)
         from pg_catalog.pg_enum e where e.enumtypid = type_oid);
  end if;

  if not exists (
    select 1 from pg_catalog.pg_enum e
     where e.enumtypid = type_oid and e.enumlabel = new.statut_vers
  ) then
    raise exception
      'transition_autorisee : « % » n''est pas une valeur de %. Valeurs admises : %.',
      new.statut_vers, nom_type,
      (select string_agg(e.enumlabel, ', ' order by e.enumsortorder)
         from pg_catalog.pg_enum e where e.enumtypid = type_oid);
  end if;

  return new;
end
$fn$;

revoke all on function public.transition_autorisee_valide_contenu() from public;

create trigger transition_autorisee_valide_contenu
  before insert or update on public.transition_autorisee
  for each row execute function public.transition_autorisee_valide_contenu();


-- ---------------------------------------------------------------------------------------------
-- 5. Contenu du référentiel — les deux machines du lot 1
--
-- Les machines `rendez_vous`, `pointage` et `pret_courtoisie` ne sont PAS chargées : leurs
-- tables n'existent pas au lot 1 (delta Δ4 du plan d'exécution) et leurs types de statut non
-- plus. Le contrôle §4.3 refuserait d'ailleurs leurs lignes, ce qui est exactement le
-- comportement voulu : le référentiel ne décrit que des machines qui existent.
-- ---------------------------------------------------------------------------------------------

-- --- 5.1 Ordre de réparation (16 transitions) -------------------------------------------------
-- Machine issue de la spécification §5.1, réduite par la décision A-03 : les attentes (accord,
-- pièces, sous-traitant) sont des DRAPEAUX portés par les lignes, pas des états de l'OR. Un OR
-- peut attendre une pièce ET un accord en même temps — ce qu'un état unique ne sait pas dire.
-- Le type `statut_ordre_reparation` ne contient donc aucun `attente_*`, et les transitions T-05
-- à T-10 de la spec n'existent plus.
--
-- Les gardes CONDITIONNELLES (I-08 « aucune ligne à valider », I-09 « aucun pointage ouvert »,
-- I-10, RM-51 « kilométrage relevé ») ne sont PAS dans cette table : elles dépendent de l'état
-- d'autres lignes et appartiennent au service. Cette table dit ce qui est structurellement
-- possible ; le service dit ce qui est possible MAINTENANT. C'est la distinction assumée par le
-- contrat d'`actionsDisponibles` : une action listée peut néanmoins être refusée, avec
-- `blocages` et `actionsProposees` à l'appui.
--
-- États terminaux, sans aucune sortie : `cloture` et `annule` (I-05, I-06).
-- Interdits par simple absence, et c'est là tout l'intérêt d'une liste blanche : I-01
-- (ouvert→facture), I-02 (facture→en_cours), I-03 (facture→annule), I-04 (restitue→*),
-- I-07 (planifie→en_cours), I-12 (ouvert→restitue).

insert into public.transition_autorisee (entite, statut_depuis, statut_vers, exige_motif) values
  -- Réception effective du véhicule (T-03) : kilométrage relevé, demandes confirmées.
  ('ordre_reparation', 'planifie', 'ouvert',   false),
  -- Annulation avant tout travail (T-20) : aucun pointage, aucune pièce sortie, aucune facture.
  -- Motif exigé : un OR annulé sans raison est indistinguable d'une erreur de saisie, et RM-62
  -- en fait une décision qui se justifie.
  ('ordre_reparation', 'planifie', 'annule',   true),

  ('ordre_reparation', 'ouvert',   'en_cours', false),  -- T-04 : premier pointage ou déclenchement manuel
  ('ordre_reparation', 'ouvert',   'controle', false),  -- travaux menés sans pointage, contrôle qualité exigé
  ('ordre_reparation', 'ouvert',   'termine',  false),  -- T-14 : contrôle qualité non obligatoire (P-08)
  ('ordre_reparation', 'ouvert',   'annule',   true),   -- T-20

  ('ordre_reparation', 'en_cours', 'controle', false),  -- T-11
  ('ordre_reparation', 'en_cours', 'termine',  false),  -- T-14
  -- Retour en arrière : l'atelier s'est déclaré en cours à tort (mauvais OR, mauvais véhicule).
  -- Motif exigé au même titre que les autres régressions — un état qui recule sans trace rend la
  -- durée de passage à l'atelier ininterprétable.
  ('ordre_reparation', 'en_cours', 'ouvert',   true),

  ('ordre_reparation', 'controle', 'en_cours', true),   -- T-12 : contrôle non conforme, motif obligatoire (spec)
  ('ordre_reparation', 'controle', 'termine',  false),  -- T-13 : check-list complète si exigée (P-08)

  ('ordre_reparation', 'termine',  'en_cours', true),   -- T-15 : réouverture avant facturation, motif obligatoire (spec)
  ('ordre_reparation', 'termine',  'facture',  false),  -- T-16 : au moins une facture émise (étape 2)
  ('ordre_reparation', 'termine',  'restitue', false),  -- T-18 : restitution sans facturation (garantie, retouche)

  ('ordre_reparation', 'facture',  'restitue', false),  -- T-17 : clés remises
  ('ordre_reparation', 'restitue', 'cloture',  false);  -- T-19 : plus rien en suspens

-- --- 5.2 Ligne d'OR (11 transitions) ----------------------------------------------------------
-- Machine issue de la spécification §5.2.
-- États terminaux : `facturee` (une ligne facturée est figée — correction par avoir) et
-- `annulee`.
-- Interdits par absence : `refusee → realisee` (RM-72, CT-28), `a_valider → en_cours` (RM-93 :
-- on ne travaille pas sur ce qui n'est pas accordé), `facturee → *`, `annulee → *`.
--
-- LACUNE CONNUE, remontée et non comblée d'autorité : la spécification ne prévoit AUCUNE sortie
-- pour `proposee` ni pour `a_valider` vers `annulee`. Une ligne saisie par erreur et laissée en
-- `proposee` ne peut donc ni être annulée ni être supprimée (aucun GRANT DELETE sur `ligne_or`) :
-- elle reste sur l'OR. Ajouter ces deux lignes est une migration d'une ligne ; retirer une
-- transition dont l'UI dépend déjà en coûte beaucoup plus. Le référentiel s'en tient donc à la
-- spec, et l'écart est signalé.

insert into public.transition_autorisee (entite, statut_depuis, statut_vers, exige_motif) values
  ('ligne_or', 'proposee',  'a_valider', false),  -- au-dessus du plafond : accord client requis
  ('ligne_or', 'proposee',  'validee',   false),  -- sous le plafond : pas d'accord nécessaire

  ('ligne_or', 'a_valider', 'validee',   false),  -- accord client obtenu
  ('ligne_or', 'a_valider', 'refusee',   false),  -- refus client (CT-33)

  ('ligne_or', 'validee',   'en_cours',  false),
  ('ligne_or', 'en_cours',  'realisee',  false),
  ('ligne_or', 'realisee',  'facturee',  false),  -- étape 2

  -- Annulations : motif obligatoire (spec §5.2). Une ligne accordée puis annulée est une
  -- promesse non tenue au client ; la raison doit être écrite au moment où elle est connue.
  ('ligne_or', 'validee',   'annulee',   true),
  ('ligne_or', 'en_cours',  'annulee',   true),
  ('ligne_or', 'realisee',  'annulee',   true),

  -- Le client rappelle et change d'avis. Un nouveau devis complémentaire est créé côté service :
  -- la ligne repart en attente d'accord, elle ne saute pas directement à `validee`.
  ('ligne_or', 'refusee',   'a_valider', false);


-- ---------------------------------------------------------------------------------------------
-- 6. `verifier_transition()` — le garde-fou générique
--
-- Le trigger est en BASE et non dans le service, pour la même raison que le RLS : le risque
-- n'est pas l'utilisateur qui clique, c'est l'UPDATE de masse d'un job de recalcul, le script de
-- reprise de données, ou le second chemin d'écriture qu'on ajoutera dans deux ans en oubliant
-- d'appeler la validation. Le service valide AUSSI — il doit rendre une erreur métier lisible et
-- non une exception SQL — mais c'est la base qui garantit.
--
-- SQLSTATE `ZDFA1`. Le `DFA01` du plan initial est INVALIDE : PostgreSQL réserve les classes
-- d'erreur commençant par 0-4 et A-H, et `DF` y tombe. La classe `ZD` n'est utilisée par aucun
-- code standard. Famille du produit :
--     ZDFA1  transition d'état interdite            (ici)
--     ZDFA2  écriture sur une entité verrouillée    (triggers d'immuabilité, migration métier)
--     ZDFA3  modification d'un champ figé           (triggers d'immuabilité, migration métier)
-- Sans SQLSTATE dédié, la couche applicative ne peut distinguer ce refus MÉTIER d'une panne, et
-- le garagiste reçoit « erreur interne » là où il devrait lire « on ne facture pas un OR qui
-- n'est pas terminé ».
--
-- Ce que le message transporte, et pourquoi chaque champ :
--   MESSAGE  lisible par un humain dans les logs ;
--   TABLE    la table réelle — c'est elle qui permet de choisir entre OR_TRANSITION_INTERDITE et
--            LIGNE_TRANSITION_INTERDITE côté API, sans analyser le texte du message ;
--   DETAIL   les trois valeurs, sous une forme parsable et stable ;
--   HINT     les transitions réellement possibles depuis l'état courant — c'est la matière
--            d'`actionsProposees` dans la réponse d'erreur, obtenue sans requête supplémentaire
--            côté service. Le coût de cette seconde requête n'est payé que sur le chemin
--            d'échec, jamais sur le chemin nominal.
--
-- SECURITY INVOKER (le défaut, écrit explicitement) : la lecture du référentiel se fait avec les
-- droits de l'appelant, qui a SELECT dessus. Aucune raison d'élever les privilèges, et une
-- fonction SECURITY DEFINER appelée sur chaque UPDATE d'OR serait une surface d'attaque offerte
-- pour rien.
-- ---------------------------------------------------------------------------------------------

create function public.verifier_transition() returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $fn$
declare
  entite_cible public.entite_auditee;
  depuis       text;
  vers         text;
  possibles    text;
  indication   text;
begin
  -- Un trigger posé sans argument ferait échouer TOUTES les transitions de la table (aucune
  -- ligne du référentiel ne correspondrait à l'entité NULL) — panne totale, diagnostic obscur.
  if tg_nargs < 1 or tg_argv[0] is null then
    raise exception
      'verifier_transition() posée sans argument sur « % ». Attendu : create trigger … execute function public.verifier_transition(''<entite_auditee>'').',
      tg_table_name
      using errcode = 'ZDFA1';
  end if;

  -- Posé sur INSERT, ce trigger échouerait sur « record old is not assigned yet » : un message
  -- de bug PL/pgSQL là où l'auteur du DDL a simplement écrit BEFORE INSERT OR UPDATE au lieu de
  -- BEFORE UPDATE. Une création n'a de toute façon pas de transition à valider — elle a un état
  -- initial, dont la légitimité relève d'un CHECK sur la table.
  if tg_op <> 'UPDATE' then
    raise exception
      'verifier_transition() posée sur % pour « % » : ce trigger ne vaut que pour BEFORE UPDATE.',
      tg_op, tg_table_name
      using errcode = 'ZDFA1';
  end if;

  entite_cible := tg_argv[0]::public.entite_auditee;

  depuis := old.statut::text;
  vers   := new.statut::text;

  -- Le statut n'a pas changé : ce n'est pas une transition, il n'y a rien à vérifier. C'est le
  -- cas de l'immense majorité des UPDATE (édition d'un commentaire, d'un kilométrage…), d'où ce
  -- retour avant toute lecture du référentiel.
  if depuis is not distinct from vers then
    return new;
  end if;

  if exists (
    select 1
      from public.transition_autorisee t
     where t.entite        = entite_cible
       and t.statut_depuis = depuis
       and t.statut_vers   = vers
  ) then
    return new;
  end if;

  select string_agg(t.statut_vers, ', ' order by t.statut_vers)
    into possibles
    from public.transition_autorisee t
   where t.entite = entite_cible
     and t.statut_depuis = depuis;

  if possibles is null then
    indication := format('« %s » est un état terminal : aucune transition n''en part.', depuis);
  else
    indication := format('Depuis « %s », transitions autorisées : %s.', depuis, possibles);
  end if;

  raise exception using
    errcode = 'ZDFA1',
    message = format('Transition %s → %s interdite sur %s.', depuis, vers, entite_cible),
    detail  = format('entite=%s;depuis=%s;vers=%s', entite_cible, depuis, vers),
    hint    = indication,
    table   = tg_table_name;
end
$fn$;

comment on function public.verifier_transition() is
  'Trigger BEFORE UPDATE générique : refuse toute transition de statut absente de '
  'transition_autorisee, avec le SQLSTATE ZDFA1. À poser sur chaque table portant une machine à '
  'états : create trigger <t>_verifier_transition before update on public.<t> for each row '
  'execute function public.verifier_transition(''<entite_auditee>''). Voir '
  '0003_prealables_etape1.sql §6.';

-- Aucun trigger n'est posé ici : les tables `ordre_reparation` et `ligne_or` n'existent pas
-- encore. Chaque migration métier pose le sien au moment où elle crée sa table — c'est aussi ce
-- qui rend le trigger visible dans le même fichier que la table qu'il protège.

revoke all     on function public.verifier_transition() from public;
grant  execute on function public.verifier_transition() to   dfa_app;


-- ---------------------------------------------------------------------------------------------
-- 7. Assertions de fin de migration
--
-- Non pas une duplication des contrôles de démarrage, mais l'assertion que CETTE migration a
-- fait ce qu'elle annonce — échouée dans sa propre transaction plutôt que découverte au
-- déploiement suivant. Sur une base neuve (CI, testcontainers, premier déploiement), ce bloc est
-- ce qui distingue « les extensions sont là » de « on croit qu'elles sont là ».
-- ---------------------------------------------------------------------------------------------

do $$
declare
  manquantes text;
  n          integer;
  echantillon text;
begin
  -- 7.1 Extensions réellement installées.
  select string_agg(e.nom, ', ' order by e.nom)
    into manquantes
    from (values ('btree_gist'), ('btree_gin'), ('pg_trgm'), ('unaccent')) as e(nom)
   where not exists (select 1 from pg_catalog.pg_extension x where x.extname = e.nom);

  if manquantes is not null then
    raise exception 'Extensions manquantes après installation : %.', manquantes;
  end if;

  -- 7.2 Normalisation : valeurs de référence. Elles verrouillent le comportement observable de
  -- la fonction. Si elles changent un jour, ce n'est pas ce bloc qu'il faut corriger — c'est un
  -- REINDEX qu'il faut planifier (§2).
  echantillon := public.normaliser_recherche('VD 123''456');
  if echantillon is distinct from 'vd123456' then
    raise exception 'normaliser_recherche(''VD 123''''456'') = % au lieu de vd123456.', echantillon;
  end if;
  echantillon := public.normaliser_recherche('Müller-Rossì');
  if echantillon is distinct from 'mullerrossi' then
    raise exception 'normaliser_recherche(''Müller-Rossì'') = % au lieu de mullerrossi.', echantillon;
  end if;
  echantillon := public.normaliser_recherche('O''Neill');
  if echantillon is distinct from 'oneill' then
    raise exception 'normaliser_recherche(''O''''Neill'') = % au lieu de oneill.', echantillon;
  end if;
  if public.normaliser_recherche(null) is not null then
    raise exception 'normaliser_recherche(null) doit rendre null (fonction STRICT).';
  end if;

  -- 7.3 Volume du référentiel : une insertion perdue dans un conflit de fusion se voit ici.
  select count(*) into n
    from public.transition_autorisee where entite = 'ordre_reparation';
  if n <> 16 then
    raise exception 'transition_autorisee : % transitions pour ordre_reparation, 16 attendues.', n;
  end if;

  select count(*) into n
    from public.transition_autorisee where entite = 'ligne_or';
  if n <> 11 then
    raise exception 'transition_autorisee : % transitions pour ligne_or, 11 attendues.', n;
  end if;

  -- 7.4 États terminaux : aucune sortie. C'est l'invariant qui protège l'immuabilité de la
  -- chaîne documentaire (I-02, I-03, I-05, I-06) et la règle « une ligne facturée est figée ».
  select string_agg(t.statut_depuis || '→' || t.statut_vers, ', ' order by t.statut_depuis)
    into manquantes
    from public.transition_autorisee t
   where (t.entite = 'ordre_reparation' and t.statut_depuis in ('cloture', 'annule'))
      or (t.entite = 'ligne_or'         and t.statut_depuis in ('facturee', 'annulee'));

  if manquantes is not null then
    raise exception 'Sortie déclarée depuis un état terminal : %.', manquantes;
  end if;

  -- 7.5 Aucun statut orphelin : chaque valeur des deux enums apparaît au moins une fois dans le
  -- référentiel. Un statut qu'aucune transition n'atteint ni ne quitte est soit une valeur
  -- morte, soit une transition oubliée — dans les deux cas, quelque chose à corriger avant que
  -- l'UI ne propose un bouton qui ne mène nulle part.
  select string_agg(x.libelle, ', ' order by x.libelle) into manquantes
    from (
      select 'ordre_reparation' as entite, e.enumlabel::text as libelle
        from pg_catalog.pg_enum e
       where e.enumtypid = 'public.statut_ordre_reparation'::regtype
      union all
      select 'ligne_or', e.enumlabel::text
        from pg_catalog.pg_enum e
       where e.enumtypid = 'public.statut_ligne_or'::regtype
    ) x
   where not exists (
     select 1 from public.transition_autorisee t
      where t.entite::text = x.entite
        and (t.statut_depuis = x.libelle or t.statut_vers = x.libelle)
   );

  if manquantes is not null then
    raise exception 'Statuts absents du référentiel des transitions : %.', manquantes;
  end if;

  -- 7.6 Posture de `transition_autorisee` : la déclaration [dfa:referentiel-partage] doit
  -- correspondre aux privilèges RÉELS, sinon elle ne serait qu'une affirmation. Le contrôle de
  -- démarrage refuserait l'API ; autant échouer ici, dans la migration qui en est la cause.
  if not has_table_privilege('dfa_app', 'public.transition_autorisee', 'SELECT') then
    raise exception 'dfa_app n''a pas SELECT sur transition_autorisee : le référentiel serait illisible.';
  end if;

  select string_agg(p.priv, ', ' order by p.priv) into manquantes
    from (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) as p(priv)
   where has_table_privilege('dfa_app', 'public.transition_autorisee', p.priv);

  if manquantes is not null then
    raise exception
      'dfa_app détient % sur transition_autorisee : un référentiel partagé est en lecture seule (une écriture y modifierait les données de TOUS les tenants).',
      manquantes;
  end if;

  if not (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.transition_autorisee'::regclass) then
    raise exception 'ROW LEVEL SECURITY non activé sur transition_autorisee.';
  end if;
end
$$;
