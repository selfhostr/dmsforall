-- =============================================================================================
-- 0051_referentiel_vehicules_ch_marque_alias.sql — table d'alias de marques pour l'autocomplétion
-- du référentiel véhicules suisse (0050 `type_approbation_ch`)
--
-- BESOIN MÉTIER, MESURÉ — `type_approbation_ch` stocke les noms de marque tels qu'enregistrés par
-- l'ASTRA (TAS), qui ne sont pas toujours ceux qu'un réceptionniste tape au comptoir. Vérifié en
-- exécution sur la base réelle (216 819 lignes, 1 163 marques distinctes au moment d'écrire cette
-- migration) : rechercher « volkswagen » ne rend STRICTEMENT AUCUNE ligne — l'ASTRA n'enregistre
-- cette marque QUE sous le code « VW », aucune entrée épelée « VOLKSWAGEN » n'existe dans le
-- référentiel. Un réceptionniste qui tape le nom complet de la marque la plus vendue de Suisse ne
-- trouve rien et conclut, à raison de son point de vue, que la recherche est cassée.
--
-- CE QUE `normaliser_recherche()` RÉSOUT DÉJÀ, ET CE QU'IL NE RÉSOUD PAS — vérifié en exécution
-- avant d'écrire cette migration, pour ne pas dupliquer un alias inutile :
--   - casse, accents ET SÉPARATEURS (espaces, tirets, ponctuation) sont déjà neutralisés par
--     `normaliser_recherche()` (0003) : « Mercedes », « mercedes-benz », « Land Rover » et
--     « landrover » trouvent déjà MERCEDES-BENZ / LAND ROVER sans le moindre alias — vérifié
--     colonne par colonne sur la base réelle avant d'écrire cette liste ;
--   - ce que `normaliser_recherche()` ne peut PAS résoudre, par construction, c'est un nom
--     complètement DIFFÉRENT du nom canonique (VW vs Volkswagen, ou une abréviation comptoir comme
--     MB) — c'est exactement le trou que cette table comble, et SEULEMENT celui-ci.
--
-- OÙ VIVENT LES ALIAS, ARBITRAGE EXPLICITE — en base, pas en constante applicative. Le volume est
-- petit (quelques dizaines de lignes au plus, jamais un import de masse) mais la donnée doit rester
-- corrigible SANS repasser par le pipeline de build/déploiement complet : un alias manquant décou-
-- vert un lundi matin par un garage doit pouvoir être ajouté par un simple `insert` en base (ou une
-- migration de suivi triviale), pas attendre le prochain cycle de release applicatif. Une constante
-- TypeScript aurait exactement le même coût d'ajout qu'une migration de suivi (revue de code +
-- déploiement) sans le bénéfice d'une correction immédiate par `insert` direct en cas d'urgence.
--
-- [dfa:referentiel-partage] MÊME DOCTRINE QUE `type_approbation_ch` (0050) — donnée ÉDITORIALE
-- mais toujours une propriété du PRODUIT, pas du garage : un alias « Volkswagen -> VW » vaut pour
-- tous les tenants. SANS `tenant_id`, SANS RLS (une table sans tenant_id n'a aucune colonne sur
-- laquelle une politique pourrait discriminer — voir le raisonnement complet dans l'en-tête de
-- 0050, non reproduit ici). `dfa_app` n'y a que SELECT, vérifié par `verifierPostureRls()` au
-- démarrage ET par les assertions de fin de migration ci-dessous.
--
-- PAS DE FK VERS `type_approbation_ch` — `marque` n'y est pas une clé (colonne répétée sur chaque
-- ligne de modèle, jamais unique), donc rien à référencer par contrainte. La correspondance est
-- vérifiée manuellement à la curation (voir chaque alias ci-dessous, source documentée) plutôt que
-- par un CHECK en base : imposer une vérification stricte ici casserait cette même migration sur
-- une base fraîche où `type_approbation_ch` est encore vide (l'import ASTRA est un script séparé,
-- non exécuté par les migrations — voir 0050 § VOLUME, même doctrine reconduite ici).
--
-- Réversible : migrations/down/0051_referentiel_vehicules_ch_marque_alias.down.sql.
-- =============================================================================================


-- ---------------------------------------------------------------------------------------------
-- 1. `type_approbation_ch_marque_alias` — une ligne par terme de recherche alternatif
-- ---------------------------------------------------------------------------------------------

create table public.type_approbation_ch_marque_alias (
  id                uuid          primary key default gen_random_uuid(),

  -- Forme d'affichage telle qu'un humain la tape ou la lit (ex. « Volkswagen », « MB ») — PAS
  -- forcément la forme canonique ASTRA. C'est ce texte qui revient au client via `aliasTrouve`
  -- quand une recherche a été résolue par cet alias (voir service-referentiel-vehicules-ch.ts) :
  -- un utilisateur qui tape « Volkswagen » et voit apparaître « VW » doit comprendre pourquoi,
  -- ce champ est la réponse à cette question.
  alias             text          not null,

  -- Doit correspondre à une valeur RÉELLE de `type_approbation_ch.marque` — vérifié manuellement
  -- à la curation (base réelle interrogée avant chaque ajout), pas par contrainte en base (voir
  -- en-tête § PAS DE FK).
  marque_canonique  text          not null,

  -- Documente D'OÙ vient l'alias (jamais fabriqué au hasard) — traçabilité éditoriale, pas une
  -- donnée fonctionnelle consommée par l'application.
  source            text          not null,

  cree_le           timestamptz   not null default now(),
  modifie_le        timestamptz   not null default now(),

  constraint type_approbation_ch_marque_alias_alias_non_vide_chk
    check (length(btrim(alias)) > 0),
  constraint type_approbation_ch_marque_alias_marque_canonique_non_vide_chk
    check (length(btrim(marque_canonique)) > 0),
  constraint type_approbation_ch_marque_alias_source_non_vide_chk
    check (length(btrim(source)) > 0),

  -- Un alias identique (au sens `normaliser_recherche`) à sa propre cible ne sert à rien — soit
  -- une erreur de saisie, soit un doublon avec ce que la recherche directe trouve déjà.
  constraint type_approbation_ch_marque_alias_distinct_de_la_cible_chk
    check (public.normaliser_recherche(alias) <> public.normaliser_recherche(marque_canonique))
);

create trigger type_approbation_ch_marque_alias_touche_modifie_le
  before update on public.type_approbation_ch_marque_alias
  for each row execute function public.touche_modifie_le();

comment on table public.type_approbation_ch_marque_alias is
  'Alias de marques pour l''autocomplétion du référentiel véhicules suisse (0050) — associe un '
  'terme réellement tapé au comptoir (ex. « Volkswagen », « MB ») à la marque canonique ASTRA '
  '(ex. « VW », « MERCEDES-BENZ ») quand les deux diffèrent au-delà de ce que '
  'normaliser_recherche() neutralise déjà (casse/accents/séparateurs). [dfa:referentiel-partage] '
  'Donnée éditoriale identique pour tous les garages suisses, ce n''est pas une donnée de tenant — '
  'dfa_app n''y a que SELECT.';

-- Posture : `dfa_app` ne reçoit QUE SELECT — même doctrine que 0050. `revoke all` d'abord : les
-- privilèges par défaut (0001/0002) donneraient SELECT/INSERT/UPDATE à `dfa_app` sur toute
-- nouvelle table sans action explicite.
revoke all    on public.type_approbation_ch_marque_alias from dfa_app;
grant  select on public.type_approbation_ch_marque_alias to   dfa_app;


-- ---------------------------------------------------------------------------------------------
-- 2. Index — UNIQUE, sert aussi la recherche par préfixe
--
-- `text_pattern_ops`, même choix que `type_approbation_ch_marque_modele_recherche_idx` (0050) :
-- l'usage est une autocomplétion par préfixe (« volksw » doit déjà remonter l'alias Volkswagen),
-- pas une recherche par fragment arbitraire. Un SEUL index sert les deux besoins (unicité de
-- l'alias ET préfixe) — l'opclass `text_pattern_ops` reste un btree standard, l'égalité qu'exige
-- une contrainte UNIQUE fonctionne identiquement avec ou sans cet opclass.
-- ---------------------------------------------------------------------------------------------

create unique index type_approbation_ch_marque_alias_recherche_uk on public.type_approbation_ch_marque_alias (
  (public.normaliser_recherche(alias)) text_pattern_ops
);


-- ---------------------------------------------------------------------------------------------
-- 3. Curation initiale — écarts RÉELS entre nom canonique ASTRA et nom tapé au comptoir,
-- vérifiés un par un contre la base réelle avant d'écrire cette migration (aucun alias fabriqué
-- pour une marque absente du référentiel). Liste volontairement NON exhaustive (bon sens métier
-- garage romand), pas une couverture systématique des 1 163 marques du référentiel.
-- ---------------------------------------------------------------------------------------------

insert into public.type_approbation_ch_marque_alias (alias, marque_canonique, source) values
  -- L'ASTRA n'enregistre cette marque QUE sous le code « VW » — aucune entrée « VOLKSWAGEN »
  -- n'existe dans type_approbation_ch (confirmé par requête sur la base réelle). C'est la marque
  -- la plus vendue de Suisse : le trou déclencheur de cette migration.
  ('Volkswagen', 'VW', 'ASTRA TAS ne connaît que le code « VW » — aucune entrée « VOLKSWAGEN », vérifié sur type_approbation_ch réel'),
  -- Abréviation de comptoir standard dans le commerce automobile (catalogues pièces, jargon
  -- garage) — « mercedes » seul trouve déjà MERCEDES-BENZ par préfixe normalisé, ce n'est que
  -- l'abréviation à deux lettres qui manquait.
  ('MB', 'MERCEDES-BENZ', 'abréviation comptoir standard (catalogues pièces, jargon garage) — confirmé marque « MERCEDES-BENZ » présente sur type_approbation_ch réel'),
  -- Vespa est une sous-marque de scooters de Piaggio, sans entrée « VESPA » propre dans le
  -- référentiel ASTRA (vérifié) — les scooters Vespa y sont homologués sous PIAGGIO.
  ('Vespa', 'PIAGGIO', 'sous-marque de scooters de Piaggio, aucune entrée « VESPA » distincte dans type_approbation_ch réel — vérifié, homologuée sous PIAGGIO'),
  -- Abréviation familière courante (annonces d'occasion, jargon comptoir) pour Chevrolet, marque
  -- bien présente telle quelle dans le référentiel.
  ('Chevy', 'CHEVROLET', 'abréviation familière courante (petites annonces, comptoir) — confirmé marque « CHEVROLET » présente sur type_approbation_ch réel');


-- ---------------------------------------------------------------------------------------------
-- Assertions de fin de migration
-- ---------------------------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.type_approbation_ch_marque_alias') is null then
    raise exception '0051 : table type_approbation_ch_marque_alias introuvable après création.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'type_approbation_ch_marque_alias_recherche_uk'
  ) then
    raise exception '0051 : index unique de recherche introuvable.';
  end if;

  -- Posture [dfa:referentiel-partage] : dfa_app doit avoir SELECT et RIEN d'autre.
  if not has_table_privilege('dfa_app', 'public.type_approbation_ch_marque_alias', 'SELECT') then
    raise exception '0051 : dfa_app n''a pas SELECT sur type_approbation_ch_marque_alias : les alias seraient illisibles.';
  end if;

  if has_table_privilege('dfa_app', 'public.type_approbation_ch_marque_alias', 'INSERT')
     or has_table_privilege('dfa_app', 'public.type_approbation_ch_marque_alias', 'UPDATE')
     or has_table_privilege('dfa_app', 'public.type_approbation_ch_marque_alias', 'DELETE') then
    raise exception '0051 : dfa_app a un privilège d''écriture sur type_approbation_ch_marque_alias — contredit [dfa:referentiel-partage].';
  end if;

  if (select count(*) from public.type_approbation_ch_marque_alias) < 4 then
    raise exception '0051 : curation initiale incomplète — moins de 4 alias trouvés après insertion.';
  end if;
end
$$;
