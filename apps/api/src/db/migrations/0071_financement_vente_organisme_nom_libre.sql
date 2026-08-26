-- =============================================================================================
-- 0071_financement_vente_organisme_nom_libre.sql — corrige un défaut qui rend `D-42`
-- (docs/reprise/decisions.md) inapplicable : « l'organisme de financement — banque, société de
-- leasing — est saisi en nom libre par défaut, sans exiger une fiche client résolue. La
-- résolution en fiche client se fait après coup, à la main, sans bloquer la bascule. » Tranchée
-- par @laupernoe le 25.08.2026.
--
-- LE DÉFAUT, SIGNALÉ EN TÊTE DE 0070 (§6, commentaire sur `financement_vente.numero_origine`),
-- PAS CORRIGÉ LÀ, CORRIGÉ ICI : `financement_vente_organisme_requis_chk` (0032) exige
-- `organisme_id` (FK `client`) NOT NULL dès que `type <> 'comptant'`, SANS échappatoire nom
-- libre. `reprise.dette_financement_organisme_id`/`.dette_financement_organisme_nom` (0032)
-- traitent le même besoin correctement (`reprise_dette_organisme_coherent_chk` accepte un nom
-- seul) — `financement_vente` n'a, avant cette migration, AUCUNE colonne équivalente. Un dossier
-- `credit`/`leasing` repris dont l'organisme n'est pas déjà une fiche client bien dédupliquée ne
-- peut donc pas être basculé : la décision de @laupernoe est inapplicable telle quelle. Mesuré en lisant
-- `financement_vente_organisme_requis_chk` (migrations/0032_ventes.sql) et
-- `reprise_dette_organisme_coherent_chk` (même fichier), pas supposé.
--
-- CORRECTIF — REPREND EXACTEMENT LE PATRON DE `reprise` (0032), MÊME COLONNE, MÊME CHECK, SANS
-- ÉCART, deux temps :
--   1. `organisme_nom text null` — texte libre, même doctrine que
--      `reprise.dette_financement_organisme_nom` : `null` tant qu'aucun nom n'a été saisi, non
--      vide dès que renseigné (`financement_vente_organisme_nom_non_vide_chk`, même formule que
--      `reprise_dette_organisme_nom_non_vide_chk`).
--   2. `financement_vente_organisme_requis_chk` (0032) RELÂCHÉE : `type = 'comptant' or
--      organisme_id is not null or organisme_nom is not null` — un `credit`/`leasing` accepte
--      désormais organisme_id (fiche résolue) OU organisme_nom (texte libre), au moins l'un des
--      deux, exactement la disjonction de `reprise_dette_organisme_coherent_chk`. `drop
--      constraint`/`add constraint`, même nom, même patron que 0047
--      (`stock_article_reservee_leq_physique_chk`) pour altérer une CHECK posée par une migration
--      antérieure sans la rouvrir.
--
-- CE QUI N'EST PAS FAIT ICI, VOLONTAIREMENT :
--   - Le contrat gelé `packages/shared/src/contrats/ventes/financement.ts` (`ReponseFinancement`)
--     n'expose aujourd'hui aucun `organismeNom` (vérifié : seul `reprise.ts` l'expose, sous
--     `detteFinancementOrganismeNom`) — hors périmètre base de données, l'écrivain d'import D-42
--     pour `ventes_vn_vo` (qui n'existe pas encore, 0070 l'a déjà signalé) devra faire évoluer ce
--     contrat avant de pouvoir peupler `organisme_nom` par API. Cette migration pose seulement la
--     colonne et la contrainte qui le débloqueront.
--   - Aucune politique RLS, aucun GRANT, aucun trigger d'audit modifiés — la table porte déjà
--     `financement_vente_isolation_tenant`/`financement_vente_migrator` (0032), indépendants de
--     la liste de colonnes, et `auditer_atelier()` (générique, `to_jsonb`) journalise la nouvelle
--     colonne sans changement de trigger — même raisonnement que 0066/0070.
--
-- EXPAND SEUL : colonne NULLABLE sans défaut (aucune réécriture de table), CHECK relâchée (plus
-- permissive qu'avant — aucune ligne existante ne peut la violer, `organisme_id` déjà NOT NULL
-- sur toute ligne `credit`/`leasing` existante continue de la satisfaire).
--
-- Réversible : migrations/down/0071_financement_vente_organisme_nom_libre.down.sql — up → down →
-- up rejoué par la CI (vérification de réversibilité).
-- =============================================================================================

alter table public.financement_vente
  add column organisme_nom text null;

alter table public.financement_vente
  add constraint financement_vente_organisme_nom_non_vide_chk
  check (organisme_nom is null or length(btrim(organisme_nom)) > 0);

alter table public.financement_vente
  drop constraint financement_vente_organisme_requis_chk;

alter table public.financement_vente
  add constraint financement_vente_organisme_requis_chk
  check (type = 'comptant' or organisme_id is not null or organisme_nom is not null);

comment on column public.financement_vente.organisme_nom is
  '0071 (D-42, docs/reprise/decisions.md) : texte libre si l''organisme de financement n''est pas '
  '(encore) une fiche client DFA — même doctrine que reprise.dette_financement_organisme_nom '
  '(0032). Au moins l''un de organisme_id/organisme_nom est renseigné dès que type <> ''comptant'' '
  '(financement_vente_organisme_requis_chk). La résolution en fiche client se fait après coup, à '
  'la main, sans jamais réécrire organisme_nom rétroactivement (même doctrine que numero_origine : '
  'verbatim, jamais retouché) — organisme_id se renseigne alors EN PLUS, organisme_nom reste tel quel.';


-- ---------------------------------------------------------------------------------------------
-- Assertions de fin — patron 0066/0070 : la migration échoue fort si le correctif n'a pas pris.
-- ---------------------------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'financement_vente'
       and column_name = 'organisme_nom'
  ) then
    raise exception '0071 : financement_vente.organisme_nom manquante après migration.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conname = 'financement_vente_organisme_requis_chk'
       and conrelid = 'public.financement_vente'::regclass
       and pg_get_constraintdef(oid) ilike '%organisme_nom%'
  ) then
    raise exception
      '0071 : financement_vente_organisme_requis_chk ne référence pas organisme_nom après migration.';
  end if;
end
$$;
