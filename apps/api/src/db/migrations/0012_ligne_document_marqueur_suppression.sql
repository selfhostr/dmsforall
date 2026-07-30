-- =============================================================================================
-- 0012_ligne_document_marqueur_suppression.sql — corrige le refus de démarrage constaté sur la
-- base migrée : « table « ligne_document » : le rôle « dfa_app » détient DELETE sans déclaration. »
--
-- CONSTAT : `0010_facturation.sql` §8 accorde bien DELETE à `dfa_app` sur `ligne_document`
-- (`grant select, insert, update, delete on public.ligne_document to dfa_app`, avec le
-- commentaire de code juste au-dessus : « MD-21 : DELETE accordé (à la différence de ligne_or),
-- le trigger §8.1 le bloque dès que le document parent n'est plus brouillon. ») — mais le
-- `comment on table public.ligne_document` posé dans la même migration ne porte AUCUN marqueur
-- `[dfa:suppression-physique]` (0002_posture_declaree.sql §2). `verifierPostureRls()` (démarrage
-- de l'API) ne lit que le commentaire réellement posé en base, jamais les commentaires SQL du
-- fichier de migration : la justification existait dans le texte du `.sql`, mais pas là où le
-- contrôle la cherche. Vérifié : aucune autre table de 0010/0011 n'a le même défaut — grep sur
-- « grant … delete » dans les deux fichiers ne remonte que `ligne_document` ; toutes les autres
-- tables font `revoke delete on … from dfa_app` explicitement (periode_comptable, document_vente,
-- paiement, mapping_compte, mapping_code_tva, correspondance_externe, export_comptable).
--
-- DÉCISION : DÉLIBÉRÉ, pas accidentel — le DELETE reste accordé, cette migration ne fait
-- qu'ajouter la déclaration manquante.
--   - Le privilège est UTILE et VOULU : une ligne saisie par erreur au comptoir (mauvaise
--     prestation choisie, doublon, mauvais véhicule) sur un document encore en BROUILLON — donc
--     jamais montré au client, sans aucune valeur légale — doit pouvoir disparaître plutôt que de
--     polluer un devis ou une facture qui sera imprimé. C'est le même besoin que celui qui a
--     justifié 0009_ligne_or_annulation_precoce.sql pour `ligne_or` (annulation précoce), à ceci
--     près que `ligne_document` en brouillon n'a même pas besoin d'un état « annulée » : la ligne
--     n'a encore rien engagé, elle se retire.
--   - Le verrou qui rend ce DELETE SANS DANGER sur un document ÉMIS existe déjà, posé dans la
--     même migration 0010 §8.1 : le trigger `ligne_document_verrouiller_document`
--     (`before insert or update or delete on public.ligne_document`, fonction
--     `public.ligne_document_verrouiller_document()`) relit `document_vente.statut` pour le
--     document parent à CHAQUE opération — y compris DELETE, tg_op géré explicitement en fin de
--     fonction — et lève `ZDFA2` dès que ce statut n'est PAS `'brouillon'`. Le privilège GRANT
--     est donc une condition nécessaire mais jamais suffisante : la table refuse elle-même toute
--     suppression sur un document non-brouillon, avant même que le service applicatif ne soit
--     consulté. C'est la vérification demandée : « qu'est-ce qui empêche de supprimer une ligne
--     d'un document émis » — réponse : ce trigger, déjà en place, pas ajouté ici.
--   - Ce comportement est d'ailleurs le miroir volontaire de `ligne_or` (RM-71, 0008) : DELETE
--     y est révoqué EN PERMANENCE (pas de brouillon en atelier au sens documentaire), alors que
--     `ligne_document` a un état brouillon où la suppression physique est légitime et un état
--     émis où elle est structurellement impossible. Les deux tables suivent donc des postures
--     différentes pour des raisons différentes — ce n'est pas un oubli sur l'une par rapport à
--     l'autre.
--
-- Non destructif : un seul `comment on table` (REMPLACE le commentaire existant — on recopie donc
-- le texte de 0010 in extenso, en y ajoutant le marqueur, jamais on ne réécrit 0010 elle-même,
-- déjà appliquée et immuable). Aucune colonne, contrainte, trigger ni privilège n'est touché : le
-- privilège DELETE constaté par le rapport de démarrage était déjà correct, seule sa déclaration
-- manquait.
--
-- Réversible : migrations/down/0012_ligne_document_marqueur_suppression.down.sql — restaure le
-- commentaire de 0010 mot pour mot, sans le marqueur (donc redémarrage bloqué par le même contrôle
-- après un down, ce qui est le comportement attendu : down annule la CORRECTION, pas le bug).
-- =============================================================================================

comment on table public.ligne_document is
  'Ligne d''un document de vente. Figée avec le reste dès que le document parent quitte '
  '''brouillon'' — voir ligne_document_verrouiller_document. §0.2 : prix_unitaire_centimes est un '
  'montant TTC, ht_centimes est le résidu ttc − tva (jamais recalculé séparément). '
  '[dfa:suppression-physique] DELETE accordé à dfa_app (0010 §8) : une ligne saisie par erreur '
  'sur un document encore en BROUILLON doit pouvoir disparaître avant d''être montrée au client, '
  'plutôt que de polluer un devis ou une facture imprimés — à la différence de ligne_or (RM-71), '
  'verrouillée en permanence. Sans danger sur un document ÉMIS : le trigger '
  'ligne_document_verrouiller_document (BEFORE INSERT OR UPDATE OR DELETE, 0010 §8.1) relit '
  'document_vente.statut à chaque opération, DELETE compris, et lève ZDFA2 dès que ce statut '
  'n''est plus ''brouillon'' — la suppression est donc bloquée en base avant même d''atteindre le '
  'privilège, pas seulement côté service.';


-- ---------------------------------------------------------------------------------------------
-- Assertions de fin de migration
-- ---------------------------------------------------------------------------------------------

do $$
declare
  fautives text;
begin
  -- 1. Le marqueur est bien posé, et resterait détecté même si le vocabulaire de
  -- acces-base.service.ts évoluait de forme (recherche textuelle simple, indépendante du regex
  -- applicatif — c'est une preuve grossière mais suffisante pour cette migration).
  if not exists (
    select 1
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = 'ligne_document'
       and coalesce(obj_description(c.oid, 'pg_class'), '') like '%[dfa:suppression-physique]%'
  ) then
    raise exception '0012 : marqueur [dfa:suppression-physique] absent du commentaire de ligne_document après migration.';
  end if;

  -- 2. Le privilège que le marqueur déclare est bien celui réellement détenu — ni plus (la
  -- déclaration ne doit pas mentir par excès), ni moins (sinon le marqueur serait sans objet).
  if not has_table_privilege('dfa_app', 'public.ligne_document', 'DELETE') then
    raise exception '0012 : dfa_app n''a plus DELETE sur ligne_document — le marqueur posé n''aurait plus d''objet.';
  end if;

  -- 3. Le verrou cité dans la justification existe réellement et couvre bien DELETE : c'est lui,
  -- et non ce commentaire, qui rend le privilège sans danger sur un document émis.
  if not exists (
    select 1
      from pg_catalog.pg_trigger t
      join pg_catalog.pg_class c on c.oid = t.tgrelid
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = 'ligne_document'
       and t.tgname = 'ligne_document_verrouiller_document'
       and not t.tgisinternal
       and (t.tgtype & (1 << 3)) <> 0   -- bit DELETE de pg_trigger.tgtype
  ) then
    raise exception '0012 : trigger ligne_document_verrouiller_document introuvable ou ne couvre pas DELETE — le DELETE ne serait plus sans danger.';
  end if;

  -- 4. Ceinture et bretelles, sur le modèle de 0002 §4.1 : aucune AUTRE table de 0010/0011 ne
  -- doit avoir le même défaut (DELETE détenu sans marqueur). Si le garde-fou de démarrage s'était
  -- arrêté au premier défaut rencontré, celui-ci le révèle ici plutôt qu'au prochain redémarrage.
  select string_agg(c.oid::regclass::text, ', ' order by c.oid::regclass::text)
    into fautives
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind in ('r', 'p')
     and has_table_privilege('dfa_app', c.oid, 'DELETE')
     and coalesce(obj_description(c.oid, 'pg_class'), '') not like '%[dfa:suppression-physique]%';

  if fautives is not null then
    raise exception '0012 : DELETE subsiste pour dfa_app sur % sans marqueur [dfa:suppression-physique].', fautives;
  end if;
end
$$;
