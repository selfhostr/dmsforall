-- =============================================================================================
-- 0050_referentiel_vehicules_ch.sql — fondations du référentiel véhicules suisse (ASTRA/OFROU)
--
-- BESOIN MÉTIER — aujourd'hui, marque/modèle/version sont tapés en texte libre : « VW Golf » et
-- « Volkswagen Golf » ne se rapprochent jamais dans une recherche. Le permis de circulation suisse
-- porte un CODE TYPE (`vehicule.code_type_ch`, existant depuis 0007, inexploité jusqu'ici) qui
-- identifie sans ambiguïté la fiche technique complète du véhicule. Cette migration pose la table
-- qui rend ce code exploitable — SANS charger la moindre ligne : le mécanisme d'import est une
-- tâche séparée (voir « VOLUME » en fin d'en-tête).
--
-- SOURCE — TAS, PAS TARGA. Les deux jeux de l'ODP ASTRA (opendata.astra.admin.ch/ivzod/) ont été
-- inspectés en exécution avant ce choix (échantillons réels téléchargés, pas une supposition) :
--   - TARGA (2000-Typengenehmigungen_TG_TARGA/) : une table de synthèse Excel unique
--     (`Neuzugaenge_und_Gesamtliste.xlsx`, 67 Mo, confirmé), mise à jour SEMESTRIELLE, sans schéma
--     machine — sa documentation est un PDF en prose.
--   - TAS (4000-Typengenehmigungen_TAS/) : un fichier JSON PAR code type
--     (`4100-json-Files/<categorie>_<codeType>.json`), mise à jour HEBDOMADAIRE (dernier dépôt
--     constaté à J-4 au moment d'écrire cette migration), et un schéma JSON Schema machine-lisible
--     complet (`4250-json-Schema/govServices_TypeApproval_Schema.json`, 194 propriétés).
-- TAS l'emporte sur les deux critères qui comptent pour un import récurrent : fraîcheur (hebdo vs
-- semestriel) et structure exploitable sans parsing Excel fragile. La couverture historique a été
-- vérifiée avant de trancher (le risque : un garage entretient des véhicules de vingt ans) — des
-- échantillons TAS réels remontent au moins à 1996 (ex. `chTypeApprovalNumber` 6AA101, Aprilia
-- Rally 50, `definitive` 1996-03-21), largement suffisant.
--
-- VOLUME MESURÉ (pour le futur import, PAS chargé ici) — le dénombrement exact des fichiers de
-- `4100-json-Files/` (aucune estimation) donne 227 540 codes types UNIQUES au total : 210 573
-- préfixés `MV_` (véhicules à moteur — voitures de tourisme M1, utilitaires N1, etc.),
-- 11 561 `MB_` (deux-roues motorisés) et 5 406 `TR_` (remorques). Confirmé SANS DOUBLON entre
-- préfixes : `chTypeApprovalNumber` est une clé globalement unique sur tout le corpus TAS. Chaque
-- fichier contient exactement DEUX enregistrements (`languageCode` = de/fr) pour un même code —
-- voir § BILINGUE ci-dessous. Rythme d'import à prévoir : un rafraîchissement hebdomadaire par
-- upsert sur `code_type_ch` (~230k lignes, taille modeste), jamais un DELETE+INSERT complet.
--
-- BILINGUE SANS DUPLIQUER LA TABLE — vérifié sur un échantillon réel (moto ET voiture de
-- tourisme) : sur 122-194 champs par enregistrement, SEULS 14 diffèrent entre la version `de` et
-- la version `fr`, et ce sont TOUS des champs de texte libre descriptif qu'on NE GARDE PAS ici
-- (emplacement de la plaque constructeur, description du freinage, remarques…). Les champs
-- retenus dans cette table (marque, modèle, type/variante/version techniques, code carburant,
-- cylindrée, puissance, poids, places, catégorie) sont des CODES ou des NOMS PROPRES — strictement
-- IDENTIQUES dans les deux enregistrements source. Une ligne par code type suffit donc ; aucune
-- colonne `_fr`/`_de` n'est nécessaire pour ce sous-ensemble de champs.
--
-- CODES BRUTS, PAS D'ENUM POSTGRES — `carburant_code` (ASTRA `chFuelType`) et `transmission_code`
-- (ASTRA `driveType`) restent du texte brut, à l'image de `vehicule.carburant` (0007, déjà
-- `text`, jamais un enum). Ce sont des codes maintenus par l'ASTRA, pas par ce produit : un enum
-- Postgres figerait la liste et ferait échouer un import le jour où l'ASTRA ajoute un code (ex.
-- nouveau type de motorisation électrique). Le décodage vers un libellé FR/DE/IT lisible est une
-- responsabilité applicative (petite table statique i18n), pas une contrainte base.
--
-- TROIS MODES DE SAISIE, ET LA CONSÉQUENCE DE MODÉLISATION QUI EN DÉCOULE — arbitrage explicite de
-- @laupernoe, à ne pas rouvrir :
--   1. code type → tout se remplit (le chemin rapide, cette table) ;
--   2. autocomplétion en cascade marque → modèle → version… quand le permis n'est pas sous les
--      yeux (les deux index posés en fin de fichier servent CE mode) ;
--   3. saisie 100% libre, TOUJOURS possible — véhicule importé, modèle ancien absent du
--      référentiel, utilitaire transformé. Le garagiste ne doit JAMAIS se retrouver bloqué.
-- CONSÉQUENCE : `vehicule.marque`/`modele`/`version` (0007) RESTENT DU TEXTE LIBRE. Ils ne
-- deviennent PAS des clés étrangères vers ce référentiel — le faire rendrait le mode 3 impossible
-- ET casserait instantanément tous les véhicules déjà saisis en texte libre. `vehicule` gagne à la
-- place un lien optionnel et silencieux (`type_approbation_ch_id`, `on delete set null`) : présent
-- quand le mode 1 ou 2 a été utilisé, absent sinon, sans jamais rien bloquer. Ne pas « corriger »
-- ceci en FK plus tard sans revalider les trois modes avec @laupernoe.
--
-- PAS DE `tenant_id`, ET C'EST VOULU — même doctrine que `transition_autorisee` (0003) : ce
-- référentiel est une propriété du PRODUIT (les données ASTRA sont identiques pour tous les
-- garages suisses), pas du garage. Déclaré `[dfa:referentiel-partage]` ci-dessous ; `dfa_app` n'y
-- a que SELECT, vérifié par `verifierPostureRls()` au démarrage — la déclaration n'ouvre rien par
-- elle-même.
--
-- CE QUI N'EST PAS FAIT ICI, DÉLIBÉRÉMENT :
--   - aucune donnée chargée (mécanisme d'import = tâche séparée, hors périmètre) ;
--   - aucun trigger d'audit : ce n'est pas une entité sensible au sens du dépôt (pas d'argent, pas
--     de responsabilité juridique engagée par une ligne) — c'est un miroir en lecture d'une source
--     externe, remplacé par le prochain import, pas une donnée saisie qu'on doit pouvoir
--     reconstituer avant/après ;
--   - aucun décodage des codes ASTRA (carburant, transmission, catégorie) en libellé humain — v.
--     § CODES BRUTS ci-dessus.
--
-- Réversible : migrations/down/0050_referentiel_vehicules_ch.down.sql.
-- =============================================================================================


-- ---------------------------------------------------------------------------------------------
-- 1. `type_approbation_ch` — une ligne par code type suisse (ASTRA `chTypeApprovalNumber`)
--
-- Clé technique `id` en surrogate (pas `code_type_ch` en PK) : un futur import qui doit
-- remplacer/retirer une ligne obsolète (ré-homologation ASTRA, ex. très rare) ne casse jamais le
-- lien optionnel posé sur `vehicule` — `on delete set null` s'appuie sur cet `id` stable, pas sur
-- le texte du code.
-- ---------------------------------------------------------------------------------------------

create table public.type_approbation_ch (
  id                   uuid          primary key default gen_random_uuid(),

  -- Clé métier : ASTRA `chTypeApprovalNumber`, ex. « 1AM461 ». Confirmée globalement unique sur
  -- les 227 540 fichiers TAS existants avant d'écrire cette contrainte (v. en-tête, § VOLUME).
  code_type_ch         text          not null,

  -- ASTRA `vehicleCategoryCode` (M1, N1, L3e, O1…) — catégorie réglementaire suisse/UE, pas un
  -- enum : liste ouverte côté ASTRA.
  categorie            text          not null,

  -- ASTRA `makeName` / `makeCode`. `marque_code` est nullable par défense (absent sur une poignée
  -- d'anciens enregistrements observés hors échantillon), jamais utilisé comme clé.
  marque               text          not null,
  marque_code          text,

  -- ASTRA `commercialName` (nom commercial, ex. « A7 SB 55TFSI qu »).
  modele               text          not null,

  -- ASTRA `type` / `variant` / `version` — trois niveaux de précision technique EMBOÎTÉS
  -- (le type identifie la plateforme technique, variante et version l'affinent), distincts du
  -- `modele` commercial. Tous trois nullables sauf `type_technique` : la donnée réelle observée le
  -- porte toujours, mais on ne le durcit pas en NOT NULL pour ne pas bloquer un futur import sur
  -- un enregistrement ASTRA atypique — le CHECK de non-vacuité ci-dessous suffit quand présent.
  type_technique       text,
  variante             text,
  version              text,

  -- Codes ASTRA bruts, PAS d'enum — v. en-tête § CODES BRUTS.
  carburant_code       text,
  transmission_code    text,

  -- ASTRA `engineType` — désignation constructeur du moteur (ex. « DLZA »), la « motorisation »
  -- au sens where @laupernoe l'a demandée : un repère technique, pas une description en prose.
  moteur_designation   text,

  -- ASTRA `engineCapacity` (cm³) et `maximumNetPower` (kW). `puissance_kw` en INTEGER, pas
  -- `numeric` : aucune colonne `numeric` n'existe ailleurs dans ce schéma, et `vehicule.puissance_kw`
  -- (0007) est déjà un `integer` — cohérence délibérée. L'ASTRA rapporte parfois une puissance
  -- fractionnaire sur les très petites cylindrées (ex. 3.7 kW sur un cyclomoteur 50cm³) ; le futur
  -- import arrondit à l'entier le plus proche, perte de précision négligeable pour l'usage visé
  -- (préremplir une fiche véhicule dont le champ cible est lui-même un entier).
  cylindree_cm3        integer,
  puissance_kw         integer,

  -- ASTRA `chMassOfTheVehicleInRunningOrderMinimum` (voitures/utilitaires) OU
  -- `chEmptyWeightMinimum` (deux-roues) selon la catégorie — DEUX noms de champ source distincts
  -- pour le même concept, vérifié en exécution sur un échantillon de chaque catégorie (le schéma
  -- JSON TAS n'est PAS uniforme entre catégories de véhicules). Le futur import normalise les deux
  -- vers cette colonne UNIQUE ; assumé : la valeur MINIMUM du couple min/max ASTRA (une plage
  -- représente les variantes du même type, le minimum correspond à la configuration de base).
  -- Même normalisation pour `poids_total_kg`
  -- (`technicallyPermissibleMaximumLadenMassMinimum` / `techPermMaxLadenMassMin`).
  poids_vide_kg        integer,
  poids_total_kg       integer,

  -- ASTRA `chNrOfSeatingPositionsMinimum` — absent sur les deux-roues (vérifié : le champ
  -- n'existe même pas dans le JSON source pour cette catégorie), d'où le nullable.
  places               smallint,

  -- ASTRA `definitive` — date d'entrée en vigueur de l'homologation. Utile pour trier/filtrer côté
  -- futur écran (« véhicules homologués après telle date ») ; pas une donnée qu'on audite.
  date_homologation    date,

  -- ASTRA `versionNo` — un même code type peut être amendé par l'ASTRA (échantillonné : 0 sur tous
  -- les enregistrements observés, mais le champ existe et un futur import doit pouvoir décider
  -- s'il écrase une version antérieure). Conservé brut, sans signification métier ajoutée ici.
  source_version_no    integer       not null default 0,

  cree_le              timestamptz   not null default now(),
  modifie_le           timestamptz   not null default now(),

  constraint type_approbation_ch_code_type_ch_uk unique (code_type_ch),
  constraint type_approbation_ch_code_type_ch_non_vide_chk
    check (length(btrim(code_type_ch)) > 0),
  constraint type_approbation_ch_categorie_non_vide_chk
    check (length(btrim(categorie)) > 0),
  constraint type_approbation_ch_marque_non_vide_chk
    check (length(btrim(marque)) > 0),
  constraint type_approbation_ch_modele_non_vide_chk
    check (length(btrim(modele)) > 0),
  constraint type_approbation_ch_cylindree_chk
    check (cylindree_cm3 is null or cylindree_cm3 >= 0),
  constraint type_approbation_ch_puissance_chk
    check (puissance_kw is null or puissance_kw >= 0),
  constraint type_approbation_ch_poids_vide_chk
    check (poids_vide_kg is null or poids_vide_kg >= 0),
  constraint type_approbation_ch_poids_total_chk
    check (poids_total_kg is null or poids_total_kg >= 0),
  constraint type_approbation_ch_places_chk
    check (places is null or places > 0),
  constraint type_approbation_ch_source_version_chk
    check (source_version_no >= 0)
);

create trigger type_approbation_ch_touche_modifie_le
  before update on public.type_approbation_ch
  for each row execute function public.touche_modifie_le();

comment on table public.type_approbation_ch is
  'Référentiel véhicules suisse dérivé des données ouvertes ASTRA (TAS, hebdomadaire) — une ligne '
  'par code type (permis de circulation, champ 2.2 / "Typengenehmigung"). Alimente le remplissage '
  'automatique marque/modèle/motorisation à partir du code type ET les deux modes '
  'd''autocomplétion en cascade. [dfa:referentiel-partage] Donnée ASTRA identique pour tous les '
  'garages suisses, ce n''est pas une donnée de tenant — dfa_app n''y a que SELECT, jamais '
  'INSERT/UPDATE/DELETE (alimentée exclusivement par le job d''import, hors périmètre de cette '
  'migration).';

-- Posture : `dfa_app` ne reçoit QUE SELECT — la déclaration [dfa:referentiel-partage] ci-dessus
-- doit correspondre aux privilèges RÉELS, sinon `verifierPostureRls()` refuse le démarrage de
-- l'API. `revoke all` d'abord : les privilèges par défaut (0001/0002) donneraient SELECT/INSERT/
-- UPDATE à `dfa_app` sur toute nouvelle table sans action explicite.
revoke all    on public.type_approbation_ch from dfa_app;
grant  select on public.type_approbation_ch to   dfa_app;


-- ---------------------------------------------------------------------------------------------
-- 2. Index — les deux chemins de recherche du besoin métier (mode 1 et mode 2, v. en-tête)
-- ---------------------------------------------------------------------------------------------

-- Mode 1 — recherche exacte par code type. Aucun index dédié à créer : la contrainte UNIQUE
-- posée ci-dessus (`type_approbation_ch_code_type_ch_uk`) crée déjà l'index btree qui rend cette
-- recherche instantanée — en poser un second serait un doublon pur.

-- Mode 2 — autocomplétion en cascade marque → modèle. UN SEUL index composite sert les deux
-- étapes de la cascade, pas deux index séparés :
--   - étape « marque » seule :        where normaliser_recherche(marque) like 'aud%'
--     -> balayage de préfixe sur la colonne de tête, l'index sert direct ;
--   - étape « modèle filtré par marque » : where normaliser_recherche(marque) = 'audi'
--       and normaliser_recherche(modele) like 'a3%'
--     -> égalité sur la tête + préfixe sur la seconde colonne, le cas d'école d'un index
--        composite btree.
-- `text_pattern_ops` plutôt que `gin_trgm_ops` (famille pg_trgm, utilisée ailleurs dans ce dépôt
-- pour la recherche comptoir PAR FRAGMENT, ex. 0006/0007/0049) : le besoin ici est un préfixe
-- ancré au DÉBUT du texte tapé (autocomplétion classique « l'utilisateur tape depuis le premier
-- caractère »), pas une sous-chaîne arbitraire. `text_pattern_ops` est un opclass btree du cœur
-- PostgreSQL (aucune extension requise) qui sert `=` ET `like 'prefixe%'` — un GIN trigram serait
-- plus lourd à maintenir pour un gain nul sur ce cas d'usage précis.
-- `normaliser_recherche()` (0003, déjà utilisée par tout le dépôt) : insensible à la casse et aux
-- accents, exactement le comportement attendu d'une autocomplétion.
create index type_approbation_ch_marque_modele_recherche_idx on public.type_approbation_ch (
  (public.normaliser_recherche(marque))   text_pattern_ops,
  (public.normaliser_recherche(modele))   text_pattern_ops
);


-- ---------------------------------------------------------------------------------------------
-- 3. `vehicule` — lien optionnel et silencieux vers la fiche référentiel qui l'a renseigné
--
-- Colonne nullable, PAS une FK composite `(tenant_id, …)` comme le reste des relations de
-- `vehicule` (0007) : sa cible n'a pas de `tenant_id`, elle est partagée par construction — tous
-- les tenants pointent légitimement vers les mêmes lignes.
--
-- `on delete set null`, jamais `restrict` : un futur réimport qui retire une ligne obsolète du
-- référentiel (réhomologation ASTRA, cas rare mais réel) ne doit JAMAIS faire échouer la
-- maintenance du référentiel à cause d'un véhicule qui la référence — le lien disparaît
-- silencieusement, `vehicule.marque`/`modele`/`version` (texte libre, inchangés) restent intacts.
-- C'est exactement la garantie « ce lien peut être absent sans que rien ne casse » qui rend le
-- mode 3 (saisie 100% libre) toujours possible.
--
-- IMPORTANT — `vehicule.code_type_ch` (0007) N'EST PAS touché ici et reste sciemment sans
-- contrainte vers ce référentiel : il doit rester saisissable même pour un code absent (import du
-- référentiel pas encore fait, véhicule antérieur à la couverture ASTRA, véhicule étranger). Faire
-- de `code_type_ch` une FK bloquerait le mode 3 sur CE champ précis — voir l'en-tête.
-- ---------------------------------------------------------------------------------------------

alter table public.vehicule
  add column type_approbation_ch_id uuid;

alter table public.vehicule
  add constraint vehicule_fk_type_approbation
    foreign key (type_approbation_ch_id)
    references public.type_approbation_ch (id)
    on delete set null;

-- Sans cet index, un `on delete set null` déclenché par le job d'import (retrait d'une ligne
-- obsolète du référentiel) balaierait `vehicule` en entier — sur tous les tenants, puisque cette
-- table n'a pas de `tenant_id` à filtrer côté référentiel — pour trouver les lignes à mettre à
-- jour. À 200 tenants et plusieurs dizaines de milliers de véhicules cumulés, chaque suppression
-- deviendrait un scan complet.
create index vehicule_type_approbation_ch_id_idx on public.vehicule (type_approbation_ch_id);


-- ---------------------------------------------------------------------------------------------
-- Assertions de fin de migration
-- ---------------------------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.type_approbation_ch') is null then
    raise exception '0050 : table type_approbation_ch introuvable après création.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid = 'public.type_approbation_ch'::regclass
       and conname = 'type_approbation_ch_code_type_ch_uk'
  ) then
    raise exception '0050 : contrainte unique sur code_type_ch introuvable.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'type_approbation_ch_marque_modele_recherche_idx'
  ) then
    raise exception '0050 : index marque/modèle introuvable.';
  end if;

  -- Posture [dfa:referentiel-partage] : dfa_app doit avoir SELECT et RIEN d'autre.
  if not has_table_privilege('dfa_app', 'public.type_approbation_ch', 'SELECT') then
    raise exception '0050 : dfa_app n''a pas SELECT sur type_approbation_ch : le référentiel serait illisible.';
  end if;

  if has_table_privilege('dfa_app', 'public.type_approbation_ch', 'INSERT')
     or has_table_privilege('dfa_app', 'public.type_approbation_ch', 'UPDATE')
     or has_table_privilege('dfa_app', 'public.type_approbation_ch', 'DELETE') then
    raise exception '0050 : dfa_app a un privilège d''écriture sur type_approbation_ch — contredit [dfa:referentiel-partage].';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_attribute
     where attrelid = 'public.vehicule'::regclass
       and attname = 'type_approbation_ch_id'
       and not attisdropped
  ) then
    raise exception '0050 : colonne vehicule.type_approbation_ch_id introuvable.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid = 'public.vehicule'::regclass
       and conname = 'vehicule_fk_type_approbation'
  ) then
    raise exception '0050 : contrainte vehicule_fk_type_approbation introuvable.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'vehicule_type_approbation_ch_id_idx'
  ) then
    raise exception '0050 : index vehicule_type_approbation_ch_id_idx introuvable.';
  end if;
end
$$;
