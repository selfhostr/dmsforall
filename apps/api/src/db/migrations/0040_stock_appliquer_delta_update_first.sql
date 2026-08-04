-- =============================================================================================
-- 0040_stock_appliquer_delta_update_first.sql — CORRECTIF défaut critique module Pièces.
--
-- SYMPTÔME : toute opération qui RÉDUIT le stock (casse, perte, transfert entre sites, retour
-- fournisseur, ajustement d'inventaire à la baisse) renvoyait `500 ERREUR_INTERNE`. Les entrées
-- (réception, ajustement à la hausse) passaient. Un magasinier ne pouvait donc pas tenir son
-- stock à la baisse — c'est-à-dire l'essentiel de son métier.
--
-- CAUSE RACINE (reproduite par isolation SQL) : le trigger `mouvement_stock_appliquer_physique`
-- de 0025 appliquait chaque mouvement par `INSERT … ON CONFLICT (…) DO UPDATE`. PostgreSQL évalue
-- les contraintes CHECK de la table sur la LIGNE CANDIDATE SPÉCULATIVE de l'INSERT — c'est-à-dire
-- `(quantite_physique_millieme = delta, quantite_reservee_millieme = 0)` — AVANT de détecter le
-- conflit de clé et d'appliquer la branche `DO UPDATE`. Pour une SORTIE, `delta` est négatif :
-- la contrainte `stock_article_reservee_leq_physique_chk` (`reservee <= physique`, 0025) est donc
-- testée comme `0 <= -500` → FAUX → échec, alors même que l'état FINAL après fusion
-- (`DO UPDATE`) aurait été parfaitement valide (`0 <= 9500`). Un delta positif passait
-- (`0 <= +500`), d'où l'asymétrie entrées/sorties observée.
--
--   Preuve minimale (table jetable) :
--     INSERT INTO t (k,physique) VALUES (1,-500)
--       ON CONFLICT (k) DO UPDATE SET physique = t.physique - 500;
--     -> ERROR: violates check "chk"  DETAIL: Failing row contains (1, -500, 0)
--   Le même effet net par UPDATE direct réussit et laisse un état final valide.
--
-- LA CONTRAINTE N'EST PAS EN CAUSE et n'est ni supprimée ni affaiblie ici : `reservee <= physique`
-- protège une invariante métier réelle (on ne réserve jamais plus qu'on n'a). Le défaut est le
-- MOMENT d'évaluation, pas l'invariante. Le correctif déplace l'écriture vers un `UPDATE` (dont la
-- CHECK ne voit QUE l'état final fusionné), avec repli `INSERT … ON CONFLICT` pour la seule
-- première apparition d'une ligne de stock — où le delta est toujours positif (une entrée), donc
-- la ligne candidate spéculative est déjà valide (`0 <= +delta`).
--
-- COMPORTEMENTS PRÉSERVÉS :
--   * Refus légitime : un mouvement dont l'état FINAL violerait `reservee <= physique` (forçage
--     qui rendrait `physique < reservee`) échoue toujours — c'est désormais la CHECK sur la ligne
--     réelle qui tranche, plus un artefact spéculatif. Le refus « stock insuffisant » du chemin
--     normal (non forcé) reste porté en amont par le service (`409 STOCK_INSUFFISANT`,
--     `verifierDisponible`) : aucun changement.
--   * Atomicité / concurrence : l'`UPDATE` verrouille la ligne existante (même garantie que
--     l'ancien `ON CONFLICT` sur une ligne présente) ; le repli `INSERT … ON CONFLICT DO UPDATE`
--     reste atomique face à deux premières réceptions simultanées du même (article, site).
--   * `transfert` touche toujours DEUX lignes (source −, destination +), un mouvement unique
--     (RP-13). `entree_livraison` met toujours à jour `article.prix_achat_centimes` (RP-29/RP-33).
--
-- RÉVERSIBILITÉ : la montante et la descendante utilisent `create or replace function` sur
-- `mouvement_stock_appliquer_physique()` — le trigger existant continue de pointer sur la même
-- fonction, aucun `drop trigger` requis. La descendante restaure le corps EXACT de 0025 et retire
-- la fonction auxiliaire ajoutée ici.
-- =============================================================================================


-- ---------------------------------------------------------------------------------------------
-- 1. Fonction auxiliaire : applique un delta signé à UNE ligne (tenant, article, site).
--
-- UPDATE d'abord : si la ligne existe (cas de TOUTE sortie — le service l'a chargée sous
-- `for update` via `verifierDisponible` avant d'insérer le mouvement), la CHECK
-- `reservee <= physique` est évaluée sur la ligne RÉELLE après application du delta, jamais sur un
-- tuple spéculatif. C'est ce qui débloque les sorties.
--
-- Repli INSERT … ON CONFLICT : uniquement quand la ligne n'existe pas encore (première réception
-- d'un article jamais stocké sur ce site — `entree_livraison`, ou destination d'un `transfert`).
-- Dans ce cas `p_delta` est POSITIF, donc la ligne candidate spéculative `(physique = +delta,
-- reservee = 0)` satisfait déjà `0 <= +delta` : pas de faux refus. `ON CONFLICT DO UPDATE` couvre
-- la course où une transaction concurrente insère la ligne entre notre UPDATE (0 ligne) et notre
-- INSERT — la branche DO UPDATE recalcule alors sur l'état réel, sous verrou.
-- ---------------------------------------------------------------------------------------------

create function public.stock_article_appliquer_delta(
  p_tenant_id  uuid,
  p_article_id uuid,
  p_site_id    uuid,
  p_delta      integer
) returns void
language plpgsql
security invoker
set search_path = pg_catalog, public
as $fn$
begin
  update public.stock_article
     set quantite_physique_millieme = quantite_physique_millieme + p_delta
   where tenant_id = p_tenant_id and article_id = p_article_id and site_id = p_site_id;

  if not found then
    insert into public.stock_article (tenant_id, article_id, site_id, quantite_physique_millieme)
    values (p_tenant_id, p_article_id, p_site_id, p_delta)
    on conflict (tenant_id, article_id, site_id)
    do update set quantite_physique_millieme =
      public.stock_article.quantite_physique_millieme + p_delta;
  end if;
end
$fn$;

comment on function public.stock_article_appliquer_delta(uuid, uuid, uuid, integer) is
  'Applique un delta signé à stock_article.quantite_physique_millieme pour (tenant, article, '
  'site). UPDATE d''abord (la CHECK reservee <= physique ne voit que l''état final réel, ce qui '
  'débloque les SORTIES — cf. 0040) ; repli INSERT … ON CONFLICT pour la première apparition de '
  'la ligne (delta alors positif). Appelée par mouvement_stock_appliquer_physique().';

revoke all     on function public.stock_article_appliquer_delta(uuid, uuid, uuid, integer) from public;
grant  execute on function public.stock_article_appliquer_delta(uuid, uuid, uuid, integer)
  to dfa_app, dfa_migrator;


-- ---------------------------------------------------------------------------------------------
-- 2. `mouvement_stock_appliquer_physique()` réécrit : délègue à la fonction auxiliaire.
--
-- Aucun `drop trigger` : le trigger `mouvement_stock_appliquer_physique` (0025) pointe sur cette
-- fonction par son nom ; `create or replace` remplace le corps en place.
-- ---------------------------------------------------------------------------------------------

create or replace function public.mouvement_stock_appliquer_physique() returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $fn$
begin
  if new.type = 'transfert' then
    -- RP-13 : un mouvement UNIQUE touche les DEUX lignes (source −, destination +).
    perform public.stock_article_appliquer_delta(
      new.tenant_id, new.article_id, new.site_source_id, -new.quantite_millieme);
    perform public.stock_article_appliquer_delta(
      new.tenant_id, new.article_id, new.site_destination_id, new.quantite_millieme);
  else
    -- `quantite_millieme` est déjà signé (négatif pour une sortie, positif pour une entrée).
    perform public.stock_article_appliquer_delta(
      new.tenant_id, new.article_id, new.site_id, new.quantite_millieme);
  end if;

  -- RP-29/RP-33/QP-04 : le prix réellement payé à réception devient le prix d'achat courant de
  -- l'article (dernier prix connu). Inchangé par rapport à 0025.
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
  'quantite_physique_millieme (RP-16) via stock_article_appliquer_delta (UPDATE d''abord — 0040, '
  'correctif du faux refus sur les SORTIES). transfert touche DEUX lignes (source −, destination '
  '+), RP-13. entree_livraison avec prix_achat_reel_centimes met à jour article.prix_achat_centimes '
  '(dernier prix connu, RP-29/RP-33/QP-04).';


-- ---------------------------------------------------------------------------------------------
-- 3. Assertions de fin de migration.
-- ---------------------------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'stock_article_appliquer_delta'
  ) then
    raise exception '0040 : fonction stock_article_appliquer_delta absente après migration.';
  end if;

  if not has_function_privilege(
       'dfa_app', 'public.stock_article_appliquer_delta(uuid, uuid, uuid, integer)', 'EXECUTE') then
    raise exception '0040 : dfa_app doit pouvoir EXECUTE stock_article_appliquer_delta.';
  end if;

  -- Le corps réécrit ne doit plus s'appuyer sur ON CONFLICT (la source de la CHECK spéculative).
  if exists (
    select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'mouvement_stock_appliquer_physique'
       and p.prosrc ilike '%on conflict%'
  ) then
    raise exception '0040 : mouvement_stock_appliquer_physique contient encore ON CONFLICT (correctif non appliqué).';
  end if;
end
$$;
