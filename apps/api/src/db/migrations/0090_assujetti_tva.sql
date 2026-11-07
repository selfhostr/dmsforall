-- =============================================================================================
-- 0090_assujetti_tva.sql — `tenant.assujetti_tva` : le garage est-il assujetti à la TVA ?
--
-- Avant : `numero_tva` NULL voulait dire « non assujetti » OU « pas encore saisi » — impossible de
-- distinguer, donc impossible d'empêcher un non-assujetti de facturer de la TVA (art. 27 LTVA : un
-- non-assujetti qui mentionne la TVA sur une facture la doit à l'AFC) ni d'exiger le n° TVA d'un
-- assujetti (art. 26 LTVA).
--
-- Valeur des garages EXISTANTS : `true`, qu'ils aient un `numero_tva` ou non. Choix délibéré :
-- le comportement actuel (TVA facturée par ligne) reste inchangé, on ne retire jamais la TVA d'un
-- garage existant en silence. Un garage réellement non assujetti répond « Non » dans Réglages >
-- Mon garage ; un assujetti sans n° est invité à le saisir (l'émission d'une facture l'exige).
-- Garages créés ensuite : `true` par défaut (défaut de colonne) ; `creer-garage --non-assujetti`
-- pose `false`.
--
-- Pas de CHECK « assujetti ⇒ numero_tva non nul » : on doit pouvoir enregistrer « Oui » avant
-- d'avoir le numéro sous la main ; c'est l'ÉMISSION qui l'exige. En revanche
-- `non assujetti ⇒ numero_tva IS NULL` est garanti en base (CHECK) : un non-assujetti ne peut pas
-- porter de n° TVA.
-- =============================================================================================

alter table public.tenant add column assujetti_tva boolean not null default true;

-- Les lignes existantes prennent le défaut `true` (comportement inchangé), donc la CHECK ci-dessous
-- est satisfaite par construction.
alter table public.tenant
  add constraint tenant_non_assujetti_sans_numero_tva_chk
  check (assujetti_tva or numero_tva is null);

comment on column public.tenant.assujetti_tva is
  'Garage assujetti à la TVA (LTVA). false : aucune TVA sur les documents émis, mention « Non assujetti à la TVA ».';
