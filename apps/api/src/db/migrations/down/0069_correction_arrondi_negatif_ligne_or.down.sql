-- =============================================================================================
-- 0069_correction_arrondi_negatif_ligne_or.down.sql — inverse de
-- 0069_correction_arrondi_negatif_ligne_or.sql.
--
-- Restaure, depuis le journal `ligne_or_correction_arrondi_negatif`, les montants
-- `montant_{ht,tva,ttc}_centimes` de chaque ligne corrigée à leur valeur `*_avant_centimes`
-- (l'ancien résultat `Math.round`), puis DROP la table journal. Aucun type Postgres créé par le
-- `up` (aucun `create type`), donc rien d'autre à retirer. Schéma après ce down identique bit à
-- bit au schéma d'avant la migration montante — les deux fonctions jetables
-- `dfa_0069_arrondi_commercial`/`dfa_0069_recalculer_ligne_or` sont déjà DROPées en fin de `up`,
-- rien à faire ici pour elles.
--
-- Deux catégories, même bascule de trigger que le `up` pour `or_verrouille` : sans elle, restaurer
-- une ligne d'un OR facturé/restitué/clôturé/annulé serait bloqué par `ligne_or_verrouiller_or`
-- (0008, ZDFA2) exactement comme la correction montante l'aurait été.
-- =============================================================================================

-- --- Catégorie 'or_ouvert' : UPDATE ordinaire ---------------------------------------------------

update public.ligne_or l
   set montant_ht_centimes  = j.montant_ht_avant_centimes,
       montant_tva_centimes = j.montant_tva_avant_centimes,
       montant_ttc_centimes = j.montant_ttc_avant_centimes
  from public.ligne_or_correction_arrondi_negatif j
 where j.categorie = 'or_ouvert'
   and j.tenant_id = l.tenant_id
   and j.ligne_or_id = l.id;

-- --- Catégorie 'or_verrouille' : bypass du trigger de verrouillage autour du seul UPDATE --------

alter table public.ligne_or disable trigger ligne_or_verrouiller_or;

update public.ligne_or l
   set montant_ht_centimes  = j.montant_ht_avant_centimes,
       montant_tva_centimes = j.montant_tva_avant_centimes,
       montant_ttc_centimes = j.montant_ttc_avant_centimes
  from public.ligne_or_correction_arrondi_negatif j
 where j.categorie = 'or_verrouille'
   and j.tenant_id = l.tenant_id
   and j.ligne_or_id = l.id;

alter table public.ligne_or enable trigger ligne_or_verrouiller_or;

-- --- Retrait de la table journal ------------------------------------------------------------

drop table if exists public.ligne_or_correction_arrondi_negatif;


-- ---------------------------------------------------------------------------------------------
-- Assertions de fin de down
-- ---------------------------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.ligne_or_correction_arrondi_negatif') is not null then
    raise exception '0069 down : table ligne_or_correction_arrondi_negatif toujours présente après le down.';
  end if;

  if to_regprocedure('public.dfa_0069_arrondi_commercial(bigint, bigint)') is not null then
    raise exception '0069 down : fonction dfa_0069_arrondi_commercial toujours présente (devrait déjà être DROPée par le up).';
  end if;

  if to_regprocedure(
       'public.dfa_0069_recalculer_ligne_or(public.type_ligne_or, public.payeur_ligne_or, integer, integer, integer, integer, smallint, smallint)'
     ) is not null then
    raise exception '0069 down : fonction dfa_0069_recalculer_ligne_or toujours présente (devrait déjà être DROPée par le up).';
  end if;
end
$$;
