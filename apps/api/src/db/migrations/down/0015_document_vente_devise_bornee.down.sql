-- =============================================================================================
-- 0015_document_vente_devise_bornee.down.sql — annulation de 0015 : retour exact à la contrainte
-- de FORME seulement (`^[A-Z]{3}$`), telle que posée par 0010. Down annule la CORRECTION, pas le
-- défaut d'origine — même logique que 0012.down/0013.down/0014.down (voir CONTRIBUTING.md du dépôt sur
-- l'immuabilité des migrations déjà appliquées).
-- =============================================================================================

alter table public.document_vente
  drop constraint document_vente_devise_chk;

alter table public.document_vente
  add constraint document_vente_devise_format_chk check (devise ~ '^[A-Z]{3}$');
