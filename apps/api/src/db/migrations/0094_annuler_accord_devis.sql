-- =============================================================================================
-- 0094_annuler_accord_devis.sql — le garagiste peut annuler l'accord du client sur un devis.
--
-- Ajoute UNE transition à la liste blanche `transition_document_autorisee` : devis accepte -> emis.
-- `accepte` n'est plus terminal pour un devis ; il le reste pour tout le reste (refuse, expire,
-- remplace, et les autres types). Le service refuse l'annulation dès qu'un OR ou un document de
-- vente est issu du devis (409 DOCUMENT_SOURCE_DEJA_TRANSFORME) ; l'audit `document_vente`
-- (trigger auditer_atelier) journalise le changement de statut avant/après.
-- =============================================================================================

insert into public.transition_document_autorisee (type_document, statut_depuis, statut_vers, exige_motif)
values ('devis', 'accepte', 'emis', false)
on conflict do nothing;
