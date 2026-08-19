-- =============================================================================================
-- 0058_vehicule_ocr_scan_journal.sql — reconnaissance automatique du permis de circulation
-- (« carte grise »), OCR serveur. Périmètre : apps/api/src/vehicules/ocr/.
--
-- NUMÉROTATION : 0057 est la dernière migration existante au moment où cette tâche démarre.
-- Numéro 0058 réservé par consigne de tâche (deux autres agents travaillent en parallèle sur des
-- périmètres disjoints — canal temps réel, écran mobile de scan — aucun des deux ne touche aux
-- migrations).
--
-- CE QUE CETTE MIGRATION POSE, ET POURQUOI C'EST TOUT CE QU'ELLE POSE :
--
-- L'endpoint de scan (`POST /vehicules/ocr/permis-circulation`) NE CRÉE RIEN (décision @laupernoe) : il
-- rend une proposition (donnée extraite + correspondances trouvées dans le référentiel ASTRA, les
-- véhicules et les clients du tenant), l'utilisateur confirme ensuite via les endpoints
-- `POST /vehicules` / `POST /clients` existants, inchangés. Il n'y a donc AUCUNE nouvelle entité
-- métier à modéliser ici, pas de colonne à ajouter à `vehicule` ou `client`.
--
-- Ce qui manquait en revanche : un endroit où le passage d'un scan laisse une trace SANS jamais
-- porter la donnée personnelle lue (décision @laupernoe : la photo n'est pas conservée, et aucun journal
-- ne doit recracher un nom/une adresse — CONTRIBUTING.md, « journalisation »). `vehicule_ocr_scan_journal`
-- sert DEUX besoins avec la même table, plutôt que d'en poser deux :
--
--   1. AUDIT — qui a scanné, quand, avec quel résultat (succès, image invalide, format non
--      supporté, moteur OCR indisponible) — traçabilité d'un traitement qui touche des documents
--      d'identité, sans jamais stocker CE QUI a été lu. `code_type_lu_valide` /
--      `vin_checksum_valide` sont des BOOLÉENS (« la lecture a-t-elle été confirmée ? »), jamais le
--      texte lu lui-même. `vehicule_correspondance_id` / `client_correspondance_id` ne pointent que
--      vers une fiche déjà existante du tenant (donnée déjà légitimement en base), jamais vers une
--      valeur extraite de la photo.
--
--   2. LIMITATION DE DÉBIT — un scan mobilise le processeur (moteur OCR, voir le service dédié
--      décrit hors SQL). Compter les lignes de CETTE MÊME table sur une fenêtre glissante
--      (`tenant_id, utilisateur_id, cree_le`) donne le quota sans exiger Redis ni une table dédiée
--      — l'index posé au §2 sert explicitement cette requête EN PLUS de la pagination d'audit.
--
-- APPEND-ONLY, MÊME DOCTRINE QUE `journal_securite` (0000/0001) : `dfa_app` n'a ni UPDATE ni
-- DELETE. Pas de trigger `entite_auditee`/`auditer_atelier` (0033 et suivants) : ce dispositif
-- trace les modifications d'une entité MUTABLE (avant/après) ; `vehicule_ocr_scan_journal` est
-- déjà, par construction, un journal immuable — un audit-de-l'audit n'ajouterait rien.
--
-- Réversible : migrations/down/0058_vehicule_ocr_scan_journal.down.sql.
-- =============================================================================================


-- ---------------------------------------------------------------------------------------------
-- 1. Enum résultat de scan.
-- ---------------------------------------------------------------------------------------------

create type public.resultat_scan_ocr_permis as enum (
  -- Image traitée de bout en bout par le moteur OCR (indépendamment du nombre de champs lus avec
  -- confiance — un scan qui ne lit fiablement AUCUN champ est un succès technique, pas un échec :
  -- c'est à l'utilisateur de juger si la proposition rendue est exploitable).
  'succes',
  -- Rejet avant tout appel au moteur OCR : taille, format MIME, image illisible/corrompue.
  'image_invalide',
  -- Décodage tenté (ex. HEIC) et échoué.
  'format_non_supporte',
  -- Moteur OCR exécuté de bout en bout SANS lever d'erreur, mais AUCUN champ exploitable n'en est
  -- ressorti (document absent du cadre, flou, trop sombre…) — distinct d'un succès partiel (un
  -- scan qui lit ne serait-ce qu'un champ, même douteux, reste `succes`) : rendu `422
  -- SCAN_PHOTO_ILLISIBLE` côté API, voir `service-vehicule-ocr.ts`.
  'rien_exploitable',
  -- Le service OCR conteneurisé n'a pas répondu (timeout, indisponible).
  'moteur_indisponible',
  -- Toute autre panne inattendue côté serveur.
  'erreur_interne'
);


-- ---------------------------------------------------------------------------------------------
-- 2. `vehicule_ocr_scan_journal`.
-- ---------------------------------------------------------------------------------------------

create table public.vehicule_ocr_scan_journal (
  id                          uuid        not null default gen_random_uuid(),
  tenant_id                   uuid        not null,
  -- NOT NULL : contrairement à journal_securite (tentatives non authentifiées possibles), scanner
  -- un permis exige déjà une session valide (droit vehicule.creer) — l'auteur est toujours connu.
  utilisateur_id              uuid        not null,

  resultat                    public.resultat_scan_ocr_permis not null,

  -- Durée de traitement serveur totale (réception de l'image -> réponse), PAS seulement le temps
  -- moteur OCR — c'est le chiffre qui décide si la fonctionnalité est utilisable au comptoir.
  duree_traitement_ms         integer     not null,

  -- Booléens de CONFIRMATION, jamais la valeur lue elle-même (voir en-tête de fichier).
  code_type_lu_valide         boolean     not null default false,
  vin_checksum_valide         boolean     not null default false,

  -- Correspondances TROUVÉES parmi des fiches déjà existantes du tenant — jamais une valeur
  -- extraite de la photo. NULL = rien trouvé (à distinguer, côté lecture applicative uniquement,
  -- d'un scan qui n'a pas cherché : cette table ne porte que le résultat final, la distinction
  -- « pas cherché » vs « cherché, rien trouvé » n'a pas sa place dans un journal d'audit dont
  -- l'unique lecteur est un exploitant, pas un écran de reprise de scan).
  vehicule_correspondance_id  uuid        null,
  client_correspondance_id    uuid        null,

  cree_le                     timestamptz not null default now(),

  constraint vehicule_ocr_scan_journal_pk primary key (id),

  constraint vehicule_ocr_scan_journal_fk_utilisateur
    foreign key (tenant_id, utilisateur_id)
    references public.utilisateur (tenant_id, id) on delete restrict,

  constraint vehicule_ocr_scan_journal_fk_vehicule
    foreign key (tenant_id, vehicule_correspondance_id)
    references public.vehicule (tenant_id, id) on delete restrict,

  constraint vehicule_ocr_scan_journal_fk_client
    foreign key (tenant_id, client_correspondance_id)
    references public.client (tenant_id, id) on delete restrict,

  constraint vehicule_ocr_scan_journal_duree_positive_chk check (duree_traitement_ms >= 0),

  -- Une correspondance véhicule/client ne se renseigne que sur un scan RÉUSSI — un scan en échec
  -- (image invalide, moteur indisponible…) n'a rien pu chercher.
  constraint vehicule_ocr_scan_journal_correspondance_coherente_chk check (
    resultat = 'succes'
    or (vehicule_correspondance_id is null and client_correspondance_id is null)
  )
);

comment on table public.vehicule_ocr_scan_journal is
  'Audit + limitation de débit du scan OCR de permis de circulation (POST /vehicules/ocr/'
  'permis-circulation). Append-only (dfa_app : select, insert seulement). Ne porte JAMAIS la '
  'donnée personnelle lue sur le document — seulement le résultat du traitement et des '
  'références vers des fiches déjà existantes du tenant. La photo elle-même n''est ni écrite en '
  'base ni sur disque (traitée en mémoire, voir apps/api/src/vehicules/ocr/).';

-- Sert À LA FOIS la pagination d'un futur écran d'audit ET le comptage de quota glissant
-- (`count(*) where tenant_id = ? and utilisateur_id = ? and cree_le > now() - interval '...'`) —
-- un seul index, deux lectures.
create index vehicule_ocr_scan_journal_quota_idx
  on public.vehicule_ocr_scan_journal (tenant_id, utilisateur_id, cree_le desc);

revoke all              on public.vehicule_ocr_scan_journal from dfa_app;
grant  select, insert   on public.vehicule_ocr_scan_journal to   dfa_app;

alter table public.vehicule_ocr_scan_journal enable row level security;
alter table public.vehicule_ocr_scan_journal force  row level security;

create policy vehicule_ocr_scan_journal_isolation_tenant on public.vehicule_ocr_scan_journal
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy vehicule_ocr_scan_journal_migrator on public.vehicule_ocr_scan_journal
  to dfa_migrator
  using (true) with check (true);


-- ---------------------------------------------------------------------------------------------
-- 3. Assertions de fin de migration.
-- ---------------------------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.vehicule_ocr_scan_journal') is null then
    raise exception '0058 : table vehicule_ocr_scan_journal absente après migration.';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'vehicule_ocr_scan_journal'
       and column_name = 'utilisateur_id' and is_nullable = 'NO' and data_type = 'uuid'
  ) then
    raise exception '0058 : vehicule_ocr_scan_journal.utilisateur_id absente, nullable, ou de mauvais type.';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'vehicule_ocr_scan_journal'
       and column_name = 'vehicule_correspondance_id' and is_nullable = 'YES' and data_type = 'uuid'
  ) then
    raise exception '0058 : vehicule_ocr_scan_journal.vehicule_correspondance_id absente, non-nullable, ou de mauvais type.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conname = 'vehicule_ocr_scan_journal_duree_positive_chk'
       and conrelid = 'public.vehicule_ocr_scan_journal'::regclass
  ) then
    raise exception '0058 : contrainte vehicule_ocr_scan_journal_duree_positive_chk absente.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conname = 'vehicule_ocr_scan_journal_correspondance_coherente_chk'
       and conrelid = 'public.vehicule_ocr_scan_journal'::regclass
  ) then
    raise exception '0058 : contrainte vehicule_ocr_scan_journal_correspondance_coherente_chk absente.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'vehicule_ocr_scan_journal' and c.relrowsecurity
  ) then
    raise exception '0058 : row level security non activée sur vehicule_ocr_scan_journal.';
  end if;

  if exists (
    select 1
      from information_schema.role_table_grants
     where table_schema = 'public' and table_name = 'vehicule_ocr_scan_journal'
       and grantee = 'dfa_app' and privilege_type in ('UPDATE', 'DELETE')
  ) then
    raise exception '0058 : dfa_app ne doit avoir ni UPDATE ni DELETE sur vehicule_ocr_scan_journal (append-only).';
  end if;
end
$$;
