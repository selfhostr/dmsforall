-- Inverse de 0090_assujetti_tva.sql. La colonne `assujetti_tva` est perdue : un garage qui avait
-- répondu « Non » redevient indistinguable d'un garage sans n° TVA (les documents déjà émis, eux,
-- gardent leurs lignes à 0 %).
alter table public.tenant drop constraint if exists tenant_non_assujetti_sans_numero_tva_chk;
alter table public.tenant drop column if exists assujetti_tva;
