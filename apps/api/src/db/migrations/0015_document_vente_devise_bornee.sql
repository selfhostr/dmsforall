-- =============================================================================================
-- 0015_document_vente_devise_bornee.sql — corrige l'incohérence relevée entre les trois colonnes
-- de devise de la facturation (migration 0010, vérifiée) :
--
--   - paiement.devise            → check (devise in ('CHF', 'EUR'))                    — borné
--   - document_vente.qr_devise   → check (qr_devise is null or qr_devise in (...))      — borné
--   - document_vente.devise      → check (devise ~ '^[A-Z]{3}$')                        — FORME
--     SEULEMENT : 'USD', 'GBP', n'importe quel code ISO à trois lettres majuscules passait.
--
-- Un document de vente libellé dans une devise que paiement.devise interdit est structurellement
-- IMPAYABLE (il ne peut jamais être encaissé), et le QR-facture n'accepte de toute façon que
-- CHF/EUR. Le contrat d'API (`ReponseDocumentVente['devise']`, `@dfa/shared`) annonçait déjà
-- `'CHF' | 'EUR'` — le code applicatif (`facturation/documents/mappeurs.ts`) devait donc combler
-- l'écart par une validation runtime (`deviseFacturationDepuisBase`) que la base aurait dû
-- garantir elle-même. Arbitrage @laupernoe : `document_vente.devise` doit être borné à ('CHF', 'EUR'),
-- comme les deux autres colonnes. Pas rouvert ici.
--
-- AUTRES COLONNES DEVISE DU SCHÉMA : recherche faite (`grep -rn devise` sur
-- `apps/api/src/db/schema/`) — seules trois colonnes existent au total : `paiement.devise`,
-- `document_vente.qr_devise` (déjà bornées toutes les deux), et `document_vente.devise` (corrigée
-- ici). Aucune autre colonne devise dans le schéma.
--
-- MESURE AVANT RESSERREMENT (un resserrement de CHECK est la direction dangereuse : une ligne
-- existante qui viole la nouvelle contrainte fait échouer la migration) :
--   select devise, count(*) from public.document_vente group by devise;  →  0 ligne au total
--   (table entièrement vide sur dfa_dev à ce jour — vérifié, pas supposé).
--
-- CHOIX DE GESTE — CHECK simple plutôt que NOT VALID + VALIDATE CONSTRAINT séparés :
--   NOT VALID/VALIDATE CONSTRAINT existe pour éviter qu'un ADD CONSTRAINT sur une grosse table de
--   PRODUCTION ne tienne un verrou bloquant pendant tout le scan de validation — l'intérêt vient
--   de faire porter VALIDATE CONSTRAINT (verrou plus léger, SHARE UPDATE EXCLUSIVE) dans une
--   transaction SÉPARÉE de l'ADD CONSTRAINT ... NOT VALID (quasi instantané). Or `migrer.ts`
--   enveloppe CHAQUE fichier de migration dans une unique transaction BEGIN/COMMIT (voir
--   apps/api/src/db/migrer.ts) : NOT VALID suivi d'un VALIDATE CONSTRAINT dans CE fichier
--   resterait dans la MÊME transaction que l'ADD CONSTRAINT, donc verrouillerait exactement aussi
--   longtemps qu'un CHECK simple, pour une complexité en plus et aucun bénéfice réel — la finesse
--   de NOT VALID ne s'exprime que si VALIDATE CONSTRAINT peut être rejoué dans une migration/
--   transaction ultérieure distincte, ce que ce runner ne permet pas. Combiné au fait que la table
--   est vide et qu'aucun tenant n'est encore en production (le premier arrive à l'étape 2, donc
--   après cette migration) : le CHECK simple est le geste juste ici, pas une précaution rituelle
--   court-circuitée. Si une future migration doit un jour resserrer une colonne de ce calibre sur
--   une table réellement peuplée en production, NOT VALID + VALIDATE CONSTRAINT redevient
--   pertinent — mais seulement si le VALIDATE peut être isolé dans son propre fichier/transaction.
--
-- Non destructif au sens du contrat de ce dépôt : la table est vide, donc aucune perte de donnée
-- réelle ; la contrainte remplacée (`document_vente_devise_format_chk`) est visible dans le down
-- pour permettre un retour exact à l'état d'avant 0015.
--
-- Réversible : migrations/down/0015_document_vente_devise_bornee.down.sql.
-- =============================================================================================

alter table public.document_vente
  drop constraint document_vente_devise_format_chk;

alter table public.document_vente
  add constraint document_vente_devise_chk check (devise in ('CHF', 'EUR'));


-- ---------------------------------------------------------------------------------------------
-- Assertions de fin de migration
-- ---------------------------------------------------------------------------------------------

do $$
begin
  -- 1. L'ancienne contrainte (forme seulement) a bien disparu.
  if exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid = 'public.document_vente'::regclass
       and conname = 'document_vente_devise_format_chk'
  ) then
    raise exception '0015 : document_vente_devise_format_chk encore présente après migration.';
  end if;

  -- 2. La nouvelle contrainte existe, VALIDÉE (pas NOT VALID — voir choix de geste ci-dessus),
  -- et porte exactement l'ensemble CHF/EUR.
  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid = 'public.document_vente'::regclass
       and conname = 'document_vente_devise_chk'
       and contype = 'c'
       and convalidated
       and pg_get_constraintdef(oid) = 'CHECK ((devise = ANY (ARRAY[''CHF''::bpchar, ''EUR''::bpchar])))'
  ) then
    raise exception '0015 : document_vente_devise_chk absente, non validée, ou définition inattendue.';
  end if;

  -- 3. Aucune ligne existante ne viole la nouvelle contrainte (l'ADD CONSTRAINT ci-dessus l'aurait
  -- de toute façon empêché — assertion redondante mais bon marché, cohérente avec le reste du
  -- dépôt qui préfère un message explicite à laisser l'échec natif de PostgreSQL parler seul).
  if exists (
    select 1 from public.document_vente where devise not in ('CHF', 'EUR')
  ) then
    raise exception '0015 : au moins un document_vente.devise hors CHF/EUR après migration — ne devrait jamais arriver, l''ADD CONSTRAINT aurait dû le bloquer.';
  end if;
end
$$;
