-- Inverse de 0079 : retire les lignes de départ qui n'ont jamais été touchées depuis leur création
-- (`cree_le = modifie_le`). Une ligne que le garage a modifiée, ou un motif déjà utilisé par un
-- rendez-vous, est conservé. Conséquence : les écrans Réglages > Atelier / Sites répondent de
-- nouveau 404 pour ces garages si le code antérieur (sans création à la volée) est redéployé.

delete from public.motif_rendez_vous m
 where m.code in ('SERVICE', 'PNEUS', 'EXPERTISE-MFK', 'FREINS', 'DIAGNOSTIC', 'CARROSSERIE', 'CLIMATISATION', 'AUTRE')
   and m.cree_le = m.modifie_le
   and not exists (
     select 1 from public.rendez_vous r where r.tenant_id = m.tenant_id and r.motif_id = m.id
   );

delete from public.taux_horaire
 where code = 'ATELIER'
   and libelle = 'Taux horaire atelier'
   and montant_centimes = 14000
   and valide_du = date '2020-01-01'
   and valide_au is null
   and cree_le = modifie_le;

delete from public.parametre_site where cree_le = modifie_le;

delete from public.parametre_atelier where cree_le = modifie_le;
