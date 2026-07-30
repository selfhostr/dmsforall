-- =============================================================================================
-- 0016_audit_tenant_bloc_creancier.sql — pose le trigger d'audit générique sur
-- `tenant_bloc_creancier` (0014), oublié à sa création.
--
-- CONSTAT : `tenant_bloc_creancier` porte l'IBAN et le QR-IBAN sur lesquels les clients du garage
-- paient, ainsi que le nom/l'adresse imprimés sur le bulletin de versement — c'est très
-- exactement la donnée dont le détournement (changer l'IBAN pour rediriger les encaissements)
-- est le scénario de fraude le plus direct du produit. 0014 a créé la table, l'a mise sous RLS,
-- lui a posé `tenant_bloc_creancier_touche_modifie_le` (horodatage seul) — mais AUCUN trigger
-- d'audit. Vérifié avant cette migration : l'enum `entite_auditee` ne portait aucune valeur
-- `tenant_bloc_creancier` (15 valeurs, voir §1 ci-dessous) et le seul trigger de la table était
-- celui de l'horodatage. Qui a changé l'IBAN, quand, et quelle était la valeur précédente :
-- rien ne le traçait.
--
-- CE QUI EST POSÉ ICI, RIGOUREUSEMENT SUR LE MÊME DISPOSITIF QUE `document_vente`/`paiement`/
-- `periode_comptable` (0010) ET `ordre_reparation` (0008) — pas une deuxième implémentation :
--   1. `entite_auditee` gagne la valeur `tenant_bloc_creancier` (§1).
--   2. `tenant_bloc_creancier_audit` : trigger AFTER INSERT/UPDATE/DELETE générique
--      `auditer_atelier('tenant_bloc_creancier')` (§2), posé par `create trigger … execute
--      function public.auditer_atelier('tenant_bloc_creancier')`, comme partout ailleurs.
--   3. Le commentaire de table est complété (mot ajouté, rien retiré) pour que la garantie soit
--      lisible directement sur la table (§3) — le DOWN restaure le texte de 0014 mot pour mot.
--
-- ALTER TYPE ... ADD VALUE DANS LA MÊME TRANSACTION QUE LE CREATE TRIGGER QUI L'UTILISE — DÉJÀ
-- PROUVÉ SÛR SUR CE DÉPÔT, PAS SUPPOSÉ ICI : `migrer.ts` enveloppe chaque fichier de migration
-- dans un seul `begin`/`commit` (voir 0013, section « CREATE INDEX CONCURRENTLY »). PostgreSQL
-- (12+, et ce dépôt tourne sur 16 — docker-compose.yml) autorise `ALTER TYPE ... ADD VALUE` à
-- l'intérieur d'un bloc de transaction ; la seule restriction réelle est qu'une valeur ajoutée ne
-- doit pas être COMPARÉE (=, tri, cast implicite dans une clause WHERE/ORDER BY) dans LA MÊME
-- transaction que celle qui l'a ajoutée. 0010 §2 a déjà ajouté SIX valeurs à ce même enum, dans
-- cette même contrainte de transaction, et cette base tourne dessus depuis. Le `create trigger …
-- execute function auditer_atelier('tenant_bloc_creancier')` de §2 ci-dessous n'enfreint pas
-- cette règle : l'argument de trigger `'tenant_bloc_creancier'` est stocké comme TEXTE brut
-- (`pg_trigger.tgargs`), le cast vers `entite_auditee` (`entite_cible := tg_argv[0]::public.
-- entite_auditee`, dans `auditer_atelier()`, 0004 §4) n'a lieu qu'à l'EXÉCUTION du trigger — dans
-- une transaction ultérieure, après le COMMIT de cette migration. Aucune comparaison de la
-- nouvelle valeur ne se produit avant ce COMMIT. Vérifié en exécution, pas supposé : voir preuve
-- de livraison (INSERT réel dans audit_atelier après application de cette migration).
--
-- RÉVERSIBILITÉ — CE QUE LE DOWN PEUT DÉFAIRE ET CE QU'IL NE PEUT PAS, ET POURQUOI C'EST
-- ACCEPTABLE : le DOWN retire le trigger et restaure le commentaire de table. Il NE PEUT PAS
-- retirer la valeur `tenant_bloc_creancier` de `entite_auditee` — PostgreSQL n'offre aucun
-- « DROP VALUE » sur un type enum, seulement une recréation complète du type (renommage,
-- recréation, migration de toutes les colonnes qui l'utilisent — dont `audit_atelier`,
-- partitionnée sur 25 partitions depuis 0004, en production potentielle dès l'étape 2). Même
-- limite, même choix que 0010 §down : une valeur d'enum inutilisée après le DROP du trigger ne
-- produit plus jamais de ligne d'audit qui la porte — elle reste dans le type, sans effet
-- observable, documentée pour qu'un futur lecteur ne la découvre pas par surprise dans
-- `\dT+ entite_auditee`.
--
-- Réversible (au sens ci-dessus) : migrations/down/0016_audit_tenant_bloc_creancier.down.sql.
-- =============================================================================================


-- ---------------------------------------------------------------------------------------------
-- 1. `entite_auditee` gagne `tenant_bloc_creancier` — seizième valeur, seizième maillon RLS/audit
--    de la même famille que les quinze déjà posées par 0003 §3 et 0010 §2.
--
-- `IF NOT EXISTS` pour la même raison que 0010 §2 : le DOWN de cette migration ne PEUT PAS
-- retirer cette valeur (voir en-tête), donc sans IF NOT EXISTS un cycle up→down→up échouerait dès
-- le second up.
-- ---------------------------------------------------------------------------------------------

alter type public.entite_auditee add value if not exists 'tenant_bloc_creancier';


-- ---------------------------------------------------------------------------------------------
-- 2. `tenant_bloc_creancier_audit` — trigger générique, dispositif inchangé (0004 §4)
--
-- Rien de spécifique à réinventer : `tenant_bloc_creancier` a `tenant_id` et `id`, exactement ce
-- que `auditer_atelier()` lit sur NEW/OLD. Comme `document_vente`/`periode_comptable` (0010),
-- aucune colonne `statut` sur cette table : toute UPDATE est donc journalisée comme
-- `modification` (jamais `transition`), ce qui est le comportement attendu — un changement d'IBAN
-- n'est pas un changement d'état.
-- ---------------------------------------------------------------------------------------------

create trigger tenant_bloc_creancier_audit
  after insert or update or delete on public.tenant_bloc_creancier
  for each row execute function public.auditer_atelier('tenant_bloc_creancier');


-- ---------------------------------------------------------------------------------------------
-- 3. Commentaire de table complété — la garantie d'audit devient lisible sur la table elle-même.
--    Texte de 0014 CONSERVÉ EN ENTIER, une phrase ajoutée à la fin. Le DOWN restaure le texte
--    de 0014 mot pour mot (voir 0016_audit_tenant_bloc_creancier.down.sql).
-- ---------------------------------------------------------------------------------------------

comment on table public.tenant_bloc_creancier is
  'Bloc créancier du QR-facture (RF-54/PF-03) : adresse structurée à 7 champs du garage plus ses '
  'comptes bancaires. Un au plus par TENANT (jamais par site, arbitrage @laupernoe 30.07.2026) — voir '
  'tenant_bloc_creancier_tenant_id_uk. Toutes les colonnes sont nullables : un créancier '
  'incomplet ne bloque JAMAIS la création du tenant, seulement l''ÉMISSION d''une facture '
  '(CHAMPS_REQUIS_BLOC_CREANCIER, facturation/qr/adresse.ts, contrôle applicatif). '
  '`iban`/`qr_iban` sont deux comptes distincts et indépendants, jamais un seul champ qui jouerait '
  'les deux rôles — lequel gouverne une émission donnée est une décision applicative '
  '(determinerTypeReference, facturation/qr/iban.ts), pas un fait figé en base. '
  'Auditée (0016) : tenant_bloc_creancier_audit journalise toute création/modification/suppression '
  'dans audit_atelier, avant/après complet — voir auditer_atelier(), 0004 §4.';


-- ---------------------------------------------------------------------------------------------
-- Assertions de fin de migration
-- ---------------------------------------------------------------------------------------------

do $$
begin
  -- 1. `entite_auditee` porte bien la nouvelle valeur.
  if not exists (
    select 1
      from pg_catalog.pg_enum e
      join pg_catalog.pg_type t on t.oid = e.enumtypid
     where t.typname = 'entite_auditee'
       and e.enumlabel = 'tenant_bloc_creancier'
  ) then
    raise exception '0016 : entite_auditee ne porte pas la valeur tenant_bloc_creancier après migration.';
  end if;

  -- 2. Le trigger d'audit existe, posé sur tenant_bloc_creancier, et exécute bien la fonction
  --    générique auditer_atelier() — pas une variante locale.
  if not exists (
    select 1
      from pg_catalog.pg_trigger tg
      join pg_catalog.pg_class c on c.oid = tg.tgrelid
      join pg_catalog.pg_proc p on p.oid = tg.tgfoid
     where c.relname = 'tenant_bloc_creancier'
       and tg.tgname = 'tenant_bloc_creancier_audit'
       and p.proname = 'auditer_atelier'
       and not tg.tgisinternal
  ) then
    raise exception '0016 : trigger tenant_bloc_creancier_audit absent ou ne pointe pas vers auditer_atelier().';
  end if;

  -- 3. Le trigger est bien AFTER INSERT/UPDATE/DELETE, FOR EACH ROW (tgtype bitmask :
  --    ROW=1, INSERT=4, DELETE=8, UPDATE=16 ; AFTER = absence du bit BEFORE=2).
  if not exists (
    select 1
      from pg_catalog.pg_trigger tg
      join pg_catalog.pg_class c on c.oid = tg.tgrelid
     where c.relname = 'tenant_bloc_creancier'
       and tg.tgname = 'tenant_bloc_creancier_audit'
       and (tg.tgtype & 1) = 1   -- ROW
       and (tg.tgtype & 2) = 0   -- AFTER (pas BEFORE)
       and (tg.tgtype & 4) = 4   -- INSERT
       and (tg.tgtype & 8) = 8   -- DELETE
       and (tg.tgtype & 16) = 16 -- UPDATE
  ) then
    raise exception '0016 : tenant_bloc_creancier_audit n''est pas exactement AFTER INSERT OR UPDATE OR DELETE FOR EACH ROW.';
  end if;
end
$$;
