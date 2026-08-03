-- =============================================================================================
-- 0036_ordre_reparation_total_valide_negatif.sql — défaut réel CONFIRMÉ en exécution (pas
-- seulement en test) : créer une ligne d'OR de type `remise` (montant négatif, RM-63) SEULE sur
-- un OR neuf répond `500 ERREUR_INTERNE` au lieu de `201`.
--
-- REPRODUCTION EN RÉEL (API en local, tenant garage-martin, chef.atelier@garage-martin.ch) :
--   POST /ordres-reparation                          -> 201, OR sans lignes, plafondCentimes=null
--   POST /ordres-reparation/{id}/lignes
--     {"type":"remise","origine":"commandee","payeur":"client",
--      "prixUnitaireCentimes":-500,"quantiteMillieme":1000}
--   -> 500 ERREUR_INTERNE
-- Log Postgres CONFIRMÉ, mot pour mot :
--   ERROR:  new row for relation "ordre_reparation" violates check constraint
--           "ordre_reparation_total_valide_chk"
--   CONTEXT: ... update ... total_valide_centimes = coalesce((select sum(l.montant_ttc_centimes)
--             from public.ligne_or l where ... and l.statut in
--             ('validee','en_cours','realisee','facturee')), 0) ...
--           PL/pgSQL function recalculer_drapeaux_ordre_reparation(uuid,uuid) ...
--           PL/pgSQL function ligne_or_recalculer_drapeaux() ...
--   STATEMENT: insert into "ligne_or" (...) values (...)
--
-- CHAÎNE DE CAUSALITÉ (déjà correctement établie avant cette migration, RE-VÉRIFIÉE ici) :
--   `determinerStatutInitial` (service-ligne-or.ts) pose une ligne `payeur=client`,
--   `origine=commandee` directement en statut `validee` dès lors que `plafondCentimes` est `null`
--   (Δ1/Q-02 : NULL = « aucun plafond convenu, la garde RM-54 ne s'exécute jamais ») — AUCUNE étape
--   de validation manuelle n'est requise pour atteindre ce statut, la création SEULE suffit. Le
--   trigger AFTER INSERT `ligne_or_recalculer_drapeaux` (0008) recalcule alors
--   `total_valide_centimes = sum(montant_ttc_centimes)` sur les lignes `validee/en_cours/
--   realisee/facturee` : avec une unique ligne remise à -540, la somme vaut -540, ce qui viole
--   `ordre_reparation_total_valide_chk check (total_valide_centimes >= 0)` (0008, ligne ~131).
--   L'exception Postgres non mappée remonte jusqu'à `FiltreProbleme`, qui retombe sur son repli
--   générique -> 500 (au lieu, par exemple, d'un problème+json exploitable par le front).
--
-- ---------------------------------------------------------------------------------------------
-- ARBITRAGE MÉTIER — la question posée était : un OR au total validé négatif est-il un ÉTAT
-- INTERDIT (correctif applicatif : refus 409 explicite) ou la CONTRAINTE `>= 0` est-elle trop
-- stricte (correctif de schéma) ? Tranché ici en faveur du SCHÉMA, pour quatre raisons :
--
--   1. `type_ligne_or` porte explicitement `remise` (0005 L76→, RM-63, spec §atelier-clients L320)
--      et `ligne_or_montant_ttc_chk` autorise déjà tout montant de ligne entre -100'000'000 et
--      +100'000'000 (0008 L374) — le schéma admet DÉJÀ, au niveau de la ligne, qu'un montant soit
--      négatif. Refuser au niveau de l'OR ce que la ligne autorise nommément revient à contredire,
--      un cran plus haut, une décision de schéma déjà prise et documentée (RM-63).
--
--   2. `total_valide_centimes` N'EST PAS un document facturable : c'est un agrégat de TRAVAIL
--      (comment 0008 L500-501 : « sert RM-54 sans recompter à chaque lecture »), maintenu par
--      trigger, comparé UNE SEULE FOIS à `plafond_centimes` pour décider si un accord client est
--      requis (RM-54, CT-20 — `service-ligne-or.ts::determinerStatutInitial`,
--      `service-or.ts` L405-411/L516-536/L810-824). Aucun de ces trois points de lecture
--      n'exige `total_valide_centimes >= 0` : la comparaison `nouveauTotal > plafondCentimes` reste
--      mathématiquement correcte, et STRICTEMENT plus permissive (jamais moins), quand le total
--      part d'une valeur négative — un OR qui commence par une remise n'est alors JAMAIS accusé à
--      tort de dépasser un plafond qu'il ne dépasse pas.
--
--   3. LE PRÉCÉDENT DÉJÀ POSÉ dans ce même dépôt place l'invariant « pas de document négatif » là
--      où il appartient réellement : au niveau du DOCUMENT ÉMIS, pas de l'agrégat de travail qui le
--      précède. `0010_facturation.sql` L654/L656 : un `devis`/`facture` doit avoir des totaux
--      `>= 0`, et SEUL un `avoir` peut les avoir `<= 0` — c'est-à-dire que la règle « un document
--      normal n'est pas négatif » existe déjà, correctement, avec sa dérogation légitime (l'avoir).
--      Dupliquer cette règle sur `ordre_reparation.total_valide_centimes` — qui n'est ni un devis,
--      ni une facture, ni un avoir, mais un agrégat interne d'un document DE TRAVAIL encore en
--      cours de constitution — confond le brouillon avec le document final, et l'empêche à un stade
--      où rien n'exige qu'il soit déjà cohérent comme facture.
--
--   4. Le comportement ATTENDU était déjà écrit avant ce correctif : le test métier dédié à
--      l'arithmétique des lignes d'OR (`arithmetique-totaux-or`, hors périmètre d'écriture de cette
--      migration) crée explicitement une ligne `remise` à -540 sur un OR et attend `201 Created`,
--      pas un refus. Le point de désaccord n'est donc pas seulement analytique : il y a bien un
--      métier qui a déjà tranché « une ligne remise seule doit passer », auquel la contrainte
--      `>= 0` posée en 0008 contrevient par effet de bord non anticipé (l'unique combinaison qui la
--      viole — une SEULE ligne, négative, immédiatement `validee` faute de plafond — n'a
--      manifestement pas été envisagée à l'écriture de 0008).
--
-- CORRECTIF : suppression de `ordre_reparation_total_valide_chk`. Aucune contrainte de
-- remplacement n'est ajoutée : `total_valide_centimes` est `bigint`, la plage utile (quelques
-- dizaines de lignes à ±100'000'000 centimes chacune au plus, `ligne_or_montant_ttc_chk`) reste
-- très en-deçà de tout risque de dépassement, et aucun besoin métier documenté n'appelle une borne
-- symétrique — en ajouter une inventerait une règle que personne n'a demandée.
--
-- CE QUE CETTE MIGRATION NE CORRIGE PAS (signalé, pas traité ici, hors périmètre) : le défaut
-- SÉPARÉ documenté dans `metier-machine-etats-or.spec.ts` (transitions `ordre_reparation.statut`
-- rendant 500 au lieu de 409) est un défaut DIFFÉRENT, sur un trigger différent
-- (`verifier_transition`), déjà signalé comme « non corrigé ici » par ce fichier de test lui-même —
-- aucun rapport avec `total_valide_centimes` (vérifié : aucune ligne de ce fichier de test ne
-- mentionne `remise` ni `total_valide_centimes`).
--
-- RÉVERSIBLE INTÉGRALEMENT : `drop constraint` / `add constraint` sur une simple CHECK ne laisse
-- aucun résidu de catalogue (contrairement à `alter type ... add value` ou à une ACL matérialisée,
-- cf. 0035) — voir migrations/down/0036_ordre_reparation_total_valide_negatif.down.sql.
-- =============================================================================================

alter table public.ordre_reparation
  drop constraint ordre_reparation_total_valide_chk;

comment on column public.ordre_reparation.total_valide_centimes is
  'Dérivé, maintenu par trigger (recalculer_drapeaux_ordre_reparation, 0008) : somme de '
  'ligne_or.montant_ttc_centimes pour les lignes validee/en_cours/realisee/facturee. Sert '
  'UNIQUEMENT la garde de plafond RM-54 (comparaison < plafond_centimes) — ce n''est PAS un '
  'document facturable, et PEUT être transitoirement négatif (ligne(s) `remise` sans autre ligne '
  'validée en contrepartie, 0036). L''invariant « un document normal n''est pas négatif » existe '
  'et s''applique déjà, correctement, au niveau du devis/facture/avoir (0010, '
  'document_vente_signe_avoir_chk / document_vente_signe_positif_chk) — pas ici.';

-- ---------------------------------------------------------------------------------------------
-- Auto-vérification — même patron que 0033/0035.
-- ---------------------------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1
      from pg_catalog.pg_constraint
     where conrelid = 'public.ordre_reparation'::regclass
       and conname = 'ordre_reparation_total_valide_chk'
  ) then
    raise exception '0036 : ordre_reparation_total_valide_chk existe encore après migration.';
  end if;
end
$$;
