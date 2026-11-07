-- =============================================================================================
-- 0083_ordre_reparation_devis_origine.sql — lien OR <- devis (POST /documents-vente/{id}/
-- creer-ordre-reparation).
--
-- POURQUOI SUR `ordre_reparation` ET PAS SUR `document_vente` : un devis émis/accepté est VERROUILLÉ
-- (trigger `document_vente_verrouiller_apres_emission`, liste blanche MD-20) — `ordre_reparation_id`
-- ne peut plus y être posé après coup. Le lien vit donc du côté de l'OR, table non verrouillée.
--
-- `devis_origine_id` : le devis dont l'OR a repris les lignes. NULL pour tout OR existant et pour
-- tout OR créé directement. Unique par (tenant, devis) : un devis ne crée qu'UN SEUL OR (course
-- entre deux clics / deux clés d'idempotence différentes -> la seconde insertion échoue en base).
-- Que ce document soit bien un `devis` est vérifié par le service (`service-devis-vers-or.ts`).
-- =============================================================================================

alter table public.ordre_reparation
  add column devis_origine_id uuid null;

alter table public.ordre_reparation
  add constraint ordre_reparation_fk_devis_origine
  foreign key (tenant_id, devis_origine_id)
  references public.document_vente (tenant_id, id)
  on delete restrict
  not valid;

alter table public.ordre_reparation
  validate constraint ordre_reparation_fk_devis_origine;

create unique index ordre_reparation_devis_origine_uk
  on public.ordre_reparation (tenant_id, devis_origine_id)
  where devis_origine_id is not null;

comment on column public.ordre_reparation.devis_origine_id is
  'Devis (document_vente.type_document = devis) dont cet OR a repris les lignes. NULL sinon.';
