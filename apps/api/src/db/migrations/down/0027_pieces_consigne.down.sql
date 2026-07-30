-- =============================================================================================
-- 0027_pieces_consigne.down.sql — inverse de 0027_pieces_consigne.sql.
--
-- NE PEUT PAS DÉFAIRE : `entite_auditee` gagne `consigne_echange_standard` en montante — pas de
-- DROP VALUE en PostgreSQL, même limite acceptée que 0010/0016/0022/0023/0025.
-- =============================================================================================

drop trigger consigne_echange_standard_transition on public.consigne_echange_standard;
drop function public.consigne_echange_standard_transition();

drop table public.consigne_echange_standard;

drop type public.statut_consigne_echange_standard;
