-- =============================================================================================
-- 0016_audit_tenant_bloc_creancier.down.sql — annulation de
-- 0016_audit_tenant_bloc_creancier.sql
--
-- Ordre inverse de la migration up : le commentaire de table restauré à son texte de 0014
-- (mot pour mot — down annule la CORRECTION de 0016, pas 0014 elle-même, déjà appliquée et
-- immuable, même logique que 0012.down/0013.down/0014.down), puis le trigger retiré.
--
-- LIMITE POSTGRESQL ASSUMÉE ET NON CONTOURNÉE — DOCUMENTÉE ICI, PAS DÉCOUVERTE PAR SURPRISE :
-- la valeur `tenant_bloc_creancier` ajoutée à `entite_auditee` par 0016 §1 (ALTER TYPE ... ADD
-- VALUE) NE PEUT PAS être retirée par ce down. PostgreSQL n'offre aucun « DROP VALUE » sur un
-- type enum — seulement une recréation complète du type (renommage, recréation, migration de
-- TOUTES les colonnes qui l'utilisent, dont `audit_atelier`, partitionnée sur 25 partitions
-- depuis 0004 et potentiellement déjà en production à l'étape 2). Une telle opération est plus
-- risquée que ce qu'elle répare : elle toucherait une table de production pour annuler l'ajout
-- d'un seul libellé qui, seul, ne change aucun comportement observable une fois le trigger
-- retiré ci-dessous — un enum élargi sans le trigger qui produirait des lignes le portant ne
-- produit plus jamais de ligne d'audit sous cette valeur. Exactement le précédent de 0010 §down
-- (six valeurs alors, une ici), pas une exception nouvelle. Ce down laisse donc la valeur dans le
-- type, documentée ici pour qu'un futur lecteur ne la découvre pas par surprise dans
-- `\dT+ entite_auditee`.
-- =============================================================================================


-- ---------------------------------------------------------------------------------------------
-- 1. Commentaire de table restauré au texte exact de 0014 (avant l'ajout de la phrase d'audit).
-- ---------------------------------------------------------------------------------------------

comment on table public.tenant_bloc_creancier is
  'Bloc créancier du QR-facture (RF-54/PF-03) : adresse structurée à 7 champs du garage plus ses '
  'comptes bancaires. Un au plus par TENANT (jamais par site, arbitrage @laupernoe 30.07.2026) — voir '
  'tenant_bloc_creancier_tenant_id_uk. Toutes les colonnes sont nullables : un créancier '
  'incomplet ne bloque JAMAIS la création du tenant, seulement l''ÉMISSION d''une facture '
  '(CHAMPS_REQUIS_BLOC_CREANCIER, facturation/qr/adresse.ts, contrôle applicatif). '
  '`iban`/`qr_iban` sont deux comptes distincts et indépendants, jamais un seul champ qui jouerait '
  'les deux rôles — lequel gouverne une émission donnée est une décision applicative '
  '(determinerTypeReference, facturation/qr/iban.ts), pas un fait figé en base.';


-- ---------------------------------------------------------------------------------------------
-- 2. Trigger d'audit retiré — la table repasse au seul horodatage (0014), sans piste d'audit.
--    C'EST LE COMPORTEMENT ATTENDU D'UN DOWN : il annule la correction, pas un bug (même logique
--    que 0012.down/0013.down) — un DOWN qui laisserait le trigger poserait un schéma qui ne
--    correspond plus au fichier up qu'il prétend défaire.
-- ---------------------------------------------------------------------------------------------

drop trigger if exists tenant_bloc_creancier_audit on public.tenant_bloc_creancier;
