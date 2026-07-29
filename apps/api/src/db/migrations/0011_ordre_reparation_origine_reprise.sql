-- =============================================================================================
-- 0011_ordre_reparation_origine_reprise.sql — Z-17 : `ordre_reparation` n'avait nulle part où
-- déposer le numéro d'un OR repris depuis Auto-i/Nextlane.
--
-- CONSTAT (remonté par l'agent de reprise de données pendant la conception de 0010) : `0010`
-- pose `document_vente.origine` + `numero_origine` (MD-01→MD-06) mais **`ordre_reparation` n'a
-- reçu ni l'un ni l'autre** — alors que le modèle documentaire de facturation l'anticipait déjà
-- (`AC-11`, §7.2 : « les OR repris entrent en `cloture` avec leur numéro d'origine et ne
-- consomment pas le compteur »), et que ce point d'accroche n'a pas été posé en étape 1 (0008).
-- Conséquence si on ne le fait pas maintenant : au premier import réel d'un garage, chaque OR
-- repris perd la correspondance avec le papier classé pendant des années, ou entre de force dans
-- la série DFA — les deux mauvais. Aujourd'hui la table est vide : c'est un ALTER TABLE additif
-- sans coût ; après la première bascule, ce serait un rétro-remplissage sur des lignes réelles,
-- avec une valeur par défaut ('dfa') qu'on ne pourrait plus distinguer d'une vraie origine DFA.
--
-- DÉCISION : REPREND EXACTEMENT LE MOTIF DE `document_vente` (0010 §1/§7), pour ne pas payer deux
-- conventions divergentes à chaque requête de réconciliation :
--   - même enum, réutilisé tel quel : `public.origine_document` ('dfa' | 'reprise'). Un OR n'est
--     pas un « document » au sens de la chaîne de vente, mais la notion — de nous ou importé —
--     est strictement la même ; un deuxième enum à deux valeurs identiques aurait été la
--     définition même de la divergence que cette migration doit éviter.
--   - même sémantique : `numero_origine` = la chaîne source VERBATIM (MD-04), jamais retouchée
--     (aucun zéro de tête retiré, aucun préfixe supprimé) ; `numero` (déjà `not null` depuis 0008)
--     reste le numéro AFFICHÉ — pour un OR repris, c'est au chargeur d'import de choisir sa forme
--     affichable, cette migration ne l'impose pas.
--   - même unicité, adaptée : `document_vente` la scope aussi par `type_document` (quatre séries
--     partagent une table) ; `ordre_reparation` n'a qu'UNE série par tenant (`ordre_reparation_
--     tenant_numero_uk` existant, 0008), donc `unique (tenant_id, numero_origine)` suffit —
--     ajouter une dimension `type` inventerait une contrainte que rien ne demande.
--
-- CE QUI N'EST PAS REPRIS ICI, VOLONTAIREMENT :
--   - `numero_sequence` séparé de `numero` (MD-03) : `ordre_reparation` n'a jamais eu cette
--     distinction (une seule colonne `numero`, `not null` dès la création, pas de `numero_
--     sequence` propre) — l'introduire ici serait une extension non demandée, hors du périmètre
--     de ce constat.
--   - `numero_normalise` (colonne générée, MD-06) : `document_vente` en a besoin pour la
--     recherche comptoir sur QUATRE séries hétérogènes (devis/bon_commande/facture/avoir) ; la
--     recherche d'OR existe déjà par ses propres moyens (étape 1) — ajouter une colonne de
--     recherche ici déborderait du constat Z-17, qui porte sur l'origine et le numéro, pas sur
--     l'indexation.
--   - `origine_lot_id` (mentionné par `AC-11` du modèle documentaire) : aucune table `lot_import`
--     n'existe encore dans ce dépôt (la reprise de données n'a pas sa propre migration ici) —
--     poser une colonne sans cible reviendrait à deviner un schéma qui n'est pas le mien à
--     décider. Signalé pour `expert-migration-donnees`, pas ajouté.
--
-- VÉHICULE ET CLIENT (demandés explicitement par le coordinateur) :
--   - `vehicule` N'EST PAS aligné. Un véhicule n'a pas de numéro séquentiel émis par l'ancien
--     DMS à préserver : son identifiant stable et déjà universel est le VIN (`vehicule.vin`,
--     0007), et la plaque est déjà historisée (`vehicule_plaque`, EXCLUDE par période). Il n'y a
--     rien d'analogue à un « numéro de facture » ou un « numéro d'OR » à retrouver sur un
--     document papier. Si un besoin réel apparaît (ex. un identifiant interne Auto-i sans
--     équivalent DFA), c'est une question pour `expert-migration-donnees`, pas une extrapolation
--     de ma part.
--   - `client` N'EST PAS aligné : `D-26` (reprise de données) est une décision OUVERTE, portée
--     par l'agent de reprise, pas par cette migration — « un numéro de client n'a pas de valeur
--     légale, contrairement à un numéro de facture » est son argument, pas le mien à trancher.
--     Cette migration ne préjuge pas de l'issue de `D-26` : si la réponse est oui, `client`
--     recevra son propre `origine`/`numero_origine` dans une migration future, sur ce même motif.
--
-- Réversible : migrations/down/0011_ordre_reparation_origine_reprise.down.sql — essayé
-- up → down → up sur base réelle (voir rapport de livraison).
-- =============================================================================================

alter table public.ordre_reparation
  add column origine        public.origine_document not null default 'dfa',
  add column numero_origine text null;

alter table public.ordre_reparation
  add constraint ordre_reparation_origine_numero_origine_chk
  check ((origine = 'dfa') = (numero_origine is null));

-- Idempotence de l'import (même raison que document_vente_numero_origine_uk, MD-06 index #3) :
-- un numéro source ne peut pas être importé deux fois. Pas de dimension `type` : une seule série
-- de numérotation d'OR par tenant (ordre_reparation_tenant_numero_uk, 0008).
create unique index ordre_reparation_numero_origine_uk
  on public.ordre_reparation (tenant_id, numero_origine)
 where numero_origine is not null;

comment on column public.ordre_reparation.origine is
  'Z-17/AC-11 : dfa (créé par DFA) ou reprise (importé). Même enum, même sémantique que '
  'document_vente.origine (0010) — voir 0011_ordre_reparation_origine_reprise.sql.';
comment on column public.ordre_reparation.numero_origine is
  'Z-17/AC-11/MD-04 : numéro source VERBATIM d''un OR repris, jamais retouché. NULL pour un OR '
  'DFA. numero (déjà not null) reste le numéro affiché.';


-- ---------------------------------------------------------------------------------------------
-- Assertions de fin de migration
-- ---------------------------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1 from public.ordre_reparation where origine = 'reprise' and numero_origine is null
  ) then
    raise exception '0011 : au moins un ordre_reparation origine=reprise sans numero_origine.';
  end if;

  if exists (
    select 1 from public.ordre_reparation where origine = 'dfa' and numero_origine is not null
  ) then
    raise exception '0011 : au moins un ordre_reparation origine=dfa avec un numero_origine renseigné.';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'ordre_reparation' and column_name = 'origine'
  ) then
    raise exception '0011 : ordre_reparation.origine manquante après migration.';
  end if;
end
$$;
