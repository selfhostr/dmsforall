-- =============================================================================================
-- 0063_report_reglement_correction.sql — deux défauts de la MÊME correction de facture
-- (`ServiceCorrectionFacture.corriger`, RF-12→RF-14), traités ensemble (même transaction
-- applicative, même migration) :
--   §1 (issue #154) : le paiement suit la facture de remplacement quand une facture émise, déjà
--       partiellement ou totalement réglée, est corrigée par avoir.
--   §2 (issue #156) : la facture de remplacement référence désormais la facture qu'elle corrige
--       — traçabilité en base, pas seulement dans la réponse HTTP du moment de la correction.
--
-- NUMÉROTATION : 0062 est la dernière migration existante. Numéro 0063 réservé par consigne de
-- tâche (0061/0062 déjà réservés à deux autres agents en parallèle).
--
-- §1 — ISSUE #154
--
-- LE DÉFAUT (mesuré en exécution, issue #154) : `POST /documents-vente/{factureId}/corriger`
-- (`ServiceCorrectionFacture`, RF-12→RF-14) annule la facture par un avoir TOTAL puis émet une
-- facture de remplacement avec les mêmes lignes — mais celle-ci repartait avec
-- `montant_regle_centimes = 0`, réclamant l'intégralité alors qu'un acompte était déjà encaissé
-- sur la facture d'origine. Dommage réel signalé par la tâche : les relances (`relances/
-- service-relances-facture.ts`) raisonnent sur `solde_centimes` du document et relanceraient le
-- client pour un montant déjà partiellement soldé.
--
-- ARBITRAGE (@laupernoe, tranché) : le paiement suit la facture de remplacement, pas un compte client
-- (qui n'existe pas dans le produit). La chaîne comptable actuelle n'est PAS fausse : l'avoir
-- annule bien la facture d'origine, sur laquelle le paiement reste attaché en base — c'est un
-- problème opérationnel (le comptoir/les relances affichent le mauvais reste à payer), pas une
-- écriture erronée à corriger.
--
-- CE QUE CETTE MIGRATION POSE, ET POURQUOI UNE TABLE PLUTÔT QU'UNE RÉAFFECTATION EN PLACE
--
--   `imputation_paiement` (0010 §11) est IMMUABLE par conception : `dfa_app` n'a que SELECT/
--   INSERT (`grant select, insert`, jamais UPDATE/DELETE), et le trigger `imputation_paiement_
--   verrouiller` interdit à `dfa_app` de modifier une ligne existante au-delà de `exporte_le`/
--   `exportId`. Réaffecter `document_id` d'une imputation existante vers
--   la facture de remplacement est donc IMPOSSIBLE sans casser cette immutabilité (append-only,
--   MD-51/MD-52). Dupliquer l'imputation (nouvelle ligne `reglement` sur la facture de
--   remplacement, même paiement) se heurte à l'invariant agrégé MD-51.b
--   (`imputation_paiement_verifier_invariants`, 0010 §11) : la somme des imputations `reglement`
--   d'un paiement ne peut pas dépasser son montant — dupliquer compterait deux fois le même
--   encaissement contre le même paiement. Une écriture inverse (imputation négative sur l'ancienne
--   facture) se heurte à son tour à MD-51.a, qui somme des VALEURS ABSOLUES par document — une
--   contre-passation y apparaîtrait comme UNE IMPUTATION SUPPLÉMENTAIRE, pas une compensation, et
--   ferait dépasser le total du document.
--
--   `report_reglement_correction` (ci-dessous) est donc un événement SÉPARÉ, append-only, qui ne
--   touche JAMAIS `imputation_paiement` : il documente « tel montant, réglé sur la facture
--   d'origine, a été reporté sur la facture de remplacement, à telle date, par tel utilisateur ».
--   L'historique des encaissements réels (qui a payé quoi, quand, par quel moyen) reste
--   EXACTEMENT ce qu'il était sur `imputation_paiement`/`paiement` — rien n'y est réécrit. Seuls
--   les COMPTEURS DÉRIVÉS du document (`document_vente.montant_regle_centimes`/`solde_centimes`/
--   `statut_reglement`, MD-53) bougent, par UPDATE ordinaire, en dehors de `imputation_paiement`
--   — exactement comme `ServiceCorrectionFacture` le fait déjà pour `statut`/`annule_par_avoir_id`
--   à l'émission de l'avoir (RF-32, `service-emission.ts` §6), un mécanisme déjà établi de mise à
--   jour du document SANS passer par le lettrage.
--
--   RÈGLE RETENUE pour la facture ANNULÉE (à trancher, imposée par la tâche, justifiée ici pour un
--   contrôle fiduciaire) : `montant_regle_centimes`/`solde_centimes` reviennent à 0 et
--   `statut_reglement` à 'non_regle' sur la facture annulée dès que son règlement est reporté —
--   cohérent avec la doctrine déjà en vigueur ailleurs dans ce module
--   (`facturation/paiements/imputations.ts::verifierDocumentImputable`, commentaire de tête : « le
--   document a été annulé par l'avoir — sa dette réelle est nulle »). L'alternative (laisser
--   `montant_regle_centimes = 150.00` sur un document `annule_par_avoir`) afficherait un
--   encaissement sur un document dont la créance est éteinte — la surprise qu'un contrôle
--   fiduciaire signalerait en premier. Rien n'est perdu pour autant : le trigger générique
--   `auditer_atelier('document_vente')` (déjà posé, 0010 §7, INCHANGÉ ici) capture la ligne
--   ENTIÈRE avant/après sur cet UPDATE — la valeur d'avant reste lisible dans
--   `audit_atelier.valeur_avant` — et `report_reglement_correction` dit explicitement où le
--   montant est parti.
--
-- POURQUOI PAS LE DISPOSITIF GÉNÉRIQUE `audit_atelier`/`entite_auditee` (0003/0004) — MÊME
-- ARBITRAGE QUE `facture_fournisseur_audit` (0059, voir sa docstring point 4) : l'étendre exige
-- `ALTER TYPE public.entite_auditee ADD VALUE`, dont la SOURCE DE VÉRITÉ TypeScript
-- (`ENTITES_AUDITEES`, `@dfa/shared`) vit dans `packages/shared/` — HORS PÉRIMÈTRE D'ÉCRITURE de
-- cette tâche (périmètre exclusif : `apps/api/src/facturation/**` et cette migration). Signalé,
-- pas contourné en douce. `report_reglement_correction` n'en a de toute façon pas besoin : table
-- APPEND-ONLY (`dfa_app` : SELECT/INSERT seulement, aucun UPDATE/DELETE possible), chaque ligne
-- EST déjà, à elle seule, un événement d'audit complet (qui/quoi/quand/combien/depuis où/vers où)
-- — même raisonnement que `bulletin_paiement` (0010 §12), également append-only et également sans
-- trigger `auditer_atelier`.
--
-- Réversible : migrations/down/0063_report_reglement_correction.down.sql.
-- =============================================================================================


-- ---------------------------------------------------------------------------------------------
-- 1. `report_reglement_correction` — UNE ligne par correction de facture réglée (au plus une par
--    facture d'origine : une facture annulée par avoir ne peut plus être corrigée une seconde
--    fois, `ServiceCorrectionFacture.corriger` le refuse déjà en amont via `validerFactureCreditable`
--    — la contrainte unique ci-dessous est un filet, pas une règle inventée ici).
-- ---------------------------------------------------------------------------------------------

create table public.report_reglement_correction (
  id                        uuid not null default gen_random_uuid(),
  tenant_id                 uuid not null,
  facture_origine_id        uuid not null,
  facture_remplacement_id   uuid not null,
  montant_centimes          bigint not null,
  cree_le                   timestamptz not null default now(),
  cree_par_id               uuid null,

  constraint report_reglement_correction_pk primary key (id),
  constraint report_reglement_correction_tenant_id_uk unique (tenant_id, id),
  -- Au plus un report par facture d'origine (voir en-tête) — filet en base, pas la barrière
  -- applicative principale.
  constraint report_reglement_correction_uk_origine unique (tenant_id, facture_origine_id),
  constraint report_reglement_correction_fk_facture_origine foreign key (tenant_id, facture_origine_id)
    references public.document_vente (tenant_id, id) on delete restrict,
  constraint report_reglement_correction_fk_facture_remplacement foreign key (tenant_id, facture_remplacement_id)
    references public.document_vente (tenant_id, id) on delete restrict,
  constraint report_reglement_correction_fk_cree_par foreign key (tenant_id, cree_par_id)
    references public.utilisateur (tenant_id, id) on delete restrict,
  constraint report_reglement_correction_montant_positif_chk check (montant_centimes > 0),
  constraint report_reglement_correction_origine_distincte_remplacement_chk
    check (facture_origine_id <> facture_remplacement_id)
);

comment on table public.report_reglement_correction is
  'Issue #154 : quand une facture émise et déjà réglée (totalement ou partiellement) est '
  'corrigée par avoir (ServiceCorrectionFacture.corriger, RF-12->RF-14), le montant réglé est '
  'reporté sur la facture de remplacement plutôt que réclamé une seconde fois. Append-only, '
  'NE TOUCHE JAMAIS imputation_paiement (immuable, MD-51/MD-52) : cette table documente '
  'seulement le report, l''historique des encaissements réels reste intact sur paiement/'
  'imputation_paiement. Voir l''en-tête de 0063_report_reglement_correction.sql pour le '
  'raisonnement complet.';

create index report_reglement_correction_remplacement_idx
  on public.report_reglement_correction (tenant_id, facture_remplacement_id);

revoke all on public.report_reglement_correction from dfa_app;
grant  select, insert on public.report_reglement_correction to dfa_app;

alter table public.report_reglement_correction enable row level security;
alter table public.report_reglement_correction force  row level security;

create policy report_reglement_correction_isolation_tenant on public.report_reglement_correction
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy report_reglement_correction_migrator on public.report_reglement_correction
  to dfa_migrator
  using (true) with check (true);


-- ---------------------------------------------------------------------------------------------
-- §2 — ISSUE #156
--
-- LE DÉFAUT (signalé par un agent de test navigateur) : après une correction, la facture de
-- remplacement laisse `document_source_id` ET `remplace_id` à NULL — rien, EN BASE, ne relie la
-- nouvelle facture à celle qu'elle corrige. Le lien n'existe qu'au moment de la réponse HTTP de
-- `POST /corriger` (`{avoir, factureRemplacement}`) : une lecture ultérieure (`GET
-- /documents-vente/{id}`), ou une requête fiduciaire directe en base, ne peut pas répondre « d'où
-- vient cette facture » sans reconstituer à la main (correspondance client/adresse/dates/montants
-- — fragile, jamais garantie).
--
-- POURQUOI PAS `document_source_id` OU `remplace_id` (déjà en base, `0010_facturation.sql` §7) —
-- vérifié AVANT de coder, comme demandé, contre la docstring de tête de `service-correction.ts`
-- et contre `0010_facturation.sql` elle-même :
--   - `document_source_id` (MD-14) documente la chaîne `devis → bon_commande → facture` — la
--     PROGRESSION normale d'UN document vers le suivant dans son propre cycle de vie. Une
--     correction relie deux FACTURES entre elles (même type, pas une progression) : réutiliser ce
--     champ mélangerait deux relations distinctes sous un seul nom, ce que
--     `ReponseDocumentVente.documentSourceId` (`@dfa/shared`) ne documente PAS aujourd'hui — un
--     lecteur de l'API ne pourrait plus distinguer « vient d'un devis » de « corrige une facture ».
--   - `remplace_id` (RF-8) est réservé à UNE SEULE transition, `('devis', 'emis', 'remplace',
--     false)` dans `transition_document_autorisee` (0010 §7.3, table figée) — AUCUNE ligne
--     équivalente n'existe pour `facture`, dont la SEULE sortie depuis `emis` est
--     `('facture', 'emis', 'annule_par_avoir', false)`. `remplace_id` n'est d'ailleurs écrit nulle
--     part dans le code applicatif actuel (RF-8 lui-même n'est pas encore implémenté côté devis) —
--     le détourner pour les factures créerait la PREMIÈRE écriture de cette colonne, sur un usage
--     que sa propre doctrine exclut explicitement.
--
-- DÉCISION : ni l'un ni l'autre ne convient — colonne DÉDIÉE, symétrique de `facture_annulee_id`
-- (« la facture qu'un AVOIR annule », posée sur l'avoir) mais posée cette fois sur la FACTURE DE
-- REMPLACEMENT (« la facture qu'ELLE corrige »). Un SEUL sens suffit (pas de colonne inverse sur
-- l'originale, contrairement à `annule_par_avoir_id`/`facture_annulee_id`) : la recherche inverse
-- (« quelle facture a corrigé celle-ci ? ») est une simple requête indexée sur
-- `facture_corrigee_id`, aucune donnée à maintenir en double.
--
-- CE QUE CETTE SECTION N'EXPOSE PAS ENCORE, SIGNALÉ AU RAPPORT DE LIVRAISON PLUTÔT QUE CONTOURNÉ :
-- la colonne existe en base et est peuplée par `ServiceCorrectionFacture` (périmètre de cette
-- tâche), mais `ReponseDocumentVente` (`packages/shared/src/contrats/facturation/document.ts`) ne
-- la porte pas encore — `packages/shared/` est HORS PÉRIMÈTRE D'ÉCRITURE de cette tâche. Un
-- contrôle fiduciaire en base (SQL direct) a déjà sa réponse ; l'exposer via `GET
-- /documents-vente/{id}` demande un agent avec accès à `packages/shared` (ajouter
-- `factureCorrigeeId?: string | null` à l'interface, un `.optional().nullable()` au schéma zod, et
-- un miroir dans `mapperDocument`, `apps/api/src/facturation/documents/mappeurs.ts` — trois lignes,
-- déjà dans le périmètre de CETTE tâche pour la dernière, mais bloquées par la première).
-- ---------------------------------------------------------------------------------------------

alter table public.document_vente
  add column facture_corrigee_id uuid null;

comment on column public.document_vente.facture_corrigee_id is
  'Issue #156 : posé UNIQUEMENT sur une facture de REMPLACEMENT (ServiceCorrectionFacture.corriger, '
  'RF-12->RF-14) — pointe vers la facture ORIGINALE qu''elle corrige (déjà annule_par_avoir au '
  'moment où ce pointeur est écrit). Symétrique de facture_annulee_id (posé sur l''avoir), mais '
  'pour la relation facture-corrige-facture plutôt qu''avoir-annule-facture. NULL sur tout '
  'document qui ne provient pas d''une correction. Distinct de document_source_id (MD-14, chaîne '
  'devis->bon_commande->facture) et de remplace_id (RF-8, réservé aux devis) — voir l''en-tête de '
  '0063_report_reglement_correction.sql §2 pour le raisonnement complet.';

alter table public.document_vente
  add constraint document_vente_fk_facture_corrigee foreign key (tenant_id, facture_corrigee_id)
  references public.document_vente (tenant_id, id) on delete restrict;

alter table public.document_vente
  add constraint document_vente_facture_corrigee_type_chk
  check (facture_corrigee_id is null or type_document = 'facture');

alter table public.document_vente
  add constraint document_vente_facture_corrigee_distincte_chk
  check (facture_corrigee_id is null or facture_corrigee_id <> id);

-- Au plus une facture de remplacement par facture corrigée (une facture annulée par avoir ne peut
-- plus être corrigée une seconde fois — `validerFactureCreditable` le refuse déjà en amont, ce
-- filet n'invente pas une règle) — MÊME doctrine que les index partiels `document_source_id`/
-- `remplace_id` déjà posés par 0010 §7.2.
create unique index document_vente_facture_corrigee_uk
  on public.document_vente (tenant_id, facture_corrigee_id)
 where facture_corrigee_id is not null;


-- ---------------------------------------------------------------------------------------------
-- Assertions de fin de migration
-- ---------------------------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.report_reglement_correction') is null then
    raise exception '0063 : table report_reglement_correction absente après la migration.';
  end if;

  if exists (
    select 1 from information_schema.role_table_grants
     where table_schema = 'public' and table_name = 'report_reglement_correction'
       and grantee = 'dfa_app' and privilege_type in ('UPDATE', 'DELETE')
  ) then
    raise exception '0063 : dfa_app ne doit avoir ni UPDATE ni DELETE sur report_reglement_correction (append-only).';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'report_reglement_correction' and c.relrowsecurity
  ) then
    raise exception '0063 : row level security non activée sur report_reglement_correction.';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'document_vente'
       and column_name = 'facture_corrigee_id' and is_nullable = 'YES' and data_type = 'uuid'
  ) then
    raise exception '0063 : document_vente.facture_corrigee_id absente, non-nullable, ou de mauvais type.';
  end if;

  if exists (select 1 from public.document_vente where facture_corrigee_id is not null) then
    raise exception '0063 : une ligne de document_vente porte déjà facture_corrigee_id non-NULL juste après la migration — expand pur violé.';
  end if;
end
$$;
