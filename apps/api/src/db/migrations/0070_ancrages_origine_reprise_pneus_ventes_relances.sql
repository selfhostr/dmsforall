-- =============================================================================================
-- 0070_ancrages_origine_reprise_pneus_ventes_relances.sql — sept tables reprises n'ont nulle part
-- où déposer l'identifiant d'origine, exactement le constat qui a motivé 0066, pour les trois
-- domaines tranchés dans `docs/reprise/decisions.md` (D-40, D-41, D-42, D-45) le 25.08.2026 :
-- pneus (`depot_pneus`), ventes VN/VO (`dossier_vente`, `vehicule_stock`, `reprise`,
-- `financement_vente`) et relances (`relance_planifiee`) — plus `commande_fournisseur` (pièces,
-- D-40), oubliée par 0066 au même titre.
--
-- CONSTAT : `docs/reprise/decisions.md`, section « Ce qui reste ouvert malgré ces arbitrages » —
-- 0066 a posé `origine`/`numero_origine` sur `client`, `vehicule`, `article`, `fournisseur`,
-- `paiement`, et s'est arrêtée là. `depot_pneus`, `commande_fournisseur`, `dossier_vente`,
-- `vehicule_stock`, `reprise`, `financement_vente` et `relance_planifiee` n'ont reçu ni l'une ni
-- l'autre. Sans elles, une ligne reprise sur l'un de ces sept objets n'est ni réconciliable avec
-- son enregistrement source, ni rejouable sans risque de doublon.
--
-- DÉCISION : REPREND EXACTEMENT LE MOTIF DE 0066 (lui-même le motif de `ordre_reparation`, 0011)
-- SANS AUCUN ÉCART, sur les sept tables — relu table par table avant d'écrire cette migration,
-- aucune n'a de dimension `type` ni de `numero_sequence` séparé qui justifierait de dévier vers le
-- patron plus complexe de `document_vente` (0010) :
--   - même enum, réutilisé tel quel : `public.origine_document` ('dfa' | 'reprise').
--   - même sémantique : `numero_origine` = la chaîne source VERBATIM, jamais retouchée. NULL pour
--     une ligne créée normalement par DFA.
--   - même contrainte de cohérence à deux états : `(origine = 'dfa') = (numero_origine is null)`.
--   - même unicité : index unique PARTIEL `(tenant_id, numero_origine) where numero_origine is
--     not null` — idempotence de l'import PAR TENANT (règle n°1 du projet).
--
-- UNE SEULE MIGRATION POUR SEPT TABLES, même raison que 0066 (un deuxième développeur travaille en
-- parallèle sur ce dépôt ; un seul numéro réservé évite de bloquer inutilement la suite).
--
-- EXPAND SEUL : `depot_pneus`, `commande_fournisseur`, `dossier_vente`, `vehicule_stock`,
-- `financement_vente`, `relance_planifiee` contiennent des données réelles dès qu'un tenant existe
-- (`reprise`, la table de reprise-véhicule des ventes VN/VO, peut être vide sur un tenant neuf mais
-- suit le même patron par cohérence — aucune raison de la traiter différemment).
--   - `origine` : `not null default 'dfa'` — DEFAULT CONSTANT (littéral d'enum), opération de
--     catalogue seule depuis PG 11, aucune réécriture de table.
--   - `numero_origine` : nullable sans défaut, ajout de catalogue pur.
--
-- INDEX ET `CONCURRENTLY` : même raisonnement que 0066 — le runner (`apps/api/src/db/migrer.ts`)
-- exécute chaque fichier dans une transaction, `CREATE INDEX CONCURRENTLY` y est impossible. Sans
-- objet de toute façon : `numero_origine` vient d'être ajoutée sur les sept tables, NULL partout à
-- l'instant de cette migration — l'index partiel n'indexe donc ZÉRO ligne à sa création.
--
-- CE QUI N'EST PAS FAIT ICI, VOLONTAIREMENT, MÊME RAISONNEMENT QUE 0066 :
--   - Aucune politique RLS n'est modifiée : les sept tables portent déjà une politique générique
--     `using (tenant_id = public.tenant_courant())` (0024/0032/0043/0045), indépendante de la
--     liste des colonnes — vérifié en lisant chaque bloc RLS avant d'écrire cette migration
--     (`grant … / enable row level security / create policy …_isolation_tenant / …_migrator`),
--     pas supposé.
--   - Aucun GRANT ajusté : les GRANT existants sont posés au niveau TABLE (`select, insert,
--     update`), pas au niveau colonne — une nouvelle colonne en hérite sans rien à faire.
--   - Aucun trigger d'audit modifié : `auditer_atelier()` (0004) journalise `to_jsonb(new)`/
--     `to_jsonb(old)` génériquement, sans liste de colonnes fixe — une colonne neuve apparaît dans
--     `audit_atelier.valeur_avant`/`valeur_apres` sans changement de trigger.
--
-- ÉCART AU PATRON 0066, ASSUMÉ ET JUSTIFIÉ — nom de colonne sur `commande_fournisseur` (§2
-- ci-dessous) : cette table porte DÉJÀ une colonne `origine` (`origine_commande_fournisseur`,
-- 0024, RP-26 : 'manuelle' | 'reservation_rupture' | 'reapprovisionnement' — POURQUOI la commande
-- est née dans DFA, sans aucun rapport avec la provenance DFA/import). Réutiliser le nom `origine`
-- pour l'ancrage de reprise entrerait directement en collision de colonne — mesuré en lisant
-- `schema/pieces/commande-fournisseur.ts` avant d'écrire cette migration, pas supposé. Ancrage
-- posé sous le nom `origine_reprise` sur CETTE SEULE table (même enum `origine_document`, même
-- sémantique, même CHECK, même index) ; `numero_origine` ne collisionne avec rien et garde son nom
-- standard. Aucune des six autres tables n'a ce problème (vérifié individuellement, colonne par
-- colonne, avant d'écrire chaque bloc ci-dessous).
--
-- ÉCART AU PATRON 0066, ASSUMÉ ET JUSTIFIÉ — `relance_planifiee.note_reprise` (§7 ci-dessous) :
-- D-45 (« relance déjà engagée : rien de réactivé, mais signalé ») exige de pouvoir porter, sur la
-- créance reprise, la mention « déjà relancée N fois côté ancien système, à vérifier avant tout
-- nouvel envoi ». Aucune colonne existante ne convient : `document_vente`/`ordre_reparation` (les
-- tables qui portent réellement une créance facturée) n'ont ni note ni commentaire libre, et sont
-- de toute façon HORS PÉRIMÈTRE de cette migration — leur ancrage est celui posé par 0066, une
-- migration déjà versionnée, jamais rouverte. `relance_planifiee` est donc le seul point d'ancrage
-- disponible dans le périmètre de ce chantier pour porter ce signalement, sous forme d'un texte
-- libre nullable — PAS un compteur structuré (pas de garantie qu'« N fois » soit un nombre fiable
-- selon la source), PAS une ligne réactivée (D-45 l'exclut explicitement).
-- CE QUI N'EST PAS TRANCHÉ ICI, SIGNALÉ : aucun écrivain d'import n'existe encore pour le domaine
-- `relances` (voir `packages/shared/src/contrats/reprise.ts::DOMAINES_REPRISE`, domaine ajouté
-- SANS écrivain concret par cette même livraison — extension seam déjà en place pour
-- `fournisseurs`/`articles_stock`/`paiements`/`ordres_reparation`/`documents_scannes`). Le jour où
-- cet écrivain sera écrit, il devra choisir comment matérialiser CE signalement sans jamais
-- réactiver de relance — ex. une ligne `relance_planifiee` créée directement `statut = 'annulee'`
-- porterait ce texte SANS jamais passer par `a_planifier`/`prete`/`envoyee`, mais entrerait alors
-- en collision avec `relance_planifiee_tenant_type_objet_palier_uk` (tenant_id, type_relance,
-- objet_id, palier) si elle occupe le palier 1 — le même palier que « le job de relance repart au
-- palier 1 » (D-45) attend pour la PROCHAINE relance réelle. Décision de conception à trancher
-- avec `expert-metier` avant d'écrire cet écrivain, pas ici : cette migration se limite à poser la
-- colonne qui porte le texte, rien de plus.
--
-- Réversible : migrations/down/0070_ancrages_origine_reprise_pneus_ventes_relances.down.sql —
-- up → down → up rejoué par la CI (vérification de réversibilité).
-- =============================================================================================

-- ---------------------------------------------------------------------------------------------
-- 1. `depot_pneus` (D-41 — dépôts pneus en cours)
-- ---------------------------------------------------------------------------------------------

alter table public.depot_pneus
  add column origine        public.origine_document not null default 'dfa',
  add column numero_origine text null;

alter table public.depot_pneus
  add constraint depot_pneus_origine_numero_origine_chk
  check ((origine = 'dfa') = (numero_origine is null));

create unique index depot_pneus_numero_origine_uk
  on public.depot_pneus (tenant_id, numero_origine)
 where numero_origine is not null;

comment on column public.depot_pneus.origine is
  'Reprise (0070) : dfa (créé par DFA) ou reprise (importé). Même enum, même sémantique que '
  'client.origine (0066) et document_vente.origine (0010).';
comment on column public.depot_pneus.numero_origine is
  'Reprise (0070) : identifiant du dépôt source VERBATIM, jamais retouché. NULL pour un dépôt créé '
  'normalement par DFA. D-41 : seuls les dépôts en cours (statut en_depot/monte) sont repris, '
  'jamais un dépôt déjà sorti — filtre applicatif, voir apps/api/src/reprise/perimetres/.';

-- ---------------------------------------------------------------------------------------------
-- 2. `commande_fournisseur` (D-40 — commandes fournisseur non soldées)
-- ÉCART DE NOMMAGE ASSUMÉ (voir en-tête « ÉCART AU PATRON 0066… nom de colonne ») : `origine`
-- existe déjà ici avec un sens différent (0024, RP-26) — l'ancrage de reprise est donc posé sous
-- `origine_reprise`, pas `origine`. `numero_origine` reste inchangé, aucune collision.
-- ---------------------------------------------------------------------------------------------

alter table public.commande_fournisseur
  add column origine_reprise public.origine_document not null default 'dfa',
  add column numero_origine  text null;

alter table public.commande_fournisseur
  add constraint commande_fournisseur_origine_numero_origine_chk
  check ((origine_reprise = 'dfa') = (numero_origine is null));

create unique index commande_fournisseur_numero_origine_uk
  on public.commande_fournisseur (tenant_id, numero_origine)
 where numero_origine is not null;

comment on column public.commande_fournisseur.origine_reprise is
  'Reprise (0070) : dfa (créé par DFA) ou reprise (importé). Même enum, même sémantique que '
  'client.origine (0066) et document_vente.origine (0010) — nommée origine_reprise (pas origine) '
  'car cette table porte déjà origine (origine_commande_fournisseur, 0024, RP-26 : pourquoi la '
  'commande est née dans DFA — manuelle/reservation_rupture/reapprovisionnement), sans rapport '
  'avec la provenance DFA/import.';
comment on column public.commande_fournisseur.numero_origine is
  'Reprise (0070) : référence de commande source VERBATIM, jamais retouchée. NULL pour une '
  'commande créée normalement par DFA. D-40 : seules les commandes non soldées (statut brouillon/'
  'envoyee/partiellement_recue) sont reprises — recue/cloturee vont en archive froide (D-15).';

-- ---------------------------------------------------------------------------------------------
-- 3. `dossier_vente` (D-42 — dossiers de vente ouverts)
-- ---------------------------------------------------------------------------------------------

alter table public.dossier_vente
  add column origine        public.origine_document not null default 'dfa',
  add column numero_origine text null;

alter table public.dossier_vente
  add constraint dossier_vente_origine_numero_origine_chk
  check ((origine = 'dfa') = (numero_origine is null));

create unique index dossier_vente_numero_origine_uk
  on public.dossier_vente (tenant_id, numero_origine)
 where numero_origine is not null;

comment on column public.dossier_vente.origine is
  'Reprise (0070) : dfa (créé par DFA) ou reprise (importé). Même enum, même sémantique que '
  'client.origine (0066) et document_vente.origine (0010).';
comment on column public.dossier_vente.numero_origine is
  'Reprise (0070) : identifiant de dossier source VERBATIM, jamais retouché. NULL pour un dossier '
  'créé normalement par DFA. D-42 : tout statut SAUF livre/clos/annule/abandonne est repris.';

-- ---------------------------------------------------------------------------------------------
-- 4. `vehicule_stock` (D-42/D-43 — véhicule associé à un dossier de vente ouvert)
-- ---------------------------------------------------------------------------------------------

alter table public.vehicule_stock
  add column origine        public.origine_document not null default 'dfa',
  add column numero_origine text null;

alter table public.vehicule_stock
  add constraint vehicule_stock_origine_numero_origine_chk
  check ((origine = 'dfa') = (numero_origine is null));

create unique index vehicule_stock_numero_origine_uk
  on public.vehicule_stock (tenant_id, numero_origine)
 where numero_origine is not null;

comment on column public.vehicule_stock.origine is
  'Reprise (0070) : dfa (créé par DFA) ou reprise (importé). Même enum, même sémantique que '
  'client.origine (0066) et document_vente.origine (0010). À ne pas confondre avec provenance '
  '(texte libre RV-02/PV-05, ex. neuf_constructeur/reprise/achat_particulier) ni avec '
  'origine_reprise_dossier_vente_id (RV-24, FK vers le dossier de vente dont la reprise-véhicule a '
  'fait entrer CE véhicule en stock) : deux notions « origine » déjà présentes sur cette table, '
  'sans rapport avec la provenance DFA/import ajoutée ici.';
comment on column public.vehicule_stock.numero_origine is
  'Reprise (0070) : identifiant de la FICHE STOCK source VERBATIM (listing VN/VO de l''ancien '
  'système), jamais retouché. NULL pour une entrée en stock créée normalement par DFA. Distinct de '
  'vehicule.numero_origine (0066) : vehicule_stock.id EST vehicule.id (extension 1:1, voir '
  'schema/ventes/vehicule-stock.ts en-tête), mais l''ancien système peut tenir un identifiant de '
  'listing stock différent de l''identifiant véhicule — les deux ancrages restent donc distincts '
  'plutôt que supposés identiques.';

-- ---------------------------------------------------------------------------------------------
-- 5. `reprise` (ventes VN/VO — véhicule repris en échange, D-42)
-- ---------------------------------------------------------------------------------------------

alter table public.reprise
  add column origine        public.origine_document not null default 'dfa',
  add column numero_origine text null;

alter table public.reprise
  add constraint reprise_origine_numero_origine_chk
  check ((origine = 'dfa') = (numero_origine is null));

create unique index reprise_numero_origine_uk
  on public.reprise (tenant_id, numero_origine)
 where numero_origine is not null;

comment on column public.reprise.origine is
  'Reprise (0070) : dfa (créé par DFA) ou reprise (importé). Même enum, même sémantique que '
  'client.origine (0066) et document_vente.origine (0010). Nom de colonne identique au nom de la '
  'table (reprise-véhicule des ventes VN/VO) : sans lien avec le chantier de reprise de données '
  'lui-même (dossier_reprise/reprise_plan/…, 0067) — deux notions homonymes, déjà présentes dans '
  'ce dépôt avant cette migration.';
comment on column public.reprise.numero_origine is
  'Reprise (0070) : identifiant de la reprise-véhicule source VERBATIM, jamais retouché. NULL pour '
  'une reprise créée normalement par DFA.';

-- ---------------------------------------------------------------------------------------------
-- 6. `financement_vente` (ventes VN/VO — financement associé, D-42)
-- ---------------------------------------------------------------------------------------------

alter table public.financement_vente
  add column origine        public.origine_document not null default 'dfa',
  add column numero_origine text null;

alter table public.financement_vente
  add constraint financement_vente_origine_numero_origine_chk
  check ((origine = 'dfa') = (numero_origine is null));

create unique index financement_vente_numero_origine_uk
  on public.financement_vente (tenant_id, numero_origine)
 where numero_origine is not null;

comment on column public.financement_vente.origine is
  'Reprise (0070) : dfa (créé par DFA) ou reprise (importé). Même enum, même sémantique que '
  'client.origine (0066) et document_vente.origine (0010).';
comment on column public.financement_vente.numero_origine is
  'Reprise (0070) : identifiant de financement/contrat source VERBATIM, jamais retouché. NULL pour '
  'un financement créé normalement par DFA. AVERTISSEMENT MESURÉ, SIGNALÉ, NON CORRIGÉ ICI : '
  'contrairement à reprise.dette_financement_organisme_nom (texte libre, CHECK '
  'reprise_dette_organisme_coherent_chk), financement_vente n''a AUCUNE colonne « nom libre » pour '
  'l''organisme — financement_vente_organisme_requis_chk exige organisme_id (FK client) NOT NULL '
  'dès que type <> ''comptant'', sans échappatoire. Un import D-42 « organisme en nom libre par '
  'défaut, sans résolution forcée » ne peut donc pas être honoré tel quel pour un dossier '
  'credit/leasing dont l''organisme n''est pas déjà une fiche client résolue — hors périmètre de '
  'cette migration (le contrat de reprise pour ventes_vn_vo n''a pas d''écrivain concret à ce '
  'stade), décision de conception à reprendre avant d''écrire l''écrivain de ce domaine.';

-- ---------------------------------------------------------------------------------------------
-- 7. `relance_planifiee` (D-45 — signalement d'une créance déjà relancée)
-- ---------------------------------------------------------------------------------------------

alter table public.relance_planifiee
  add column origine        public.origine_document not null default 'dfa',
  add column numero_origine text null;

alter table public.relance_planifiee
  add constraint relance_planifiee_origine_numero_origine_chk
  check ((origine = 'dfa') = (numero_origine is null));

create unique index relance_planifiee_numero_origine_uk
  on public.relance_planifiee (tenant_id, numero_origine)
 where numero_origine is not null;

comment on column public.relance_planifiee.origine is
  'Reprise (0070) : dfa (créé par DFA) ou reprise (importé). Même enum, même sémantique que '
  'client.origine (0066) et document_vente.origine (0010). D-45 : AUCUNE relance active n''est '
  'reprise — cette colonne existe pour cohérence de patron et un usage futur (voir note_reprise '
  'ci-dessous), pas parce qu''un import réel écrira origine=reprise dans ce lot.';
comment on column public.relance_planifiee.numero_origine is
  'Reprise (0070) : identifiant de relance source VERBATIM, jamais retouché. NULL pour une relance '
  'créée normalement par DFA.';

-- ÉCART AU PATRON 0066 — colonne supplémentaire hors ancrage, voir en-tête de fichier (§ « ÉCART
-- AU PATRON 0066 ») pour la justification complète et ce qui reste À TRANCHER avant tout écrivain.
alter table public.relance_planifiee
  add column note_reprise text null;

alter table public.relance_planifiee
  add constraint relance_planifiee_note_reprise_non_vide_chk
  check (note_reprise is null or length(btrim(note_reprise)) > 0);

comment on column public.relance_planifiee.note_reprise is
  'D-45 (docs/reprise/decisions.md) : signalement « déjà relancée N fois côté ancien système, à '
  'vérifier avant tout nouvel envoi » — texte libre, jamais structuré (aucune garantie qu''un '
  'compte fiable existe côté source). N''est PAS peuplée par cette migration : aucun écrivain '
  'd''import n''existe encore pour le domaine relances (extension seam, voir '
  '@dfa/shared::DOMAINES_REPRISE). Ne doit JAMAIS accompagner un statut actif '
  '(a_planifier/prete/en_cours_envoi/envoyee) — voir avertissement de conception en en-tête de '
  'fichier avant d''implémenter l''écrivain qui la peuplera.';

-- ---------------------------------------------------------------------------------------------
-- Assertions de fin de migration
-- ---------------------------------------------------------------------------------------------

do $$
declare
  v_table       text;
  v_col_origine text;
  v_manquant    boolean;
begin
  -- (table, colonne d'ancrage « origine ») : `commande_fournisseur` seule dévie sur
  -- `origine_reprise` — collision de nom avec sa colonne `origine` préexistante (0024, RP-26), voir
  -- l'en-tête de ce fichier (« ÉCART AU PATRON 0066… nom de colonne »).
  for v_table, v_col_origine in
    select * from (values
      ('depot_pneus',         'origine'),
      ('commande_fournisseur','origine_reprise'),
      ('dossier_vente',       'origine'),
      ('vehicule_stock',      'origine'),
      ('reprise',             'origine'),
      ('financement_vente',   'origine'),
      ('relance_planifiee',   'origine')
    ) as t(nom_table, nom_colonne)
  loop
    if not exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = v_table and column_name = v_col_origine
    ) then
      raise exception '0070 : %.% manquante après migration.', v_table, v_col_origine;
    end if;

    if not exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = v_table and column_name = 'numero_origine'
    ) then
      raise exception '0070 : %.numero_origine manquante après migration.', v_table;
    end if;

    execute format(
      'select exists (select 1 from public.%I where %I = ''reprise'' and numero_origine is null)',
      v_table, v_col_origine
    ) into v_manquant;
    if v_manquant then
      raise exception '0070 : au moins un %.% = reprise sans numero_origine.', v_table, v_col_origine;
    end if;

    execute format(
      'select exists (select 1 from public.%I where %I = ''dfa'' and numero_origine is not null)',
      v_table, v_col_origine
    ) into v_manquant;
    if v_manquant then
      raise exception '0070 : au moins un %.% = dfa avec numero_origine renseigné.', v_table, v_col_origine;
    end if;
  end loop;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'relance_planifiee'
       and column_name = 'note_reprise'
  ) then
    raise exception '0070 : relance_planifiee.note_reprise manquante après migration.';
  end if;
end
$$;
