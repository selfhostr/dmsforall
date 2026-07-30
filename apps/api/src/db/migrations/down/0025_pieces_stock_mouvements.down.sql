-- =============================================================================================
-- 0025_pieces_stock_mouvements.down.sql — inverse de 0025_pieces_stock_mouvements.sql.
--
-- NE PEUT PAS DÉFAIRE : `entite_auditee` gagne `mouvement_stock` en montante — pas de DROP VALUE
-- en PostgreSQL, même limite acceptée que 0010/0016/0022/0023.
-- =============================================================================================

drop trigger mouvement_stock_appliquer_physique on public.mouvement_stock;
drop function public.mouvement_stock_appliquer_physique();

drop table public.mouvement_stock;
drop table public.stock_article;

drop type public.type_mouvement_stock;
