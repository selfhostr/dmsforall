-- =============================================================================================
-- 0062_cycle_vie_resiliation_tenant.sql — cycle de vie de sortie du garage d'un tenant : export
-- intégral remis au garage, conservation limitée, effacement final avec trace d'audit.
--
-- BESOIN (mandat du 20.08.2026, hors spécification écrite préexistante — voir le rapport de
-- livraison pour les arbitrages non tranchés en amont) : quand un garage résilie, ses dix ans de
-- factures/OR/clients/véhicules doivent le suivre (conservation légale dix ans, art. 958f CO), et
-- dmsforall doit ensuite cesser d'être responsable de données qui ne rapportent plus rien.
--
-- CE QUE CETTE MIGRATION POSE
--   1. `statut_resiliation_tenant` — sept états : demandee, export_en_cours, export_echoue,
--      export_pret, export_remis, en_conservation, efface.
--   2. `resiliation_tenant` — AU PLUS UNE ligne par tenant (unique(tenant_id)) : le dossier de fin
--      de vie, une machine à états complète, colonnes d'export/remise/conservation/effacement.
--   3. `resiliation_tenant_evenement` — APPEND-ONLY, une ligne par transition : qui (utilisateur du
--      garage ou automatique), quand, motif. C'est la trace d'audit exigée par le mandat pour
--      l'effacement final, mais elle couvre TOUTES les transitions, pas seulement la dernière.
--   4. `verifier_transition_resiliation_tenant()` — trigger BEFORE UPDATE dédié, LISTE BLANCHE des
--      sept transitions légales. Voir §A ci-dessous : pourquoi CE trigger et pas le dispositif
--      partagé `transition_autorisee`/`entite_auditee` (0003).
--   5. `purger_donnees_tenant(uuid, uuid, boolean)` — fonction SECURITY DEFINER, balayage
--      DYNAMIQUE (catalogue, pas une liste de 87 noms codés en dur) de toutes les tables de
--      `public` portant `tenant_id`, hors `resiliation_tenant`/`resiliation_tenant_evenement`
--      (doivent survivre comme preuve de l'effacement). Voir §B.
--
-- §A — POURQUOI PAS `transition_autorisee`/`entite_auditee` (0003_prealables_etape1.sql §4/§6)
--   Le dispositif partagé exigerait `ALTER TYPE public.entite_auditee ADD VALUE 'resiliation_tenant'`
--   PUIS `INSERT INTO public.transition_autorisee (entite, ...) VALUES ('resiliation_tenant', ...)`
--   DANS LA MÊME MIGRATION — exactement le cas que `0033_vehicule_travail_reporte_motif_
--   modification.sql` (§3, lignes ~39-57) documente comme INTERDIT par PostgreSQL : une valeur
--   ajoutée par ALTER TYPE ... ADD VALUE ne peut pas être UTILISÉE (castée, comparée) dans LA MÊME
--   transaction que celle qui l'a ajoutée. 0033 contourne ça en ne l'utilisant JAMAIS comme valeur
--   castée dans sa propre migration (l'argument de trigger reste `text`, casté seulement à
--   l'exécution future). Mon cas est différent : `transition_autorisee.entite` est typée
--   `entite_auditee` et une ligne `('resiliation_tenant', 'demandee', 'export_en_cours', false)`
--   CASTERAIT immédiatement la valeur — donc échouerait. Séparer en deux migrations (l'ADD VALUE
--   ici, l'INSERT dans une migration ultérieure) n'est pas possible : le numéro réservé pour cet
--   agent est 0062 SEUL, un autre agent travaille en parallèle sur 0061 et il n'y a pas de numéro
--   suivant disponible sans risque de collision. Solution retenue : machine à états ENTIÈREMENT
--   LOCALE à cette migration — enum propre, trigger propre, liste blanche codée UNE FOIS dans ce
--   fichier (respecte quand même l'exigence du mandat : « transitions autorisées écrites une fois
--   pour toutes »), sans toucher au dispositif partagé. SQLSTATE `ZDFA1` réutilisé (même famille,
--   même sémantique exacte : « transition d'état interdite »).
--
-- §B — `purger_donnees_tenant` : pourquoi un balayage DYNAMIQUE plutôt qu'une liste de tables
--   Le tenant a des lignes dans ~87 tables (atelier, facturation, pièces, pointage, ventes, pneus,
--   relances, socle), réparties sur des migrations possédées par d'autres agents, hors du périmètre
--   d'écriture de celle-ci. Coder les 87 noms ici les figerait au jour de cette migration : toute
--   table tenant-scopée ajoutée PLUS TARD par un autre domaine échapperait silencieusement à la
--   purge — précisément le mode de défaillance que le mandat interdit (« un export incomplet est
--   pire qu'aucun export », même logique pour un effacement incomplet : des données qu'on croit
--   effacées mais qui survivent quelque part sont pires que l'absence d'effacement, puisque plus
--   personne ne les cherche). La fonction découvre donc ses cibles à CHAQUE appel via le catalogue
--   (`pg_attribute` : porte une colonne `tenant_id`), balaie en PASSES SUCCESSIVES en retentant les
--   tables qui échouent sur une violation de clé étrangère (une table enfant pas encore vidée
--   bloque son parent) jusqu'à ce que : (a) toutes les tables soient vides pour ce tenant, ou
--   (b) une passe entière ne fasse plus aucun progrès — échec bruyant plutôt qu'une boucle infinie
--   ou un effacement partiel silencieux. AUCUN SQL dynamique construit depuis une entrée EXTERNE :
--   les seuls identifiants injectés dans `format(...%I...)` viennent du catalogue Postgres
--   lui-même (`pg_class.relname`), jamais d'un paramètre appelant — même garde-fou que les
--   fonctions SECURITY DEFINER de 0048 (aucun SQL dynamique depuis une entrée non contrôlée).
--
--   SECURITY DEFINER, propriétaire `dfa_migrator` : les ~87 tables n'accordent PAS toutes DELETE à
--   `dfa_app` (suppression LOGIQUE par défaut dans ce produit — voir `ServiceAccesBase.
--   verifierPostureRls`, marqueur `[dfa:suppression-physique]`), et cette fonction est la SEULE
--   voie légitime de suppression PHYSIQUE d'un tenant entier. `dfa_migrator`, propriétaire de
--   TOUTES les tables de `public`, y détient DELETE implicitement (privilège de propriétaire) —
--   aucun GRANT DELETE supplémentaire à poser nulle part. Les politiques `<table>_migrator using
--   (true)` déjà posées par CHAQUE migration métier depuis 0001 §4 (convention constante du dépôt)
--   couvrent l'accès malgré `FORCE ROW LEVEL SECURITY` (qui s'applique même au propriétaire) — donc
--   `dfa_migrator` voit et efface les lignes de N'IMPORTE QUEL tenant SANS que cette fonction n'ait
--   à poser `set_config('app.tenant_id', ...)` : le filtre réel est le `WHERE tenant_id = $1`
--   explicite de chaque DELETE, pas le RLS. GARDE-FOU CENTRAL, VÉRIFIÉ EN BASE, PAS SEULEMENT CÔTÉ
--   SERVICE (même doctrine que `verifier_transition()`, 0003 §6 : « le risque n'est pas
--   l'utilisateur qui clique ») : la fonction REFUSE si `resiliation_tenant.statut <>
--   'en_conservation'` ou si `purge_prevue_le` n'est pas encore atteinte — un appel malencontreux
--   (mauvais tenant, script de test, job rejoué trop tôt) échoue avant la moindre suppression.
--
-- ARBITRAGE DU COORDINATEUR (20.08.2026, APRÈS le rapport de livraison initial de cette migration)
--   Le rapport initial signalait une ambiguïté : le mandat demandait de cadrer l'opération comme
--   un « droit d'exploitation », mais le seul mécanisme d'exploitation existant (console porte 1,
--   `GardeExploitant`) est explicitement bloqué côté données métier (porte 2 fermée, prérequis
--   nLPD non tranchés, 0048_exploitation_console_porte_1.sql). TRANCHÉ : c'est le GARAGE LUI-MÊME
--   qui déclenche sa résiliation et son export, depuis son propre espace — un droit MÉTIER
--   ordinaire, tenant résolu depuis la session comme partout ailleurs. La console porte 2 reste
--   fermée, elle n'a jamais été ouverte par cette migration. D'où le changement de cette version :
--   `demandee_par_exploitant_id`/`remis_confirme_par_exploitant_id`/`declenche_par_exploitant_id`
--   sont devenues `..._utilisateur_id`, avec de vraies FK vers `public.utilisateur` — l'auteur de
--   ces actions est un EMPLOYÉ du garage (rôle `direction` uniquement, gardé côté service — voir
--   `resiliation-tenant.controller.ts`), pas un exploitant de la plateforme.
--
-- CE QUE CETTE MIGRATION NE FAIT PAS
--   - Aucun GRANT `[dfa:suppression-physique]` n'est ajouté ailleurs : cette migration ne modifie
--     AUCUNE table possédée par un autre domaine.
--   - L'effacement final NE DEVIENT PAS un bouton (arbitrage explicite) : aucune route HTTP ne
--     l'expose, il reste déclenché EXCLUSIVEMENT par `OrdonnanceurPurgeAutomatiqueTenant`, à
--     l'échéance de la période de conservation, avec le garde-fou de `purger_donnees_tenant`
--     vérifié en base.
--
-- Réversible : migrations/down/0062_cycle_vie_resiliation_tenant.down.sql. `purger_donnees_tenant`
-- est une fonction pure (aucune donnée créée par le up qu'un down devrait préserver) : DROP complet
-- possible, aucun résidu à documenter dans `verifier-reversibilite-migrations.sh`.
-- =============================================================================================


-- ---------------------------------------------------------------------------------------------
-- 1. Enum du cycle de vie
-- ---------------------------------------------------------------------------------------------

create type public.statut_resiliation_tenant as enum (
  'demandee',        -- résiliation enregistrée, aucun export encore produit
  'export_en_cours', -- job d'export en tâche de fond
  'export_echoue',   -- dernière tentative en échec (export_erreur renseigné), retentable
  'export_pret',     -- export généré, en attente de remise au garage
  'export_remis',    -- garage confirmé en possession de l'export
  'en_conservation', -- horloge de rétention en cours (purge_prevue_le)
  'efface'           -- terminal : données métier physiquement supprimées
);

comment on type public.statut_resiliation_tenant is
  'Cycle de vie de sortie du garage (mandat 20.08.2026) : demandee -> export_en_cours -> '
  '(export_echoue -> export_en_cours)* -> export_pret -> export_remis -> en_conservation -> '
  'efface. efface est terminal, aucune sortie. Machine à états LOCALE à cette migration — voir '
  '§A de l''en-tête : le dispositif partagé transition_autorisee/entite_auditee ne peut pas être '
  'utilisé ici (contrainte PostgreSQL sur ALTER TYPE ADD VALUE dans la même transaction).';


-- ---------------------------------------------------------------------------------------------
-- 2. `resiliation_tenant` — au plus une ligne par tenant
-- ---------------------------------------------------------------------------------------------

create table public.resiliation_tenant (
  id                                 uuid                              not null default gen_random_uuid(),
  tenant_id                          uuid                              not null,
  statut                             public.statut_resiliation_tenant  not null default 'demandee',
  motif                              text                              not null,

  demandee_le                        timestamptz                       not null default now(),
  -- ARBITRAGE (20.08.2026, après le rapport de livraison initial) : c'est le GARAGE LUI-MÊME qui
  -- déclenche sa résiliation, depuis son propre espace — un droit MÉTIER ordinaire, tenant résolu
  -- depuis la session comme partout ailleurs. PAS la console d'exploitation, PAS `GardeExploitant`
  -- — la « porte 2 » (0048_exploitation_console_porte_1.sql) reste fermée, elle n'a jamais été
  -- rouverte. D'où une vraie FK vers `public.utilisateur` (contrairement à la version précédente
  -- de ce commentaire, qui envisageait un exploitant) : l'auteur de la demande est un EMPLOYÉ du
  -- garage, exactement comme toute autre colonne `cree_par_utilisateur_id` du produit. Restreint
  -- au rôle `direction` — voir `resiliation-tenant.controller.ts` (garde applicative, en l'absence
  -- d'un droit dédié dans `auth/matrice-droits.ts`, hors périmètre d'écriture de cet agent).
  demandee_par_utilisateur_id        uuid                              not null
    references public.utilisateur (id) on delete restrict,

  export_genere_le                   timestamptz                       null,
  -- Chemin relatif du répertoire d'export (voir service-stockage-export-tenant.ts), opaque pour
  -- le reste du produit — même doctrine que `document_vente.pdf_cle` (0010).
  export_repertoire                  text                              null,
  export_nb_tables                   integer                           null,
  export_nb_lignes_total             bigint                            null,
  export_taille_octets                bigint                           null,
  export_erreur                      text                              null,

  remis_le                           timestamptz                       null,
  -- Confirmée EXPLICITEMENT par `direction` (`POST /resiliation/confirmer-remise`), après avoir
  -- téléchargé/vérifié l'export — jamais déduite implicitement d'un simple téléchargement de
  -- fichier (une seule pièce téléchargée ne prouve pas que le garage a tout récupéré).
  remis_confirme_par_utilisateur_id  uuid                              null
    references public.utilisateur (id) on delete restrict,

  retention_jours                    integer                           not null default 180,
  -- PAS UNE COLONNE GENERATED, bien qu'elle en ait toute la nature (dérivée de remis_le +
  -- retention_jours) : PostgreSQL REFUSE toute expression GENERATED qui n'est pas IMMUTABLE, et
  -- `timestamptz + interval 'N days'` ne l'est PAS — l'ajout d'un intervalle en JOURS à un
  -- timestamptz dépend du fuseau horaire de la session (un jour peut valoir 23h/25h au passage
  -- d'un changement d'heure) — CONSTATÉ EN EXÉCUTION (`generation expression is not immutable`,
  -- `verifier-reversibilite-migrations.sh`), pas supposé. Calculée UNE SEULE FOIS, explicitement,
  -- au moment de la transition `export_remis -> en_conservation`
  -- (`ServiceCycleVieResiliation.confirmerRemise`), jamais recalculée ensuite — le risque de
  -- désynchronisation que visait la colonne GENERATED est donc porté par CE service, pas par la
  -- base : un seul point d'écriture pour cette colonne dans tout le code applicatif.
  purge_prevue_le                    timestamptz                       null,

  effacee_le                         timestamptz                       null,
  -- TOUJOURS NULL en pratique : l'effacement n'est JAMAIS un bouton (arbitrage 20.08.2026) — il
  -- n'a lieu qu'automatiquement, par `OrdonnanceurPurgeAutomatiqueTenant`
  -- (`effacement_automatique = true` systématiquement). Colonne conservée pour l'intégrité du
  -- schéma et un usage d'exploitation hors produit (script direct via `dfa_migrator`, jamais une
  -- route HTTP) — PAS un chemin fonctionnel de ce cycle de vie.
  effacee_par_utilisateur_id         uuid                              null
    references public.utilisateur (id) on delete restrict,
  effacement_automatique             boolean                           not null default false,

  cree_le                            timestamptz                       not null default now(),
  modifie_le                         timestamptz                       not null default now(),

  constraint resiliation_tenant_pk primary key (id),
  -- Cible de la FK composite de resiliation_tenant_evenement (§3).
  constraint resiliation_tenant_tenant_id_uk unique (tenant_id, id),
  -- Règle métier : au plus UN dossier de résiliation par tenant. Un tenant réactivé après
  -- résiliation redeviendrait un nouveau tenant en pratique (ses données métier ont pu être
  -- effacées) — pas un cas que ce cycle doit rouvrir.
  constraint resiliation_tenant_tenant_uk unique (tenant_id),

  constraint resiliation_tenant_fk_tenant foreign key (tenant_id) references public.tenant (id)
    on delete restrict,

  constraint resiliation_tenant_motif_non_vide_chk check (length(btrim(motif)) > 0),
  constraint resiliation_tenant_retention_positive_chk check (retention_jours > 0),

  constraint resiliation_tenant_export_pret_chk check (
    statut not in ('export_pret', 'export_remis', 'en_conservation', 'efface')
    or (export_genere_le is not null and export_repertoire is not null)
  ),
  constraint resiliation_tenant_export_echoue_chk
    check ((statut = 'export_echoue') = (export_erreur is not null)),
  constraint resiliation_tenant_remis_chk check (
    statut not in ('export_remis', 'en_conservation', 'efface') or remis_le is not null
  ),
  constraint resiliation_tenant_purge_prevue_chk check (
    statut not in ('en_conservation', 'efface') or purge_prevue_le is not null
  ),
  constraint resiliation_tenant_efface_chk
    check (statut <> 'efface' or effacee_le is not null)
);

comment on table public.resiliation_tenant is
  'Dossier de sortie du garage, au plus un par tenant (mandat 20.08.2026). Machine à états locale '
  '(voir type statut_resiliation_tenant) — jamais supprimée : c''est la preuve, y compris APRÈS '
  'l''effacement des données métier, que l''export a été produit/remis et que l''effacement a eu '
  'lieu.';

comment on column public.resiliation_tenant.export_repertoire is
  'Chemin relatif (racine applicative) du répertoire d''export, opaque pour le reste du produit — '
  'même doctrine que document_vente.pdf_cle (0010_facturation.sql).';

create trigger resiliation_tenant_touche_modifie_le
  before update on public.resiliation_tenant
  for each row execute function public.touche_modifie_le();

revoke all                    on public.resiliation_tenant from dfa_app;
grant  select, insert, update on public.resiliation_tenant to   dfa_app;
revoke delete                 on public.resiliation_tenant from dfa_app;

alter table public.resiliation_tenant enable row level security;
alter table public.resiliation_tenant force  row level security;

create policy resiliation_tenant_isolation_tenant on public.resiliation_tenant
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy resiliation_tenant_migrator on public.resiliation_tenant
  to dfa_migrator
  using (true) with check (true);


-- ---------------------------------------------------------------------------------------------
-- 3. `resiliation_tenant_evenement` — APPEND-ONLY, trace d'audit de CHAQUE transition
--
-- Exigence du mandat pour l'effacement final : « quand, sur quel tenant, à la demande de qui ».
-- Cette table répond à la question pour TOUTES les transitions, pas seulement la dernière — une
-- ligne unique sur `resiliation_tenant` écraserait l'historique à chaque UPDATE.
-- ---------------------------------------------------------------------------------------------

create table public.resiliation_tenant_evenement (
  id                          uuid          not null default gen_random_uuid(),
  tenant_id                   uuid          not null,
  resiliation_tenant_id       uuid          not null,
  statut_precedent            text          null,  -- NULL sur l'événement de création (demandee)
  statut_nouveau              text          not null,
  survenue_le                 timestamptz   not null default now(),
  declenche_par_utilisateur_id uuid         null references public.utilisateur (id) on delete restrict,
  declenche_automatiquement   boolean       not null default false,
  motif                       text          null,

  cree_le                     timestamptz   not null default now(),

  constraint resiliation_tenant_evenement_pk primary key (id),
  constraint resiliation_tenant_evenement_fk_resiliation
    foreign key (tenant_id, resiliation_tenant_id)
    references public.resiliation_tenant (tenant_id, id) on delete restrict
);

comment on table public.resiliation_tenant_evenement is
  'APPEND-ONLY : une ligne par transition du dossier de résiliation. qui (declenche_par_utilisateur_id '
  'ou declenche_automatiquement), quand (survenue_le), sur quel tenant, avec quel motif — trace '
  'd''audit exigée par le mandat pour l''effacement final, étendue à tout le cycle de vie.';

revoke all            on public.resiliation_tenant_evenement from dfa_app;
grant  select, insert on public.resiliation_tenant_evenement to   dfa_app;
revoke update, delete on public.resiliation_tenant_evenement from dfa_app;

alter table public.resiliation_tenant_evenement enable row level security;
alter table public.resiliation_tenant_evenement force  row level security;

create policy resiliation_tenant_evenement_isolation_tenant on public.resiliation_tenant_evenement
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy resiliation_tenant_evenement_migrator on public.resiliation_tenant_evenement
  to dfa_migrator
  using (true) with check (true);

create index resiliation_tenant_evenement_resiliation_idx
  on public.resiliation_tenant_evenement (tenant_id, resiliation_tenant_id, survenue_le);


-- ---------------------------------------------------------------------------------------------
-- 4. `verifier_transition_resiliation_tenant()` — liste blanche LOCALE (§A de l'en-tête)
-- ---------------------------------------------------------------------------------------------

create function public.verifier_transition_resiliation_tenant() returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $fn$
declare
  v_depuis text := old.statut::text;
  v_vers   text := new.statut::text;
begin
  if tg_op <> 'UPDATE' then
    raise exception 'verifier_transition_resiliation_tenant() posée sur % : ce trigger ne vaut que pour BEFORE UPDATE.', tg_op
      using errcode = 'ZDFA1';
  end if;

  if v_depuis is not distinct from v_vers then
    return new;
  end if;

  if exists (
    select 1 from (values
      ('demandee',        'export_en_cours'),
      ('export_en_cours', 'export_pret'),
      ('export_en_cours', 'export_echoue'),
      ('export_echoue',   'export_en_cours'),
      ('export_pret',     'export_en_cours'),  -- régénération (données modifiées entre-temps)
      ('export_pret',     'export_remis'),
      ('export_remis',    'en_conservation'),
      ('en_conservation', 'efface')
    ) as t(depuis, vers)
    where t.depuis = v_depuis
      and t.vers   = v_vers
  ) then
    return new;
  end if;

  raise exception using
    errcode = 'ZDFA1',
    message = format('Transition %s → %s interdite sur resiliation_tenant.', v_depuis, v_vers),
    detail  = format('entite=resiliation_tenant;depuis=%s;vers=%s', v_depuis, v_vers),
    table   = 'resiliation_tenant';
end
$fn$;

comment on function public.verifier_transition_resiliation_tenant() is
  'Trigger BEFORE UPDATE : liste blanche des 8 transitions légales de resiliation_tenant.statut, '
  'codée ICI (voir §A de l''en-tête de 0062 pour pourquoi le dispositif partagé transition_autorisee '
  'n''est pas utilisable dans cette migration). SQLSTATE ZDFA1, même famille que verifier_transition().';

revoke all on function public.verifier_transition_resiliation_tenant() from public;

create trigger resiliation_tenant_verifier_transition
  before update on public.resiliation_tenant
  for each row execute function public.verifier_transition_resiliation_tenant();


-- ---------------------------------------------------------------------------------------------
-- 5. `purger_donnees_tenant(uuid, uuid, boolean)` — effacement final (§B de l'en-tête)
-- ---------------------------------------------------------------------------------------------

create function public.purger_donnees_tenant(
  p_tenant_id      uuid,
  -- TOUJOURS NULL en usage produit (l'effacement n'est jamais déclenché par une route HTTP,
  -- arbitrage 20.08.2026) — paramètre conservé pour un usage d'exploitation hors produit (script
  -- direct `dfa_migrator`), voir le commentaire de `resiliation_tenant.effacee_par_utilisateur_id`.
  p_utilisateur_id uuid    default null,
  p_automatique    boolean default true
)
returns table (table_nom text, lignes_supprimees bigint)
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_statut          public.statut_resiliation_tenant;
  v_purge_prevue    timestamptz;
  v_resiliation_id  uuid;
  v_liste           text[];
  v_suivante        text[];
  v_table           text;
  v_lignes          bigint;
  v_progres         boolean;
  v_derniere_erreur text;
  v_passe           integer := 0;
begin
  select id, statut, purge_prevue_le
    into v_resiliation_id, v_statut, v_purge_prevue
    from public.resiliation_tenant
   where tenant_id = p_tenant_id;

  if v_resiliation_id is null then
    raise exception 'purger_donnees_tenant : aucun dossier de résiliation pour le tenant %.', p_tenant_id
      using errcode = 'ZDFA1';
  end if;

  if v_statut <> 'en_conservation' then
    raise exception 'purger_donnees_tenant : tenant % au statut % — purge refusée (attendu en_conservation).',
      p_tenant_id, v_statut
      using errcode = 'ZDFA1';
  end if;

  if v_purge_prevue is null or v_purge_prevue > clock_timestamp() then
    raise exception 'purger_donnees_tenant : période de conservation non écoulée pour le tenant % (purge prévue %, maintenant %).',
      p_tenant_id, v_purge_prevue, clock_timestamp()
      using errcode = 'ZDFA1';
  end if;

  -- Découverte DYNAMIQUE (§B) : toutes les tables de public portant tenant_id, hors les deux
  -- tables de cycle de vie elles-mêmes (doivent survivre comme preuve de l'effacement) et hors
  -- partitions (le parent partitionné route le DELETE vers ses partitions lui-même).
  select coalesce(array_agg(c.relname order by c.relname), array[]::text[])
    into v_liste
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind in ('r', 'p')
     and not c.relispartition
     and exists (
       select 1 from pg_catalog.pg_attribute a
        where a.attrelid = c.oid and a.attname = 'tenant_id' and a.attnum > 0 and not a.attisdropped
     )
     and c.relname not in ('resiliation_tenant', 'resiliation_tenant_evenement');

  -- Passes successives : une table enfant pas encore vidée fait échouer son parent sur violation
  -- de clé étrangère (23503) — on la retente à la passe suivante. Échec bruyant si une passe
  -- entière ne progresse plus (blocage réel : FK circulaire, table hors de portée de dfa_migrator)
  -- ou après un nombre de passes déraisonnable (garde-fou contre toute boucle infinie).
  while array_length(v_liste, 1) is not null loop
    v_passe   := v_passe + 1;
    v_progres := false;
    v_suivante := array[]::text[];

    if v_passe > 200 then
      raise exception 'purger_donnees_tenant : abandon défensif après % passes, tenant %, tables restantes : %.',
        v_passe, p_tenant_id, array_to_string(v_liste, ', ')
        using errcode = 'ZDFA1';
    end if;

    foreach v_table in array v_liste loop
      begin
        execute format('delete from public.%I where tenant_id = $1', v_table) using p_tenant_id;
        get diagnostics v_lignes = row_count;

        table_nom := v_table;
        lignes_supprimees := v_lignes;
        return next;

        v_progres := true;
      exception
        when foreign_key_violation then
          v_derniere_erreur := sqlerrm;
          v_suivante := v_suivante || v_table;
      end;
    end loop;

    v_liste := v_suivante;

    if not v_progres and array_length(v_liste, 1) is not null then
      raise exception 'purger_donnees_tenant : aucune progression à la passe % pour le tenant %, tables bloquées : %. Dernière erreur : %',
        v_passe, p_tenant_id, array_to_string(v_liste, ', '), coalesce(v_derniere_erreur, 'aucune')
        using errcode = 'ZDFA1';
    end if;
  end loop;

  -- Transition finale + trace d'audit, DANS LA MÊME TRANSACTION que la suppression : jamais de
  -- fenêtre où les données sont effacées mais où le statut dit encore « en_conservation ».
  update public.resiliation_tenant
     set statut                     = 'efface',
         effacee_le                 = clock_timestamp(),
         effacee_par_utilisateur_id = p_utilisateur_id,
         effacement_automatique     = p_automatique
   where tenant_id = p_tenant_id;

  insert into public.resiliation_tenant_evenement
    (tenant_id, resiliation_tenant_id, statut_precedent, statut_nouveau,
     declenche_par_utilisateur_id, declenche_automatiquement, cree_le)
  values
    (p_tenant_id, v_resiliation_id, 'en_conservation', 'efface',
     p_utilisateur_id, p_automatique, clock_timestamp());

  return;
end
$fn$;

comment on function public.purger_donnees_tenant(uuid, uuid, boolean) is
  'Effacement final (mandat 20.08.2026, §B de l''en-tête de 0062) : balayage DYNAMIQUE (catalogue) '
  'de toutes les tables de public portant tenant_id, hors resiliation_tenant/_evenement. Refuse si '
  'le dossier n''est pas en_conservation ou si la période de rétention n''est pas écoulée — '
  'garde-fou vérifié EN BASE, pas seulement côté service. SECURITY DEFINER (dfa_migrator) : seule '
  'voie de suppression PHYSIQUE d''un tenant entier, les tables métier n''accordent pas toutes '
  'DELETE à dfa_app par construction (suppression logique par défaut).';

revoke all     on function public.purger_donnees_tenant(uuid, uuid, boolean) from public;
grant  execute on function public.purger_donnees_tenant(uuid, uuid, boolean) to   dfa_app;


-- ---------------------------------------------------------------------------------------------
-- 6. Assertions de fin de migration
-- ---------------------------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.resiliation_tenant') is null then
    raise exception '0062 : table resiliation_tenant absente après migration.';
  end if;
  if to_regclass('public.resiliation_tenant_evenement') is null then
    raise exception '0062 : table resiliation_tenant_evenement absente après migration.';
  end if;

  if not exists (select 1 from pg_catalog.pg_type where typname = 'statut_resiliation_tenant') then
    raise exception '0062 : type statut_resiliation_tenant absent après migration.';
  end if;

  if (select count(*) from pg_catalog.pg_enum e join pg_catalog.pg_type t on t.oid = e.enumtypid
       where t.typname = 'statut_resiliation_tenant') <> 7 then
    raise exception '0062 : statut_resiliation_tenant doit porter exactement 7 valeurs.';
  end if;

  -- RLS activée ET forcée sur les deux tables.
  if not exists (
    select 1 from pg_catalog.pg_class
     where relname = 'resiliation_tenant' and relnamespace = 'public'::regnamespace
       and relrowsecurity and relforcerowsecurity
  ) then
    raise exception '0062 : resiliation_tenant n''a pas RLS activée et forcée.';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_class
     where relname = 'resiliation_tenant_evenement' and relnamespace = 'public'::regnamespace
       and relrowsecurity and relforcerowsecurity
  ) then
    raise exception '0062 : resiliation_tenant_evenement n''a pas RLS activée et forcée.';
  end if;

  -- Deux politiques (isolation + migrator) sur chaque table.
  if (select count(*) from pg_catalog.pg_policies
       where schemaname = 'public' and tablename = 'resiliation_tenant') <> 2 then
    raise exception '0062 : resiliation_tenant doit porter exactement 2 politiques.';
  end if;
  if (select count(*) from pg_catalog.pg_policies
       where schemaname = 'public' and tablename = 'resiliation_tenant_evenement') <> 2 then
    raise exception '0062 : resiliation_tenant_evenement doit porter exactement 2 politiques.';
  end if;

  -- resiliation_tenant_evenement : append-only pour dfa_app.
  if has_table_privilege('dfa_app', 'public.resiliation_tenant_evenement', 'UPDATE') then
    raise exception '0062 : resiliation_tenant_evenement doit interdire UPDATE à dfa_app (append-only).';
  end if;
  if has_table_privilege('dfa_app', 'public.resiliation_tenant_evenement', 'DELETE') then
    raise exception '0062 : resiliation_tenant_evenement doit interdire DELETE à dfa_app (append-only).';
  end if;

  -- resiliation_tenant : pas de DELETE pour dfa_app (jamais supprimée — preuve de l'effacement).
  if has_table_privilege('dfa_app', 'public.resiliation_tenant', 'DELETE') then
    raise exception '0062 : resiliation_tenant doit interdire DELETE à dfa_app.';
  end if;

  -- Fonction de purge présente et EXECUTE accordée à dfa_app.
  if to_regprocedure('public.purger_donnees_tenant(uuid, uuid, boolean)') is null then
    raise exception '0062 : fonction purger_donnees_tenant absente après migration.';
  end if;
  if not has_function_privilege('dfa_app', 'public.purger_donnees_tenant(uuid, uuid, boolean)', 'EXECUTE') then
    raise exception '0062 : dfa_app doit détenir EXECUTE sur purger_donnees_tenant.';
  end if;

  -- Aucune table du schéma exploitation ne doit porter tenant_id (invariant posé par 0048, ne
  -- doit jamais devenir faux — cette migration ne touche pas exploitation, contrôle défensif).
  if exists (
    select 1
      from pg_catalog.pg_attribute a
      join pg_catalog.pg_class c on c.oid = a.attrelid
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'exploitation' and c.relkind = 'r'
       and a.attname = 'tenant_id' and not a.attisdropped
  ) then
    raise exception '0062 : une table du schéma exploitation porte tenant_id — invariant 0048 rompu.';
  end if;

  -- resiliation_tenant elle-même n'a PAS de politique dfa_console (elle vit dans public, pas dans
  -- le plan console) — contrôle défensif : aucun privilège dfa_console sur cette table.
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'dfa_console') then
    if has_table_privilege('dfa_console', 'public.resiliation_tenant', 'SELECT')
       or has_table_privilege('dfa_console', 'public.resiliation_tenant', 'INSERT')
       or has_table_privilege('dfa_console', 'public.resiliation_tenant', 'UPDATE') then
      raise exception '0062 : dfa_console ne doit détenir aucun privilège sur resiliation_tenant.';
    end if;
  end if;
end
$$;
