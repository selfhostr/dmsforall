-- =============================================================================================
-- 0069_correction_arrondi_negatif_ligne_or.sql — corrige rétroactivement l'arrondi TVA des lignes
-- `ligne_or` écrites AVANT `fix/arrondi-unique` (commit 2358f2e).
--
-- LE DÉFAUT : avant 2358f2e, `atelier/calcul-ligne.ts` (`CalculLigneSimple.calculer`, appelé
-- exclusivement par `atelier/service-ligne-or.ts`) arrondissait avec `Math.round` en flottant —
-- demi vers **+∞**, donc ASYMÉTRIQUE. Depuis 2358f2e, il utilise `foisArrondiCommercial`/
-- `arrondiCommercial` (`@dfa/shared`, MD-40) — demi ÉLOIGNÉ DE ZÉRO, la règle commerciale suisse.
-- Sur un montant positif, les deux règles coïncident TOUJOURS (le point médian s'arrondit déjà
-- vers +∞ dans les deux cas). Elles ne divergent QUE sur un montant négatif dont le reste vaut
-- exactement un demi-centime — typiquement une ligne `remise` (RM-63). Exemple mesuré
-- (`prixUnitaireCentimes=-500`, `tauxTvaPourmille=81`) : `ht=-500` (division exacte, inchangé),
-- `brut_tva = -500 * 81 = -40500` millièmes de centime → `-40500/1000 = -40.5`. `Math.round(-40.5)`
-- vaut `-40` en JS (arrondit vers +∞) ; `arrondiCommercial` vaut `-41` (s'éloigne de zéro). Écart
-- d'UN centime sur `montant_tva_centimes`, répercuté sur `montant_ttc_centimes`
-- (`ligne_or_montant_coherent_chk` : `ttc = ht + tva`, donc `ttc` hérite du même écart).
--
-- PÉRIMÈTRE — UNE SEULE TABLE, `ligne_or` — établi par la mesure, pas par hypothèse :
--   - 2358f2e n'a changé QUE `atelier/calcul-ligne.ts` (buggé), `facturation/documents/
--     calcul-document.ts` (déjà bigint/symétrique AVANT 2358f2e — jamais buggé) et
--     `atelier/service-facturation-or.ts` (la ligne de document copie désormais les montants de
--     `ligne_or` tels quels au lieu de les recalculer — donc `ligne_document` n'a JAMAIS utilisé
--     `Math.round`, et par doctrine MD-24 (figée dès l'écriture), ne doit de toute façon jamais
--     être retouchée depuis l'OR).
--   - `CalculLigneSimple` est le SEUL appelant de l'ancien `Math.round` sur un montant TVA dans
--     tout `apps/api/src` (vérifié) — aucune ligne `document_vente`/`ventes`/`pieces` n'est donc
--     concernée par CETTE régression précise.
--
-- FORMULE REPRODUITE (pipeline gelé de `CalculLigneSimple.calculer`, DANS CET ORDRE — l'arrondi
-- intermédiaire du HT compte, une seule division combinée donnerait un résultat différent) :
--   brut = main_oeuvre ? arrondi(temps_bareme_centiemes * taux_horaire_centimes, 100)
--                       : arrondi(prix_unitaire_centimes * quantite_millieme, 1000)
--   ht   = arrondi(brut * (1000 - rabais_pourmille), 1000)
--   tva  = arrondi(ht * taux_tva_pourmille, 1000)
--   ttc  = ht + tva
-- `payeur = 'garage'` est spécial-casé à 0/0/0 (RM-70 : le service force ces lignes à zéro SANS
-- passer par `CalculLigneSimple`, alors que les colonnes sources restent peuplées sur la ligne) —
-- omettre ce cas produirait de FAUX positifs sur toutes les lignes `payeur = 'garage'`.
--
-- CRITÈRE DE SÉLECTION : une ligne est fautive ssi son `montant_ht_centimes`,
-- `montant_tva_centimes` OU `montant_ttc_centimes` stocké diffère de la valeur recalculée par la
-- formule ci-dessus.
--
-- POURQUOI DEUX BLOCS — LE TRIGGER `ligne_or_verrouiller_or` (0008, `BEFORE INSERT/UPDATE/DELETE`,
-- SQLSTATE ZDFA2, I-15/CT-30) refuse toute écriture sur `ligne_or` dès que
-- `ordre_reparation.statut IN ('facture', 'restitue', 'cloture', 'annule')`. Un OR ouvert se
-- corrige donc par un `UPDATE` ordinaire (bloc A) ; un OR verrouillé exige de désactiver ce
-- trigger le temps du seul `UPDATE` concerné (bloc B).
--
-- =============================================================================================
-- ARBITRAGE — POURQUOI LE BLOC B EST LIVRÉ ACTIF PAR DÉFAUT, ET NON RETIRÉ PAR PRUDENCE
--
-- La règle du projet « une facture émise est verrouillée, toute correction passe par un avoir »
-- (CONTRIBUTING.md) protège les corrections MÉTIER : changer un prix, une quantité, ajouter/retirer une
-- ligne — des décisions qui changent ce que le document DIT. Ce bloc ne fait rien de tel : il ne
-- touche ni le prix, ni la quantité, ni le rabais, ni le taux — seule la fonction d'arrondi
-- appliquée à des entrées INCHANGÉES change. La ligne, après correction, dit exactement ce
-- qu'elle a TOUJOURS été censée dire. Une facture émise dont la TVA de ligne ne correspond pas à
-- sa propre base HT (`ht`, `tva`, `taux`) est un défaut comptable qui contredit la propre règle
-- d'arrondi du produit — pas un état que la doctrine « verrouillage = protection contre la
-- réécriture » a jamais eu vocation à figer. D'où : bloc B ACTIF par défaut.
--
--   >>> POUR RETIRER LE BLOC B (ne PAS corriger les OR facturés/restitués/clôturés/annulés) : <<<
--   >>> supprimer tout le texte entre les deux marqueurs                                     <<<
--   >>> "BLOC B — DÉBUT (SUPPRIMABLE)" et "BLOC B — FIN (SUPPRIMABLE)" ci-dessous, rien        <<<
--   >>> d'autre à changer — le bloc A et les assertions de fin restent valides sans lui.        <<<
--
-- Décision définitive laissée à @laupernoe ; cette bannière rend le geste de retrait immédiat.
--
-- =============================================================================================
-- MESURE SUR `dfa_dev` (25.08.2026, `dfa_migrator`, RLS `using(true)`) : `total_lignes = 10`,
-- `total_fautives = 0` (aucune ligne `remise`/montant négatif dans le seed actuel — c'est un vrai
-- négatif trivial : la branche négative de la formule n'est simplement pas exercée par les
-- données actuelles, pas une preuve de sa correction — celle-ci vient des tests écrits pour cette
-- migration). Cette migration reste nécessaire : c'est le filet pour toute base ayant vécu AVANT
-- `fix/arrondi-unique` (staging, démo, un premier garage), pas seulement pour `dfa_dev`.
--
-- RÉVERSIBILITÉ — table journal DÉDIÉE (`ligne_or_correction_arrondi_negatif`, patron de
-- `report_reglement_correction`, 0063), PAS `audit_atelier` : `audit_atelier` est partitionnée
-- par mois, sans clé permettant d'isoler sans ambiguïté « les lignes touchées par CETTE
-- migration » d'un `UPDATE` métier qui s'intercalerait avant qu'un `down` réel ne soit rejoué.
-- Append-only, RLS forcée, tenant-scopée, créée ici et DROPée par le `down` — aucun résidu.
-- Voir migrations/down/0069_correction_arrondi_negatif_ligne_or.down.sql.
-- =============================================================================================


-- ---------------------------------------------------------------------------------------------
-- 1. Table journal — voir « RÉVERSIBILITÉ » ci-dessus. Créée AVANT les fonctions jetables (§2) :
--    une `create table` n'est pas rejouable telle quelle (contrairement à `create or replace
--    function`), elle reste donc HORS de la zone rejouable ci-dessous par construction.
-- ---------------------------------------------------------------------------------------------

create table public.ligne_or_correction_arrondi_negatif (
  id                          uuid not null default gen_random_uuid(),
  tenant_id                   uuid not null references public.tenant (id) on delete restrict,
  ligne_or_id                 uuid not null,
  ordre_reparation_id         uuid not null,
  categorie                   text not null check (categorie in ('or_ouvert', 'or_verrouille')),
  montant_ht_avant_centimes   integer not null,
  montant_tva_avant_centimes  integer not null,
  montant_ttc_avant_centimes  integer not null,
  montant_ht_apres_centimes   integer not null,
  montant_tva_apres_centimes  integer not null,
  montant_ttc_apres_centimes  integer not null,
  corrige_le                  timestamptz not null default now(),

  constraint ligne_or_correction_arrondi_negatif_pk primary key (id),
  constraint ligne_or_correction_arrondi_negatif_uk unique (tenant_id, ligne_or_id),
  constraint ligne_or_correction_arrondi_negatif_fk_ligne_or foreign key (tenant_id, ligne_or_id)
    references public.ligne_or (tenant_id, id) on delete restrict,
  constraint ligne_or_correction_arrondi_negatif_fk_or foreign key (tenant_id, ordre_reparation_id)
    references public.ordre_reparation (tenant_id, id) on delete restrict
);

comment on table public.ligne_or_correction_arrondi_negatif is
  '0069 : une ligne par ligne_or corrigée (arrondi TVA Math.round -> arrondiCommercial, '
  'commit 2358f2e). Append-only, source du down. Voir l''en-tête de '
  '0069_correction_arrondi_negatif_ligne_or.sql.';

create index ligne_or_correction_arrondi_negatif_or_idx
  on public.ligne_or_correction_arrondi_negatif (tenant_id, ordre_reparation_id);

revoke all on public.ligne_or_correction_arrondi_negatif from dfa_app;
grant  select on public.ligne_or_correction_arrondi_negatif to dfa_app;

alter table public.ligne_or_correction_arrondi_negatif enable row level security;
alter table public.ligne_or_correction_arrondi_negatif force  row level security;

create policy ligne_or_correction_arrondi_negatif_isolation_tenant
  on public.ligne_or_correction_arrondi_negatif
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy ligne_or_correction_arrondi_negatif_migrator
  on public.ligne_or_correction_arrondi_negatif
  to dfa_migrator
  using (true) with check (true);


-- >>> DFA_0069_BLOC_CORRECTION_DEBUT — fonctions + insert/update rejouables seuls (idempotents, >>>
-- >>> test d'intégration) — `create or replace function` : rejouable même après un premier DROP. >>>

-- ---------------------------------------------------------------------------------------------
-- 2. Fonctions JETABLES — utilisées uniquement par cette migration, DROPées en toute fin de
--    fichier (aucun résidu de catalogue après le `up`). Un seul point de calcul pour bloc A,
--    bloc B ET les assertions de fin — pour ne JAMAIS écrire la formule trois fois et risquer une
--    divergence entre elles.
-- ---------------------------------------------------------------------------------------------

create or replace function public.dfa_0069_arrondi_commercial(num bigint, den bigint)
returns bigint
language plpgsql
security invoker
set search_path = pg_catalog, public
as $fn$
begin
  if den <= 0 then
    raise exception 'dfa_0069_arrondi_commercial : dénominateur non strictement positif (%).', den;
  end if;
  return case when num >= 0 then (num + den / 2) / den else -((-num + den / 2) / den) end;
end
$fn$;

revoke all on function public.dfa_0069_arrondi_commercial(bigint, bigint) from public;

comment on function public.dfa_0069_arrondi_commercial(bigint, bigint) is
  '0069, JETABLE : réplique exacte de arrondiCommercial (@dfa/shared, MD-40) — demi éloigné de '
  'zéro, bigint. DROPée en fin de 0069_correction_arrondi_negatif_ligne_or.sql.';

create or replace function public.dfa_0069_recalculer_ligne_or(
  p_type                   public.type_ligne_or,
  p_payeur                 public.payeur_ligne_or,
  p_temps_bareme_centiemes integer,
  p_taux_horaire_centimes  integer,
  p_prix_unitaire_centimes integer,
  p_quantite_millieme      integer,
  p_rabais_pourmille       smallint,
  p_taux_tva_pourmille     smallint,
  out ht_centimes          integer,
  out tva_centimes         integer,
  out ttc_centimes         integer
)
returns record
language plpgsql
security invoker
set search_path = pg_catalog, public
as $fn$
declare
  v_brut bigint;
begin
  if p_payeur = 'garage' then
    ht_centimes := 0;
    tva_centimes := 0;
    ttc_centimes := 0;
    return;
  end if;

  v_brut := case
    when p_type in ('main_oeuvre_bareme', 'main_oeuvre_temps_reel')
      then public.dfa_0069_arrondi_commercial(
             coalesce(p_temps_bareme_centiemes, 0)::bigint * coalesce(p_taux_horaire_centimes, 0)::bigint,
             100)
    else public.dfa_0069_arrondi_commercial(
             coalesce(p_prix_unitaire_centimes, 0)::bigint * coalesce(p_quantite_millieme, 1000)::bigint,
             1000)
  end;

  ht_centimes  := public.dfa_0069_arrondi_commercial(
                    v_brut * (1000 - coalesce(p_rabais_pourmille, 0))::bigint, 1000)::integer;
  tva_centimes := public.dfa_0069_arrondi_commercial(
                    ht_centimes::bigint * p_taux_tva_pourmille::bigint, 1000)::integer;
  ttc_centimes := ht_centimes + tva_centimes;
end
$fn$;

revoke all on function public.dfa_0069_recalculer_ligne_or(
  public.type_ligne_or, public.payeur_ligne_or, integer, integer, integer, integer, smallint, smallint
) from public;

comment on function public.dfa_0069_recalculer_ligne_or(
  public.type_ligne_or, public.payeur_ligne_or, integer, integer, integer, integer, smallint, smallint
) is
  '0069, JETABLE : réplique exacte de CalculLigneSimple.calculer (atelier/calcul-ligne.ts) avec '
  'l''arrondi CORRIGÉ (arrondiCommercial). DROPée en fin de 0069_correction_arrondi_negatif_ligne_or.sql.';


-- ---------------------------------------------------------------------------------------------
-- 3. BLOC A — OR NON verrouillés (statut hors facture/restitue/cloture/annule) : `UPDATE` ordinaire,
--    aucun trigger à contourner. Toujours appliqué — jamais retiré, jamais supprimable.
-- ---------------------------------------------------------------------------------------------

insert into public.ligne_or_correction_arrondi_negatif (
  tenant_id, ligne_or_id, ordre_reparation_id, categorie,
  montant_ht_avant_centimes, montant_tva_avant_centimes, montant_ttc_avant_centimes,
  montant_ht_apres_centimes, montant_tva_apres_centimes, montant_ttc_apres_centimes
)
select
  l.tenant_id, l.id, l.ordre_reparation_id, 'or_ouvert',
  l.montant_ht_centimes, l.montant_tva_centimes, l.montant_ttc_centimes,
  r.ht_centimes, r.tva_centimes, r.ttc_centimes
from public.ligne_or l
join public.ordre_reparation o
  on o.tenant_id = l.tenant_id and o.id = l.ordre_reparation_id
join lateral public.dfa_0069_recalculer_ligne_or(
       l.type, l.payeur, l.temps_bareme_centiemes, l.taux_horaire_centimes,
       l.prix_unitaire_centimes, l.quantite_millieme, l.rabais_pourmille, l.taux_tva_pourmille
     ) r on true
where o.statut not in ('facture', 'restitue', 'cloture', 'annule')
  and (l.montant_ht_centimes <> r.ht_centimes
       or l.montant_tva_centimes <> r.tva_centimes
       or l.montant_ttc_centimes <> r.ttc_centimes)
on conflict (tenant_id, ligne_or_id) do nothing;

update public.ligne_or l
   set montant_ht_centimes  = j.montant_ht_apres_centimes,
       montant_tva_centimes = j.montant_tva_apres_centimes,
       montant_ttc_centimes = j.montant_ttc_apres_centimes
  from public.ligne_or_correction_arrondi_negatif j
 where j.categorie = 'or_ouvert'
   and j.tenant_id = l.tenant_id
   and j.ligne_or_id = l.id
   and (l.montant_ht_centimes <> j.montant_ht_apres_centimes
        or l.montant_tva_centimes <> j.montant_tva_apres_centimes
        or l.montant_ttc_centimes <> j.montant_ttc_apres_centimes);


-- ---------------------------------------------------------------------------------------------
-- BLOC B — DÉBUT (SUPPRIMABLE) — OR verrouillés (documents émis) : facture, restitue, cloture,
-- annule. Voir « ARBITRAGE » en tête de fichier pour pourquoi il est livré ACTIF par défaut.
-- >>> POUR NE PAS CORRIGER LES OR FACTURÉS/RESTITUÉS/CLÔTURÉS/ANNULÉS : SUPPRIMER TOUT LE TEXTE <<<
-- >>> ENTRE CE MARQUEUR ET « BLOC B — FIN (SUPPRIMABLE) » CI-DESSOUS, RIEN D'AUTRE À CHANGER.    <<<
-- ---------------------------------------------------------------------------------------------

insert into public.ligne_or_correction_arrondi_negatif (
  tenant_id, ligne_or_id, ordre_reparation_id, categorie,
  montant_ht_avant_centimes, montant_tva_avant_centimes, montant_ttc_avant_centimes,
  montant_ht_apres_centimes, montant_tva_apres_centimes, montant_ttc_apres_centimes
)
select
  l.tenant_id, l.id, l.ordre_reparation_id, 'or_verrouille',
  l.montant_ht_centimes, l.montant_tva_centimes, l.montant_ttc_centimes,
  r.ht_centimes, r.tva_centimes, r.ttc_centimes
from public.ligne_or l
join public.ordre_reparation o
  on o.tenant_id = l.tenant_id and o.id = l.ordre_reparation_id
join lateral public.dfa_0069_recalculer_ligne_or(
       l.type, l.payeur, l.temps_bareme_centiemes, l.taux_horaire_centimes,
       l.prix_unitaire_centimes, l.quantite_millieme, l.rabais_pourmille, l.taux_tva_pourmille
     ) r on true
where o.statut in ('facture', 'restitue', 'cloture', 'annule')
  and (l.montant_ht_centimes <> r.ht_centimes
       or l.montant_tva_centimes <> r.tva_centimes
       or l.montant_ttc_centimes <> r.ttc_centimes)
on conflict (tenant_id, ligne_or_id) do nothing;

-- Bypass du trigger de verrouillage (0008, ZDFA2) — AUTOUR DU SEUL `UPDATE` CONCERNÉ, rien d'autre :
-- privilège de PROPRIÉTAIRE (dfa_migrator possède ligne_or), pas besoin de superuser.
alter table public.ligne_or disable trigger ligne_or_verrouiller_or;

update public.ligne_or l
   set montant_ht_centimes  = j.montant_ht_apres_centimes,
       montant_tva_centimes = j.montant_tva_apres_centimes,
       montant_ttc_centimes = j.montant_ttc_apres_centimes
  from public.ligne_or_correction_arrondi_negatif j
 where j.categorie = 'or_verrouille'
   and j.tenant_id = l.tenant_id
   and j.ligne_or_id = l.id
   and (l.montant_ht_centimes <> j.montant_ht_apres_centimes
        or l.montant_tva_centimes <> j.montant_tva_apres_centimes
        or l.montant_ttc_centimes <> j.montant_ttc_apres_centimes);

alter table public.ligne_or enable trigger ligne_or_verrouiller_or;

-- ---------------------------------------------------------------------------------------------
-- BLOC B — FIN (SUPPRIMABLE)
-- ---------------------------------------------------------------------------------------------

-- <<< DFA_0069_BLOC_CORRECTION_FIN <<<


-- ---------------------------------------------------------------------------------------------
-- 4. Assertions de fin — patron 0038/0063. Le trigger AFTER `ligne_or_recalculer_drapeaux`
--    (0008) reste ACTIF pendant tout ce fichier (jamais désactivé) : chaque `UPDATE` ci-dessus
--    recalcule automatiquement `ordre_reparation.total_valide_centimes` — rien à recalculer ici
--    à la main.
-- ---------------------------------------------------------------------------------------------

do $$
declare
  v_residu_ouvert     bigint;
  v_residu_verrouille bigint;
begin
  if to_regclass('public.ligne_or_correction_arrondi_negatif') is null then
    raise exception '0069 : table ligne_or_correction_arrondi_negatif absente après la migration.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'ligne_or_correction_arrondi_negatif' and c.relrowsecurity
  ) then
    raise exception '0069 : row level security non activée sur ligne_or_correction_arrondi_negatif.';
  end if;

  -- Échec DUR : le bloc A doit TOUJOURS être complet, jamais retiré.
  select count(*) into v_residu_ouvert
    from public.ligne_or l
    join public.ordre_reparation o on o.tenant_id = l.tenant_id and o.id = l.ordre_reparation_id
    join lateral public.dfa_0069_recalculer_ligne_or(
           l.type, l.payeur, l.temps_bareme_centiemes, l.taux_horaire_centimes,
           l.prix_unitaire_centimes, l.quantite_millieme, l.rabais_pourmille, l.taux_tva_pourmille
         ) r on true
   where o.statut not in ('facture', 'restitue', 'cloture', 'annule')
     and (l.montant_ht_centimes <> r.ht_centimes
          or l.montant_tva_centimes <> r.tva_centimes
          or l.montant_ttc_centimes <> r.ttc_centimes);

  if v_residu_ouvert > 0 then
    raise exception
      '0069 : % ligne(s) d''OR NON verrouillé encore fautive(s) après le bloc A — bloc A incomplet.',
      v_residu_ouvert;
  end if;

  -- Information, PAS un échec : 0 si le bloc B a tourné (défaut), > 0 si @laupernoe l'a retiré volontairement.
  select count(*) into v_residu_verrouille
    from public.ligne_or l
    join public.ordre_reparation o on o.tenant_id = l.tenant_id and o.id = l.ordre_reparation_id
    join lateral public.dfa_0069_recalculer_ligne_or(
           l.type, l.payeur, l.temps_bareme_centiemes, l.taux_horaire_centimes,
           l.prix_unitaire_centimes, l.quantite_millieme, l.rabais_pourmille, l.taux_tva_pourmille
         ) r on true
   where o.statut in ('facture', 'restitue', 'cloture', 'annule')
     and (l.montant_ht_centimes <> r.ht_centimes
          or l.montant_tva_centimes <> r.tva_centimes
          or l.montant_ttc_centimes <> r.ttc_centimes);

  raise notice
    '0069 : % ligne(s) sur OR verrouillé encore fautive(s) (0 attendu si le bloc B est actif ; > 0 si retiré volontairement).',
    v_residu_verrouille;
end
$$;

drop function public.dfa_0069_recalculer_ligne_or(
  public.type_ligne_or, public.payeur_ligne_or, integer, integer, integer, integer, smallint, smallint
);
drop function public.dfa_0069_arrondi_commercial(bigint, bigint);
