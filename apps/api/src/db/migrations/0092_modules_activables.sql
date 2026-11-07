-- =============================================================================================
-- 0092_modules_activables.sql — `tenant.modules_desactives` : modules de l'application retirés
-- par le garage (Réglages > Modules).
--
-- On stocke ce que le garage a RETIRÉ, pas ce qu'il garde : un garage existant (liste vide) garde
-- tout, et un module ajouté plus tard au produit est actif par défaut. Rien n'est supprimé en
-- retirant un module — ses données restent, seules ses écritures sont refusées par l'API
-- (`MODULE_DESACTIVE`) ; réactiver restaure tout.
--
-- Le socle (accueil, clients et véhicules, facturation, réglages) n'est volontairement PAS une
-- valeur de l'enum : il ne peut pas être retiré. Ajouter un module = `ALTER TYPE module_app ADD
-- VALUE` ; en retirer un demande un cycle expand/contract complet.
-- =============================================================================================

create type public.module_app as enum (
  'atelier',
  'planning',
  'pointage',
  'tablettes',
  'pieces',
  'ventes',
  'pneus',
  'courtoisie',
  'relances',
  'export_fiduciaire'
);

alter table public.tenant
  add column modules_desactives public.module_app[] not null default '{}';

-- Pas de CHECK d'unicité des éléments : Postgres refuse les sous-requêtes en CHECK. L'enum borne les
-- valeurs, et le contrat (`schemaModificationModules`) déduplique avant écriture.

comment on column public.tenant.modules_desactives is
  'Modules retirés par le garage (Réglages > Modules). Vide : tout est actif. Les dépendances (pointage -> atelier, tablettes -> pointage) sont calculées à la lecture, jamais stockées.';
