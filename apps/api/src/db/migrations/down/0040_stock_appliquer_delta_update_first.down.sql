-- =============================================================================================
-- 0040_stock_appliquer_delta_update_first.down.sql — inverse EXACT de 0040.
--
-- Restaure le corps d'origine de `mouvement_stock_appliquer_physique()` (texte de 0025, à base
-- d'`INSERT … ON CONFLICT`) et retire la fonction auxiliaire `stock_article_appliquer_delta`
-- introduite par la montante. Le trigger n'est jamais touché : `create or replace` remplace le
-- corps en place, le trigger continue de pointer sur la même fonction par son nom.
--
-- ⚠️ Redescendre RÉINTRODUIT le défaut critique (500 sur toute sortie de stock). Ce down existe
-- pour la stricte réversibilité structurelle (up→down→up rejoué par
-- scripts/verifier-reversibilite-migrations.sh) ; il n'a aucune raison d'être joué en production.
-- =============================================================================================


-- ---------------------------------------------------------------------------------------------
-- 1. `mouvement_stock_appliquer_physique()` restauré au corps EXACT de 0025.
-- ---------------------------------------------------------------------------------------------

create or replace function public.mouvement_stock_appliquer_physique() returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $fn$
begin
  if new.type = 'transfert' then
    insert into public.stock_article (tenant_id, article_id, site_id, quantite_physique_millieme)
    values (new.tenant_id, new.article_id, new.site_source_id, -new.quantite_millieme)
    on conflict (tenant_id, article_id, site_id)
    do update set quantite_physique_millieme =
      public.stock_article.quantite_physique_millieme - new.quantite_millieme;

    insert into public.stock_article (tenant_id, article_id, site_id, quantite_physique_millieme)
    values (new.tenant_id, new.article_id, new.site_destination_id, new.quantite_millieme)
    on conflict (tenant_id, article_id, site_id)
    do update set quantite_physique_millieme =
      public.stock_article.quantite_physique_millieme + new.quantite_millieme;
  else
    insert into public.stock_article (tenant_id, article_id, site_id, quantite_physique_millieme)
    values (new.tenant_id, new.article_id, new.site_id, new.quantite_millieme)
    on conflict (tenant_id, article_id, site_id)
    do update set quantite_physique_millieme =
      public.stock_article.quantite_physique_millieme + new.quantite_millieme;
  end if;

  -- RP-29 : le prix réellement payé à réception devient le prix d'achat courant de l'article
  -- (dernier prix connu — QP-04 laisse ouverte la méthode de valorisation, mais l'article DOIT
  -- porter UNE valeur lisible ; « dernier prix » est le seul choix que ce trigger peut faire sans
  -- préjuger de QP-04, une moyenne pondérée nécessiterait un historique que ce module ne tient
  -- pas). Jamais réécrit par ailleurs (RP-33).
  if new.type = 'entree_livraison' and new.prix_achat_reel_centimes is not null then
    update public.article
       set prix_achat_centimes = new.prix_achat_reel_centimes
     where tenant_id = new.tenant_id and id = new.article_id;
  end if;

  return null;
end
$fn$;

comment on function public.mouvement_stock_appliquer_physique() is
  'Trigger AFTER INSERT sur mouvement_stock : fait progresser stock_article.'
  'quantite_physique_millieme (RP-16). transfert touche DEUX lignes (source −, destination +), '
  'RP-13. entree_livraison avec prix_achat_reel_centimes met à jour article.prix_achat_centimes '
  '(dernier prix connu, RP-29/RP-33/QP-04).';


-- ---------------------------------------------------------------------------------------------
-- 2. Fonction auxiliaire retirée.
-- ---------------------------------------------------------------------------------------------

drop function public.stock_article_appliquer_delta(uuid, uuid, uuid, integer);
