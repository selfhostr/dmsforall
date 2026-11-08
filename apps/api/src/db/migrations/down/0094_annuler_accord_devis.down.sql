-- Inverse de 0094 : `accepte` redevient terminal pour un devis.
-- Un devis éventuellement revenu à `emis` reste `emis` (état valide).
delete from public.transition_document_autorisee
 where type_document = 'devis' and statut_depuis = 'accepte' and statut_vers = 'emis';
