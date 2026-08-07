-- =============================================================================================
-- 0046_ligne_or_types_sans_temps_et_delai_paiement_tenant.sql
--
-- Deux correctifs indépendants, arbitrés sans @laupernoe (délégation explicite de l'orchestrateur —
-- « tranche donc, mais documente chaque décision de façon qu'il puisse la rejeter facilement »).
-- Regroupés dans une SEULE migration parce qu'un seul numéro de migration a été vérifié libre
-- pour cet agent au moment d'écrire ce fichier (0045 est la dernière migration existante ; un
-- autre agent travaille en parallèle sur apps/api/src/atelier/ et apps/api/src/auth/ et pourrait
-- lui aussi consommer un numéro — repartir en devinant un second aurait risqué une collision).
--
-- NUMÉROTATION : 0045 est la dernière migration existante au moment où cette tâche a été
-- assignée (`0045_relances_socle.sql`) — vérifié en exécution avant d'écrire ce fichier. Cette
-- migration prend 0046, et SEULEMENT 0046.
--
-- =================================================================================================
-- PARTIE A — issue #14 : « une pièce doit pointer du temps pour sortir du stock »
-- =================================================================================================
--
-- CONSTAT (voir l'issue et son commentaire, qui démontre que ce n'est pas une gêne mais un
-- BLOCAGE DUR) : une ligne d'OR de type `piece` ne peut passer `validee -> realisee` qu'en
-- transitant par `en_cours` — transition que SEUL le pointage produit (RM-117,
-- `pointage/regles-pointage.ts::ligneDoitPasserEnCours`). Poser une plaquette de frein oblige donc
-- à chronométrer du temps sur la ligne de PIÈCE elle-même, ce qui fausse le rendement atelier et,
-- pire, rend un OR contenant une ligne de pièce IMPOSSIBLE à terminer sans ce détour : `POST
-- .../terminer` refuse tant qu'une ligne validée n'est pas réalisée.
--
-- DÉCISION ARBITRÉE ICI, SANS LE MAINTENEUR : autoriser `validee -> realisee` DIRECTEMENT pour les lignes
-- dont le type ne consomme pas de temps de main-d'œuvre garage — PAS pour toutes les lignes,
-- sans quoi une ligne de main-d'œuvre pourrait se déclarer réalisée sans jamais être pointée, ce
-- qui casserait le suivi du temps productif (RM-87 et suivantes) que le pointage existe pour
-- garantir.
--
--   AUTORISÉS en direct (7 types) :
--     - piece            : le cas de l'issue. Sortie de stock via RP-21 (réservation), déclenchée
--                           par le passage à `realisee`, PAS par le pointage — voir PARTIE A.3.
--     - fourniture        : même nature que `piece` (consommable posé, pas de temps propre).
--     - produit_atelier    : produit vendu/consommé (huile, additif…), même raisonnement que
--                           `piece`/`fourniture` — aucun temps distinct à chronométrer.
--     - taxe               : ligne purement financière (taxe d'élimination…), jamais un geste
--                           atelier.
--     - remise             : ajustement financier, jamais un geste atelier.
--     - texte              : ligne informative libre, sans exécution ni stock.
--     - sous_traitance     : travail réalisé PAR UN TIERS (carrossier externe, reprogrammation
--                           constructeur…) — le garage ne pointe jamais de temps sur le travail
--                           d'un sous-traitant, il constate sa réalisation (livraison, facture
--                           reçue). Le pointage n'a physiquement aucun sens ici.
--
--   RESTENT via `en_cours` (donc via pointage, INCHANGÉ) — 3 types :
--     - main_oeuvre_bareme, main_oeuvre_temps_reel : travail du garage lui-même, RM-87→RM-99
--       existe précisément pour le mesurer. `ligne_or_taux_horaire_requis_chk` (0008) impose déjà
--       un taux horaire à ces deux seuls types — cohérent avec le fait qu'ils restent chronométrés.
--     - forfait : prix fixe, mais TRAVAIL RÉEL du garage (ex. « forfait vidange ») — un forfait
--       reste un geste atelier mesurable pour le rendement, contrairement aux 7 types ci-dessus qui
--       n'impliquent aucune exécution du garage lui-même ou aucune exécution du tout. JUGEMENT DE
--       CET AGENT, PAS DANS LA LISTE EXPLICITE DE L'ISSUE : à confirmer par expert-métier si le
--       terrain contredit — revenir en arrière consiste à retirer `('ligne_or','validee',
--       'realisee','forfait')` s'il fallait l'assouplir aussi, ou l'inverse (aucune des 7 lignes
--       insérées ci-dessous n'est requise si le jugement était trop généreux).
--
-- MÉCANISME : `transition_autorisee` (0003) n'a jamais distingué le TYPE de la ligne, seulement
-- (entite, statut_depuis, statut_vers) — juste pour `ordre_reparation`/`ligne_or`/etc. considérés
-- comme des blocs monolithiques. Cette migration lui ajoute une colonne `type_ligne` (sentinel
-- '*' = « tout type », comportement historique préservé pour les 27 lignes existantes) et étend
-- les DEUX fonctions génériques (`transition_autorisee_valide_contenu`,`verifier_transition`) pour
-- en tenir compte — jamais une règle codée en dur dans le service NestJS
-- (`atelier/service-ligne-or.ts`, HORS PÉRIMÈTRE DE CET AGENT, propriété de l'agent parallèle) :
-- `ServiceLigneOr.marquerRealisee` appelle `transitionnerLigne`, qui fait un UPDATE nu — c'est le
-- trigger `ligne_or_verifier_transition` (déjà posé par 0008) qui gouverne, donc CETTE migration
-- suffit à débloquer #14 sans toucher une ligne de TypeScript dans `atelier/`.
--
-- `to_jsonb(new)->>'type'` (dans `verifier_transition`, §4 plus bas) lit la colonne `type` SI ELLE
-- EXISTE sur la table qui déclenche le trigger, NULL sinon — idiome déjà utilisé par le trigger
-- d'audit générique `auditer_atelier` (0004_transverse.sql, `to_jsonb(new)`/`to_jsonb(old)`), donc
-- rien de nouveau pour ce moteur. Les sept autres entités qui posent ce trigger
-- (`ordre_reparation`, `commande_fournisseur`, `pointage`, `vehicule_stock`, `dossier_vente`,
-- `reprise`, `financement_vente`) n'ont pas de transition type-dépendante : `to_jsonb(new)->>'type'`
-- y rend NULL (ou une valeur sans rapport si l'une d'elles a par ailleurs sa propre colonne
-- `type` — sans conséquence, le filtre `t.entite = entite_cible` isole déjà chaque entité, aucune
-- ligne `type_ligne`-spécifique n'existe pour elles), coalescé vers le sentinel '*', qui matche
-- toujours — comportement strictement inchangé pour ces sept entités.
--
-- SIGNALÉ À L'AGENT PROPRIÉTAIRE DE `apps/api/src/atelier/` : `etat-affiche.ts` porte un miroir
-- TypeScript de `transition_autorisee`, mais restreint aux transitions d'ORDRE DE RÉPARATION
-- (`ACTIONS_DEPUIS_STATUT`), jamais aux transitions de LIGNE — vérifié, aucun mirror TS n'existe
-- pour `ligne_or`, donc rien à resynchroniser côté TypeScript pour cette migration. À reconfirmer
-- si un tel mirror naît plus tard.
--
-- =================================================================================================
-- PARTIE B — issue #17 : « une facture sans échéance est invisible aux relances »
-- =================================================================================================
--
-- CONSTAT : `document_vente.date_echeance` (calculée à l'émission,
-- `facturation/documents/echeance.ts::calculerDateEcheance`) reste `null` quand le client n'a
-- AUCUNE condition commerciale en vigueur portant `delai_paiement_jours` — chemin par défaut d'un
-- client créé via le formulaire standard, qui n'envoie jamais de conditions. Une facture sans
-- échéance est invisible à `relances/regles-planification.ts`, qui calcule chaque palier depuis
-- cette date : ELLE NE SERA JAMAIS RELANCÉE.
--
-- DÉCISION ARBITRÉE ICI, SANS LE MAINTENEUR : un délai de paiement par défaut, PAR TENANT, utilisé à
-- l'émission quand le client n'en a pas — jamais un « 30 » codé en dur côté application (l'en-tête
-- de `echeance.ts` refusait déjà explicitement d'inventer une colonne qui n'existait pas : elle
-- existe maintenant). Le délai du CLIENT, quand il existe, l'emporte TOUJOURS — ce correctif ne
-- change rien pour un client déjà correctement paramétré.
--
-- POURQUOI LE TENANT ET PAS LE SITE : PF-04 (le modèle documentaire déjà cité par `echeance.ts`)
-- documente un délai par défaut au niveau du GARAGE (« 30 jours net, sans escompte »), pas par
-- site — un même garage n'a normalement qu'une politique de recouvrement, pas une par comptoir.
-- `tenant_bloc_creancier` (migration 0014) est déjà LUI AUSSI porté par tenant seul, sans site
-- (« arbitrage @laupernoe 30.07.2026 » cité dans son fichier Drizzle) : même niveau, même précédent.
-- Ajouter le site plus tard (colonne nullable sur `parametre_site`, propriété d'un autre module)
-- resterait une migration additive si le terrain le réclamait — aucune décision ici ne le bloque.
--
-- POURQUOI LA COLONNE VIT SUR `tenant` ET NON SUR `tenant_bloc_creancier` : `tenant_bloc_creancier`
-- est nommément le bloc CRÉANCIER du QR-facture (IBAN, adresse bancaire) — y ajouter un délai de
-- paiement, sans rapport avec le paiement PAR QR, aurait mélangé deux responsabilités dans une
-- table dont le nom promet autre chose. `tenant` porte déjà les réglages généraux du tenant
-- (langue par défaut, pays…) : c'est le bon endroit pour un réglage général de facturation qui
-- n'est ni bancaire ni spécifique à un module métier.
--
-- CE QUE CETTE MIGRATION NE FAIT PAS : elle n'expose AUCUN endpoint pour modifier cette valeur
-- (`apps/api/src/parametrage/**` est hors du périmètre déclaré de cet agent — facturation/db
-- uniquement). La colonne est déjà « paramétrable » au sens propre (une valeur en base, PAS un
-- littéral dans le code, modifiable par une future écriture SQL ou un futur écran), et porte une
-- valeur par défaut (30, usage suisse courant, « net 30 ») dès sa création — donc UTILISABLE
-- immédiatement sans aucune action de paramétrage. Exposer un `PATCH` pour l'éditer (probablement
-- à côté de `parametrage/bloc-creancier`) est un travail de suivi, signalé mais pas fait ici.
--
-- POUR REVENIR EN ARRIÈRE SUR CETTE DÉCISION (#17) : supprimer la colonne (voir le DOWN de cette
-- migration) fait redevenir `dateEcheance` systématiquement `null` pour tout client sans
-- conditions — exactement le comportement d'avant ce correctif. Aucune donnée n'est perdue :
-- aucune facture déjà émise n'est recalculée (RF-04/MD-20 : `date_echeance` est figée à
-- l'émission, jamais réévaluée après coup), seules les ÉMISSIONS FUTURES seraient à nouveau
-- affectées.
--
-- Réversible : migrations/down/0046_ligne_or_types_sans_temps_et_delai_paiement_tenant.down.sql.
-- Aucune migration de données : la colonne `type_ligne` ajoutée à `transition_autorisee` prend sa
-- valeur par défaut '*' pour les 27 lignes existantes (comportement inchangé), et
-- `tenant.delai_paiement_jours_defaut` prend 30 pour tous les tenants existants (aucun tenant
-- n'avait de valeur avant : rien n'est écrasé, il n'y avait rien).
-- =============================================================================================


-- ---------------------------------------------------------------------------------------------
-- PARTIE A.1 — transition_autorisee gagne `type_ligne`.
-- ---------------------------------------------------------------------------------------------

alter table public.transition_autorisee
  add column type_ligne text not null default '*';

comment on column public.transition_autorisee.type_ligne is
  'Sentinel ''*'' = transition valable pour TOUT type de ligne (comportement historique de 0003, '
  'valeur par défaut des 27 lignes chargées avant 0046). Une valeur précise restreint la '
  'transition à CE type de ligne — réservé à l''entité ''ligne_or'' aujourd''hui (seule à porter '
  'une colonne de type distinctive, public.type_ligne_or), validé par '
  'transition_autorisee_valide_contenu(). Ajouté par 0046 (issue #14) pour permettre '
  'validee -> realisee directement sur les types de ligne qui ne consomment pas de temps de '
  'main-d''œuvre garage (piece, fourniture, produit_atelier, taxe, remise, texte, sous_traitance), '
  'sans l''ouvrir aux lignes de main-d''œuvre/forfait, qui doivent rester chronométrées via le '
  'pointage.';

alter table public.transition_autorisee
  drop constraint transition_autorisee_pk;

alter table public.transition_autorisee
  add constraint transition_autorisee_pk
  primary key (entite, statut_depuis, statut_vers, type_ligne);

alter table public.transition_autorisee
  add constraint transition_autorisee_type_ligne_non_vide_chk
  check (length(btrim(type_ligne)) > 0);


-- ---------------------------------------------------------------------------------------------
-- PARTIE A.2 — transition_autorisee_valide_contenu() : valide aussi `type_ligne`.
--
-- Corps IDENTIQUE à 0003 jusqu'à l'ancien `return new;` inclus (rien n'est retiré, rien n'est
-- réordonné) — seul le bloc `type_ligne` est ajouté juste avant. Même doctrine que le reste de
-- cette fonction : une transition mal orthographiée doit échouer À LA MIGRATION, pas être lue en
-- silence comme « transition inexistante » en production.
-- ---------------------------------------------------------------------------------------------

create or replace function public.transition_autorisee_valide_contenu() returns trigger
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

  -- 0046 : type_ligne. '*' est toujours valide (aucune distinction demandée). Une valeur précise
  -- n'est acceptée que pour l'entité 'ligne_or' (seule à porter aujourd'hui une colonne de type
  -- utilisable ici, public.type_ligne_or) et doit être un label RÉEL de cet enum — même garde-fou
  -- que statut_depuis/statut_vers ci-dessus.
  if new.type_ligne <> '*' then
    if new.entite <> 'ligne_or' then
      raise exception
        'transition_autorisee : type_ligne « % » réservé à l''entité « ligne_or », pas « % ». Utilisez ''*'' pour cette entité.',
        new.type_ligne, new.entite;
    end if;

    if not exists (
      select 1 from pg_catalog.pg_enum e
       where e.enumtypid = 'public.type_ligne_or'::regtype and e.enumlabel = new.type_ligne
    ) then
      raise exception
        'transition_autorisee : « % » n''est pas une valeur de public.type_ligne_or. Valeurs admises : %.',
        new.type_ligne,
        (select string_agg(e.enumlabel, ', ' order by e.enumsortorder)
           from pg_catalog.pg_enum e where e.enumtypid = 'public.type_ligne_or'::regtype);
    end if;
  end if;

  return new;
end
$fn$;


-- ---------------------------------------------------------------------------------------------
-- PARTIE A.3 — verifier_transition() : filtre aussi par type_ligne quand le référentiel le
-- demande.
--
-- Corps IDENTIQUE à 0003 pour tout ce qui précède la lecture du référentiel — seule la clause
-- WHERE des deux requêtes sur transition_autorisee gagne la condition type_ligne, précédée du
-- calcul de `type_ligne_actuel`.
-- ---------------------------------------------------------------------------------------------

create or replace function public.verifier_transition() returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $fn$
declare
  entite_cible      public.entite_auditee;
  depuis            text;
  vers              text;
  type_ligne_actuel text;
  possibles         text;
  indication        text;
begin
  if tg_nargs < 1 or tg_argv[0] is null then
    raise exception
      'verifier_transition() posée sans argument sur « % ». Attendu : create trigger … execute function public.verifier_transition(''<entite_auditee>'').',
      tg_table_name
      using errcode = 'ZDFA1';
  end if;

  if tg_op <> 'UPDATE' then
    raise exception
      'verifier_transition() posée sur % pour « % » : ce trigger ne vaut que pour BEFORE UPDATE.',
      tg_op, tg_table_name
      using errcode = 'ZDFA1';
  end if;

  entite_cible := tg_argv[0]::public.entite_auditee;

  depuis := old.statut::text;
  vers   := new.statut::text;

  if depuis is not distinct from vers then
    return new;
  end if;

  -- 0046 : `to_jsonb(new)->>'type'` lit la colonne `type` SI ELLE EXISTE sur la table qui
  -- déclenche ce trigger (rend NULL sinon) — même idiome que le trigger d'audit générique
  -- `auditer_atelier` (0004_transverse.sql). Seule `ligne_or` porte des lignes type_ligne-
  -- spécifiques dans le référentiel aujourd'hui ; pour toutes les autres entités, le sentinel '*'
  -- matche systématiquement, comportement STRICTEMENT INCHANGÉ.
  type_ligne_actuel := coalesce(to_jsonb(new) ->> 'type', '*');

  if exists (
    select 1
      from public.transition_autorisee t
     where t.entite        = entite_cible
       and t.statut_depuis = depuis
       and t.statut_vers   = vers
       and (t.type_ligne = '*' or t.type_ligne = type_ligne_actuel)
  ) then
    return new;
  end if;

  select string_agg(distinct t.statut_vers, ', ' order by t.statut_vers)
    into possibles
    from public.transition_autorisee t
   where t.entite = entite_cible
     and t.statut_depuis = depuis
     and (t.type_ligne = '*' or t.type_ligne = type_ligne_actuel);

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


-- ---------------------------------------------------------------------------------------------
-- PARTIE A.4 — les 7 transitions type-spécifiques, exactement les types qui ne consomment pas de
-- temps de main-d'œuvre garage (voir le raisonnement détaillé dans l'en-tête de ce fichier).
-- ---------------------------------------------------------------------------------------------

insert into public.transition_autorisee (entite, statut_depuis, statut_vers, exige_motif, type_ligne) values
  ('ligne_or', 'validee', 'realisee', false, 'piece'),           -- le cas de l'issue #14
  ('ligne_or', 'validee', 'realisee', false, 'fourniture'),
  ('ligne_or', 'validee', 'realisee', false, 'produit_atelier'),
  ('ligne_or', 'validee', 'realisee', false, 'taxe'),
  ('ligne_or', 'validee', 'realisee', false, 'remise'),
  ('ligne_or', 'validee', 'realisee', false, 'texte'),
  ('ligne_or', 'validee', 'realisee', false, 'sous_traitance');


-- ---------------------------------------------------------------------------------------------
-- PARTIE B.1 — tenant.delai_paiement_jours_defaut (issue #17).
-- ---------------------------------------------------------------------------------------------

alter table public.tenant
  add column delai_paiement_jours_defaut integer not null default 30;

comment on column public.tenant.delai_paiement_jours_defaut is
  'Délai de paiement PAR DÉFAUT (jours calendaires), utilisé à l''émission d''une facture '
  '(RF-04/PF-04, facturation/documents/echeance.ts) quand le client n''a AUCUNE condition '
  'commerciale en vigueur portant delai_paiement_jours — chemin par défaut d''un client créé sans '
  'paramétrage (issue #17). Le délai du CLIENT, quand il existe, l''emporte TOUJOURS. 30 = usage '
  'suisse courant (« net 30 »). PARAMÉTRABLE par tenant : aucun endpoint de modification n''est '
  'posé par cette migration (hors périmètre facturation/db de l''agent qui l''a écrite) — la '
  'colonne est néanmoins déjà une vraie donnée paramétrable, pas un défaut codé en dur côté '
  'application, et porte une valeur exploitable immédiatement.';

alter table public.tenant
  add constraint tenant_delai_paiement_jours_defaut_positif_chk
  check (delai_paiement_jours_defaut >= 0);


-- ---------------------------------------------------------------------------------------------
-- Assertions de fin de migration
-- ---------------------------------------------------------------------------------------------

do $$
declare
  n integer;
  echoue boolean;
begin
  -- A.1 : colonne type_ligne présente, NOT NULL, défaut '*'.
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'transition_autorisee'
       and column_name = 'type_ligne' and is_nullable = 'NO' and data_type = 'text'
       and column_default = '''*''::text'
  ) then
    raise exception '0046 : transition_autorisee.type_ligne absente, nullable, mal typée, ou sans défaut ''*''.';
  end if;

  -- A.1 : nouvelle PK à 4 colonnes.
  if (
    select count(*) from pg_catalog.pg_constraint
     where conname = 'transition_autorisee_pk' and conrelid = 'public.transition_autorisee'::regclass
       and array_length(conkey, 1) = 4
  ) <> 1 then
    raise exception '0046 : transition_autorisee_pk doit désormais porter 4 colonnes.';
  end if;

  -- A.4 : les 27 lignes historiques restent à type_ligne = '*' (comportement inchangé).
  select count(*) into n
    from public.transition_autorisee where type_ligne <> '*';
  if n <> 7 then
    raise exception '0046 : % ligne(s) à type_ligne <> ''*'', 7 attendues (les 7 nouvelles).', n;
  end if;

  -- A.4 : exactement les 7 types attendus, aucun autre, pour validee -> realisee.
  if (
    select count(*) from public.transition_autorisee
     where entite = 'ligne_or' and statut_depuis = 'validee' and statut_vers = 'realisee'
       and type_ligne = any (array[
         'piece', 'fourniture', 'produit_atelier', 'taxe', 'remise', 'texte', 'sous_traitance'
       ])
  ) <> 7 then
    raise exception '0046 : les 7 transitions type-spécifiques validee -> realisee sont incomplètes.';
  end if;

  -- A.4 : la transition générique validee -> realisee (type_ligne = '*') ne doit toujours PAS
  -- exister — sinon main_oeuvre_bareme/main_oeuvre_temps_reel/forfait sauteraient aussi le
  -- pointage, ce qui n'est PAS la décision prise.
  if exists (
    select 1 from public.transition_autorisee
     where entite = 'ligne_or' and statut_depuis = 'validee' and statut_vers = 'realisee'
       and type_ligne = '*'
  ) then
    raise exception '0046 : validee -> realisee ne doit PAS être ouverte à tous les types (''*'').';
  end if;

  -- A.2/A.3 : le garde-fou refuse un type_ligne hors énumération sur ligne_or — vérifié EN
  -- EXÉCUTION, pas seulement supposé depuis le texte de la fonction.
  echoue := false;
  begin
    insert into public.transition_autorisee (entite, statut_depuis, statut_vers, type_ligne)
    values ('ligne_or', 'realisee', 'facturee', 'type_inexistant');
  exception when others then
    echoue := true;
  end;
  if not echoue then
    raise exception '0046 : transition_autorisee_valide_contenu() aurait dû refuser un type_ligne inconnu.';
  end if;

  -- A.2/A.3 : le garde-fou refuse un type_ligne non '*' sur une entité qui ne connaît pas de
  -- distinction par type (ordre_reparation).
  echoue := false;
  begin
    insert into public.transition_autorisee (entite, statut_depuis, statut_vers, type_ligne)
    values ('ordre_reparation', 'facture', 'restitue', 'piece');
  exception when others then
    echoue := true;
  end;
  if not echoue then
    raise exception '0046 : transition_autorisee_valide_contenu() aurait dû refuser type_ligne <> ''*'' sur ordre_reparation.';
  end if;

  -- B.1 : tenant.delai_paiement_jours_defaut présente, NOT NULL, entier, défaut 30.
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'tenant'
       and column_name = 'delai_paiement_jours_defaut' and is_nullable = 'NO'
       and data_type = 'integer' and column_default = '30'
  ) then
    raise exception '0046 : tenant.delai_paiement_jours_defaut absente, nullable, mal typée, ou sans défaut 30.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conname = 'tenant_delai_paiement_jours_defaut_positif_chk'
       and conrelid = 'public.tenant'::regclass
  ) then
    raise exception '0046 : tenant_delai_paiement_jours_defaut_positif_chk absente après migration.';
  end if;
end
$$;
