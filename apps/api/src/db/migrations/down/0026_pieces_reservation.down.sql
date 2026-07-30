-- =============================================================================================
-- 0026_pieces_reservation.down.sql — inverse de 0026_pieces_reservation.sql.
--
-- Entièrement réversible : aucune valeur `entite_auditee` n'est ajoutée par cette migration (voir
-- son en-tête, §« PAS D'AUDIT »), donc rien de la famille 0010/0016/0022/0023/0025 à signaler ici.
-- =============================================================================================

drop trigger reservation_piece_transition on public.reservation_piece;
drop function public.reservation_piece_transition();

drop trigger reservation_piece_verrouiller_stock on public.reservation_piece;
drop function public.reservation_piece_verrouiller_stock();

drop table public.reservation_piece;

drop type public.motif_liberation_reservation;
drop type public.statut_reservation_piece;
