-- =============================================================================================
-- 0034_pieces_commande_fournisseur_motif_annulation.sql — pose la colonne qu'`EntreeAnnulation
-- CommandeFournisseur.motif` (packages/shared/src/contrats/pieces/commande-fournisseur.ts)
-- attend depuis toujours et n'a jamais eue : mesuré en exécution en auditant le module Pièces
-- (agent expert-nestjs), pas supposé — `ServiceCommandeFournisseur.annuler` (0024, ce lot)
-- VALIDE `entree.motif` (`schemaMotif`, non vide) mais ne l'écrit dans AUCUNE colonne, alors même
-- que `transition_autorisee` (0024 §4) porte `exige_motif = true` pour les DEUX transitions
-- {brouillon, envoyee} -> annulee. Le service documentait déjà ce trou (« GAP DE SCHÉMA signalé
-- au rapport de livraison ») — cette migration le comble, même patron exact que 0021
-- (`vehicule_travail_reporte.motif_refus`) et 0033 (`vehicule_travail_reporte.motif_modification`).
--
-- `commande_fournisseur` porte déjà `entite_auditee` + un trigger `..._audit`
-- (`auditer_atelier('commande_fournisseur')`, 0023/0024) : AUCUN travail d'audit à faire ici,
-- contrairement à 0033 — le nouveau champ sera journalisé par le dispositif générique existant
-- dès qu'il porte une valeur (`to_jsonb(new)` inclut automatiquement toute colonne de la table).
--
-- 1. NULLABLE, sans borne de longueur — même raisonnement que 0021/0033 (voir leurs en-têtes,
--    non répété ici) : aucun champ de texte libre de ce dépôt n'a de borne supérieure, seulement
--    une garde « non vide quand renseigné ».
--
-- 2. CHECK — `commande_fournisseur_annulation_coherente_chk`, MÊME FORME EXACTE que
--    `ordre_reparation_annulation_coherente_chk` (0008 : `statut <> 'annule' or motif_annulation
--    is not null`) plutôt que la forme bidirectionnelle de `vehicule_travail_reporte` (0033) :
--    ici le motif est TOUJOURS exigé par la transition (exige_motif = true dans TOUTES les lignes
--    de transition_autorisee qui mènent à `annulee`, §4 de 0024), jamais optionnel comme un motif
--    de correction ultérieure — la contrainte à sens unique (annulee => motif présent) suffit et
--    reflète fidèlement `exige_motif`, que `verifier_transition()` (0003 §6) ne lit PAS lui-même
--    (il ne compare que `(statut_depuis, statut_vers)`, jamais la colonne `exige_motif` — constaté
--    en lisant sa définition, `exige_motif` n'était jusqu'ici QUE de la documentation) : c'est
--    cette contrainte-ci, posée au niveau de la table métier plutôt que du garde-fou générique,
--    qui rend `exige_motif = true` réellement opposable pour `commande_fournisseur`.
--
-- 3. SERVICE (hors DDL, périmètre `apps/api/src/pieces/**` du même agent) : `annuler()` doit
--    désormais écrire `motif_annulation = entree.motif` dans son UPDATE — sans ce changement
--    applicatif, la CHECK ci-dessous ferait simplement échouer TOUTE annulation (500 non qualifié)
--    au lieu de rester une perte silencieuse : un progrès, mais incomplet sans le service.
--
-- Réversible : migrations/down/0034_pieces_commande_fournisseur_motif_annulation.down.sql.
-- Migration de DONNÉES : aucune — colonne neuve, entièrement NULL sur les lignes existantes
-- (aucune commande déjà `annulee` en base ne peut exister avant ce lot : la transition n'était
-- accessible que depuis ce même module).
-- =============================================================================================


-- ---------------------------------------------------------------------------------------------
-- 1. Colonne `motif_annulation` — nullable, sans borne de longueur (§1 en-tête).
-- ---------------------------------------------------------------------------------------------

alter table public.commande_fournisseur
  add column motif_annulation text null;


-- ---------------------------------------------------------------------------------------------
-- 2. CHECK — exigé quand annulee (§2 en-tête).
-- ---------------------------------------------------------------------------------------------

alter table public.commande_fournisseur
  add constraint commande_fournisseur_annulation_coherente_chk
  check (statut <> 'annulee' or motif_annulation is not null);


-- ---------------------------------------------------------------------------------------------
-- 3. Commentaire de table complété — texte de 0024 CONSERVÉ, une phrase ajoutée à la fin.
-- ---------------------------------------------------------------------------------------------

comment on table public.commande_fournisseur is
  'Commande fournisseur (RP-26→RP-31). Machine à états portée par transition_autorisee '
  '(entite=''commande_fournisseur'') + verifier_transition() — dispositif générique de '
  '0003_prealables_etape1.sql, pas une réimplémentation. Auditée (RP-31). motif_annulation '
  '(0034) : raison saisie à l''annulation (brouillon/envoyee -> annulee), exigée par la CHECK '
  'commande_fournisseur_annulation_coherente_chk — exige_motif=true de transition_autorisee '
  '(0024 §4) n''était, avant cette colonne, que de la documentation non opposable.';


-- ---------------------------------------------------------------------------------------------
-- Assertions de fin de migration
-- ---------------------------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'commande_fournisseur'
       and column_name = 'motif_annulation' and is_nullable = 'YES' and data_type = 'text'
  ) then
    raise exception '0034 : commande_fournisseur.motif_annulation absente, non-nullable, ou de mauvais type.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conname = 'commande_fournisseur_annulation_coherente_chk'
       and conrelid = 'public.commande_fournisseur'::regclass
  ) then
    raise exception '0034 : commande_fournisseur_annulation_coherente_chk absente après migration.';
  end if;

  if exists (
    select 1 from public.commande_fournisseur where motif_annulation is not null
  ) then
    raise exception '0034 : une ligne de commande_fournisseur porte un motif_annulation non-NULL juste après la migration — une valeur a été inventée quelque part.';
  end if;
end
$$;
