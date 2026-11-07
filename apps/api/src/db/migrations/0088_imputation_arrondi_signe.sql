-- =============================================================================================
-- 0088 — MD-51.a : l'arrondi espèces est SIGNÉ (CF-05), il ne s'additionne plus en valeur absolue
-- =============================================================================================
--
-- Pas de pièce de 1 ou 2 centimes en Suisse : un solde de CHF 109.44 est payé 109.45 en espèces.
-- CF-05 prévoit déjà ce cas (« facture 204.33, espèces encaissées 204.35 : reglement 204.35 +
-- arrondi -0.02 », écriture comptable : crédit du compte d'arrondi) et l'export le construit déjà.
--
-- Mais l'invariant MD-51.a (0010 §11) sommait `abs(montant)` de TOUTES les imputations d'un
-- document : 109.45 (reglement) + |-0.01| (arrondi) = 109.46 > 109.44, donc ZDFA4. Seul l'arrondi
-- vers le BAS (le client paie moins) était réellement enregistrable ; vers le HAUT, l'écran de
-- caisse n'avait d'autre issue que de laisser 1 ct d'« avance client » sans document.
--
-- Correction : la nature `arrondi` entre dans la somme avec son SIGNE ; toutes les autres natures
-- gardent la valeur absolue. L'invariant reste « ce qui solde un document ≤ son total » :
-- reglement 109.45 + arrondi -0.01 = 109.44. Le trigger étant évalué ligne par ligne (AFTER INSERT),
-- l'application insère l'arrondi négatif AVANT le règlement qui le compense.
--
-- MD-51.b (Σ reglement ≤ montant du paiement) est inchangé : 109.45 ≤ 109.45.
-- Le commentaire de la table (réécrit par 0019) n'est volontairement pas touché : un down qui le
-- restaurerait écraserait celui de 0019 (échec de la vérification de réversibilité).
-- Réversible : migrations/down/0088_imputation_arrondi_signe.down.sql.
-- =============================================================================================

create or replace function public.imputation_paiement_verifier_invariants() returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $fn$
declare
  total_document   bigint;
  somme_imputations bigint;
  montant_paiement  bigint;
  somme_reglement   bigint;
begin
  select abs(d.total_ttc_centimes) into total_document
    from public.document_vente d
   where d.tenant_id = new.tenant_id and d.id = new.document_id
     for update;

  -- AFTER INSERT : la ligne NEW est déjà visible dans la table au moment où ce trigger s'exécute
  -- (contrairement à un BEFORE), donc cette somme inclut déjà l'imputation qui vient d'être créée.
  -- `arrondi` est SIGNÉ (CF-05) ; toute autre nature compte en valeur absolue.
  select coalesce(sum(case when ip.nature = 'arrondi' then ip.montant_centimes
                           else abs(ip.montant_centimes) end), 0) into somme_imputations
    from public.imputation_paiement ip
   where ip.tenant_id = new.tenant_id and ip.document_id = new.document_id;

  if somme_imputations > total_document then
    raise exception using
      errcode = 'ZDFA4',
      message = format('imputation_paiement : la somme des imputations (%s) dépasse le total du document (%s) (MD-51.a).', somme_imputations, total_document),
      detail  = format('entite=imputation_paiement;document_id=%s', new.document_id);
  end if;

  select abs(p.montant_centimes) into montant_paiement
    from public.paiement p
   where p.tenant_id = new.tenant_id and p.id = new.paiement_id
     for update;

  select coalesce(sum(ip.montant_centimes), 0) into somme_reglement
    from public.imputation_paiement ip
   where ip.tenant_id = new.tenant_id and ip.paiement_id = new.paiement_id
     and ip.nature = 'reglement';

  if somme_reglement > montant_paiement then
    raise exception using
      errcode = 'ZDFA4',
      message = format('imputation_paiement : la somme des imputations ''reglement'' (%s) dépasse le montant du paiement (%s) (MD-51.b).', somme_reglement, montant_paiement),
      detail  = format('entite=imputation_paiement;paiement_id=%s', new.paiement_id);
  end if;

  return null;
end
$fn$;
