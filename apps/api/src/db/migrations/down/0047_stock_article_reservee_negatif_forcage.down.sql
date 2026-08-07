-- =============================================================================================
-- 0047_stock_article_reservee_negatif_forcage.down.sql — inverse de la montante.
--
-- La CHECK est restaurée MOT POUR MOT à sa définition de 0025 (`reservee <= physique`) — voir
-- `verifier-reversibilite-migrations.sh`, même patron que 0038.
--
-- ⚠️ Redescendre RÉINTRODUIT le défaut corrigé par 0047 : `forcer: true` sur une casse/perte qui
-- dépasserait le stock PHYSIQUE (pas seulement le disponible) redevient inconditionnellement
-- refusé (`409 STOCK_INSUFFISANT`), même sous forçage. Attendu et voulu d'un down : il annule le
-- correctif, pas seulement son symptôme.
--
-- `motif_liberation_reservation.liberation_forcage_stock` N'EST PAS retiré : PostgreSQL n'offre
-- aucun `DROP VALUE` sur un type enum (seule une recréation complète du type le permettrait,
-- jugée plus risquée que le résidu qu'elle corrigerait) — même limite, même arbitrage que
-- `entite_auditee` dans `down/0010_facturation.down.sql` (voir son en-tête). Aucun résidu
-- fonctionnel : une valeur enum présente mais jamais référencée par aucune ligne ne viole aucune
-- contrainte.
-- =============================================================================================

alter table public.stock_article
  drop constraint stock_article_reservee_leq_physique_chk;

alter table public.stock_article
  add constraint stock_article_reservee_leq_physique_chk
  check (quantite_reservee_millieme <= quantite_physique_millieme);

comment on table public.stock_article is
  'Stock physique par (tenant, article, site) — RP-09→RP-15. quantite_disponible = '
  'quantite_physique_millieme - quantite_reservee_millieme (RP-14, calculé côté lecture, jamais '
  'stocké). quantite_reservee_millieme est maintenue par le trigger de reservation_piece (0026), '
  'sous verrou de ligne — c''est ce qui rend CP-02 sûr sous concurrence, voir 0026. '
  'stock_article_reservee_leq_physique_chk est le filet ultime : la réservée ne dépasse jamais le '
  'physique, quel que soit le chemin d''écriture.';
