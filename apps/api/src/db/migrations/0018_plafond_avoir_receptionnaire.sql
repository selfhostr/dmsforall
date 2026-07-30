-- =============================================================================================
-- 0018_plafond_avoir_receptionnaire.sql — pose la colonne de paramétrage que `RF-117` attend et
-- qui n'existe nulle part en base aujourd'hui.
--
-- CONSTAT : `RF-117` prévoit que l'émission d'un avoir par un `receptionnaire` est plafonnée en
-- montant — au-delà, seuls `direction`/`comptable` prennent le relais (un avoir rend de l'argent
-- au client ; un réceptionnaire au comptoir ne doit pas pouvoir annuler seul une facture de
-- 8'000.-). Vérifié dans `apps/api/src/auth/matrice-droits.ts` (§EMISSION_AVOIR, commentaire
-- « ⚠️ RF-117 NON IMPLÉMENTÉ, SIGNALÉ ») : `receptionnaire` détient aujourd'hui
-- `facturation.document.emettre_avoir` SANS AUCUNE LIMITE — dégradé documenté, pas un oubli
-- silencieux. Cette migration pose la colonne ; elle ne plafonne rien à elle seule (voir la note
-- « HORS PÉRIMÈTRE » en fin de fichier).
--
-- 1. OÙ VIT CE PARAMÈTRE — RÉUTILISATION DE `parametre_atelier`, PAS UNE NOUVELLE TABLE :
--    Trois tables de paramétrage existaient déjà à l'ouverture de cette tâche : `parametre_
--    atelier` (0005, une ligne par TENANT, PK = tenant_id), `parametre_site` (0005, une ligne par
--    SITE) et `tenant_bloc_creancier` (0014, une ligne par TENANT, mais dédiée corps et âme au
--    bloc créancier QR-facture — IBAN/QR-IBAN/adresse structurée, RF-54/PF-03). Aucune des trois
--    n'est un magasin générique par réflexe : chacune porte un domaine précis.
--    Retenu : `parametre_atelier`. Deux raisons vérifiées, pas supposées :
--      a) Ce N'EST PAS une table réservée à l'atelier malgré son nom — son propre commentaire de
--         table (0005) le dit : « Paramètres structurants du TENANT ». Elle est déjà lue hors du
--         module atelier : `apps/api/src/facturation/documents/numerotation.ts` s'appuie dessus
--         pour la numérotation des documents de vente — la facturation en dépend déjà pour un
--         besoin qui n'a rien d'atelier. Le grep est dans le rapport de livraison.
--      b) Elle porte DÉJÀ un paramètre de la même famille exacte : `plafond_defaut_centimes`
--         (0005, RM-54/Q-02 — « NULL = aucun plafond convenu, la garde RM-54 ne s'exécute jamais ;
--         0 = accord requis pour toute validation payante ; n>0 = plafond nominal », CHECK entre
--         0 et 100'000'000). C'est structurellement le même problème que `RF-117` : un montant
--         plafond en centimes, NULL = pas de plafond convenu, gouvernant qui doit escalader une
--         décision. Dupliquer le motif « une ligne par tenant, PK = tenant_id, plafond nullable »
--         dans une deuxième table pour la même forme de problème n'ajouterait aucune garantie et
--         fragmenterait le paramétrage tenant en deux endroits à consulter pour la même question
--         (« qui doit escalader, et jusqu'à combien »).
--    `tenant_bloc_creancier` est écarté explicitement : sa table n'a de sens que pour le bloc
--    créancier du QR-facture (nom/adresse/IBAN du garage) — y greffer un plafond d'autorisation
--    d'avoir mélangerait deux domaines sans rapport sous une même table, cassant la lisibilité
--    que 0014 a posée à dessein (voir sa tête de fichier).
--
--    TENANT, PAS SITE — doctrine reprise, pas rouverte : 0014 a tranché pour le bloc créancier
--    « le tenant est l'entité juridique de ce modèle, pas d'override par site » (la numérotation
--    continue des factures est déjà par tenant/année, ce qui présuppose exactement ça). `RF-117`
--    est de la même nature : une question de GOUVERNANCE (qui, dans le tenant, a l'autorité de
--    rendre de l'argent sans validation d'un supérieur), pas une question opérationnelle propre à
--    un site (horaires d'ouverture, capacité journalière — `parametre_site`). Un groupe
--    multi-sites qui voudrait un plafond différent par site changerait en réalité sa politique de
--    délégation d'autorité entre sites, ce qui reste un choix DU TENANT (l'entité juridique qui
--    emploie le réceptionnaire), pas une propriété physique du site. `parametre_atelier` est de
--    toute façon déjà PK = tenant_id : y ajouter la colonne suit cette doctrine sans qu'elle ait
--    à être rediscutée.
--
-- 2. NOM DE COLONNE ET TYPE : `plafond_avoir_receptionnaire_centimes`, `integer`, jamais de
--    float (règle non négociable du dépôt). Le nom porte explicitement `receptionnaire` — et non
--    un `plafond_avoir_centimes` générique — parce que `direction`/`comptable` ne sont JAMAIS
--    plafonnés par `RF-117` (matrice-droits.ts : ce sont eux qui « prennent le relais » au-delà du
--    plafond) : une colonne au nom générique laisserait croire à un futur lecteur qu'elle borne
--    tout le monde, ou ouvrirait la porte à un mésusage qui l'appliquerait par erreur à
--    `direction`. Un nom précis évite l'ambiguïté sans qu'aucun commentaire ne suffise à la
--    dissiper de façon aussi fiable qu'un nom qui ne peut pas se lire autrement.
--
-- 3. VALEUR PAR DÉFAUT — TRANCHÉ À NULL, ET CE QUE ÇA IMPLIQUE :
--    NULL = « aucun plafond convenu », exactement la sémantique déjà posée par `plafond_defaut_
--    centimes` (§1b). Choix délibéré, pas un défaut Postgres oublié :
--      - un défaut chiffré (« 500.- », « 5'000.- ») serait un montant INVENTÉ par cet agent, sans
--        base métier ni mandat de @laupernoe pour le fixer — faux pour un garage roulant sur de petites
--        interventions comme pour un garage qui facture des groupes motopropulseurs, et personne
--        ne saurait d'où le chiffre sort une fois en production ;
--      - NULL préserve EXACTEMENT le comportement actuel de tous les tenants existants (aucun
--        d'entre eux ne voit son réceptionnaire perdre un droit qu'il avait la veille) — cette
--        migration n'est pas un point de bascule comportementale, seulement l'ouverture d'un
--        paramètre qui n'existait pas ;
--      - CONSÉQUENCE ASSUMÉE ET EXPLICITE : le dégradé documenté dans `matrice-droits.ts`
--        (`receptionnaire` sans aucune limite d'émission d'avoir) RESTE EN PLACE tant qu'aucun
--        paramétrage n'a positionné cette colonne pour un tenant donné — la colonne seule ne
--        plafonne rien (voir « HORS PÉRIMÈTRE » ci-dessous). C'est un choix conscient : mieux
--        vaut un dégradé qui reste identifiable et déjà signalé qu'un chiffre arbitraire qui
--        donnerait la fausse impression que `RF-117` est réglé.
--
-- 4. CONTRAINTE CHECK : positivité, MÊME BORNES que `parametre_atelier_plafond_defaut_chk`
--    (`is null or between 0 and 100000000`, soit 0 à CHF 1'000'000.-) — même famille de valeur,
--    même garde-fou contre une saisie manifestement fautive (signe négatif, faute de frappe sur
--    le nombre de zéros). `0` reste une valeur légale et volontaire : elle signifierait « toute
--    émission d'avoir par un réceptionnaire, même de CHF 0.01, doit escalader » — cohérent avec
--    la sémantique déjà retenue pour `plafond_defaut_centimes` (« 0 = accord requis pour tout »),
--    pas une valeur à exclure par erreur de symétrie.
--
-- HORS PÉRIMÈTRE DE CETTE MIGRATION (`apps/api/src/db/` seulement) — CE QUI RESTE À FAIRE POUR
-- QUE `RF-117` SOIT RÉELLEMENT APPLIQUÉ :
--   - une vérification dans le service d'émission d'avoir (`apps/api/src/facturation/documents/`,
--     périmètre d'un autre agent) qui lit `parametre_atelier.plafond_avoir_receptionnaire_
--     centimes` pour le tenant courant et refuse/redirige l'émission par un `receptionnaire` au-
--     delà du plafond quand il est renseigné ;
--   - probablement un endpoint de paramétrage (le module `apps/api/src/parametrage/parametres-
--     atelier/` existe déjà et gouverne `parametre_atelier` — voir `service-parametres-atelier.ts`)
--     pour que `direction`/`comptable` puissent renseigner ce plafond depuis l'écran de
--     paramétrage, plutôt que par une commande SQL manuelle ;
--   - la mise à jour de `matrice-droits.ts` (§EMISSION_AVOIR) pour retirer la mention « NON
--     IMPLÉMENTÉ » une fois le contrôle applicatif posé.
--   Cette migration ne touche à AUCUN de ces trois points — ils appartiennent à d'autres
--   périmètres et restent à la charge de @laupernoe pour les faire suivre.
--
-- Réversible : migrations/down/0018_plafond_avoir_receptionnaire.down.sql.
-- =============================================================================================


-- ---------------------------------------------------------------------------------------------
-- 1. Colonne — nullable, NULL = aucun plafond convenu (§3 ci-dessus).
-- ---------------------------------------------------------------------------------------------

alter table public.parametre_atelier
  add column plafond_avoir_receptionnaire_centimes integer null;

alter table public.parametre_atelier
  add constraint parametre_atelier_plafond_avoir_receptionnaire_chk
  check (plafond_avoir_receptionnaire_centimes is null
         or plafond_avoir_receptionnaire_centimes between 0 and 100000000);


-- ---------------------------------------------------------------------------------------------
-- 2. Commentaire de table complété — texte de 0005 CONSERVÉ EN ENTIER, une phrase ajoutée à la
--    fin. Le DOWN restaure le texte de 0005 mot pour mot (même discipline que 0016/0017).
-- ---------------------------------------------------------------------------------------------

comment on table public.parametre_atelier is
  'Paramètres structurants du tenant (P-xx de la spécification). Une ligne par tenant, id = '
  'tenant_id. controle_qualite restreint à jamais|toujours au lot 1 (Δ3 du plan d''exécution) ; '
  'fonctionnalites n''est PAS une colonne, calculé côté service. '
  'plafond_avoir_receptionnaire_centimes (0018, RF-117) : NULL = aucun plafond convenu (défaut, '
  'comportement actuel préservé — voir matrice-droits.ts, dégradé documenté) ; 0 = toute émission '
  'd''avoir par un réceptionnaire doit escalader à direction/comptable ; n>0 = plafond nominal. '
  'Colonne seule : ne plafonne rien tant que le service d''émission (facturation/documents/) ne '
  'la consulte pas.';


-- ---------------------------------------------------------------------------------------------
-- Assertions de fin de migration
-- ---------------------------------------------------------------------------------------------

do $$
begin
  -- 1. Colonne présente, nullable, type integer.
  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'parametre_atelier'
       and column_name = 'plafond_avoir_receptionnaire_centimes'
       and is_nullable = 'YES'
       and data_type = 'integer'
  ) then
    raise exception '0018 : parametre_atelier.plafond_avoir_receptionnaire_centimes absente, non-nullable, ou de mauvais type après migration.';
  end if;

  -- 2. La contrainte CHECK est bien posée.
  if not exists (
    select 1
      from pg_catalog.pg_constraint
     where conrelid = 'public.parametre_atelier'::regclass
       and conname = 'parametre_atelier_plafond_avoir_receptionnaire_chk'
  ) then
    raise exception '0018 : contrainte parametre_atelier_plafond_avoir_receptionnaire_chk absente.';
  end if;

  -- 3. Aucune ligne existante n'a été altérée : la colonne neuve est NULL partout où
  --    `parametre_atelier` a déjà des lignes (garage de démo compris) — expand pur, aucune
  --    valeur inventée n'a été écrite.
  if exists (
    select 1 from public.parametre_atelier where plafond_avoir_receptionnaire_centimes is not null
  ) then
    raise exception '0018 : une ligne de parametre_atelier porte une valeur non-NULL pour plafond_avoir_receptionnaire_centimes juste après la migration — une valeur a été inventée quelque part.';
  end if;
end
$$;
