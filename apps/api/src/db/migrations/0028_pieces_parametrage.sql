-- =============================================================================================
-- 0028_pieces_parametrage.sql — étape 3 (Pièces) : `parametre_pieces`. Spécification : §10
-- (PP-01→PP-08). Contrat gelé : packages/shared/src/contrats/pieces/parametrage.ts.
--
-- Une ligne par tenant, PK confondue avec tenant_id — même patron que `parametre_atelier` (0005).
-- `PP-08` (seuil de réappro / quantité de commande standard) n'est PAS ici : porté par
-- `stock_article` (par article/site, 0025), déjà noté par le contrat lui-même
-- (« pas répété ici »).
--
-- TROIS COLONNES RESTENT NULL PAR DÉFAUT, SANS VALEUR INVENTÉE — miroir exact de
-- `ReponseParametresPieces` (contrat) : `methode_prix_achat` (QP-04), `seuil_valeur_ajustement_
-- significatif_centimes` (QP-11), `delai_consigne_acquisition_jours` (QP-07). N'INVENTE AUCUNE
-- VALEUR (consigne du brief) : contrairement à `parametre_atelier.attente_pieces_longue_defaut`
-- (0005, défaut 'A' documenté comme un choix arbitraire du plan d'exécution), ces trois-là n'ont
-- AUCUN défaut proposé même côté contrat — le NULL est la valeur correcte tant que @laupernoe ne
-- tranche pas, pas un oubli.
--
-- `conditionnement_article_distinct` (PP-04) N'EST PAS UNE COLONNE : le contrat l'expose comme
-- une constante `true` non paramétrable (« pas de bascule tenant… inventerait une option qui
-- n'existe peut-être pas ») — rien à stocker, rien à migrer si l'hypothèse RP-05 est un jour
-- remise en cause par QP-03 (ce jour-là, une vraie migration ajoutera la colonne).
-- =============================================================================================

create type public.methode_prix_achat as enum ('dernier_prix', 'moyenne_ponderee');

create table public.parametre_pieces (
  tenant_id                                       uuid                        not null
    primary key references public.tenant (id) on delete restrict,

  -- PP-01 : défaut proposé par la spec (RP-10, à confirmer QP-01).
  stock_autres_sites_visible                      boolean                     not null default true,
  -- PP-02 : forçage d'une sortie sous le disponible réservé à un rôle habilité — non tranché côté
  -- droits (§11), défaut le plus sûr : forçage désactivé tant que le rôle habilité n'est pas
  -- choisi.
  stock_negatif_forcage_autorise                  boolean                     not null default false,
  -- PP-03 : QP-04, aucune valeur avancée.
  methode_prix_achat                              public.methode_prix_achat  null,
  -- PP-05 : QP-11, aucune valeur avancée.
  seuil_valeur_ajustement_significatif_centimes   integer                     null,
  -- PP-06 : QP-07, aucune valeur avancée.
  delai_consigne_acquisition_jours                smallint                    null,
  -- PP-07 : défaut proposé par la spec (hérite de l'hypothèse RF-100, 8.1% — à confirmer
  -- fiscalement QP-06).
  taux_tva_consigne_pourmille                     smallint                    not null default 81,

  cree_le                                         timestamptz                 not null default now(),
  modifie_le                                      timestamptz                 not null default now(),

  constraint parametre_pieces_seuil_ajustement_chk
    check (seuil_valeur_ajustement_significatif_centimes is null or seuil_valeur_ajustement_significatif_centimes >= 0),
  constraint parametre_pieces_delai_consigne_chk
    check (delai_consigne_acquisition_jours is null or delai_consigne_acquisition_jours between 0 and 3650),
  constraint parametre_pieces_taux_tva_consigne_chk
    check (taux_tva_consigne_pourmille between 0 and 1000)
);

comment on table public.parametre_pieces is
  'Paramétrage tenant du module pièces (§10, PP-01→PP-08 sauf PP-04 non stocké et PP-08 porté par '
  'stock_article). methode_prix_achat/seuil_valeur_ajustement_significatif_centimes/'
  'delai_consigne_acquisition_jours restent NULL tant que @laupernoe ne tranche pas (QP-04/QP-11/QP-07) '
  '— aucune valeur inventée.';

create trigger parametre_pieces_touche_modifie_le
  before update on public.parametre_pieces
  for each row execute function public.touche_modifie_le();

revoke all    on public.parametre_pieces from dfa_app;
grant  select, insert, update on public.parametre_pieces to dfa_app;

alter table public.parametre_pieces enable row level security;
alter table public.parametre_pieces force  row level security;

create policy parametre_pieces_isolation_tenant on public.parametre_pieces
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy parametre_pieces_migrator on public.parametre_pieces
  to dfa_migrator
  using (true) with check (true);
