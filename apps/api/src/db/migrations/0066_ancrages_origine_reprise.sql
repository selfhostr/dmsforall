-- =============================================================================================
-- 0066_ancrages_origine_reprise.sql — cinq tables reprises n'ont nulle part où déposer
-- l'identifiant d'origine, alors qu'une reprise Auto-i/Stieger en a besoin pour ne pas créer de
-- doublon en cas de rejeu, et pour rester réconciliable avec le système source.
--
-- CONSTAT : `document_vente` (0010, MD-01→MD-06) et `ordre_reparation` (0011, Z-17/AC-11) portent
-- déjà `origine`/`numero_origine`. Cinq tables ne les ont pas : `client`, `vehicule`, `article`,
-- `fournisseur`, `paiement`. Sans elles, un import ne peut ni être rejoué sans doublon, ni être
-- réconcilié avec le DMS source, ni tracer d'où vient une ligne — au premier import réel d'un
-- garage, chaque ligne reprise perd la correspondance avec le système source ou entre de force
-- dans la série DFA (même risque que Z-17 pour `ordre_reparation`).
--
-- DÉCISION : REPREND EXACTEMENT LE MOTIF DE `ordre_reparation` (0011), pas celui, plus complexe,
-- de `document_vente` (0010) — aucune des cinq tables ci-dessous n'a l'équivalent de
-- `type_document` (plusieurs séries de numérotation partageant une table) ni de `numero_sequence`
-- séparé du numéro affiché :
--   - même enum, réutilisé tel quel : `public.origine_document` ('dfa' | 'reprise'), créé par
--     0010. Un client/véhicule/article/fournisseur/paiement n'est pas un « document » au sens de
--     la chaîne de vente, mais la notion — de nous ou importé — est strictement la même ; un
--     nouvel enum à deux valeurs identiques serait la définition même de la divergence que cette
--     migration doit éviter.
--   - même sémantique : `numero_origine` = la chaîne source VERBATIM, jamais retouchée (aucun
--     zéro de tête retiré, aucun préfixe supprimé). NULL pour une ligne créée normalement par DFA.
--   - même contrainte de cohérence : `(origine = 'dfa') = (numero_origine is null)` — forme
--     simple à deux états de `ordre_reparation_origine_numero_origine_chk` (0011), pas la forme à
--     trois branches de `document_vente_origine_numero_chk` (0010), qui gère en plus
--     `numero_sequence` — notion absente ici.
--   - même unicité : idempotence de l'import — un numéro source ne peut pas être importé deux
--     fois PAR TENANT (règle n°1 du projet : `tenant_id` fait partie de toute contrainte
--     d'unicité). Index unique PARTIEL `(tenant_id, numero_origine) where numero_origine is not
--     null`, comme `ordre_reparation_numero_origine_uk` (0011) — aucune de ces cinq tables n'a de
--     dimension `type` qui justifierait de suivre plutôt le motif à 3 colonnes de
--     `document_vente_numero_origine_uk` (0010).
--
-- UNE SEULE MIGRATION POUR CINQ TABLES (et non cinq migrations) : un deuxième développeur
-- travaille sur ce dépôt en parallèle ; ne réserver qu'UN numéro (0066) évite de bloquer
-- inutilement 0066→0070 et un conflit de numérotation sur le même entier.
--
-- EXPAND SEUL, aucune réécriture de table : ces cinq tables contiennent des données réelles.
--   - colonnes NULLABLES, aucun NOT NULL rétroactif ;
--   - `origine` reçoit `not null default 'dfa'` (comme 0010/0011) mais c'est un DEFAULT CONSTANT
--     (littéral d'enum, pas volatile) : depuis PG 11, `ALTER TABLE ... ADD COLUMN ... DEFAULT
--     <constante>` est une opération de catalogue seule, sans réécriture de table — même coût
--     qu'une colonne nullable sans défaut ;
--   - `numero_origine` est nullable sans défaut : ajout de catalogue pur, coût nul.
--
-- INDEX ET `CONCURRENTLY` : le runner de migrations (`apps/api/src/db/migrer.ts`) exécute chaque
-- fichier dans une transaction (`begin`/…/`commit`) — `CREATE INDEX CONCURRENTLY` ne PEUT PAS
-- s'exécuter dans une transaction (erreur PostgreSQL immédiate), donc hors de question ici quelle
-- que soit la charge visée. Sans objet de toute façon : à l'instant de cette migration,
-- `numero_origine` vient d'être ajoutée sur les cinq tables et vaut NULL sur CHAQUE ligne
-- existante — l'index partiel `where numero_origine is not null` n'indexe donc ZÉRO ligne à sa
-- création, quel que soit le volume de la table (verrou `ACCESS EXCLUSIVE` bref, le temps d'un
-- balayage qui ne retient rien). Le coût réel de cet index n'apparaîtra qu'au fil des imports
-- futurs, un tenant à la fois, jamais en bloc sur une table déjà pleine.
--
-- CE QUI N'EST PAS FAIT ICI, VOLONTAIREMENT :
--   - `numero_article` (`article`, 0022) N'EST PAS TOUCHÉE : son commentaire (« reprise verbatim
--     future, jamais exploitée ») parle d'un mécanisme DIFFÉRENT — le numéro AFFICHÉ de
--     l'article, attribué par `attribuer_numero_article()` si absent à l'INSERT — et non d'un
--     ancrage vers l'identifiant source. `article.origine`/`numero_origine` (ci-dessous) sont
--     NEUFS, orthogonaux à `numero_article`, sur le même modèle que `numero` (numéro affiché) et
--     `numero_origine` (ancrage source) qui coexistent déjà sur `ordre_reparation` (0011).
--   - Aucune politique RLS n'est modifiée : les cinq tables portent une politique générique
--     `using (tenant_id = public.tenant_courant())` (0006/0007/0010/0022), indépendante de la
--     liste des colonnes — vérifié en lisant chaque bloc RLS avant d'écrire cette migration, pas
--     supposé.
--   - `paiement` reste gouverné par `paiement_verrouiller` (0010, MD-52, immuabilité) : la liste
--     blanche post-création (`exporte_le`/`export_id`/`modifie_le`) n'inclut pas
--     `origine`/`numero_origine`, qui deviennent donc immuables comme le reste de la ligne dès
--     l'INSERT — cohérent avec MD-52 (« une saisie erronée se corrige par un paiement de sens
--     opposé, jamais par UPDATE »), aucune modification de ce trigger n'est nécessaire.
--   - Aucun GRANT ajusté : les GRANT existants (0006/0007/0010/0022) sont posés au niveau TABLE
--     (`select, insert, update`), pas au niveau colonne — une nouvelle colonne en hérite sans rien
--     à faire.
--
-- Réversible : migrations/down/0066_ancrages_origine_reprise.down.sql — up → down → up rejoué par
-- la CI (vérification de réversibilité).
-- =============================================================================================

-- ---------------------------------------------------------------------------------------------
-- 1. `client`
-- ---------------------------------------------------------------------------------------------

alter table public.client
  add column origine        public.origine_document not null default 'dfa',
  add column numero_origine text null;

alter table public.client
  add constraint client_origine_numero_origine_chk
  check ((origine = 'dfa') = (numero_origine is null));

create unique index client_numero_origine_uk
  on public.client (tenant_id, numero_origine)
 where numero_origine is not null;

comment on column public.client.origine is
  'Reprise (0066) : dfa (créé par DFA) ou reprise (importé). Même enum, même sémantique que '
  'document_vente.origine (0010) et ordre_reparation.origine (0011).';
comment on column public.client.numero_origine is
  'Reprise (0066) : numéro/identifiant client source VERBATIM, jamais retouché. NULL pour un '
  'client créé normalement par DFA. numero (déjà not null, 0006) reste le numéro DFA affiché.';

-- ---------------------------------------------------------------------------------------------
-- 2. `vehicule`
-- ---------------------------------------------------------------------------------------------

alter table public.vehicule
  add column origine        public.origine_document not null default 'dfa',
  add column numero_origine text null;

alter table public.vehicule
  add constraint vehicule_origine_numero_origine_chk
  check ((origine = 'dfa') = (numero_origine is null));

create unique index vehicule_numero_origine_uk
  on public.vehicule (tenant_id, numero_origine)
 where numero_origine is not null;

comment on column public.vehicule.origine is
  'Reprise (0066) : dfa (créé par DFA) ou reprise (importé). Même enum, même sémantique que '
  'document_vente.origine (0010) et ordre_reparation.origine (0011).';
comment on column public.vehicule.numero_origine is
  'Reprise (0066) : identifiant véhicule source VERBATIM (ex. identifiant interne Auto-i sans '
  'équivalent DFA — écarté explicitement par 0011, revu ici pour la même raison que client/'
  'article/fournisseur/paiement), jamais retouché. NULL pour un véhicule créé normalement par '
  'DFA. Distinct de vin/vehicule_plaque, qui restent les identifiants métier stables.';

-- ---------------------------------------------------------------------------------------------
-- 3. `article`
-- ---------------------------------------------------------------------------------------------

alter table public.article
  add column origine        public.origine_document not null default 'dfa',
  add column numero_origine text null;

alter table public.article
  add constraint article_origine_numero_origine_chk
  check ((origine = 'dfa') = (numero_origine is null));

create unique index article_numero_origine_uk
  on public.article (tenant_id, numero_origine)
 where numero_origine is not null;

comment on column public.article.origine is
  'Reprise (0066) : dfa (créé par DFA) ou reprise (importé). Même enum, même sémantique que '
  'document_vente.origine (0010) et ordre_reparation.origine (0011). Orthogonal à numero_article '
  '(0022, numéro AFFICHÉ attribué par attribuer_numero_article() si absent) : voir l''en-tête de '
  'cette migration pour la distinction.';
comment on column public.article.numero_origine is
  'Reprise (0066) : référence article source VERBATIM, jamais retouchée. NULL pour un article '
  'créé normalement par DFA. numero_article (0022) reste le numéro DFA affiché, distinct de '
  'cette colonne.';

-- ---------------------------------------------------------------------------------------------
-- 4. `fournisseur`
-- ---------------------------------------------------------------------------------------------

alter table public.fournisseur
  add column origine        public.origine_document not null default 'dfa',
  add column numero_origine text null;

alter table public.fournisseur
  add constraint fournisseur_origine_numero_origine_chk
  check ((origine = 'dfa') = (numero_origine is null));

create unique index fournisseur_numero_origine_uk
  on public.fournisseur (tenant_id, numero_origine)
 where numero_origine is not null;

comment on column public.fournisseur.origine is
  'Reprise (0066) : dfa (créé par DFA) ou reprise (importé). Même enum, même sémantique que '
  'document_vente.origine (0010) et ordre_reparation.origine (0011).';
comment on column public.fournisseur.numero_origine is
  'Reprise (0066) : identifiant fournisseur source VERBATIM, jamais retouché. NULL pour un '
  'fournisseur créé normalement par DFA — fournisseur (0022) n''a pas de numéro affiché propre.';

-- ---------------------------------------------------------------------------------------------
-- 5. `paiement`
-- ---------------------------------------------------------------------------------------------

alter table public.paiement
  add column origine        public.origine_document not null default 'dfa',
  add column numero_origine text null;

alter table public.paiement
  add constraint paiement_origine_numero_origine_chk
  check ((origine = 'dfa') = (numero_origine is null));

create unique index paiement_numero_origine_uk
  on public.paiement (tenant_id, numero_origine)
 where numero_origine is not null;

comment on column public.paiement.origine is
  'Reprise (0066) : dfa (créé par DFA) ou reprise (importé). Même enum, même sémantique que '
  'document_vente.origine (0010) et ordre_reparation.origine (0011). Couverte par '
  'paiement_verrouiller (MD-52, 0010) : immuable comme le reste de la ligne dès l''INSERT, hors '
  'liste blanche exporte_le/export_id/modifie_le.';
comment on column public.paiement.numero_origine is
  'Reprise (0066) : identifiant de paiement/transaction source VERBATIM, jamais retouché. NULL '
  'pour un paiement saisi normalement par DFA. Distinct de identifiant_transaction_banque (0010, '
  'camt.054) : celui-ci vient de la banque, numero_origine vient de l''ancien DMS.';

-- ---------------------------------------------------------------------------------------------
-- Assertions de fin de migration
-- ---------------------------------------------------------------------------------------------

do $$
declare
  v_table    text;
  v_manquant boolean;
begin
  foreach v_table in array array['client', 'vehicule', 'article', 'fournisseur', 'paiement']
  loop
    if not exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = v_table and column_name = 'origine'
    ) then
      raise exception '0066 : %.origine manquante après migration.', v_table;
    end if;

    if not exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = v_table and column_name = 'numero_origine'
    ) then
      raise exception '0066 : %.numero_origine manquante après migration.', v_table;
    end if;

    execute format(
      'select exists (select 1 from public.%I where origine = ''reprise'' and numero_origine is null)',
      v_table
    ) into v_manquant;
    if v_manquant then
      raise exception '0066 : au moins un %.origine=reprise sans numero_origine.', v_table;
    end if;

    execute format(
      'select exists (select 1 from public.%I where origine = ''dfa'' and numero_origine is not null)',
      v_table
    ) into v_manquant;
    if v_manquant then
      raise exception '0066 : au moins un %.origine=dfa avec numero_origine renseigné.', v_table;
    end if;
  end loop;
end
$$;
