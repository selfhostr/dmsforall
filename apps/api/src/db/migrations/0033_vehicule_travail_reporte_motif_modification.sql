-- =============================================================================================
-- 0033_vehicule_travail_reporte_motif_modification.sql — corrige une perte de données silencieuse
-- mesurée en exécution (pas supposée) : `ServiceVehiculeTravailReporte.modifier`
-- (apps/api/src/vehicules/service-vehicule-travail-reporte.ts) accepte `entree.motif`
-- (`schemaModificationTravailReporte.motif`, `schemaMotif`, validé, min 3 caractères) mais ne
-- l'écrit dans AUCUNE colonne — l'API répond 200, la raison saisie par le réceptionnaire à la
-- correction/clôture/abandon d'un travail reporté disparaît. Le commentaire de tête de
-- `service-vehicule-travail-reporte.ts` documentait déjà ce trou (« une modification ultérieure
-- ne laissera aucune trace ») — cette migration le comble.
--
-- NUMÉROTATION — 0032 ÉTAIT PRIS ENTRE-TEMPS : le brief de cette tâche assignait 0032 à cet agent,
-- avec 0030 (Pointage) et 0031 (Ventes) réservés à des agents en vol. Constaté en exécution avant
-- d'écrire ce fichier : `0031_ventes_entite_auditee.sql` ET `0032_ventes.sql` existent déjà
-- (agent « ventes » passé par 0032 dans le même intervalle). Cette migration prend donc 0033 —
-- signalé, pas deviné en silence.
--
-- NE RÉUTILISE PAS `motif_refus` (0021) — ARBITRAGE DÉJÀ TRANCHÉ, RAPPELÉ ICI POUR NE PAS ÊTRE
-- ROUVERT : `motif_refus` porte « pourquoi le client a refusé ce travail au moment du devis »,
-- écrit UNE FOIS par `creerDepuisRefus` au moment de la création. `motif_modification` porte une
-- information différente, à un autre moment, par un autre acteur : pourquoi une correction ou un
-- abandon ULTÉRIEUR a eu lieu. Fusionner les deux détruirait la traçabilité du refus initial que
-- 0021 avait précisément posée pour préserver — deux colonnes distinctes, comme `dossier_vente`
-- (motif_cloture) et `reprise`/`financement_vente` (motif_refus, une autre paire déjà distincte
-- dans le module ventes) le font chacun pour leur propre paire de moments.
--
-- 1. COLONNE — même forme exacte que `motif_refus` (0021) : `text null`, sans borne de longueur
--    (aucun champ de texte libre de ce dépôt n'en a, voir le raisonnement complet en 0021 §2),
--    nullable pour la même raison (une correction sans motif reste un cas normal — seuls
--    `statut: 'abandonne'`/`'repris'` avec motif deviennent la norme attendue côté UI, jamais
--    imposés par une contrainte NOT NULL qui forcerait un motif inventé).
--
-- 2. CHECK — non vide quand renseigné, même famille exacte que
--    `vehicule_travail_reporte_motif_refus_non_vide_chk` (0021) : sans elle, le service pourrait
--    écrire '' plutôt que NULL, et tout code qui teste `motif_modification !== null` afficherait
--    une bulle de motif vide au lieu de rien.
--
-- 3. AUDIT — LE POINT CENTRAL DE CETTE MIGRATION, PAS UN AJOUT ACCESSOIRE : `vehicule_travail_reporte`
--    n'était auditée par RIEN (0021 §4b, confirmé encore vrai ici : ni trigger `..._audit`, ni
--    présence dans `entite_auditee`) alors que `dfa_app` a `UPDATE` sur cette table depuis 0007 et
--    que la table porte un `montant_estime_centimes` — modifier un travail reporté, c'est
--    modifier un montant proposé au client. Posé ici, RIGOUREUSEMENT SUR LE MÊME DISPOSITIF que
--    `tenant_bloc_creancier` (0016, référence directe) — pas une deuxième implémentation :
--      a) `entite_auditee` gagne la valeur `vehicule_travail_reporte` (§3.1).
--      b) `vehicule_travail_reporte_audit` : trigger AFTER INSERT/UPDATE/DELETE générique
--         `auditer_atelier('vehicule_travail_reporte')` (§3.2).
--    `ALTER TYPE ... ADD VALUE` PUIS `CREATE TRIGGER` qui l'utilise, DANS LA MÊME TRANSACTION —
--    SÛR ICI, VÉRIFIÉ PAR LE RAISONNEMENT DE 0016 (pas supposé) : la seule restriction réelle de
--    PostgreSQL est qu'une valeur ajoutée ne doit pas être COMPARÉE (=, tri, cast implicite dans
--    WHERE/ORDER BY) dans la même transaction que celle qui l'a ajoutée. `vehicule_travail_reporte`
--    n'a PAS de machine à états sur `transition_autorisee` (à la différence de `vehicule_stock`/
--    `dossier_vente`/`reprise`/`financement_vente`, 0031/0032 — la table sœur qui, elle, A dû
--    séparer sa migration parce qu'elle INSÈRE dans `transition_autorisee (entite, ...) values
--    ('vehicule_stock', ...)`, un INSERT typé qui compare la valeur neuve) : aucun INSERT de ce
--    genre ici, seulement un `CREATE TRIGGER … execute function auditer_atelier(
--    'vehicule_travail_reporte')`, où l'argument est stocké comme TEXTE brut (`pg_trigger.tgargs`)
--    et casté vers `entite_auditee` uniquement à l'EXÉCUTION future du trigger (0004 §4,
--    `entite_cible := tg_argv[0]::public.entite_auditee`) — une transaction ultérieure, après le
--    COMMIT de cette migration-ci. Aucune comparaison de la valeur neuve avant ce COMMIT.
--
--    ACTION DÉDUITE PAR LE TRIGGER GÉNÉRIQUE (0004 §4, inchangé ici) : `vehicule_travail_reporte`
--    porte une colonne `statut` (0007) — un UPDATE qui la change sera donc journalisé comme
--    `transition` (ouvert -> repris/abandonne), tout autre UPDATE (correction de désignation,
--    urgence, montant, ou motif seul) comme `modification`. `montant_estime_centimes` avant/après
--    devient ainsi lisible dans `audit_atelier.valeur_avant`/`valeur_apres`, comme demandé.
--
-- 4. `ENTITES_AUDITEES` (packages/shared/src/contrats/atelier/enums.ts) — CE QUE CETTE MIGRATION NE
--    FAIT PAS : ce fichier TypeScript a un autre propriétaire cette vague (signalé par le brief de
--    tâche). La valeur Postgres `vehicule_travail_reporte` existe côté base dès cette migration
--    (§3.1) ; le miroir TypeScript partagé — et donc `GET /ordres-reparation/{id}/journal` côté
--    contrat public pour cette entité — reste à ajouter séparément. SIGNALÉ EN RÉPONSE DE TÂCHE,
--    PAS FAIT ICI : la valeur exacte à ajouter à `ENTITES_AUDITEES` est `'vehicule_travail_reporte'`.
--
-- Réversible : migrations/down/0033_vehicule_travail_reporte_motif_modification.down.sql. Le DOWN
-- retire le trigger, la colonne et sa contrainte, restaure le commentaire de table — il NE PEUT
-- PAS retirer `vehicule_travail_reporte` de `entite_auditee` (PostgreSQL n'offre aucun DROP VALUE
-- sur un type enum), même limite documentée et acceptée que 0016/0021/0023. Migration de DONNÉES :
-- aucune — colonne neuve, entièrement NULL sur les lignes existantes.
-- =============================================================================================


-- ---------------------------------------------------------------------------------------------
-- 1. Colonne `motif_modification` — nullable, sans borne de longueur (§1 en-tête).
-- ---------------------------------------------------------------------------------------------

alter table public.vehicule_travail_reporte
  add column motif_modification text null;


-- ---------------------------------------------------------------------------------------------
-- 2. CHECK — non vide quand renseigné (§2 en-tête).
-- ---------------------------------------------------------------------------------------------

alter table public.vehicule_travail_reporte
  add constraint vehicule_travail_reporte_motif_modification_non_vide_chk
  check (motif_modification is null or length(btrim(motif_modification)) > 0);


-- ---------------------------------------------------------------------------------------------
-- 3.1. `entite_auditee` gagne `vehicule_travail_reporte` (§3 en-tête).
--
-- `IF NOT EXISTS` : le DOWN de cette migration ne PEUT PAS retirer cette valeur (voir en-tête),
-- donc sans IF NOT EXISTS un cycle up->down->up échouerait dès le second up.
-- ---------------------------------------------------------------------------------------------

alter type public.entite_auditee add value if not exists 'vehicule_travail_reporte';


-- ---------------------------------------------------------------------------------------------
-- 3.2. `vehicule_travail_reporte_audit` — trigger générique, dispositif inchangé (0004 §4, même
--      patron que `tenant_bloc_creancier_audit`, 0016).
-- ---------------------------------------------------------------------------------------------

create trigger vehicule_travail_reporte_audit
  after insert or update or delete on public.vehicule_travail_reporte
  for each row execute function public.auditer_atelier('vehicule_travail_reporte');


-- ---------------------------------------------------------------------------------------------
-- 4. Commentaire de table complété — texte de 0021 CONSERVÉ EN ENTIER, une phrase ajoutée à la
--    fin (correction, pas remplacement — la phrase de 0021 sur `motif_refus` reste exacte). Le
--    DOWN restaure le texte de 0021 mot pour mot.
-- ---------------------------------------------------------------------------------------------

comment on table public.vehicule_travail_reporte is
  'Travaux reportés d''un véhicule (RM-73), MATÉRIALISÉS et éditables — pas une vue sur ligne_or. '
  '`motif_refus` (0021) : raison du refus saisie au comptoir, consultée au passage suivant. '
  '`motif_modification` (0033) : raison d''une correction ou d''un abandon ULTÉRIEUR, distincte de '
  '`motif_refus` (autre moment, autre acteur) — voir le commentaire de tête de 0033 pour '
  'l''arbitrage. Auditée depuis 0033 : vehicule_travail_reporte_audit journalise toute création/'
  'modification/transition/suppression dans audit_atelier, avant/après complet — voir '
  'auditer_atelier(), 0004 §4.';


-- ---------------------------------------------------------------------------------------------
-- Assertions de fin de migration
-- ---------------------------------------------------------------------------------------------

do $$
begin
  -- 1. Colonne motif_modification présente, nullable, type text.
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'vehicule_travail_reporte'
       and column_name = 'motif_modification' and is_nullable = 'YES' and data_type = 'text'
  ) then
    raise exception '0033 : vehicule_travail_reporte.motif_modification absente, non-nullable, ou de mauvais type.';
  end if;

  -- 2. CHECK posée.
  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conname = 'vehicule_travail_reporte_motif_modification_non_vide_chk'
       and conrelid = 'public.vehicule_travail_reporte'::regclass
  ) then
    raise exception '0033 : vehicule_travail_reporte_motif_modification_non_vide_chk absente après migration.';
  end if;

  -- 3. Aucune ligne existante altérée : expand pur.
  if exists (
    select 1 from public.vehicule_travail_reporte where motif_modification is not null
  ) then
    raise exception '0033 : une ligne de vehicule_travail_reporte porte un motif_modification non-NULL juste après la migration — une valeur a été inventée quelque part.';
  end if;

  -- 4. `entite_auditee` porte bien la nouvelle valeur.
  if not exists (
    select 1
      from pg_catalog.pg_enum e
      join pg_catalog.pg_type t on t.oid = e.enumtypid
     where t.typname = 'entite_auditee'
       and e.enumlabel = 'vehicule_travail_reporte'
  ) then
    raise exception '0033 : entite_auditee ne porte pas la valeur vehicule_travail_reporte après migration.';
  end if;

  -- 5. Le trigger d'audit existe, posé sur vehicule_travail_reporte, et exécute bien la fonction
  --    générique auditer_atelier() — pas une variante locale.
  if not exists (
    select 1
      from pg_catalog.pg_trigger tg
      join pg_catalog.pg_class c on c.oid = tg.tgrelid
      join pg_catalog.pg_proc p on p.oid = tg.tgfoid
     where c.relname = 'vehicule_travail_reporte'
       and tg.tgname = 'vehicule_travail_reporte_audit'
       and p.proname = 'auditer_atelier'
       and not tg.tgisinternal
  ) then
    raise exception '0033 : trigger vehicule_travail_reporte_audit absent ou ne pointe pas vers auditer_atelier().';
  end if;

  -- 6. Le trigger est bien AFTER INSERT/UPDATE/DELETE, FOR EACH ROW (tgtype bitmask :
  --    ROW=1, INSERT=4, DELETE=8, UPDATE=16 ; AFTER = absence du bit BEFORE=2).
  if not exists (
    select 1
      from pg_catalog.pg_trigger tg
      join pg_catalog.pg_class c on c.oid = tg.tgrelid
     where c.relname = 'vehicule_travail_reporte'
       and tg.tgname = 'vehicule_travail_reporte_audit'
       and (tg.tgtype & 1) = 1   -- ROW
       and (tg.tgtype & 2) = 0   -- AFTER (pas BEFORE)
       and (tg.tgtype & 4) = 4   -- INSERT
       and (tg.tgtype & 8) = 8   -- DELETE
       and (tg.tgtype & 16) = 16 -- UPDATE
  ) then
    raise exception '0033 : vehicule_travail_reporte_audit n''est pas exactement AFTER INSERT OR UPDATE OR DELETE FOR EACH ROW.';
  end if;
end
$$;
