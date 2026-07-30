-- =============================================================================================
-- 0021_vehicule_travail_reporte_motif_refus.sql — pose la colonne qu'`EntreeRefusLignes.motif`
-- attend depuis toujours et n'a jamais eue : mesuré indépendamment par deux agents, ce motif est
-- SAISI par le réceptionnaire au refus d'une ligne de devis, et JETÉ SILENCIEUSEMENT aujourd'hui —
-- `service-ligne-or.ts::refuserLignes` appelle `transitionnerLigne(tx, ctx, ligne, 'refusee', {})`
-- sans jamais lire `entree.motif`, et ni `ligne_or` ni `vehicule_travail_reporte` n'ont de colonne
-- où l'accueillir. Ça devenait un défaut silencieux tolérable tant que le refus ne produisait
-- rien de durable ; ça cesse de l'être maintenant qu'un refus crée un TRAVAIL REPORTÉ (RM-73,
-- `vehicule_travail_reporte`) reproposé au client des mois plus tard — « refusé, trop cher en ce
-- moment » et « refusé, fait faire ailleurs » n'appellent pas la même relance, et cette nuance
-- disparaît aujourd'hui entre la saisie et la persistance.
--
-- ARBITRAGE (@laupernoe, 30.07.2026) : la colonne va sur `vehicule_travail_reporte`, PAS sur `ligne_or`.
-- Raison : c'est le travail reporté qu'on CONSULTE au retour du véhicule, souvent après que l'OR
-- d'origine a été facturé et archivé — le motif doit vivre là où il sera lu, pas seulement là où
-- il a été énoncé. `vehicule_travail_reporte` (0007/0008) est déjà « MATÉRIALISÉ et éditable, pas
-- une vue sur `ligne_or` » (son propre commentaire de table) : poser le motif ailleurs que sur lui
-- aurait obligé à une jointure vers un OR potentiellement déjà hors de portée courante.
--
-- 1. NULLABLE — délibéré, pas un oubli : un refus sans explication reste un cas normal au
--    comptoir (client pressé, désintérêt sans raison formulée), et une NOT NULL forcerait la
--    saisie d'un motif inventé pour satisfaire la contrainte — exactement le défaut que 0017/0018
--    ont déjà évité pour d'autres colonnes nullables « à saisie progressive/optionnelle ».
--
-- 2. LONGUEUR — MESURÉE SUR LE DÉPÔT, PAS INVENTÉE : grep de tout `length(...)` posé en CHECK sur
--    l'ensemble de `migrations/*.sql` (0000→0020). Deux bornes SUPÉRIEURES existent dans TOUT le
--    schéma, et aucune n'est un gabarit pour un champ de texte libre :
--      - `utilisateur.email` / `journal_securite.email_tente` : `length(...) between 3 and 320`
--        (0000) — borne STRUCTURELLE, la limite RFC 5321 d'une adresse e-mail, pas un choix
--        éditorial de longueur de phrase.
--      - `vehicule.vin` : `length(vin) <> 17 or vin ~ '^[A-HJ-NPR-Z0-9]{17}$'` (0007) — borne
--        STRUCTURELLE aussi, la longueur fixe ISO 3779 d'un numéro de châssis.
--    À L'INVERSE, CHAQUE champ de texte libre existant — et `motif_refus` en est un, de la même
--    famille que ceux-ci — n'a JAMAIS de borne supérieure, seulement une garde « non vide quand
--    renseigné » : `ligne_or.motif_annulation` (0008, `text null`, AUCUN CHECK de longueur — le
--    parallèle le plus direct, un autre motif de comptoir saisi en texte libre sur ce même
--    domaine atelier), `ordre_reparation_demande.verbatim` (0008), `client_note.texte` (0006),
--    `vehicule_travail_reporte.designation` (0007, la colonne sœur immédiate de celle posée ici,
--    sur la MÊME table). Poser une borne chiffrée sur `motif_refus` — 200, 500, peu importe le
--    nombre choisi — inventerait une DEUXIÈME convention pour le texte libre là où le dépôt n'en a
--    jamais eu qu'une seule. Retenu ici : `text null`, MÊME FORME EXACTE que `motif_annulation`,
--    sans CHECK de longueur.
--
-- 3. CHECK POSÉ QUAND MÊME, MAIS D'UNE AUTRE NATURE — « non vide quand renseigné », pas une borne
--    de longueur : `vehicule_travail_reporte_motif_refus_non_vide_chk`, même famille exacte que
--    `document_vente_numero_non_vide_chk` (0010, `numero is null or length(btrim(numero)) > 0`).
--    Sans elle, un service pourrait écrire une chaîne vide (`''`) plutôt que NULL pour « pas de
--    motif », et tout code qui teste `motif_refus !== null` pour décider d'afficher une bulle de
--    motif au comptoir afficherait une bulle VIDE au lieu de rien — bug d'affichage silencieux
--    que la contrainte élimine à la source, en base, pas seulement par convention applicative.
--    `motif_annulation` N'A PAS cette garde (seule sa présence est exigée conditionnellement au
--    statut, `ligne_or_annulation_motif_chk`) : la différence est assumée — `motif_refus` n'a
--    aucune contrainte de présence conditionnelle équivalente (RM-73 n'exige jamais un motif),
--    donc rien n'empêcherait autrement une chaîne vide de s'y glisser sans qu'aucune règle ne la
--    remarque.
--
-- 4. PISTE D'AUDIT — LE POINT LE PLUS IMPORTANT DE CETTE MIGRATION, MESURÉ EN EXÉCUTION SUR LE
--    SCHÉMA, PAS SUPPOSÉ :
--
--    a) `ligne_or` EST auditée : `ligne_or_audit` (0008, `after insert or update or delete`,
--       `auditer_atelier('ligne_or')`) capture `to_jsonb(old)`/`to_jsonb(new)` — la ligne ENTIÈRE,
--       colonne par colonne. Le passage d'une ligne à `statut = 'refusee'` (`refuserLignes` →
--       `transitionnerLigne`) EST donc tracé : QUI, QUAND, l'ancien ET le nouveau `statut` sont
--       dans `audit_atelier`. MAIS `entree.motif` (le paramètre reçu par `refuserLignes`) N'A
--       JAMAIS ÉTÉ ÉCRIT SUR AUCUNE COLONNE DE `ligne_or` (vérifié : liste complète des colonnes
--       de `ligne_or`, 0008, ci-dessus — aucune ne s'appelle `motif`/`motif_refus`, `to_jsonb(new)`
--       ne peut donc structurellement pas le contenir) — la trace d'audit existante pour ce
--       refus contient TOUT sauf la seule information qui explique POURQUOI.
--
--    b) `vehicule_travail_reporte` N'EST PAS auditée du tout, aujourd'hui : aucun trigger
--       `..._audit` sur cette table (seul `vehicule_travail_reporte_touche_modifie_le` existe,
--       0007) et `vehicule_travail_reporte` NE FIGURE PAS dans l'énumération `entite_auditee`
--       (vérifié : liste complète, 0003 §create type + tous les `alter type ... add value` de
--       0010/0016 — `ordre_reparation, ligne_or, devis_complementaire, pointage,
--       vehicule_detention, vehicule_kilometrage, client, rendez_vous, pret_courtoisie,
--       document_vente, paiement, imputation_paiement, periode_comptable, export_comptable,
--       mapping_compte, tenant_bloc_creancier` — `vehicule_travail_reporte` absent). CONSÉQUENCE
--       ASSUMÉE PAR CETTE MIGRATION, PAS CORRIGÉE ICI : une fois `creerDepuisRefus` câblé
--       (`atelier`/`vehicules`, hors périmètre), la valeur de `motif_refus` sera bien DURABLEMENT
--       LISIBLE sur la ligne `vehicule_travail_reporte` elle-même (c'est le point de départ de
--       l'arbitrage §0 : le travail reporté EST l'endroit où on le consulte) — mais AUCUNE TRACE
--       QUI/QUAND ne serait posée pour une modification ultérieure de ce champ (`dfa_app` a
--       `UPDATE` sur cette table depuis 0007) : un motif corrigé ou effacé après coup ne
--       laisserait aucune preuve de sa valeur d'origine.
--
--    RÉPONSE À LA CRAINTE EXPRIMÉE : CONFIRMÉE, PAS SEULEMENT PROBABLE. Avant cette migration,
--    « pourquoi cette ligne a-t-elle été refusée » est structurellement irrécupérable a
--    posteriori, quelle que soit la profondeur de fouille dans `audit_atelier` — le motif n'existe
--    tout simplement nulle part, ni comme colonne, ni comme trace. Après cette migration, il
--    existe comme COLONNE (consultable tant que personne ne l'écrase), mais PAS encore comme
--    TRACE (un historique des modifications de `motif_refus` au fil du temps).
--
--    RECOMMANDATION, NON FAITE DANS CETTE MIGRATION : ajouter `vehicule_travail_reporte` à
--    `entite_auditee` et lui poser un trigger `vehicule_travail_reporte_audit` (même patron que
--    `ligne_or_audit`) mérite sa propre migration, décidée séparément — cette migration-ci reste
--    volontairement un `ALTER TABLE` à objet unique (même discipline qu'0017/0018/0019 : une
--    colonne, sa contrainte, son commentaire), et étendre l'audit générique est un changement de
--    nature différente (nouvelle valeur d'enum, nouveau trigger, nouvelle politique à vérifier)
--    qui mérite d'être vu et validé pour lui-même plutôt que noyé dans l'ajout d'une colonne.
--
-- Réversible : migrations/down/0021_vehicule_travail_reporte_motif_refus.down.sql. Migration de
-- DONNÉES : aucune — colonne neuve, entièrement NULL sur les lignes existantes (aucune ligne de
-- `vehicule_travail_reporte` en base aujourd'hui, vérifié, mais le principe resterait le même sur
-- des lignes réelles).
-- =============================================================================================


-- ---------------------------------------------------------------------------------------------
-- 1. Colonne — nullable, sans borne de longueur (§1/§2 en-tête).
-- ---------------------------------------------------------------------------------------------

alter table public.vehicule_travail_reporte
  add column motif_refus text null;


-- ---------------------------------------------------------------------------------------------
-- 2. CHECK — non vide quand renseigné (§3 en-tête).
-- ---------------------------------------------------------------------------------------------

alter table public.vehicule_travail_reporte
  add constraint vehicule_travail_reporte_motif_refus_non_vide_chk
  check (motif_refus is null or length(btrim(motif_refus)) > 0);


-- ---------------------------------------------------------------------------------------------
-- 3. Commentaire de table complété — texte de 0007 CONSERVÉ EN ENTIER, une phrase ajoutée à la
--    fin. Le DOWN restaure le texte de 0007 mot pour mot (même discipline que 0016/0017/0018/0019).
-- ---------------------------------------------------------------------------------------------

comment on table public.vehicule_travail_reporte is
  'Travaux reportés d''un véhicule (RM-73), MATÉRIALISÉS et éditables — pas une vue sur ligne_or. '
  '`motif_refus` (0021) : raison du refus saisie au comptoir, consultée au passage suivant — '
  'PAS encore tracée par l''audit générique (voir la migration : cette table n''est pas dans '
  '`entite_auditee`), seule sa valeur COURANTE est durablement lisible.';


-- ---------------------------------------------------------------------------------------------
-- Assertions de fin de migration
-- ---------------------------------------------------------------------------------------------

do $$
begin
  -- 1. Colonne présente, nullable, type text.
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'vehicule_travail_reporte'
       and column_name = 'motif_refus' and is_nullable = 'YES' and data_type = 'text'
  ) then
    raise exception '0021 : vehicule_travail_reporte.motif_refus absente, non-nullable, ou de mauvais type.';
  end if;

  -- 2. CHECK posée.
  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conname = 'vehicule_travail_reporte_motif_refus_non_vide_chk'
       and conrelid = 'public.vehicule_travail_reporte'::regclass
  ) then
    raise exception '0021 : vehicule_travail_reporte_motif_refus_non_vide_chk absente après migration.';
  end if;

  -- 3. Aucune ligne existante altérée : expand pur.
  if exists (
    select 1 from public.vehicule_travail_reporte where motif_refus is not null
  ) then
    raise exception '0021 : une ligne de vehicule_travail_reporte porte un motif_refus non-NULL juste après la migration — une valeur a été inventée quelque part.';
  end if;
end
$$;
