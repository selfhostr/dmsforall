-- Inverse de 0088_imputation_arrondi_signe.sql : restaure la somme en valeur absolue de 0010 §11.
-- Un arrondi négatif déjà enregistré rendrait alors l'invariant (a) violé au prochain INSERT sur ce
-- document : à purger ou corriger avant le retour arrière si de tels arrondis existent.

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
  select coalesce(sum(abs(ip.montant_centimes)), 0) into somme_imputations
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

comment on table public.imputation_paiement is
  'Ce que le paiement solde (MD-50). MD-51 : deux invariants agrégés, vérifiés par trigger AFTER '
  'INSERT — (a) Σ imputations d''un document ≤ |total| du document ; (b) Σ imputations de nature '
  '''reglement'' d''un paiement ≤ |montant| du paiement (restriction volontaire, voir CF-05).';
