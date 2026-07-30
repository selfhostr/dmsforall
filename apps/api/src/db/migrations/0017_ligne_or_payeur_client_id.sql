-- =============================================================================================
-- 0017_ligne_or_payeur_client_id.sql — pose l'accroche `AC-08`
-- (docs/modele-documentaire-facturation.md §4.5), tranchée mais jamais posée en base.
--
-- CONSTAT : `MD-62` a tranché « le regroupement se fait par `(payeur, payeur_client_id)` » et
-- `AC-08` documentait déjà le besoin (« `payeur_client_id uuid null` à côté de `payeur` (`RM-66`).
-- Savoir que c'est "assurance" ne suffit pas à émettre une facture : il faut QUELLE assurance,
-- avec son adresse. ») — jamais posée dans `0008_atelier.sql`. Vérifié avant cette migration :
-- `ligne_or` n'a que la colonne `payeur` (enum), aucune colonne qui désigne LEQUEL. Conséquence
-- vécue : `apps/api/src/atelier/totaux-payeur.ts` (`calculerTotauxParPayeur`) ne peut regrouper
-- que par `payeur` seul — deux assureurs différents sur un même OR fusionnent aujourd'hui en un
-- seul groupe et recevraient une facture commune. Ce fichier appartient à un autre périmètre
-- (`apps/api/src/atelier/`), corrigé en parallèle de cette migration ; cette migration pose
-- seulement la colonne qui rend la correction possible.
--
-- 1. NULLABLE, ET POURQUOI C'EST CORRECT :
--    Le cas courant est `payeur = 'client'` : le destinataire de la facture est le client du
--    véhicule lui-même (`ordre_reparation.client_id`), déjà connu, sans tiers à désigner. Une
--    valeur ici serait une redondance qui pourrait diverger de `ordre_reparation.client_id` sans
--    qu'aucune règle ne le détecte. Même chose pour `payeur = 'garage'` : `MD-66` est explicite
--    — une ligne de payeur `garage` (geste commercial, retouche, casse) est « facturée à
--    PERSONNE » (`montant_facturable_centimes = 0`, accroche `AC-07`, hors périmètre ici). Il n'y
--    a structurellement personne à qui adresser une facture pour ces deux valeurs de `payeur`.
--    La colonne ne se remplit donc que pour un payeur tiers réel : `constructeur`, `assurance`,
--    `tiers` (enum `payeur_ligne_or`, 5 valeurs, vérifié : `client, constructeur, assurance,
--    tiers, garage` — 0005 §payeur_ligne_or).
--
-- 2. CHECK EN BASE, PAS SEULEMENT EN COMMENTAIRE — MAIS UNIQUEMENT DANS LE SENS QUE L'ENUM
--    JUSTIFIE : `ligne_or_payeur_client_coherent_chk` interdit `payeur_client_id` renseigné sauf
--    si `payeur` est `constructeur`, `assurance` ou `tiers`. C'est un fait structurel (MD-66 pour
--    `garage`, sémantique de `client` pour l'autre) — pas une simple préférence d'écriture. La
--    contrainte NE force PAS l'inverse (`payeur` tiers ⇒ `payeur_client_id` obligatoire) : une
--    ligne peut naître avec `payeur = 'assurance'` avant que l'assureur exact ne soit connu
--    (sinistre ouvert, accord pas encore reçu — `MD-65`), exactement le même choix que
--    `tenant_bloc_creancier` (0014/0016, colonnes nullables, obligation vérifiée à l'ÉMISSION,
--    pas à la création — contrôle applicatif à venir sur `POST .../facturer`, `RF-81`, hors
--    périmètre `db/migrations/`). Inventer une NOT NULL conditionnelle ici verrouillerait une
--    saisie progressive que le métier autorise explicitement.
--
-- 3. FK COMPOSITE AVEC LE TENANT — RÈGLE N°1 DU PROJET : `ligne_or_fk_payeur_client` référence
--    `(tenant_id, id)` de `client`, jamais `id` seul, exactement comme `ordre_reparation_fk_
--    client`/`ordre_reparation_fk_detenteur_fige` (0008), `client_adresse_fk` (0006) et
--    `paiement_fk_payeur` (0010, le précédent le plus proche : même besoin « payeur tiers
--    nullable »). Une FK sur `id` seul permettrait à un utilisateur du tenant A d'adresser une
--    ligne d'OR au client d'un tenant B — franchise d'étanchéité inter-tenant, prouvée refusée
--    en preuve de livraison.
--
-- 4. ON DELETE RESTRICT — alignement avec TOUTES les FK existantes vers `client` sans exception
--    (`client_fk_groupe`, `client_fk_fusionne_vers`, `client_adresse_fk`, `client_contact_fk`,
--    `client_condition_fk`, `client_consentement_fk`, `client_note_fk`,
--    `ordre_reparation_fk_client`, `ordre_reparation_fk_detenteur_fige`,
--    `vehicule_detention_fk_client`, `vehicule_fk_proprietaire_eco`, `document_vente_fk_client`,
--    `paiement_fk_payeur` — vérifié, aucune n'utilise CASCADE ni SET NULL). Un client désigné
--    comme payeur d'une ligne d'OR — potentiellement déjà facturé (`RM-71` : une ligne facturée
--    ne se corrige que par avoir, jamais supprimée) — ne doit jamais pouvoir disparaître
--    silencieusement de sous une pièce comptable. `client.statut = 'inactif'` est la voie normale
--    pour un client qu'on ne veut plus voir apparaître aux nouvelles saisies (RM-06, fusion) ;
--    `RESTRICT` protège l'historique, pas la vie courante du fichier client.
--
-- 5. INDEX — MESURÉ, PAS SUPPOSÉ : `ligne_or_payeur_client_idx`, partiel (`where payeur_client_id
--    is not null`), sur `(tenant_id, payeur_client_id)` — même forme exacte que
--    `paiement_payeur_idx` (0010), le précédent direct pour « retrouver tout ce qui est dû par un
--    tiers payeur donné » (ex. futur écran « factures en attente pour l'assurance X », ou l'export
--    par groupe de `RF-81`). `ligne_or_or_idx` (0008, `tenant_id, ordre_reparation_id,
--    numero_ordre`) sert déjà le regroupement DANS un OR (les lignes d'un OR tiennent en mémoire,
--    `calculerTotauxParPayeur` les reçoit déjà chargées) — ce nouvel index sert la question
--    inverse, INTER-OR : toutes les lignes d'un payeur donné, à travers les OR, sur un tenant.
--
--    Banc d'essai RÉEL, exécuté sur `dfa_dev` APRÈS application de cette migration : 90 000
--    lignes sur le tenant de démo, réparties sur 5 000 OR (18 lignes/OR — ordre de grandeur 5 ans
--    × 50 OR/jour, le volume visé par la tâche), payeur_client_id renseigné sur 20 000 lignes
--    (payeur `assurance`, cycle sur les 3 clients existants, ~6 700 lignes chacun). Généré et
--    détruit par `ROLLBACK` dans la même transaction — jamais persisté dans `dfa_dev` ; l'index
--    lui-même est retiré puis recréé À L'IDENTIQUE dans cette même transaction pour mesurer
--    l'avant/après sans toucher à l'index réel posé par cette migration (§4 ci-dessous).
--
--      -- AVANT (index retiré le temps de la mesure) :
--      explain (analyze, buffers, timing)
--      select id, ordre_reparation_id, montant_ttc_centimes from public.ligne_or
--       where tenant_id = '11ed8af1-bcb7-486c-8643-8648380f0221'
--         and payeur_client_id = '7bba5908-f7a5-4988-90da-a1365f0cd200';
--
--      Seq Scan on ligne_or (actual time=1.719..11.075 rows=6700 loops=1)
--        Filter: ((tenant_id = $1) AND (payeur_client_id = $2))
--        Rows Removed by Filter: 83305
--        Buffers: shared hit=1682
--      Execution Time: 11.269 ms
--
--      -- APRÈS (index recréé, ANALYZE) :
--      Bitmap Heap Scan on ligne_or (actual time=0.183..1.377 rows=6700 loops=1)
--        Recheck Cond: ((tenant_id = $1) AND (payeur_client_id = $2))
--        Heap Blocks: exact=411 — Buffers: shared hit=411 read=8
--        ->  Bitmap Index Scan on ligne_or_payeur_client_idx
--              (actual time=0.149..0.149 rows=6700 loops=1) — Buffers: shared read=8
--      Execution Time: 1.590 ms
--
--    11.27 ms → 1.59 ms (≈7×) à 90 000 lignes/tenant, 1682 buffers lus → 419 — et l'écart croît
--    avec le volume, puisque le scan séquentiel est linéaire en nombre de lignes DU TENANT alors
--    que le bitmap index scan l'est en nombre de lignes DU PAYEUR ciblé. Capture intégrale
--    (script exact et sortie psql complète) dans le rapport de livraison.
--
-- `CREATE INDEX` ordinaire, pas `CONCURRENTLY` — même motif documenté en détail par 0013 §« ENVISAGÉ,
-- ÉCARTÉ » : `migrer.ts` enveloppe chaque fichier dans une seule transaction, incompatible avec
-- `CONCURRENTLY`. Au stade actuel (étape 1, aucun tenant de production, cf. CONTRIBUTING.md feuille de
-- route), le verrou `ACCESS EXCLUSIVE` de construction dure quelques millisecondes sur les
-- volumes réels du dépôt (5 lignes en dev). Même limite assumée, même suite recommandée que 0013.
--
-- RÉVERSIBILITÉ : colonne nullable ajoutée à une table existante — direction sûre, aucune reprise
-- de données à inventer. Le DOWN retire l'index, la contrainte CHECK, la FK puis la colonne, et
-- restaure le commentaire de table au texte exact de 0008 (même discipline que 0016 pour
-- `tenant_bloc_creancier`). Migration de DONNÉES : aucune (une colonne neuve, entièrement NULL,
-- ne casse aucune ligne existante).
--
-- Réversible : migrations/down/0017_ligne_or_payeur_client_id.down.sql.
-- =============================================================================================


-- ---------------------------------------------------------------------------------------------
-- 1. Colonne — nullable (voir §1 en-tête), sans DEFAULT (une ligne muette sur son payeur exact
--    reste muette, jamais devinée).
-- ---------------------------------------------------------------------------------------------

alter table public.ligne_or
  add column payeur_client_id uuid null;


-- ---------------------------------------------------------------------------------------------
-- 2. FK composite avec le tenant (voir §3 en-tête) — RESTRICT (voir §4 en-tête).
-- ---------------------------------------------------------------------------------------------

alter table public.ligne_or
  add constraint ligne_or_fk_payeur_client foreign key (tenant_id, payeur_client_id)
  references public.client (tenant_id, id) on delete restrict;


-- ---------------------------------------------------------------------------------------------
-- 3. CHECK — payeur_client_id ne se renseigne que pour un payeur tiers réel (voir §2 en-tête).
-- ---------------------------------------------------------------------------------------------

alter table public.ligne_or
  add constraint ligne_or_payeur_client_coherent_chk
  check (payeur_client_id is null or payeur in ('constructeur', 'assurance', 'tiers'));


-- ---------------------------------------------------------------------------------------------
-- 4. Index partiel — mesuré §5 en-tête.
-- ---------------------------------------------------------------------------------------------

create index ligne_or_payeur_client_idx on public.ligne_or (tenant_id, payeur_client_id)
 where payeur_client_id is not null;


-- ---------------------------------------------------------------------------------------------
-- 5. Commentaire de table complété — texte de 0008 CONSERVÉ EN ENTIER, une phrase ajoutée à la
--    fin. Le DOWN restaure le texte de 0008 mot pour mot (même discipline que 0016 §3).
-- ---------------------------------------------------------------------------------------------

comment on table public.ligne_or is
  'Ligne d''un ordre de réparation. taux_horaire_centimes/prix_unitaire_centimes FIGÉS à la '
  'création (RM-65). Aucun DELETE (RM-71) : une ligne se corrige par annulation motivée. '
  '`payeur_client_id` (0017, AC-08) désigne le tiers payeur (constructeur/assurance/tiers) quand '
  '`payeur` n''est pas `client`/`garage` — voir ligne_or_payeur_client_coherent_chk et MD-62 '
  '(regroupement des documents par (payeur, payeur_client_id)).';


-- ---------------------------------------------------------------------------------------------
-- Assertions de fin de migration
-- ---------------------------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'ligne_or' and column_name = 'payeur_client_id'
       and is_nullable = 'YES'
  ) then
    raise exception '0017 : ligne_or.payeur_client_id absente ou non nullable après migration.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conname = 'ligne_or_fk_payeur_client' and conrelid = 'public.ligne_or'::regclass
  ) then
    raise exception '0017 : ligne_or_fk_payeur_client absente après migration.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conname = 'ligne_or_payeur_client_coherent_chk' and conrelid = 'public.ligne_or'::regclass
  ) then
    raise exception '0017 : ligne_or_payeur_client_coherent_chk absente après migration.';
  end if;

  if not exists (
    select 1
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'ligne_or_payeur_client_idx'
  ) then
    raise exception '0017 : ligne_or_payeur_client_idx introuvable après création.';
  end if;
end
$$;
