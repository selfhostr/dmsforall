-- =============================================================================================
-- 0079_garage_neuf_defauts.sql — un garage doit pouvoir servir dès le premier jour.
--
-- `creer-garage` ne posait ni `parametre_atelier`, ni `parametre_site`, ni taux horaire, ni motif de
-- rendez-vous : « Réglages > Atelier » et « Réglages > Sites » répondaient 404 et aucun rendez-vous
-- ne pouvait être pris (le motif est obligatoire). Cette migration rattrape les garages DÉJÀ créés ;
-- la commande `creer-garage` pose désormais les mêmes données pour les suivants
-- (`apps/api/src/parametrage/defauts-garage.ts` : les valeurs ci-dessous doivent y rester alignées).
--
-- Idempotente et non destructive :
--   - `parametre_atelier` / `parametre_site` : une ligne par tenant / site qui n'en a pas, toutes
--     colonnes à leur valeur par défaut de la base ;
--   - taux horaire « ATELIER » (CHF 140.00 depuis le 01.01.2020) : seulement pour un tenant qui n'a
--     AUCUN taux horaire ;
--   - motifs de rendez-vous : seulement pour un tenant qui n'en a AUCUN (un garage qui a déjà son
--     catalogue, ou qui a désactivé le sien, n'est pas retouché).
-- Aucune ligne existante n'est modifiée. Retour arrière : down/0079_garage_neuf_defauts.down.sql.
-- =============================================================================================

insert into public.parametre_atelier (tenant_id)
select t.id
  from public.tenant t
 where not exists (select 1 from public.parametre_atelier p where p.tenant_id = t.id);

insert into public.parametre_site (tenant_id, site_id)
select s.tenant_id, s.id
  from public.site s
 where not exists (select 1 from public.parametre_site p where p.site_id = s.id);

insert into public.taux_horaire (tenant_id, code, libelle, montant_centimes, valide_du)
select t.id, 'ATELIER', 'Taux horaire atelier', 14000, date '2020-01-01'
  from public.tenant t
 where not exists (select 1 from public.taux_horaire th where th.tenant_id = t.id);

insert into public.motif_rendez_vous
  (tenant_id, code, libelle_fr, libelle_de, libelle_it, duree_defaut_minutes)
select t.id, m.code, m.libelle_fr, m.libelle_de, m.libelle_it, m.duree
  from public.tenant t
 cross join (values
    ('SERVICE', 'Entretien / service courant', 'Service / Wartung', 'Tagliando / manutenzione', 90),
    ('PNEUS', 'Changement de pneus saisonnier', 'Saisonaler Reifenwechsel', 'Cambio pneumatici stagionale', 45),
    ('EXPERTISE-MFK', 'Préparation et passage à l’expertise (MFK)', 'MFK-Vorbereitung und Vorführung', 'Preparazione e passaggio al collaudo (MFK)', 120),
    ('FREINS', 'Freins', 'Bremsen', 'Freni', 120),
    ('DIAGNOSTIC', 'Diagnostic / recherche de panne', 'Diagnose / Fehlersuche', 'Diagnosi / ricerca guasto', 60),
    ('CARROSSERIE', 'Carrosserie / devis', 'Karosserie / Offerte', 'Carrozzeria / preventivo', 30),
    ('CLIMATISATION', 'Climatisation', 'Klimaanlage', 'Climatizzazione', 60),
    ('AUTRE', 'Autre / à déterminer', 'Andere / zu bestimmen', 'Altro / da determinare', 60)
 ) as m (code, libelle_fr, libelle_de, libelle_it, duree)
 where not exists (select 1 from public.motif_rendez_vous x where x.tenant_id = t.id);
