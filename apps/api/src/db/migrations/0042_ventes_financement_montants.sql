-- =============================================================================================
-- 0042_ventes_financement_montants.sql — comble une lacune constatée par audit sur le module
-- Ventes VN/VO (étape 4) : `financement_vente` (0032) ne porte AUCUNE donnée monétaire. Un
-- dossier de vente avec un leasing/crédit CONFIRMÉ n'expose donc nulle part combien le client
-- paie (ni au vendeur, ni à la direction) — seule la référence de contrat (`reference_contrat`,
-- traçabilité pure) existait.
--
-- TENSION SIGNALÉE avec `RV-42` (specification-etape-4-ventes.md §5.5, littéral) : « Le dossier
-- de vente doit conserver la référence du contrat de leasing (numéro, organisme) à titre de
-- traçabilité, SANS EN PORTER LE DÉTAIL FINANCIER (mensualité, durée, kilométrage contractuel)
-- qui reste dans le système de l'organisme. » Cette migration pose exactement les colonnes que
-- RV-42 disait ne pas vouloir. Décision arbitrée hors de cette migration (audit ayant priorité
-- sur la lecture initiale de RV-42) — signalée ici et dans `contrats/ventes/financement.ts` /
-- `schema/ventes/financement.ts` pour qu'une révision de la spécification (§5.5) suive si @laupernoe le
-- juge nécessaire. Le kilométrage contractuel, lui, N'EST PAS repris : seul le sous-ensemble
-- strictement monétaire (« combien le client paie ») est ajouté, pas la totalité du détail que
-- RV-42 renvoyait à l'organisme.
--
-- 1. CINQ colonnes, TOUTES NULLABLES — montant_finance_centimes, acompte_centimes,
--    mensualite_centimes (integer, centimes), taux_interet_pourmille, duree_mois (smallint,
--    même type que `prestation.taux_tva_pourmille`, 0005). Nullable par construction : rien n'est
--    connu pour un `comptant` (pas de financement), et rien n'est forcément connu au moment de
--    PROPOSER un crédit/leasing (l'organisme peut confirmer des chiffres différents de la
--    proposition). Ce sont des colonnes de SAISIE (ce que le vendeur a noté), pas une source de
--    vérité qui remplace le contrat signé chez l'organisme.
--
-- 2. CHECK « positif ou nul » sur les trois colonnes centimes et « borné » sur les deux autres —
--    même patron que `reprise_valeur_estimee_chk` (0032) : filet base, pas une règle métier
--    nouvelle. `taux_interet_pourmille between 0 and 1000` reprend la borne de
--    `prestation_taux_tva_chk` (0005). `duree_mois between 1 and 120` (10 ans) est un garde-fou
--    contre une saisie aberrante — `0` est explicitement refusé (une durée nulle n'est pas un
--    financement), pas une règle métier tranchée sur la durée maximale réelle d'un leasing.
--
-- 3. CHECK `financement_vente_comptant_sans_detail_chk` — RV-44 : un `comptant` N'EST PAS un
--    financement, donc aucune des cinq colonnes ne doit y être renseignée. Même raisonnement que
--    `financement_vente_organisme_requis_chk` (0032) déjà posée sur `organisme_id` pour la même
--    raison, étendu ici aux cinq colonnes monétaires.
--
-- 4. AUCUN champ dérivé (mensualité recalculée depuis taux/montant/durée) : une formule
--    d'amortissement est une décision métier propre à chaque organisme, pas une évidence
--    arithmétique — ce que le vendeur saisit est ce qui est stocké, point.
--
-- 5. VISIBILITÉ (hors DDL, périmètre `apps/api/src/ventes/**` du même agent) : ces cinq champs
--    suivent la doctrine `roleVoitLesMontants()` (RF-116) déjà appliquée par
--    `ventes/mappers.ts::versDocumentVenteResume` — omis (pas `null`) de `ReponseFinancement` et
--    `FinancementResume` pour un rôle qui ne voit pas les montants (`ROLES_SANS_MONTANT_FACTURATION`).
--
-- Réversible : migrations/down/0042_ventes_financement_montants.down.sql.
-- Migration de DONNÉES : aucune — cinq colonnes neuves, entièrement NULL sur les lignes
-- existantes (aucune ligne de `financement_vente` déjà en base ne peut violer la CHECK §3 : elle
-- ne peut être vraie que si au moins une des cinq colonnes neuves est non-NULL, impossible avant
-- cette migration).
-- =============================================================================================


-- ---------------------------------------------------------------------------------------------
-- 1. Colonnes — toutes nullables (§1 en-tête).
-- ---------------------------------------------------------------------------------------------

alter table public.financement_vente
  add column montant_finance_centimes  integer   null,
  add column acompte_centimes          integer   null,
  add column mensualite_centimes       integer   null,
  add column taux_interet_pourmille    smallint  null,
  add column duree_mois                smallint  null;


-- ---------------------------------------------------------------------------------------------
-- 2. CHECK — positif ou nul / borné, quand renseigné (§2 en-tête).
-- ---------------------------------------------------------------------------------------------

alter table public.financement_vente
  add constraint financement_vente_montant_finance_chk
  check (montant_finance_centimes is null or montant_finance_centimes >= 0);

alter table public.financement_vente
  add constraint financement_vente_acompte_chk
  check (acompte_centimes is null or acompte_centimes >= 0);

alter table public.financement_vente
  add constraint financement_vente_mensualite_chk
  check (mensualite_centimes is null or mensualite_centimes >= 0);

alter table public.financement_vente
  add constraint financement_vente_taux_interet_chk
  check (taux_interet_pourmille is null or taux_interet_pourmille between 0 and 1000);

alter table public.financement_vente
  add constraint financement_vente_duree_chk
  check (duree_mois is null or duree_mois between 1 and 120);


-- ---------------------------------------------------------------------------------------------
-- 3. CHECK — un `comptant` ne porte aucun détail monétaire (§3 en-tête, RV-44).
-- ---------------------------------------------------------------------------------------------

alter table public.financement_vente
  add constraint financement_vente_comptant_sans_detail_chk
  check (
    type <> 'comptant'
    or (montant_finance_centimes is null
        and acompte_centimes is null
        and mensualite_centimes is null
        and taux_interet_pourmille is null
        and duree_mois is null)
  );


-- ---------------------------------------------------------------------------------------------
-- 4. Commentaire de table complété — texte de 0032 CONSERVÉ, un paragraphe ajouté à la fin.
-- ---------------------------------------------------------------------------------------------

comment on table public.financement_vente is
  'Financement/leasing d''un dossier de vente (RV-39→RV-45). PLUSIEURS lignes possibles par '
  'dossier (append-only côté remplacement, CV-03 : un financement refusé est TERMINAL, jamais '
  'rouvert — un nouveau mode de financement est une NOUVELLE ligne). Le "financement courant" '
  '(contrats/ventes/financement.ts::FinancementResume) est une notion DE LECTURE (le plus récent '
  'non refusé, ou le plus récent tout court) — aucun drapeau "actif" stocké, le contrat n''en '
  'expose aucun. Machine à états (entite=''financement_vente'') + verifier_transition() — '
  'dispositif générique de 0003. Auditée. montant_finance_centimes/acompte_centimes/'
  'mensualite_centimes/taux_interet_pourmille/duree_mois (0042) : détail monétaire saisi par le '
  'vendeur, TENSION SIGNALÉE avec RV-42 (specification-etape-4-ventes.md §5.5, qui excluait '
  'explicitement ce détail) — voir l''en-tête de 0042_ventes_financement_montants.sql.';


-- ---------------------------------------------------------------------------------------------
-- Assertions de fin de migration
-- ---------------------------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'financement_vente'
       and column_name = 'montant_finance_centimes' and is_nullable = 'YES' and data_type = 'integer'
  ) then
    raise exception '0042 : financement_vente.montant_finance_centimes absente, non-nullable, ou de mauvais type.';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'financement_vente'
       and column_name = 'acompte_centimes' and is_nullable = 'YES' and data_type = 'integer'
  ) then
    raise exception '0042 : financement_vente.acompte_centimes absente, non-nullable, ou de mauvais type.';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'financement_vente'
       and column_name = 'mensualite_centimes' and is_nullable = 'YES' and data_type = 'integer'
  ) then
    raise exception '0042 : financement_vente.mensualite_centimes absente, non-nullable, ou de mauvais type.';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'financement_vente'
       and column_name = 'taux_interet_pourmille' and is_nullable = 'YES' and data_type = 'smallint'
  ) then
    raise exception '0042 : financement_vente.taux_interet_pourmille absente, non-nullable, ou de mauvais type.';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'financement_vente'
       and column_name = 'duree_mois' and is_nullable = 'YES' and data_type = 'smallint'
  ) then
    raise exception '0042 : financement_vente.duree_mois absente, non-nullable, ou de mauvais type.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conname = 'financement_vente_montant_finance_chk'
       and conrelid = 'public.financement_vente'::regclass
  ) then
    raise exception '0042 : financement_vente_montant_finance_chk absente après migration.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conname = 'financement_vente_acompte_chk'
       and conrelid = 'public.financement_vente'::regclass
  ) then
    raise exception '0042 : financement_vente_acompte_chk absente après migration.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conname = 'financement_vente_mensualite_chk'
       and conrelid = 'public.financement_vente'::regclass
  ) then
    raise exception '0042 : financement_vente_mensualite_chk absente après migration.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conname = 'financement_vente_taux_interet_chk'
       and conrelid = 'public.financement_vente'::regclass
  ) then
    raise exception '0042 : financement_vente_taux_interet_chk absente après migration.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conname = 'financement_vente_duree_chk'
       and conrelid = 'public.financement_vente'::regclass
  ) then
    raise exception '0042 : financement_vente_duree_chk absente après migration.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conname = 'financement_vente_comptant_sans_detail_chk'
       and conrelid = 'public.financement_vente'::regclass
  ) then
    raise exception '0042 : financement_vente_comptant_sans_detail_chk absente après migration.';
  end if;

  if exists (
    select 1 from public.financement_vente
     where montant_finance_centimes is not null
        or acompte_centimes is not null
        or mensualite_centimes is not null
        or taux_interet_pourmille is not null
        or duree_mois is not null
  ) then
    raise exception '0042 : une ligne de financement_vente porte déjà une valeur monétaire juste après la migration — une valeur a été inventée quelque part.';
  end if;
end
$$;
