-- =============================================================================================
-- 0047_stock_article_reservee_negatif_forcage.sql — défaut réel CONFIRMÉ en exécution
-- (`pont-atelier-pieces.spec.ts`, section `pieces.mouvement.forcer`) : `forcer: true` sur une
-- `casse`/`perte` qui dépasse le stock PHYSIQUE (pas seulement le disponible) échoue TOUJOURS
-- avec `409 STOCK_INSUFFISANT`, quel que soit le rôle — le paramètre est donc totalement inerte
-- dès que la demande dépasse le physique total, alors que RP-15/PP-02 (spécification
-- étape-3-pièces §5.2) autorisent nommément ce forçage : « le cas réel existe (compteur
-- informatique faux, pièce retrouvée après une casse déclarée par erreur) mais reste l'exception
-- qui doit se voir ».
--
-- CAUSE RACINE, MATHÉMATIQUEMENT INCONTOURNABLE avec le schéma tel qu'il existait :
--   `stock_article_reservee_leq_physique_chk` (0025) impose `reservee <= physique`.
--   `stock_article_reservee_non_negative_chk` (0025) impose `reservee >= 0`.
--   Combinées, ces deux CHECK impliquent `physique >= 0` INCONDITIONNELLEMENT — y COMPRIS quand
--   `reservee` vaut déjà 0 (aucune réservation active sur cet article/site, le cas le PLUS
--   fréquent). Le commentaire de tête de 0025 (§4) affirme pourtant explicitement qu'« AUCUNE
--   contrainte n'empêche quantite_physique_millieme de devenir négatif » — cette affirmation ne
--   tenait PAS compte du couplage avec `stock_article_reservee_leq_physique_chk`, posée trois
--   lignes plus bas dans le MÊME fichier. Preuve par le test (`articleAvecStock(1000)`, AUCUNE
--   réservation créée, `casse({quantiteMillieme: 1500, forcer: true})`) : `reservee` vaut déjà 0
--   avant toute tentative — il n'y a RIEN à libérer côté réservations, et pourtant le refus
--   persiste, ce qui prouve que la cause n'est PAS (seulement) une réservation active mal
--   libérée, mais la CHECK elle-même qui interdit structurellement tout `physique` négatif.
--
-- CE QUI N'EST PAS EN CAUSE : `reservee <= physique` protège une invariante RÉELLE (CP-02, 0026 —
-- une réservation ne dépasse jamais ce qui est VRAIMENT disponible). Cette invariante reste
-- entièrement posée ici, simplement reformulée pour rester vraie quand `physique` devient négatif
-- (RP-15 l'autorise nommément sous forçage) : dans cet état, il ne reste PHYSIQUEMENT rien à
-- réserver, donc le plafond de `reservee` devient 0, pas un nombre négatif inatteignable par
-- construction (`reservee >= 0` reste posée, inchangée).
--
-- CORRECTIF DE SCHÉMA (nécessaire, pas suffisant seul) : remplace
-- `reservee <= physique` par `reservee <= greatest(physique, 0)`. Aucun changement de
-- comportement tant que `physique >= 0` (le régime NORMAL, non forcé : `greatest(physique, 0) =
-- physique`) — la relaxation ne s'active QUE dans la zone que RP-15 réserve explicitement au
-- forçage. Le correctif APPLICATIF qui l'accompagne (`ServiceMouvement`/`ServiceReservation`,
-- `apps/api/src/pieces/`, hors périmètre de ce fichier) libère en cascade les réservations
-- actives de l'article/site quand un forçage ferait autrement passer `reservee` au-dessus de ce
-- nouveau plafond — cette migration pose seulement la borne que ce correctif doit respecter.
--
-- MOTIF DE LIBÉRATION AUTOMATIQUE, NOUVEAU : `motif_liberation_reservation` (0026) gagne
-- `liberation_forcage_stock` — quatrième cas automatique (après `annulation_ligne`/`refus_devis`,
-- le troisième, `liberation_manuelle`, restant le seul geste MANUEL) — le type est explicitement
-- documenté « extensible » (`contrats/pieces/enums.ts`). `ALTER TYPE ... ADD VALUE` : aucun
-- `DROP VALUE` en PostgreSQL, même limite structurelle déjà acceptée pour `entite_auditee`
-- (0010 et suivants) — voir `down/0047_stock_article_reservee_negatif_forcage.down.sql`.
--
-- RÉVERSIBILITÉ : la CHECK est intégralement réversible (`drop constraint`/`add constraint`, même
-- patron que 0038). La valeur enum ajoutée à `motif_liberation_reservation` ne l'est PAS (aucun
-- résidu fonctionnel : une valeur enum inutilisée après un down ne viole aucune contrainte tant
-- qu'aucune ligne ne la référence).
-- =============================================================================================


-- ---------------------------------------------------------------------------------------------
-- 1. `stock_article_reservee_leq_physique_chk` relâchée : `reservee <= greatest(physique, 0)`.
-- ---------------------------------------------------------------------------------------------

alter table public.stock_article
  drop constraint stock_article_reservee_leq_physique_chk;

alter table public.stock_article
  add constraint stock_article_reservee_leq_physique_chk
  check (quantite_reservee_millieme <= greatest(quantite_physique_millieme, 0));

comment on table public.stock_article is
  'Stock physique par (tenant, article, site) — RP-09→RP-15. quantite_disponible = '
  'quantite_physique_millieme - quantite_reservee_millieme (RP-14, calculé côté lecture, jamais '
  'stocké). quantite_reservee_millieme est maintenue par le trigger de reservation_piece (0026), '
  'sous verrou de ligne — c''est ce qui rend CP-02 sûr sous concurrence, voir 0026. '
  'stock_article_reservee_leq_physique_chk (0047 : reservee <= greatest(physique, 0)) est le '
  'filet ultime : la réservée ne dépasse jamais le VRAIMENT disponible, y compris quand physique '
  'est négatif (forçage RP-15) — cas où plus rien n''est réservable, le plafond devient 0 plutôt '
  'qu''un nombre négatif inatteignable.';


-- ---------------------------------------------------------------------------------------------
-- 2. `motif_liberation_reservation` gagne `liberation_forcage_stock`.
-- ---------------------------------------------------------------------------------------------

alter type public.motif_liberation_reservation add value if not exists 'liberation_forcage_stock';


-- ---------------------------------------------------------------------------------------------
-- 3. Assertions de fin de migration.
-- ---------------------------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1
      from pg_catalog.pg_constraint
     where conrelid = 'public.stock_article'::regclass
       and conname = 'stock_article_reservee_leq_physique_chk'
       and pg_get_constraintdef(oid) = 'CHECK ((quantite_reservee_millieme <= GREATEST(quantite_physique_millieme, 0)))'
  ) then
    raise exception '0047 : stock_article_reservee_leq_physique_chk absente ou pas relâchée comme attendu.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_enum e join pg_catalog.pg_type t on t.oid = e.enumtypid
     where t.typname = 'motif_liberation_reservation' and e.enumlabel = 'liberation_forcage_stock'
  ) then
    raise exception '0047 : motif_liberation_reservation ne porte pas la valeur liberation_forcage_stock après migration.';
  end if;
end
$$;
