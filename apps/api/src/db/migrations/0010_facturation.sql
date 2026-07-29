-- =============================================================================================
-- 0010_facturation.sql — étape 2 : facturation (chaîne devis→bon de commande→facture→avoir,
-- numérotation légale, paiements/lettrage, QR-facture, export fiduciaire).
--
-- Jalon : fin d'étape 2 = premier premier garage en production réelle. Source de vérité métier :
-- docs/specification-etape-2-facturation.md (RF-1→RF-120) et docs/modele-documentaire-
-- facturation.md (MD-01→MD-95, PF-xx, QF-xx, CF-xx). Cette migration ne tranche AUCUNE des douze
-- hypothèses ⚠️ À VALIDER du §11.1 de la spécification, à deux exceptions près tranchées par @laupernoe
-- le 29.07.2026 et intégrées ici (voir §0.2 ci-dessous) :
--   - RF-83 (facturation/restitution indépendantes) : la table de transitions de l'OR gagne
--     UNIQUEMENT une ligne (restitue → facture) ; aucune contrainte n'exige un document soldé
--     pour restituer un véhicule, dans aucun sens.
--   - RF-40 (montants toujours saisis et affichés TTC) : voir §0.2.
-- Les dix autres hypothèses restent ouvertes ; chaque endroit qu'elles affectent est signalé par
-- un commentaire « ⚠️ RF-xx ». Rien n'est codé en dur qui présumerait de leur issue.
--
-- 0. CE QUI EST DÉCIDÉ ET POSÉ ICI, EN UNE PHRASE CHACUN
--   1. Chaîne documentaire immuable devis→bon_commande→facture→avoir : `document_vente`,
--      `ligne_document`, `document_vente_tva`. Verrouillage en BASE (trigger BEFORE UPDATE avec
--      liste blanche de colonnes, MD-20), pas seulement côté service.
--   2. Numérotation continue par tenant/exercice/[site], sans trou, garantie par une ligne de
--      compteur verrouillée en transaction (`compteur_document`, déjà posée en 0005 — cette
--      migration y ajoute `valeur_depart`, MD-26/AC-17). Aucune SEQUENCE PostgreSQL.
--   3. Argent en centimes entiers (`integer` par ligne plafonné à ±CHF 1'000'000 comme `ligne_or`,
--      `bigint` pour les agrégats de document comme `ordre_reparation.total_valide_centimes`).
--      TVA stockée PAR LIGNE, jamais recalculée sur le total.
--   4. `tenant_id` NOT NULL + RLS FORCE + politique `tenant_courant()` sur chaque table, FK
--      composites `(tenant_id, x) → cible(tenant_id, id)`, UUID, timestamptz, enums PG.
--   5. Audit : `entite_auditee` gagne six valeurs (document_vente, paiement, imputation_paiement,
--      periode_comptable, export_comptable, mapping_compte) et réutilise `audit_atelier` /
--      `auditer_atelier()` (0004) — même dispositif que l'OR, pas une deuxième implémentation
--      (AC-25).
--   6. Réversible, expand/contract : aucune table 0000→0009 n'est réécrite. `compteur_document`
--      et `ligne_or` reçoivent des ALTER TABLE additifs (colonne nullable / FK différée), sur le
--      modèle du §8 de 0008_atelier.sql.
--
-- 0.1 SQLSTATE — extension de la famille produit posée par 0003 §6 :
--     ZDFA1  transition d'état interdite            (déjà posé, réutilisé ici sans changement)
--     ZDFA2  écriture sur une entité verrouillée     (déjà posé, réutilisé ici sans changement)
--     ZDFA3  modification d'un champ figé            (déjà posé, réutilisé ici sans changement)
--     ZDFA4  invariant financier violé               (NOUVEAU — imputation > document/paiement,
--            somme des avoirs > facture, ligne d'OR facturée deux fois)
--     ZDFA5  émission refusée hors transition         (NOUVEAU — période comptable close, bloc
--            créancier QR incomplet)
--
-- 0.2 RF-40, décidé par @laupernoe le 29.07.2026 (message reçu en cours de conception, PAS dans la spec
-- écrite) : les prix sont TOUJOURS saisis et affichés TTC, y compris pour les entreprises — « 450
-- francs, tout compris ». `ligne_document.mode_calcul_tva` reste un enum à deux valeurs (`ht`,
-- `ttc`), sur le même patron Δ que `parametre_atelier.controle_qualite` (0005, Δ3) : le type PG
-- reste complet pour ne pas imposer une migration d'enum si @laupernoe rouvre un jour un mode HT en
-- B2B, mais un CHECK restreint le lot pilote à `ttc` seul. Conséquence arithmétique, documentée
-- au plus près de la table (§3 ci-dessous) : le prix unitaire stocké est un montant TTC, la TVA
-- est dérivée par `arrondiCommercial(ttc × taux, 1000 + taux)`, et le HT est le RÉSIDU exact
-- `ttc − tva` — jamais recalculé séparément. `ttc = ht + tva` tient donc par construction, ligne
-- par ligne, et se propage à la somme (CHECK `ligne_document_montant_coherent_chk` et
-- `document_vente_totaux_coherents_chk`). Cette décision est IRRATTRAPABLE après coup (spec
-- §11.1 point 2) : elle est donc posée dans cette migration, pas laissée en accroche.
--
-- 0.3 Ce qui N'EST PAS tranché ici (dix hypothèses ⚠️ restantes, spec §11.1) — repéré par
-- « ⚠️ RF-xx » au plus près de la colonne ou de la contrainte concernée : Abacus hors périmètre
-- (RF, §0.3 spec — n'affecte que `cible_export`, qui liste `abacus` quand même, coût nul, sur le
-- modèle des enums « modules absents du lot 1 » de 0005), consigne d'échange standard (RF-100),
-- commissions carte/TWINT (RF-75), vocabulaire « demande d'accord » (RF-2, hors DB), facture sans
-- bulletin au comptoir (RF-62, hors DB), escompte pratiqué ou non (RF-48), arrondi 5 centimes
-- actif par défaut (RF-52), mention DUPLICATA (RF-19, hors DB), facturation en EUR (RF-58),
-- traductions DE/IT (RF-3, hors DB, `expert-i18n`).
--
-- Prend modèle sur 0008_atelier.sql pour le style, le patron RLS et la table de transitions.
-- Réversible : migrations/down/0010_facturation.down.sql.
-- =============================================================================================


-- ---------------------------------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------------------------------

-- MD-01 : deux populations, une seule table. Pas de troisième valeur.
create type public.origine_document as enum ('dfa', 'reprise');

-- MD-11 : quatre séries de numérotation indépendantes.
create type public.type_document_vente as enum ('devis', 'bon_commande', 'facture', 'avoir');

-- MD-12 : la facture d'acompte n'est pas un cinquième type, c'est une facture de cette nature.
create type public.nature_facture as enum ('ordinaire', 'acompte');

-- MD-15 : union des états atteignables par les quatre types de document_vente. Chaque
-- type_document n'atteint qu'un sous-ensemble — imposé par transition_document_autorisee
-- (§4 ci-dessous), pas par ce type lui-même (une seule table document_vente pour les quatre
-- types, RF-1→RF-19). Ordre = ordre du cycle de vie, jamais alphabétique (0003 §3).
create type public.statut_document_vente as enum (
  'brouillon',
  'emis',
  'accepte',          -- devis
  'refuse',           -- devis
  'expire',           -- devis
  'remplace',         -- devis
  'transforme',       -- bon_commande
  'annule',           -- bon_commande
  'annule_par_avoir', -- facture (RF-32 : garde son numéro et sa place dans la série)
  'abandonne'         -- tous (MD-19 : un brouillon ne se supprime pas, il s'abandonne)
);

-- MD-16 : dérivé, maintenu par trigger depuis imputation_paiement. Jamais écrit à la main.
create type public.statut_reglement_document as enum (
  'non_regle', 'partiel', 'regle', 'trop_percu', 'irrecouvrable'
);

-- MD-37 : le taux seul ne suffit pas — exonere et exclu valent tous deux 0 ‰ et se déclarent
-- différemment. marge = documents repris antérieurs à 2018 (imposition de la marge, abrogée au
-- 01.01.2018, MD-68). acquisition = impôt sur les acquisitions.
create type public.regime_tva as enum (
  'normal', 'reduit', 'hebergement', 'exonere', 'exclu', 'marge', 'acquisition'
);

-- MD-43 / §0.2 ci-dessus : type PG complet, restreint à 'ttc' par CHECK pour le lot pilote
-- (Δ-RF40, décision @laupernoe du 29.07.2026 — sur le même patron que Δ3/controle_qualite, 0005).
create type public.mode_calcul_tva as enum ('ht', 'ttc');

-- Type de ligne du DOCUMENT (pas de l'OR) : proche de type_ligne_or (étape 1, contrat gelé) mais
-- volontairement un enum SÉPARÉ. Deux raisons : (1) 'remise' de type_ligne_or n'est jamais
-- produit en facturation (RF-45 — DFA ventile toujours, MD-59) et un enum partagé aurait exigé un
-- CHECK d'exclusion permanent sur une valeur qui ne doit jamais apparaître ici ; (2) la
-- facturation a ses propres types sans équivalent atelier (acompte_deduit, repartition, consigne,
-- ecart_reprise). Coupler les deux enums aurait lié le contrat gelé de l'étape 1 aux évolutions
-- de l'étape 2.
create type public.type_ligne_document as enum (
  'main_oeuvre_bareme', 'main_oeuvre_temps_reel', 'forfait', 'piece', 'fourniture',
  'sous_traitance', 'produit_atelier', 'taxe', 'texte',
  'acompte_deduit',   -- MD-55, montant négatif obligatoire, document_acompte_id obligatoire
  'repartition',      -- MD-63 : franchise, prise en charge partielle par un tiers
  'consigne',         -- RF-100 — ⚠️ RF-100 (pratique et taux applicable non confirmés)
  'ecart_reprise'     -- MD-08 : absorbe l'écart entre Σ lignes et total stocké d'un document repris
);

-- MD-50.
create type public.nature_imputation as enum ('reglement', 'escompte', 'arrondi', 'perte', 'compensation');
create type public.moyen_paiement as enum (
  'especes', 'carte', 'virement', 'qr', 'twint', 'compensation', 'leasing'
);
create type public.paiement_source as enum ('manuel', 'camt054', 'terminal');

-- RF-15 : liste courte, 'autre' avec texte libre obligatoire (contrôlé par CHECK sur la table).
create type public.motif_avoir as enum (
  'erreur_adresse', 'erreur_montant', 'erreur_destinataire', 'erreur_taux',
  'prestation_annulee', 'geste_commercial', 'autre'
);
create type public.portee_avoir as enum ('total', 'partiel');

-- MD-74.
create type public.type_reference_qr as enum ('qrr', 'scor', 'non');

-- MD-82.
create type public.motif_bulletin_paiement as enum ('facture', 'solde', 'relance', 'creance_reprise');

-- MD-84/88/91.
create type public.statut_export_comptable as enum ('genere', 'transmis', 'accepte', 'rejete');
create type public.mode_agregation_export as enum ('detaille', 'agrege');
-- ⚠️ RF (§0.3 spec) : Abacus hors périmètre de l'étape 2 (adaptateur non écrit) mais la valeur
-- existe dans l'enum au même coût que les « modules absents du lot 1 » de 0005 §1 — un type
-- déclaré et non câblé ne coûte rien, et l'inverser si le pilote est sur Abacus n'impose pas de
-- migration d'enum.
create type public.cible_export as enum ('bexio', 'winbiz', 'abacus', 'banana', 'csv');
create type public.usage_mapping_compte as enum (
  'creances_clients', 'produit', 'tva_due', 'acomptes_recus',
  'financier', 'arrondi', 'escompte', 'perte', 'ecart_reprise'
);


-- ---------------------------------------------------------------------------------------------
-- 2. Extension de `entite_auditee` (0003) — AC-25 : même dispositif d'audit que l'OR
--
-- ALTER TYPE ... ADD VALUE est un ordre TOP-LEVEL, jamais dans un bloc DO/fonction, et sa valeur
-- ne doit JAMAIS être comparée (=, tri, index) dans CETTE MÊME transaction de migration — voir
-- l'en-tête de ce fichier. Les usages qui suivent (CREATE TRIGGER ... execute function
-- auditer_atelier('document_vente')) sont sans risque : l'argument de trigger est stocké comme
-- TEXTE (pg_trigger.tgargs), le cast vers entite_auditee n'a lieu qu'à l'exécution du trigger,
-- dans une transaction ultérieure au COMMIT de cette migration.
-- ---------------------------------------------------------------------------------------------

-- `IF NOT EXISTS` : pas pour un rejeu normal (le runner ne rejoue jamais une migration déjà
-- suivie dans __dfa_migrations, voir migrer.ts), mais parce que le DOWN de cette migration ne
-- PEUT PAS retirer ces valeurs (Postgres n'a pas de « DROP VALUE », voir down/0010_facturation.
-- down.sql) — sans IF NOT EXISTS, un cycle up→down→up échouerait dès le second up.
alter type public.entite_auditee add value if not exists 'document_vente';
alter type public.entite_auditee add value if not exists 'paiement';
alter type public.entite_auditee add value if not exists 'imputation_paiement';
alter type public.entite_auditee add value if not exists 'periode_comptable';
alter type public.entite_auditee add value if not exists 'export_comptable';
alter type public.entite_auditee add value if not exists 'mapping_compte';


-- ---------------------------------------------------------------------------------------------
-- 3. `compteur_document` — expand : MD-26/AC-17, `valeur_depart`
--
-- Sans elle, la preuve de continuité (§2.4 du modèle) est ininterprétable après une reprise : elle
-- constaterait qu'il manque N factures avant la première DFA. Colonne nullable... non, NOT NULL
-- avec défaut 0 (une table déjà peuplée par le seed/lot 1 reçoit 0 partout, qui est la valeur
-- correcte pour un tenant qui n'a jamais eu de reprise). `valeur >= valeur_depart` déjà vrai
-- puisque valeur >= 0 par défaut = valeur_depart par défaut.
-- ---------------------------------------------------------------------------------------------

alter table public.compteur_document
  add column valeur_depart integer not null default 0;

alter table public.compteur_document
  add constraint compteur_document_valeur_depart_chk check (valeur_depart >= 0);

alter table public.compteur_document
  add constraint compteur_document_valeur_coherente_chk check (valeur >= valeur_depart);

comment on column public.compteur_document.valeur_depart is
  'MD-26/AC-17 : calage de fin d''import (D-23). 0 = tenant sans reprise. Alimente la preuve de '
  'continuité (§2.4 du modèle documentaire) : la suite DFA doit démarrer à valeur_depart + 1.';


-- ---------------------------------------------------------------------------------------------
-- 4. `parametre_atelier` — expand : AC-20 (partiel — mode_calcul_tva_defaut devient sans objet,
-- §0.2 : les prix sont TOUJOURS TTC, il n'y a plus de choix à défaut)
-- ---------------------------------------------------------------------------------------------

alter table public.parametre_atelier
  add column taux_tva_defaut_pourmille smallint not null default 81,
  add column arrondi_especes_actif     boolean  not null default true;

alter table public.parametre_atelier
  add constraint parametre_atelier_taux_tva_defaut_chk check (taux_tva_defaut_pourmille between 0 and 1000);

comment on column public.parametre_atelier.taux_tva_defaut_pourmille is
  'PF-02 : taux proposé à la création d''une ligne de document, avant sélection éventuelle d''un '
  'autre régime. 81 = taux normal 2026 (MD-36).';
comment on column public.parametre_atelier.arrondi_especes_actif is
  'PF-05/AC-20 — ⚠️ RF-52 (À VALIDER) : actif par défaut, proposition de la spec (le désactiver à '
  'tort est sans conséquence tant qu''aucune espèce n''entre en caisse ; l''inverse coûterait un '
  'contrôle de caisse qui ne tombe jamais juste).';


-- ---------------------------------------------------------------------------------------------
-- 5. `periode_comptable` — MD-34
-- ---------------------------------------------------------------------------------------------

create table public.periode_comptable (
  id             uuid        not null default gen_random_uuid(),
  tenant_id      uuid        not null references public.tenant (id) on delete restrict,
  debut          date        not null,
  fin            date        not null,
  cloturee_le    timestamptz null,
  cloturee_par_id uuid       null,

  cree_le    timestamptz not null default now(),
  modifie_le timestamptz not null default now(),

  constraint periode_comptable_pk primary key (id),
  constraint periode_comptable_tenant_id_uk unique (tenant_id, id),
  constraint periode_comptable_fk_cloturee_par foreign key (tenant_id, cloturee_par_id)
    references public.utilisateur (tenant_id, id) on delete restrict,
  constraint periode_comptable_periode_chk check (fin >= debut),
  -- Aucune période ne chevauche une autre du même tenant.
  constraint periode_comptable_chevauchement_excl
    exclude using gist (tenant_id with =, daterange(debut, fin, '[]') with &&)
);

comment on table public.periode_comptable is
  'MD-34 : aucune émission de document_vente dans une période close (voir '
  'document_vente_verifier_periode() ci-dessous). Immuable une fois clôturée — voir le trigger '
  'periode_comptable_verrouiller.';

create trigger periode_comptable_touche_modifie_le
  before update on public.periode_comptable
  for each row execute function public.touche_modifie_le();

-- --- Immuabilité une fois clôturée --------------------------------------------------------------

create function public.periode_comptable_verrouiller() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $fn$
begin
  if old.cloturee_le is not null then
    raise exception using
      errcode = 'ZDFA2',
      message = 'periode_comptable : une période clôturée est immuable.',
      detail  = format('entite=periode_comptable;entite_id=%s', old.id);
  end if;
  return new;
end
$fn$;

revoke all on function public.periode_comptable_verrouiller() from public;

create trigger periode_comptable_verrouiller
  before update on public.periode_comptable
  for each row execute function public.periode_comptable_verrouiller();

create trigger periode_comptable_audit
  after insert or update or delete on public.periode_comptable
  for each row execute function public.auditer_atelier('periode_comptable');

create index periode_comptable_recherche_idx on public.periode_comptable (tenant_id, debut, fin);

revoke all    on public.periode_comptable from dfa_app;
grant  select, insert, update on public.periode_comptable to dfa_app;
revoke delete on public.periode_comptable from dfa_app;

alter table public.periode_comptable enable row level security;
alter table public.periode_comptable force  row level security;

create policy periode_comptable_isolation_tenant on public.periode_comptable
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy periode_comptable_migrator on public.periode_comptable
  to dfa_migrator
  using (true) with check (true);


-- ---------------------------------------------------------------------------------------------
-- 6. `transition_document_autorisee` — machine à états EN DONNÉES (RF-83, MD-17), dédiée
--
-- Table DÉDIÉE et non un réemploi de `transition_autorisee` (0003) : cette dernière est indexée
-- par `entite` (une entité = un type de statut). Ici, QUATRE machines différentes (une par
-- type_document) partagent UNE SEULE table document_vente et donc UN SEUL enum statut, et ce
-- qu'un devis peut atteindre (accepte, refuse, expire, remplace) n'a rien à voir avec ce qu'une
-- facture peut atteindre (annule_par_avoir) — un `entite = 'document_vente'` générique
-- autoriserait l'union des quatre, donc une facture qui « accepte », ce que RF-1→RF-19 interdit.
-- La clé est donc (type_document, statut_depuis, statut_vers), typée avec les enums RÉELS
-- (statut_document_vente) — pas de colonne text ni de trigger de validation de contenu : le
-- type système suffit ici, à la différence de transition_autorisee qui doit couvrir plusieurs
-- enums de statut différents.
-- ---------------------------------------------------------------------------------------------

create table public.transition_document_autorisee (
  type_document public.type_document_vente     not null,
  statut_depuis public.statut_document_vente    not null,
  statut_vers   public.statut_document_vente    not null,
  exige_motif   boolean                         not null default false,

  constraint transition_document_autorisee_pk primary key (type_document, statut_depuis, statut_vers),
  constraint transition_document_autorisee_pas_de_boucle check (statut_depuis <> statut_vers)
);

comment on table public.transition_document_autorisee is
  'Transitions autorisées de document_vente, PAR type_document (RF-83/MD-17). [dfa:referentiel-'
  'partage] Liste blanche, alimentée exclusivement par migration ; dfa_app n''y a que SELECT — '
  'mêmes garanties que transition_autorisee (0003 §4).';

revoke all    on public.transition_document_autorisee from dfa_app;
grant  select on public.transition_document_autorisee to   dfa_app;

alter table public.transition_document_autorisee enable row level security;

create policy transition_document_autorisee_lecture on public.transition_document_autorisee
  for select to dfa_app
  using (true);

-- --- Contenu : RF-1→RF-19, MD-15 ---------------------------------------------------------------
-- devis          : brouillon → emis → {accepte, refuse, expire, remplace} ; brouillon → abandonne
-- bon_commande   : brouillon → emis → {transforme, annule} ; brouillon → abandonne
-- facture        : brouillon → emis → annule_par_avoir ; brouillon → abandonne
-- avoir          : brouillon → emis ; brouillon → abandonne
-- États terminaux, sans sortie : accepte/refuse/expire/remplace/transforme/annule/
-- annule_par_avoir/abandonne. C'est RF-10 : « personne » ne fait sortir un document émis de son
-- état — pas même vers un autre état émis.

insert into public.transition_document_autorisee (type_document, statut_depuis, statut_vers, exige_motif) values
  ('devis', 'brouillon', 'emis',      false),
  ('devis', 'brouillon', 'abandonne', false),
  ('devis', 'emis',      'accepte',   false),
  ('devis', 'emis',      'refuse',    false),
  ('devis', 'emis',      'expire',    false),
  ('devis', 'emis',      'remplace',  false),

  ('bon_commande', 'brouillon', 'emis',      false),
  ('bon_commande', 'brouillon', 'abandonne', false),
  ('bon_commande', 'emis',      'transforme', false),
  ('bon_commande', 'emis',      'annule',    true),

  ('facture', 'brouillon', 'emis',             false),
  ('facture', 'brouillon', 'abandonne',        false),
  -- RF-10/RF-11/MD-22 : la SEULE sortie d'une facture émise, et elle ne se déclenche jamais par un
  -- appel direct — le service l'exécute dans la même transaction que l'émission de l'avoir
  -- (RF-12), jamais isolément.
  ('facture', 'emis',      'annule_par_avoir', false),

  ('avoir', 'brouillon', 'emis',      false),
  ('avoir', 'brouillon', 'abandonne', false);

-- --- `verifier_transition_document()` — garde-fou générique, clé sur type_document -------------
--
-- Sur le même modèle que verifier_transition() (0003 §6), mais l'entité à interroger dans le
-- référentiel n'est pas un argument statique de trigger : elle vient de NEW.type_document, colonne
-- de la ligne elle-même (une seule table document_vente pour quatre types). SECURITY INVOKER,
-- explicite.

create function public.verifier_transition_document() returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $fn$
declare
  depuis     public.statut_document_vente;
  vers       public.statut_document_vente;
  possibles  text;
  indication text;
begin
  if tg_op <> 'UPDATE' then
    raise exception
      'verifier_transition_document() posée sur % pour « % » : ce trigger ne vaut que pour BEFORE UPDATE.',
      tg_op, tg_table_name
      using errcode = 'ZDFA1';
  end if;

  -- Un document ne change JAMAIS de type_document (RF-8) : vérifié par ailleurs
  -- (document_vente_verrouiller_apres_emission couvre le brouillon exclu ; le type est de toute
  -- façon hors liste blanche post-émission). Ici on ne s'intéresse qu'au statut.
  depuis := old.statut;
  vers   := new.statut;

  if depuis is not distinct from vers then
    return new;
  end if;

  if exists (
    select 1
      from public.transition_document_autorisee t
     where t.type_document = new.type_document
       and t.statut_depuis  = depuis
       and t.statut_vers    = vers
  ) then
    return new;
  end if;

  select string_agg(t.statut_vers::text, ', ' order by t.statut_vers::text)
    into possibles
    from public.transition_document_autorisee t
   where t.type_document = new.type_document
     and t.statut_depuis  = depuis;

  if possibles is null then
    indication := format('« %s » est un état terminal pour %s : aucune transition n''en part.', depuis, new.type_document);
  else
    indication := format('Depuis « %s » (%s), transitions autorisées : %s.', depuis, new.type_document, possibles);
  end if;

  raise exception using
    errcode = 'ZDFA1',
    message = format('Transition %s → %s interdite sur document_vente (type %s).', depuis, vers, new.type_document),
    detail  = format('entite=document_vente;entite_id=%s;type_document=%s;depuis=%s;vers=%s', new.id, new.type_document, depuis, vers),
    hint    = indication,
    table   = tg_table_name;
end
$fn$;

comment on function public.verifier_transition_document() is
  'Trigger BEFORE UPDATE sur document_vente : refuse toute transition de statut absente de '
  'transition_document_autorisee POUR CE type_document, SQLSTATE ZDFA1. Voir 0010_facturation.sql §6.';

revoke all     on function public.verifier_transition_document() from public;
grant  execute on function public.verifier_transition_document() to   dfa_app;


-- ---------------------------------------------------------------------------------------------
-- 7. `document_vente` — le cœur de la chaîne (MD-01→MD-46)
-- ---------------------------------------------------------------------------------------------

create table public.document_vente (
  id        uuid not null default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  site_id   uuid not null,

  type_document   public.type_document_vente not null,
  nature_facture  public.nature_facture       not null default 'ordinaire',
  origine         public.origine_document     not null default 'dfa',
  statut          public.statut_document_vente not null default 'brouillon',
  -- Dérivé, maintenu par le service à chaque imputation (MD-16/MD-53) : dans la liste blanche
  -- post-émission (§7.4). PAS un état du document (RF-68) — voir le trigger d'immuabilité.
  statut_reglement public.statut_reglement_document not null default 'non_regle',

  -- --- Numérotation (MD-03→MD-06) ---------------------------------------------------------------
  numero_sequence  integer null,
  numero           text    null,
  numero_origine   text    null,
  -- MD-06 : colonne générée, recherche comptoir insensible à la casse et aux séparateurs.
  numero_normalise text generated always as (
    upper(regexp_replace(numero, '[^0-9A-Za-z]', '', 'g'))
  ) stored,
  exercice smallint null,

  -- --- Dates (MD-27, MD-33, MD-34, MD-39, MD-80) ------------------------------------------------
  date_document        date        null,
  date_prestation_debut date       null,
  date_prestation_fin   date       null,
  date_echeance        date        null,
  emis_le              timestamptz null,

  -- --- Destinataire et figement (MD-24, RM-50-like) ---------------------------------------------
  client_id                 uuid  not null,
  vehicule_id                uuid  null,
  ordre_reparation_id        uuid  null,
  -- Accroche étape 4 (MD-70) : vide tant que la vente de véhicule n'existe pas, sans FK.
  dossier_vente_id           uuid  null,
  client_designation_figee   text  not null,
  client_ide_fige            text  null,
  langue_figee               public.langue not null,
  adresse_facturation_figee  jsonb not null,
  conditions_paiement_figees jsonb not null default '{}'::jsonb,

  -- --- Chaîne (MD-14) : colonnes explicites, pas une table de liens générique --------------------
  document_source_id  uuid null,
  facture_annulee_id  uuid null,
  -- RF-32/MD-20 : posé sur la FACTURE annulée, pointe vers l'avoir qui l'annule. Dans la liste
  -- blanche post-émission (§7.4) — c'est le sens INVERSE de facture_annulee_id.
  annule_par_avoir_id uuid null,
  remplace_id          uuid null,

  -- --- Avoir (RF-11→RF-18) ------------------------------------------------------------------------
  portee_avoir      public.portee_avoir null,
  motif_avoir       public.motif_avoir  null,
  motif_avoir_libre text null,

  -- --- TVA au niveau document (MD-07→MD-09, MD-68/69) --------------------------------------------
  tva_non_ventilee      boolean       not null default false,
  taux_tva_pourmille    smallint      null,
  mention_tva_interdite boolean       not null default false,

  -- --- Montants (MD-08, MD-46) — bigint : agrégats de document, comme
  -- ordre_reparation.total_valide_centimes (0008). Les montants DE LIGNE restent `integer`
  -- (§8 ci-dessous), plafonnés comme ligne_or. -----------------------------------------------------
  total_ht_centimes             bigint not null default 0,
  total_tva_centimes            bigint not null default 0,
  ecart_reprise_centimes        bigint not null default 0,
  total_ttc_centimes            bigint not null default 0,
  remise_globale_pourmille      smallint null,
  remise_globale_saisie_centimes bigint  null,
  -- Dérivés (MD-53), liste blanche post-émission.
  montant_regle_centimes bigint not null default 0,
  solde_centimes         bigint not null default 0,

  devise char(3) not null default 'CHF',

  -- --- QR-facture (MD-73→MD-81) — figé à l'émission, octet pour octet ----------------------------
  qr_iban              text null,
  qr_iban_est_qr_iban  boolean generated always as (
    case
      when qr_iban is not null
       and length(regexp_replace(qr_iban, '\s', '', 'g')) >= 9
       and substring(regexp_replace(qr_iban, '\s', '', 'g') from 5 for 5) ~ '^[0-9]{5}$'
      then substring(regexp_replace(qr_iban, '\s', '', 'g') from 5 for 5)::integer between 30000 and 31999
      else false
    end
  ) stored,
  creancier_nom      text null,
  creancier_rue      text null,
  creancier_numero   text null,
  creancier_npa      text null,
  creancier_localite text null,
  creancier_pays     char(2) null,
  type_reference_qr  public.type_reference_qr null,
  qr_reference        text null,
  qr_montant_centimes bigint null,
  qr_devise            char(3) null,
  qr_langue            public.langue null,
  -- RF-59/RF-60/MD-79 : true seulement si les 5 champs du débiteur étaient TOUS présents à
  -- l'émission — contrôle mécanique côté service, cette colonne n'en garde que la trace figée.
  qr_debiteur_present boolean not null default false,
  qr_payload           text null,
  qr_payload_sha256    text null,

  -- --- Document imprimé (MD-91, MD-95) -----------------------------------------------------------
  pdf_cle    text null,
  pdf_sha256 text null,

  -- --- Export (MD-91), liste blanche post-émission. FK vers export_comptable ajoutée en §14
  -- (table déclarée plus loin dans ce fichier). --------------------------------------------------
  exporte_le timestamptz null,
  export_id  uuid null,

  -- --- Relance, contentieux (MD-20 liste blanche) -------------------------------------------------
  relance_niveau smallint    not null default 0,
  relance_le     timestamptz null,
  contentieux    boolean     not null default false,

  cree_le    timestamptz not null default now(),
  modifie_le timestamptz not null default now(),

  constraint document_vente_pk primary key (id),
  constraint document_vente_tenant_id_uk unique (tenant_id, id),

  constraint document_vente_fk_site foreign key (tenant_id, site_id)
    references public.site (tenant_id, id) on delete restrict,
  constraint document_vente_fk_client foreign key (tenant_id, client_id)
    references public.client (tenant_id, id) on delete restrict,
  constraint document_vente_fk_vehicule foreign key (tenant_id, vehicule_id)
    references public.vehicule (tenant_id, id) on delete restrict,
  constraint document_vente_fk_or foreign key (tenant_id, ordre_reparation_id)
    references public.ordre_reparation (tenant_id, id) on delete restrict,
  constraint document_vente_fk_source foreign key (tenant_id, document_source_id)
    references public.document_vente (tenant_id, id) on delete restrict,
  constraint document_vente_fk_facture_annulee foreign key (tenant_id, facture_annulee_id)
    references public.document_vente (tenant_id, id) on delete restrict,
  constraint document_vente_fk_annule_par_avoir foreign key (tenant_id, annule_par_avoir_id)
    references public.document_vente (tenant_id, id) on delete restrict,
  constraint document_vente_fk_remplace foreign key (tenant_id, remplace_id)
    references public.document_vente (tenant_id, id) on delete restrict,

  -- --- MD-03 : origine / numérotation, verbatim depuis le modèle documentaire --------------------
  constraint document_vente_origine_numero_chk check (
    (origine = 'dfa'     and numero_origine is null)
    or
    (origine = 'reprise' and numero_origine is not null and numero_sequence is null)
  ),
  constraint document_vente_numero_brouillon_chk check ((statut = 'brouillon') = (numero is null)),
  constraint document_vente_sequence_emise_chk
    check (origine <> 'dfa' or statut = 'brouillon' or numero_sequence is not null),
  constraint document_vente_exercice_brouillon_chk check ((statut = 'brouillon') = (exercice is null)),
  constraint document_vente_emis_le_brouillon_chk check ((statut = 'brouillon') = (emis_le is null)),
  constraint document_vente_numero_non_vide_chk check (numero is null or length(btrim(numero)) > 0),

  -- --- RF-8 : un document source n'est transformé/remplacé qu'une fois — voir les index uniques
  -- partiels §7.2 (document_source_id, remplace_id ne peuvent être réutilisés).

  -- --- Avoir (RF-11→RF-18) -------------------------------------------------------------------------
  constraint document_vente_avoir_facture_annulee_chk
    check ((type_document = 'avoir') = (facture_annulee_id is not null)),
  constraint document_vente_avoir_motif_chk
    check (type_document = 'avoir' or motif_avoir is null),
  constraint document_vente_avoir_motif_emis_chk
    check (type_document <> 'avoir' or statut = 'brouillon' or motif_avoir is not null),
  constraint document_vente_avoir_motif_autre_chk
    check (motif_avoir <> 'autre' or motif_avoir_libre is not null),
  constraint document_vente_avoir_portee_chk
    check ((type_document = 'avoir') = (portee_avoir is not null)),
  constraint document_vente_annule_par_avoir_type_chk
    check (annule_par_avoir_id is null or type_document = 'facture'),

  -- --- Acompte (MD-12) ------------------------------------------------------------------------------
  constraint document_vente_nature_acompte_chk
    check (nature_facture = 'ordinaire' or type_document = 'facture'),

  -- --- TVA / reprise (MD-07→MD-09, MD-68/69) --------------------------------------------------------
  constraint document_vente_tva_non_ventilee_chk check (not tva_non_ventilee or origine = 'reprise'),
  constraint document_vente_taux_tva_doc_chk
    check (taux_tva_pourmille is null or (taux_tva_pourmille between 0 and 1000)),
  constraint document_vente_taux_tva_doc_reprise_chk
    check (taux_tva_pourmille is null or (tva_non_ventilee and origine = 'reprise')),
  constraint document_vente_ecart_reprise_chk check (origine = 'reprise' or ecart_reprise_centimes = 0),
  constraint document_vente_mention_tva_interdite_chk
    check (not mention_tva_interdite or total_tva_centimes = 0),

  -- --- Montants (MD-08, MD-46) ------------------------------------------------------------------------
  constraint document_vente_totaux_coherents_chk
    check (total_ht_centimes + total_tva_centimes + ecart_reprise_centimes = total_ttc_centimes),
  constraint document_vente_signe_avoir_chk
    check (type_document <> 'avoir' or (total_ht_centimes <= 0 and total_tva_centimes <= 0 and total_ttc_centimes <= 0)),
  constraint document_vente_signe_positif_chk
    check (type_document = 'avoir' or (total_ht_centimes >= 0 and total_tva_centimes >= 0 and total_ttc_centimes >= 0)),
  constraint document_vente_remise_globale_xor_chk
    check (remise_globale_pourmille is null or remise_globale_saisie_centimes is null),
  constraint document_vente_remise_globale_pourmille_chk
    check (remise_globale_pourmille is null or remise_globale_pourmille between 0 and 1000),
  constraint document_vente_solde_non_negatif_chk check (solde_centimes >= 0),
  constraint document_vente_montant_regle_non_negatif_chk check (montant_regle_centimes >= 0),
  constraint document_vente_devise_format_chk check (devise ~ '^[A-Z]{3}$'),

  -- --- QR-facture (MD-74, MD-81) — le décompte exact des champs du payload (CF-21) relève de
  -- l'encodeur applicatif ; ces CHECK couvrent la cohérence STOCKÉE, pas la conformité complète
  -- au Swiss Payment Standard. -----------------------------------------------------------------------
  constraint document_vente_qr_payload_coherent_chk
    check ((qr_payload is null) = (qr_payload_sha256 is null)),
  constraint document_vente_qr_reference_type_chk
    check (qr_reference is null or type_reference_qr is not null),
  constraint document_vente_qr_iban_type_chk
    check ((type_reference_qr is null) = (qr_iban is null)),
  constraint document_vente_qr_devise_chk
    check (qr_devise is null or qr_devise in ('CHF', 'EUR')),
  -- MD-74, verbatim : le type de référence découle du type d'IBAN, la base l'impose.
  constraint document_vente_qr_reference_forme_chk check (
    qr_iban is null or (
      (type_reference_qr = 'qrr'  and qr_iban_est_qr_iban     and qr_reference ~ '^[0-9]{27}$')
      or (type_reference_qr = 'scor' and not qr_iban_est_qr_iban and qr_reference ~ '^RF[0-9]{2}[0-9A-Z]{1,21}$')
      or (type_reference_qr = 'non'  and not qr_iban_est_qr_iban and qr_reference is null)
    )
  ),

  constraint document_vente_relance_niveau_chk check (relance_niveau >= 0)
);

comment on table public.document_vente is
  'Chaîne devis/bon_commande/facture/avoir (RF-1→RF-19, MD-01→MD-46). Verrouillée en base à '
  'l''émission — voir document_vente_verrouiller_apres_emission. §0.2 : montants TOUJOURS TTC '
  '(décision @laupernoe du 29.07.2026) — voir ligne_document pour le détail arithmétique.';

comment on column public.document_vente.annule_par_avoir_id is
  'RF-32 : posé sur la FACTURE annulée (pas sur l''avoir), après émission — liste blanche MD-20. '
  'Sens INVERSE de facture_annulee_id (posé sur l''avoir, immuable dès sa création).';

create trigger document_vente_touche_modifie_le
  before update on public.document_vente
  for each row execute function public.touche_modifie_le();

-- --- 7.1 Création : tout document naît en brouillon (MD-19) -------------------------------------

create function public.document_vente_creation_brouillon() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $fn$
begin
  if new.statut <> 'brouillon' then
    raise exception using
      errcode = 'ZDFA1',
      message = 'document_vente : tout document naît en brouillon (MD-19) — aucune insertion directe dans un autre statut.',
      detail  = format('entite=document_vente;entite_id=%s;statut=%s', new.id, new.statut);
  end if;
  return new;
end
$fn$;

revoke all on function public.document_vente_creation_brouillon() from public;

create trigger document_vente_creation_brouillon
  before insert on public.document_vente
  for each row execute function public.document_vente_creation_brouillon();

-- --- 7.2 Verrouillage après émission — liste blanche MD-20 ---------------------------------------

create function public.document_vente_verrouiller_apres_emission() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $fn$
declare
  colonnes_modifiables text[] := array[
    'statut', 'statut_reglement', 'montant_regle_centimes', 'solde_centimes',
    'relance_niveau', 'relance_le', 'pdf_cle', 'pdf_sha256', 'exporte_le', 'export_id',
    'annule_par_avoir_id', 'contentieux', 'modifie_le'
  ];
  -- PIÈGE VÉRIFIÉ EN EXÉCUTION : dans un trigger BEFORE UPDATE, les colonnes GENERATED ALWAYS ...
  -- STORED de `new` ne sont PAS ENCORE calculées (Postgres les recalcule seulement après que tous
  -- les triggers BEFORE ROW ont fini) — `new.numero_normalise` et `new.qr_iban_est_qr_iban` lisent
  -- NULL, quelle que soit la valeur réelle de `old`. Sans cette exclusion, TOUTE mise à jour, même
  -- limitée à la liste blanche ci-dessus, était refusée à tort. Exclues ici, pas comparées : un
  -- changement réel de leur colonne source (numero, qr_iban) est de toute façon déjà hors liste
  -- blanche et donc déjà bloqué par la comparaison sur ces colonnes sources elles-mêmes.
  colonnes_generees text[] := array['numero_normalise', 'qr_iban_est_qr_iban'];
begin
  if old.statut <> 'brouillon'
     and (to_jsonb(new) - colonnes_modifiables - colonnes_generees)
         is distinct from (to_jsonb(old) - colonnes_modifiables - colonnes_generees)
  then
    raise exception using
      errcode = 'ZDFA2',
      message = 'document_vente : document verrouillé après émission (MD-20), seules statut/statut_reglement/montant_regle_centimes/solde_centimes/relance_*/pdf_*/exporte_le/export_id/annule_par_avoir_id/contentieux restent modifiables.',
      detail  = format('entite=document_vente;entite_id=%s;code=document_verrouille', old.id);
  end if;
  return new;
end
$fn$;

comment on function public.document_vente_verrouiller_apres_emission() is
  'Trigger BEFORE UPDATE : liste blanche MD-20. code=document_verrouille dans DETAIL, pour '
  'mapping applicatif vers le code problem+json stable. SQLSTATE ZDFA2.';

revoke all on function public.document_vente_verrouiller_apres_emission() from public;

create trigger document_vente_verrouiller_apres_emission
  before update on public.document_vente
  for each row execute function public.document_vente_verrouiller_apres_emission();

-- --- 7.3 Machine à états (§6) + période comptable (MD-34) ----------------------------------------

create trigger document_vente_verifier_transition
  before update on public.document_vente
  for each row execute function public.verifier_transition_document();

create function public.document_vente_verifier_periode() returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $fn$
begin
  if new.statut = 'emis' and old.statut = 'brouillon' and new.date_document is not null then
    if exists (
      select 1
        from public.periode_comptable p
       where p.tenant_id    = new.tenant_id
         and p.cloturee_le is not null
         and new.date_document between p.debut and p.fin
    ) then
      raise exception using
        errcode = 'ZDFA5',
        message = format('document_vente : émission refusée, période comptable close pour la date %s (MD-34).', new.date_document),
        detail  = format('entite=document_vente;entite_id=%s;date_document=%s', new.id, new.date_document);
    end if;
  end if;
  return new;
end
$fn$;

comment on function public.document_vente_verifier_periode() is
  'Trigger BEFORE UPDATE : refuse l''émission (brouillon→emis) dans une période comptable close '
  '(MD-34). SQLSTATE ZDFA5. Aucune période configurée = aucun contrôle applicable.';

revoke all on function public.document_vente_verifier_periode() from public;

create trigger document_vente_verifier_periode
  before update on public.document_vente
  for each row execute function public.document_vente_verifier_periode();

create trigger document_vente_audit
  after insert or update or delete on public.document_vente
  for each row execute function public.auditer_atelier('document_vente');

-- --- 7.4 Index --------------------------------------------------------------------------------

-- MD-06, index #1 : numéro affiché unique par tenant et par série (couvre les deux populations).
create unique index document_vente_numero_uk
  on public.document_vente (tenant_id, type_document, numero)
 where numero is not null;

-- MD-06, index #2 : support de la preuve de continuité (§2.4 du modèle).
create unique index document_vente_sequence_uk
  on public.document_vente (tenant_id, type_document, exercice, numero_sequence)
 where origine = 'dfa' and numero_sequence is not null;

-- MD-06, index #3 : idempotence de l'import (un numéro source n'est jamais importé deux fois).
create unique index document_vente_numero_origine_uk
  on public.document_vente (tenant_id, type_document, numero_origine)
 where numero_origine is not null;

-- MD-06, index #4 : recherche comptoir, non unique.
create index document_vente_numero_recherche_idx
  on public.document_vente (tenant_id, numero_normalise);

-- MD-76 : unicité PERPÉTUELLE, sans restriction d'exercice ni de type — clé du rapprochement
-- camt.054. À la différence des numéros de document, une référence QR ne se remet JAMAIS à zéro
-- et ne se réutilise JAMAIS (MD-75).
create unique index document_vente_qr_reference_uk
  on public.document_vente (tenant_id, qr_reference)
 where qr_reference is not null;

-- RF-8 : un document source n'est transformé/remplacé qu'une seule fois.
create unique index document_vente_source_uk
  on public.document_vente (tenant_id, document_source_id)
 where document_source_id is not null;
create unique index document_vente_remplace_uk
  on public.document_vente (tenant_id, remplace_id)
 where remplace_id is not null;

create index document_vente_client_idx on public.document_vente (tenant_id, client_id, date_document desc);
create index document_vente_or_idx     on public.document_vente (tenant_id, ordre_reparation_id)
 where ordre_reparation_id is not null;
create index document_vente_facture_annulee_idx on public.document_vente (tenant_id, facture_annulee_id)
 where facture_annulee_id is not null;

-- Grand livre des débiteurs ouvert : factures émises non soldées (dashboard comptable, §6 RF-114).
create index document_vente_ouvert_idx on public.document_vente (tenant_id, client_id)
 where type_document = 'facture' and statut = 'emis' and statut_reglement <> 'regle';

create index document_vente_pagination_idx on public.document_vente (tenant_id, cree_le desc, id desc);

revoke all    on public.document_vente from dfa_app;
grant  select, insert, update on public.document_vente to dfa_app;
-- RF-31 : aucun DELETE, quel que soit le rôle — même patron que ligne_or (0008).
revoke delete on public.document_vente from dfa_app;

alter table public.document_vente enable row level security;
alter table public.document_vente force  row level security;

create policy document_vente_isolation_tenant on public.document_vente
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy document_vente_migrator on public.document_vente
  to dfa_migrator
  using (true) with check (true);


-- ---------------------------------------------------------------------------------------------
-- 8. `ligne_document` (MD-15, MD-40→MD-45, §0.2 — arithmétique TTC)
--
-- §0.2 : `prix_unitaire_centimes` est un montant TTC (décision @laupernoe du 29.07.2026). Pipeline de
-- calcul, à REPRODUIRE À L'IDENTIQUE côté service (packages/shared, arrondiCommercial en bigint) :
--
--   base_ttc_centimes   = arrondiCommercial(prix_unitaire_centimes × quantite_millieme, 1000)
--   remise_centimes     = remise_montant_centimes
--                         ?? arrondiCommercial(base_ttc_centimes × remise_pourmille, 1000)
--   ttc_centimes        = base_ttc_centimes − remise_centimes − remise_globale_repartie_centimes
--   tva_centimes        = arrondiCommercial(ttc_centimes × taux_tva_pourmille, 1000 + taux_tva_pourmille)
--   ht_centimes         = ttc_centimes − tva_centimes         -- RÉSIDU EXACT, jamais recalculé
--
-- L'arrondi ne tombe donc QU'à une seule étape (le calcul de tva_centimes) ; ht_centimes absorbe
-- zéro arrondi supplémentaire par construction. `ttc = ht + tva` est donc TOUJOURS exact, ligne
-- par ligne (ligne_document_montant_coherent_chk), et la somme sur le document l'est donc aussi
-- (document_vente_totaux_coherents_chk) — c'est le sens de « le total TTC est ce qui a été promis,
-- c'est le calcul qui cède » (consigne de @laupernoe). type_ligne='acompte_deduit' et 'ecart_reprise'
-- sont recopiés depuis leur source (MD-55, MD-08) et ne repassent pas par ce pipeline.
-- ---------------------------------------------------------------------------------------------

create table public.ligne_document (
  id           uuid not null default gen_random_uuid(),
  tenant_id    uuid not null,
  document_id  uuid not null,
  numero_ordre smallint not null,

  type_ligne public.type_ligne_document not null,
  designation text not null,
  reference_texte text null,

  -- MD-15 : le point d'accroche qui rend la facturation partielle dans le temps possible sans
  -- dupliquer une prestation (RF-84, RF-85, une ligne d'OR = un seul document non annulé, garanti
  -- par le trigger ligne_document_verifier_unicite_or ci-dessous, pas par un index seul : la
  -- condition « non annulé » dépend du statut du document PARENT, pas de cette ligne).
  ligne_or_id uuid null,
  -- MD-55 : obligatoire et négatif quand type_ligne = 'acompte_deduit'.
  document_acompte_id uuid null,
  -- AC-09-like : surcharge exceptionnelle du mapping comptable dérivé du type de ligne.
  categorie_comptable text null,

  -- --- §0.2 : prix TOUJOURS TTC (Δ-RF40) -----------------------------------------------------------
  mode_calcul_tva  public.mode_calcul_tva not null default 'ttc',
  regime_tva       public.regime_tva      not null default 'normal',
  -- Figé à la création (MD-38/39) : un changement de taux fédéral ne réécrit jamais une ligne déjà
  -- émise. C'est le taux, pas seulement un code (consigne de @laupernoe du 29.07.2026).
  taux_tva_pourmille smallint not null,
  date_prestation     date     not null,

  quantite_millieme      integer not null default 1000,
  prix_unitaire_centimes integer not null default 0,

  remise_pourmille               smallint null,
  remise_montant_centimes        integer  null,
  remise_globale_repartie_centimes integer not null default 0,

  base_centimes integer not null default 0,
  ht_centimes   integer not null,
  tva_centimes  integer not null,
  ttc_centimes  integer not null,

  -- MD-66/RF-92 : lignes à charge du garage — facturées 0.00, valorisées quand même.
  montant_valorise_centimes integer null,

  cree_le    timestamptz not null default now(),
  modifie_le timestamptz not null default now(),

  constraint ligne_document_pk primary key (id),
  constraint ligne_document_tenant_id_uk unique (tenant_id, id),
  constraint ligne_document_tenant_doc_ordre_uk unique (tenant_id, document_id, numero_ordre),

  constraint ligne_document_fk_document foreign key (tenant_id, document_id)
    references public.document_vente (tenant_id, id) on delete restrict,
  constraint ligne_document_fk_ligne_or foreign key (tenant_id, ligne_or_id)
    references public.ligne_or (tenant_id, id) on delete restrict,
  constraint ligne_document_fk_document_acompte foreign key (tenant_id, document_acompte_id)
    references public.document_vente (tenant_id, id) on delete restrict,

  constraint ligne_document_designation_non_vide_chk check (length(btrim(designation)) > 0),
  -- Δ-RF40 : type PG complet (ht/ttc), restreint à 'ttc' pour le lot pilote — voir l'en-tête §0.2.
  constraint ligne_document_mode_ttc_lot_pilote_chk check (mode_calcul_tva = 'ttc'),
  constraint ligne_document_taux_tva_chk check (taux_tva_pourmille between 0 and 1000),
  constraint ligne_document_remise_xor_chk
    check (remise_pourmille is null or remise_montant_centimes is null),
  constraint ligne_document_remise_pourmille_chk
    check (remise_pourmille is null or remise_pourmille between 0 and 1000),
  constraint ligne_document_montant_ht_chk  check (ht_centimes  between -100000000 and 100000000),
  constraint ligne_document_montant_tva_chk check (tva_centimes between -100000000 and 100000000),
  constraint ligne_document_montant_ttc_chk check (ttc_centimes between -100000000 and 100000000),
  -- §0.2 : tient PAR CONSTRUCTION (ht = ttc − tva), ce CHECK est le filet qui le garantit en base.
  constraint ligne_document_montant_coherent_chk check (ttc_centimes = ht_centimes + tva_centimes),
  -- MD-55, verbatim du modèle documentaire.
  constraint ligne_document_acompte_deduit_chk
    check (type_ligne <> 'acompte_deduit' or (ht_centimes < 0 and document_acompte_id is not null)),
  constraint ligne_document_document_acompte_type_chk
    check (document_acompte_id is null or type_ligne = 'acompte_deduit')
);

comment on table public.ligne_document is
  'Ligne d''un document de vente. Figée avec le reste dès que le document parent quitte '
  '''brouillon'' — voir ligne_document_verrouiller_document. §0.2 : prix_unitaire_centimes est un '
  'montant TTC, ht_centimes est le résidu ttc − tva (jamais recalculé séparément).';

create trigger ligne_document_touche_modifie_le
  before update on public.ligne_document
  for each row execute function public.touche_modifie_le();

-- --- 8.1 Immuabilité conditionnelle (MD-21) : verrouillée dès que le document n'est plus brouillon,
-- CONTRAIREMENT à ligne_or qui l'est de façon PERMANENTE (RM-71) — le DELETE reste possible tant
-- que le document est en brouillon (une ligne ajoutée par erreur avant émission se retire).

create function public.ligne_document_verrouiller_document() returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $fn$
declare
  statut_doc public.statut_document_vente;
  cible_id     uuid := coalesce(new.document_id, old.document_id);
  cible_tenant uuid := coalesce(new.tenant_id, old.tenant_id);
begin
  select d.statut into statut_doc
    from public.document_vente d
   where d.tenant_id = cible_tenant and d.id = cible_id;

  if statut_doc is distinct from 'brouillon' then
    raise exception using
      errcode = 'ZDFA2',
      message = format('ligne_document : document verrouillé (statut %s), plus aucune modification de ligne (MD-21).', statut_doc),
      detail  = format('entite=ligne_document;entite_id=%s;document_id=%s;code=document_verrouille', coalesce(new.id, old.id), cible_id);
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$fn$;

revoke all on function public.ligne_document_verrouiller_document() from public;

create trigger ligne_document_verrouiller_document
  before insert or update or delete on public.ligne_document
  for each row execute function public.ligne_document_verrouiller_document();

-- --- 8.2 Unicité de facturation d'une ligne d'OR (MD-15) : « un seul document NON ANNULÉ » -------
--
-- Ne peut pas être un index unique partiel classique : « non annulé » est un état du document
-- PARENT (document_vente.statut), pas de cette ligne. Verrou de ligne sur ligne_or (FOR UPDATE)
-- pour rendre le contrôle atomique sous concurrence — deux émissions concurrentes qui tenteraient
-- de facturer la MÊME ligne d'OR se sérialisent sur ce verrou au lieu de courir vers une double
-- facturation (même principe que le verrou de compteur_document, §2.3 du modèle).

create function public.ligne_document_verifier_unicite_or() returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $fn$
begin
  if new.ligne_or_id is null then
    return new;
  end if;

  perform 1 from public.ligne_or
   where tenant_id = new.tenant_id and id = new.ligne_or_id
     for update;

  if exists (
    select 1
      from public.ligne_document ld
      join public.document_vente d on d.tenant_id = ld.tenant_id and d.id = ld.document_id
     where ld.tenant_id    = new.tenant_id
       and ld.ligne_or_id  = new.ligne_or_id
       and ld.id           <> new.id
       and d.statut         not in ('abandonne', 'annule_par_avoir')
  ) then
    raise exception using
      errcode = 'ZDFA4',
      message = 'ligne_document : cette ligne d''OR est déjà facturée sur un document non annulé (MD-15).',
      detail  = format('entite=ligne_document;ligne_or_id=%s', new.ligne_or_id);
  end if;

  return new;
end
$fn$;

revoke all on function public.ligne_document_verifier_unicite_or() from public;

create trigger ligne_document_verifier_unicite_or
  before insert or update on public.ligne_document
  for each row execute function public.ligne_document_verifier_unicite_or();

create index ligne_document_document_idx on public.ligne_document (tenant_id, document_id, numero_ordre);
create index ligne_document_or_idx on public.ligne_document (tenant_id, ligne_or_id) where ligne_or_id is not null;
create index ligne_document_acompte_idx on public.ligne_document (tenant_id, document_acompte_id)
 where document_acompte_id is not null;

revoke all    on public.ligne_document from dfa_app;
-- MD-21 : DELETE accordé (à la différence de ligne_or), le trigger §8.1 le bloque dès que le
-- document parent n'est plus brouillon.
grant  select, insert, update, delete on public.ligne_document to dfa_app;

alter table public.ligne_document enable row level security;
alter table public.ligne_document force  row level security;

create policy ligne_document_isolation_tenant on public.ligne_document
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy ligne_document_migrator on public.ligne_document
  to dfa_migrator
  using (true) with check (true);


-- ---------------------------------------------------------------------------------------------
-- 9. `document_vente_tva` — récapitulatif par (régime, taux), figé À L'ÉMISSION (MD-45)
--
-- N'existe QU'à partir de l'émission (écrit une seule fois par le service, jamais avant) :
-- append-only par PRIVILÈGE seul, comme ordre_reparation_demande (0008) — aucun trigger de
-- verrouillage n'est nécessaire puisqu'aucun GRANT UPDATE/DELETE n'est jamais accordé.
-- ---------------------------------------------------------------------------------------------

create table public.document_vente_tva (
  id                 uuid not null default gen_random_uuid(),
  tenant_id          uuid not null,
  document_id        uuid not null,
  regime_tva         public.regime_tva not null,
  taux_tva_pourmille smallint not null,
  base_centimes      integer not null,
  tva_centimes       integer not null,

  cree_le timestamptz not null default now(),

  constraint document_vente_tva_pk primary key (id),
  constraint document_vente_tva_tenant_id_uk unique (tenant_id, id),
  constraint document_vente_tva_tenant_doc_regime_taux_uk
    unique (tenant_id, document_id, regime_tva, taux_tva_pourmille),
  constraint document_vente_tva_fk_document foreign key (tenant_id, document_id)
    references public.document_vente (tenant_id, id) on delete restrict,
  constraint document_vente_tva_taux_chk check (taux_tva_pourmille between 0 and 1000),
  constraint document_vente_tva_base_chk check (base_centimes between -100000000000 and 100000000000),
  constraint document_vente_tva_montant_chk check (tva_centimes between -100000000000 and 100000000000)
);

comment on table public.document_vente_tva is
  'Récapitulatif TVA par (régime, taux), figé à l''émission (MD-45) : bloc récapitulatif du PDF, '
  'information Swico du QR, export. Append-only par privilège : dfa_app n''a que SELECT, INSERT.';

create index document_vente_tva_document_idx on public.document_vente_tva (tenant_id, document_id);

revoke all    on public.document_vente_tva from dfa_app;
grant  select, insert on public.document_vente_tva to dfa_app;

alter table public.document_vente_tva enable row level security;
alter table public.document_vente_tva force  row level security;

create policy document_vente_tva_isolation_tenant on public.document_vente_tva
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy document_vente_tva_migrator on public.document_vente_tva
  to dfa_migrator
  using (true) with check (true);


-- ---------------------------------------------------------------------------------------------
-- 10. `paiement` (MD-50, MD-52)
-- ---------------------------------------------------------------------------------------------

create table public.paiement (
  id        uuid not null default gen_random_uuid(),
  tenant_id uuid not null,
  site_id   uuid not null,

  date_valeur       date not null,
  moyen             public.moyen_paiement not null,
  -- Signé : négatif = remboursement / contre-passation (MD-50).
  montant_centimes  bigint not null,
  devise            char(3) not null default 'CHF',
  payeur_client_id  uuid null,
  payeur_libelle    text not null,
  -- Phase 2 (camt.054), colonnes posées maintenant (§5.5 du modèle) pour ne pas migrer une table
  -- de paiements déjà volumineuse le jour où le rapprochement bancaire arrive.
  reference_qr                    text null,
  identifiant_transaction_banque  text null,
  source            public.paiement_source not null default 'manuel',
  contre_passe_id   uuid null,

  -- Export (MD-91 : « sur chaque document ET chaque paiement »). FK ajoutée en §14.
  exporte_le timestamptz null,
  export_id  uuid null,

  cree_par_id uuid null,
  cree_le     timestamptz not null default now(),
  modifie_le  timestamptz not null default now(),

  constraint paiement_pk primary key (id),
  constraint paiement_tenant_id_uk unique (tenant_id, id),
  constraint paiement_fk_site foreign key (tenant_id, site_id)
    references public.site (tenant_id, id) on delete restrict,
  constraint paiement_fk_payeur foreign key (tenant_id, payeur_client_id)
    references public.client (tenant_id, id) on delete restrict,
  constraint paiement_fk_contre_passe foreign key (tenant_id, contre_passe_id)
    references public.paiement (tenant_id, id) on delete restrict,
  constraint paiement_fk_cree_par foreign key (tenant_id, cree_par_id)
    references public.utilisateur (tenant_id, id) on delete restrict,

  -- Idempotence de l'ingestion camt.054 : un fichier importé deux fois ne crédite pas deux fois.
  constraint paiement_transaction_banque_uk unique (tenant_id, identifiant_transaction_banque),

  constraint paiement_montant_non_nul_chk check (montant_centimes <> 0),
  constraint paiement_devise_chk check (devise in ('CHF', 'EUR')),
  constraint paiement_payeur_libelle_non_vide_chk check (length(btrim(payeur_libelle)) > 0)
);

comment on table public.paiement is
  'Encaissement réel (MD-50). Immuable (MD-52) : une saisie erronée se corrige par un paiement de '
  'sens opposé (contre_passe_id), jamais par UPDATE des colonnes financières — voir '
  'paiement_verrouiller pour la liste blanche (exporte_le/export_id seuls restent modifiables).';

create trigger paiement_touche_modifie_le
  before update on public.paiement
  for each row execute function public.touche_modifie_le();

create function public.paiement_verrouiller() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $fn$
declare
  colonnes_modifiables text[] := array['exporte_le', 'export_id', 'modifie_le'];
begin
  if (to_jsonb(new) - colonnes_modifiables) is distinct from (to_jsonb(old) - colonnes_modifiables) then
    raise exception using
      errcode = 'ZDFA2',
      message = 'paiement : immuable (MD-52), seuls exporte_le/export_id restent modifiables après création. Corriger par un paiement de sens opposé (contre_passe_id).',
      detail  = format('entite=paiement;entite_id=%s', old.id);
  end if;
  return new;
end
$fn$;

revoke all on function public.paiement_verrouiller() from public;

create trigger paiement_verrouiller
  before update on public.paiement
  for each row execute function public.paiement_verrouiller();

create trigger paiement_audit
  after insert or update or delete on public.paiement
  for each row execute function public.auditer_atelier('paiement');

create index paiement_payeur_idx on public.paiement (tenant_id, payeur_client_id, date_valeur desc)
 where payeur_client_id is not null;
create index paiement_date_idx on public.paiement (tenant_id, date_valeur desc);

revoke all    on public.paiement from dfa_app;
grant  select, insert, update on public.paiement to dfa_app;
revoke delete on public.paiement from dfa_app;

alter table public.paiement enable row level security;
alter table public.paiement force  row level security;

create policy paiement_isolation_tenant on public.paiement
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy paiement_migrator on public.paiement
  to dfa_migrator
  using (true) with check (true);


-- ---------------------------------------------------------------------------------------------
-- 11. `imputation_paiement` (MD-50, MD-51)
--
-- Append-only par privilège (SELECT, INSERT seuls) : une imputation erronée se corrige par une
-- imputation de sens opposé, jamais par UPDATE/DELETE — même philosophie que paiement.
-- ---------------------------------------------------------------------------------------------

create table public.imputation_paiement (
  id           uuid not null default gen_random_uuid(),
  tenant_id    uuid not null,
  paiement_id  uuid not null,
  document_id  uuid not null,
  montant_centimes bigint not null,
  nature       public.nature_imputation not null,
  impute_le    timestamptz not null default now(),
  impute_par_id uuid null,

  cree_le timestamptz not null default now(),

  constraint imputation_paiement_pk primary key (id),
  constraint imputation_paiement_tenant_id_uk unique (tenant_id, id),
  constraint imputation_paiement_fk_paiement foreign key (tenant_id, paiement_id)
    references public.paiement (tenant_id, id) on delete restrict,
  constraint imputation_paiement_fk_document foreign key (tenant_id, document_id)
    references public.document_vente (tenant_id, id) on delete restrict,
  constraint imputation_paiement_fk_impute_par foreign key (tenant_id, impute_par_id)
    references public.utilisateur (tenant_id, id) on delete restrict,

  constraint imputation_paiement_montant_non_nul_chk check (montant_centimes <> 0)
);

comment on table public.imputation_paiement is
  'Ce que le paiement solde (MD-50). MD-51 : deux invariants agrégés, vérifiés par trigger AFTER '
  'INSERT — (a) Σ imputations d''un document ≤ |total| du document ; (b) Σ imputations de nature '
  '''reglement'' d''un paiement ≤ |montant| du paiement (restriction volontaire, voir CF-05).';

-- --- MD-51 : invariants agrégés, sous verrou de ligne (document ET paiement) pour rester exacts
-- sous concurrence — deux imputations concurrentes sur le même document/paiement se sérialisent.

create function public.imputation_paiement_verifier_invariants() returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $fn$
declare
  total_document   bigint;
  somme_imputations bigint;
  montant_paiement  bigint;
  somme_reglement   bigint;
begin
  select abs(d.total_ttc_centimes) into total_document
    from public.document_vente d
   where d.tenant_id = new.tenant_id and d.id = new.document_id
     for update;

  -- AFTER INSERT : la ligne NEW est déjà visible dans la table au moment où ce trigger s'exécute
  -- (contrairement à un BEFORE), donc cette somme inclut déjà l'imputation qui vient d'être créée.
  select coalesce(sum(abs(ip.montant_centimes)), 0) into somme_imputations
    from public.imputation_paiement ip
   where ip.tenant_id = new.tenant_id and ip.document_id = new.document_id;

  if somme_imputations > total_document then
    raise exception using
      errcode = 'ZDFA4',
      message = format('imputation_paiement : la somme des imputations (%s) dépasse le total du document (%s) (MD-51.a).', somme_imputations, total_document),
      detail  = format('entite=imputation_paiement;document_id=%s', new.document_id);
  end if;

  select abs(p.montant_centimes) into montant_paiement
    from public.paiement p
   where p.tenant_id = new.tenant_id and p.id = new.paiement_id
     for update;

  select coalesce(sum(ip.montant_centimes), 0) into somme_reglement
    from public.imputation_paiement ip
   where ip.tenant_id = new.tenant_id and ip.paiement_id = new.paiement_id
     and ip.nature = 'reglement';

  if somme_reglement > montant_paiement then
    raise exception using
      errcode = 'ZDFA4',
      message = format('imputation_paiement : la somme des imputations ''reglement'' (%s) dépasse le montant du paiement (%s) (MD-51.b).', somme_reglement, montant_paiement),
      detail  = format('entite=imputation_paiement;paiement_id=%s', new.paiement_id);
  end if;

  return null;
end
$fn$;

revoke all on function public.imputation_paiement_verifier_invariants() from public;

create trigger imputation_paiement_verifier_invariants
  after insert on public.imputation_paiement
  for each row execute function public.imputation_paiement_verifier_invariants();

create trigger imputation_paiement_audit
  after insert on public.imputation_paiement
  for each row execute function public.auditer_atelier('imputation_paiement');

create index imputation_paiement_document_idx on public.imputation_paiement (tenant_id, document_id);
create index imputation_paiement_paiement_idx on public.imputation_paiement (tenant_id, paiement_id);

revoke all    on public.imputation_paiement from dfa_app;
grant  select, insert on public.imputation_paiement to dfa_app;

alter table public.imputation_paiement enable row level security;
alter table public.imputation_paiement force  row level security;

create policy imputation_paiement_isolation_tenant on public.imputation_paiement
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy imputation_paiement_migrator on public.imputation_paiement
  to dfa_migrator
  using (true) with check (true);


-- ---------------------------------------------------------------------------------------------
-- 12. `bulletin_paiement` (MD-82, MD-83) — append-only
-- ---------------------------------------------------------------------------------------------

create table public.bulletin_paiement (
  id          uuid not null default gen_random_uuid(),
  tenant_id   uuid not null,
  document_id uuid not null,
  motif       public.motif_bulletin_paiement not null,
  qr_reference        text not null,
  qr_montant_centimes bigint null,
  qr_payload          text not null,
  qr_payload_sha256   text not null,
  emis_le     timestamptz not null default now(),
  emis_par_id uuid null,

  cree_le timestamptz not null default now(),

  constraint bulletin_paiement_pk primary key (id),
  constraint bulletin_paiement_tenant_id_uk unique (tenant_id, id),
  constraint bulletin_paiement_fk_document foreign key (tenant_id, document_id)
    references public.document_vente (tenant_id, id) on delete restrict,
  constraint bulletin_paiement_fk_emis_par foreign key (tenant_id, emis_par_id)
    references public.utilisateur (tenant_id, id) on delete restrict,
  constraint bulletin_paiement_qr_reference_non_vide_chk check (length(btrim(qr_reference)) > 0)
);

comment on table public.bulletin_paiement is
  'Bulletin de solde/relance, distinct de la facture (MD-82) : porte la MÊME référence QR que le '
  'document, le montant total du document reste inchangé (MD-64/82). Append-only.';

create index bulletin_paiement_document_idx on public.bulletin_paiement (tenant_id, document_id);
create index bulletin_paiement_reference_idx on public.bulletin_paiement (tenant_id, qr_reference);

revoke all    on public.bulletin_paiement from dfa_app;
grant  select, insert on public.bulletin_paiement to dfa_app;

alter table public.bulletin_paiement enable row level security;
alter table public.bulletin_paiement force  row level security;

create policy bulletin_paiement_isolation_tenant on public.bulletin_paiement
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy bulletin_paiement_migrator on public.bulletin_paiement
  to dfa_migrator
  using (true) with check (true);


-- ---------------------------------------------------------------------------------------------
-- 13. Export fiduciaire (MD-84→MD-94) — `mapping_compte`, `mapping_code_tva`,
-- `correspondance_externe`, `export_comptable`
-- ---------------------------------------------------------------------------------------------

-- --- 13.1 `mapping_compte` — versionné par dates (MD-86, RF-112) : on ne réécrit jamais un
-- mapping existant, on le clôt (actif_au) et on en ouvre un nouveau. EXCLUDE GiST garantissant
-- qu'aucune période valide ne chevauche une autre pour le même (usage, categorie) — même patron
-- que taux_horaire (0005).

create table public.mapping_compte (
  id        uuid not null default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  usage     public.usage_mapping_compte not null,
  categorie text not null,
  compte    text not null,
  libelle   text null,
  actif_du  date not null,
  actif_au  date null,

  cree_le    timestamptz not null default now(),
  modifie_le timestamptz not null default now(),

  constraint mapping_compte_pk primary key (id),
  constraint mapping_compte_tenant_id_uk unique (tenant_id, id),
  constraint mapping_compte_compte_non_vide_chk check (length(btrim(compte)) > 0),
  constraint mapping_compte_periode_chk check (actif_au is null or actif_au > actif_du),
  constraint mapping_compte_periode_excl
    exclude using gist (
      tenant_id with =, usage with =, categorie with =,
      daterange(actif_du, actif_au, '[)') with &&
    )
);

comment on table public.mapping_compte is
  'Plan comptable du tenant (MD-86), versionné par dates. RF-112 : on ne réécrit jamais une ligne '
  'existante — clore (actif_au) puis ouvrir une nouvelle ligne. Seul actif_au reste modifiable '
  'après création (mapping_compte_verrouiller).';

create trigger mapping_compte_touche_modifie_le
  before update on public.mapping_compte
  for each row execute function public.touche_modifie_le();

create function public.mapping_compte_verrouiller() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $fn$
declare
  colonnes_modifiables text[] := array['actif_au', 'modifie_le'];
begin
  if (to_jsonb(new) - colonnes_modifiables) is distinct from (to_jsonb(old) - colonnes_modifiables) then
    raise exception using
      errcode = 'ZDFA2',
      message = 'mapping_compte : une ligne existante n''est jamais réécrite (RF-112) — seul actif_au peut être posé pour la clore, une nouvelle ligne s''ouvre pour la suite.',
      detail  = format('entite=mapping_compte;entite_id=%s', old.id);
  end if;
  return new;
end
$fn$;

revoke all on function public.mapping_compte_verrouiller() from public;

create trigger mapping_compte_verrouiller
  before update on public.mapping_compte
  for each row execute function public.mapping_compte_verrouiller();

create trigger mapping_compte_audit
  after insert or update or delete on public.mapping_compte
  for each row execute function public.auditer_atelier('mapping_compte');

create index mapping_compte_usage_idx on public.mapping_compte (tenant_id, usage, categorie);

revoke all    on public.mapping_compte from dfa_app;
grant  select, insert, update on public.mapping_compte to dfa_app;
revoke delete on public.mapping_compte from dfa_app;

alter table public.mapping_compte enable row level security;
alter table public.mapping_compte force  row level security;

create policy mapping_compte_isolation_tenant on public.mapping_compte
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy mapping_compte_migrator on public.mapping_compte
  to dfa_migrator
  using (true) with check (true);


-- --- 13.2 `mapping_code_tva` (MD-86) : codes TVA par cible, pas versionné par dates dans le
-- modèle documentaire — une simple table de configuration, modifiable en place.

create table public.mapping_code_tva (
  id           uuid not null default gen_random_uuid(),
  tenant_id    uuid not null references public.tenant (id) on delete restrict,
  cible        public.cible_export not null,
  regime_tva   public.regime_tva   not null,
  taux_pourmille smallint not null,
  code_externe text not null,

  cree_le    timestamptz not null default now(),
  modifie_le timestamptz not null default now(),

  constraint mapping_code_tva_pk primary key (id),
  constraint mapping_code_tva_tenant_id_uk unique (tenant_id, id),
  constraint mapping_code_tva_tenant_uk unique (tenant_id, cible, regime_tva, taux_pourmille),
  constraint mapping_code_tva_taux_chk check (taux_pourmille between 0 and 1000),
  constraint mapping_code_tva_code_non_vide_chk check (length(btrim(code_externe)) > 0)
);

comment on table public.mapping_code_tva is
  'Codes TVA par cible d''export (MD-86) : indexé sur (cible, régime, taux) et non sur le seul '
  'régime — voir CF-09, un adaptateur qui remapperait sur le taux courant casserait la '
  'déclaration TVA d''un exercice passé.';

create trigger mapping_code_tva_touche_modifie_le
  before update on public.mapping_code_tva
  for each row execute function public.touche_modifie_le();

revoke all    on public.mapping_code_tva from dfa_app;
grant  select, insert, update on public.mapping_code_tva to dfa_app;
revoke delete on public.mapping_code_tva from dfa_app;

alter table public.mapping_code_tva enable row level security;
alter table public.mapping_code_tva force  row level security;

create policy mapping_code_tva_isolation_tenant on public.mapping_code_tva
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy mapping_code_tva_migrator on public.mapping_code_tva
  to dfa_migrator
  using (true) with check (true);


-- --- 13.3 `correspondance_externe` (MD-87) : identifiants rendus par l'API de la cible.

create table public.correspondance_externe (
  id         uuid not null default gen_random_uuid(),
  tenant_id  uuid not null references public.tenant (id) on delete restrict,
  cible      public.cible_export not null,
  entite     text not null,
  dfa_id     uuid not null,
  externe_id text not null,

  cree_le    timestamptz not null default now(),
  modifie_le timestamptz not null default now(),

  constraint correspondance_externe_pk primary key (id),
  constraint correspondance_externe_tenant_id_uk unique (tenant_id, id),
  constraint correspondance_externe_tenant_uk unique (tenant_id, cible, entite, dfa_id),
  constraint correspondance_externe_entite_non_vide_chk check (length(btrim(entite)) > 0),
  constraint correspondance_externe_externe_id_non_vide_chk check (length(btrim(externe_id)) > 0)
);

comment on table public.correspondance_externe is
  'Pendant de correspondance_reprise (MD-87) : évite les doublons de contacts/comptes chez la '
  'fiduciaire à chaque export. Indexée PAR CIBLE (RF-112) : un changement de fiduciaire repart '
  'vide sans effacer la correspondance de l''ancienne cible.';

create trigger correspondance_externe_touche_modifie_le
  before update on public.correspondance_externe
  for each row execute function public.touche_modifie_le();

revoke all    on public.correspondance_externe from dfa_app;
grant  select, insert, update on public.correspondance_externe to dfa_app;
revoke delete on public.correspondance_externe from dfa_app;

alter table public.correspondance_externe enable row level security;
alter table public.correspondance_externe force  row level security;

create policy correspondance_externe_isolation_tenant on public.correspondance_externe
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy correspondance_externe_migrator on public.correspondance_externe
  to dfa_migrator
  using (true) with check (true);


-- --- 13.4 `export_comptable` (MD-91) : le lot d'export, objet de première classe conservé à vie.

create table public.export_comptable (
  id     uuid not null default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  cible  public.cible_export not null,
  mode   public.mode_agregation_export not null default 'detaille',
  periode_debut date not null,
  periode_fin   date not null,

  genere_le     timestamptz not null default now(),
  genere_par_id uuid null,

  nb_ecritures          integer not null,
  total_debit_centimes  bigint  not null,
  total_credit_centimes bigint  not null,
  empreinte_sha256      text    not null,
  statut public.statut_export_comptable not null default 'genere',
  reponse_cible jsonb null,

  cree_le    timestamptz not null default now(),
  modifie_le timestamptz not null default now(),

  constraint export_comptable_pk primary key (id),
  constraint export_comptable_tenant_id_uk unique (tenant_id, id),
  constraint export_comptable_fk_genere_par foreign key (tenant_id, genere_par_id)
    references public.utilisateur (tenant_id, id) on delete restrict,
  constraint export_comptable_periode_chk check (periode_fin >= periode_debut),
  constraint export_comptable_nb_ecritures_chk check (nb_ecritures >= 0),
  -- MD-85 : l'équilibre est vérifié écriture par écriture AVANT l'appel à l'adaptateur (service) ;
  -- ce CHECK est le filet qui garantit que le LOT reste équilibré une fois stocké.
  constraint export_comptable_equilibre_chk check (total_debit_centimes = total_credit_centimes),
  constraint export_comptable_empreinte_non_vide_chk check (length(btrim(empreinte_sha256)) > 0)
);

comment on table public.export_comptable is
  'Lot d''export fiduciaire (MD-91), conservé à vie avec son empreinte — reproductible à '
  'l''identique en cas de contrôle ou de retour à une ancienne fiduciaire (RF-111).';

create trigger export_comptable_touche_modifie_le
  before update on public.export_comptable
  for each row execute function public.touche_modifie_le();

-- --- Transitions fixes (genere→transmis→{accepte,rejete}, genere→rejete) : quatre états, mêmes
-- garanties qu'une table de référentiel mais sans le coût d'une table dédiée pour si peu d'états.

create function public.export_comptable_verifier_transition() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $fn$
begin
  if old.statut = new.statut then
    return new;
  end if;
  if (old.statut, new.statut) not in (
    ('genere', 'transmis'), ('genere', 'rejete'), ('transmis', 'accepte'), ('transmis', 'rejete')
  ) then
    raise exception using
      errcode = 'ZDFA1',
      message = format('export_comptable : transition %s → %s interdite.', old.statut, new.statut),
      detail  = format('entite=export_comptable;entite_id=%s', old.id);
  end if;
  return new;
end
$fn$;

revoke all on function public.export_comptable_verifier_transition() from public;

create trigger export_comptable_verifier_transition
  before update on public.export_comptable
  for each row execute function public.export_comptable_verifier_transition();

create trigger export_comptable_audit
  after insert or update or delete on public.export_comptable
  for each row execute function public.auditer_atelier('export_comptable');

create index export_comptable_periode_idx on public.export_comptable (tenant_id, cible, periode_debut desc);

revoke all    on public.export_comptable from dfa_app;
grant  select, insert, update on public.export_comptable to dfa_app;
revoke delete on public.export_comptable from dfa_app;

alter table public.export_comptable enable row level security;
alter table public.export_comptable force  row level security;

create policy export_comptable_isolation_tenant on public.export_comptable
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy export_comptable_migrator on public.export_comptable
  to dfa_migrator
  using (true) with check (true);


-- ---------------------------------------------------------------------------------------------
-- 14. FK différées (expand, sur le modèle du §8 de 0008_atelier.sql) — cibles désormais créées
-- ---------------------------------------------------------------------------------------------

alter table public.document_vente
  add constraint document_vente_fk_export foreign key (tenant_id, export_id)
  references public.export_comptable (tenant_id, id) on delete restrict;

alter table public.paiement
  add constraint paiement_fk_export foreign key (tenant_id, export_id)
  references public.export_comptable (tenant_id, id) on delete restrict;

-- ligne_or.facture_id (0008, accroche étape 2 — commentaire "Accroche étape 2 (facturation) :
-- nullable, sans FK") reçoit enfin sa cible. Non contraint au seul type_document='facture' — ce
-- n'est pas exprimable par un CHECK inter-lignes ; le service ne l'écrit que dans ce cas.
alter table public.ligne_or
  add constraint ligne_or_fk_facture foreign key (tenant_id, facture_id)
  references public.document_vente (tenant_id, id) on delete restrict;


-- ---------------------------------------------------------------------------------------------
-- 15. RF-83 (décision @laupernoe du 29.07.2026) : facturation et restitution INDÉPENDANTES
--
-- `transition_autorisee` (0003) gagne UNE ligne : restitue → facture. `termine → facture`,
-- `termine → restitue` et `facture → restitue` existent déjà (T-16, T-18, T-17, 0003 §5.1) ;
-- seul le sens « restitué avant facturé » manquait (carrosserie qui repart avant l'accord de
-- l'assurance, six semaines avant la facture, RF-83). Aucune valeur d'enum n'est ajoutée — le
-- contrat gelé statut_ordre_reparation (0003) est respecté à l'identique, seule la table de
-- transitions gagne une ligne, exactement comme 0009 l'a fait pour ligne_or. Aucune contrainte
-- n'est ajoutée dans l'autre sens : un véhicule reste restituable sans document soldé, dans
-- TOUS les cas — c'est la substance de la décision, pas seulement cette ligne.
-- ---------------------------------------------------------------------------------------------

insert into public.transition_autorisee (entite, statut_depuis, statut_vers, exige_motif) values
  ('ordre_reparation', 'restitue', 'facture', false);


-- ---------------------------------------------------------------------------------------------
-- 16. Assertions de fin de migration
-- ---------------------------------------------------------------------------------------------

do $$
declare
  fautives text;
  n        integer;
begin
  -- 16.1 Aucun DELETE résiduel sur les tables verrouillées / append-only (Δ6).
  select string_agg(t.tbl, ', ') into fautives
    from (values
      ('document_vente'), ('document_vente_tva'), ('paiement'), ('imputation_paiement'),
      ('bulletin_paiement'), ('periode_comptable'), ('mapping_compte'), ('mapping_code_tva'),
      ('correspondance_externe'), ('export_comptable')
    ) as t(tbl)
   where has_table_privilege('dfa_app', format('public.%I', t.tbl), 'DELETE');

  if fautives is not null then
    raise exception 'DELETE encore accordé à dfa_app sur % (Δ6 violé).', fautives;
  end if;

  -- ligne_document est la SEULE exception volontaire (MD-21 : DELETE possible tant que le
  -- document parent est brouillon, bloqué par trigger ensuite) — vérifié dans l'autre sens :
  if not has_table_privilege('dfa_app', 'public.ligne_document', 'DELETE') then
    raise exception 'ligne_document : DELETE devrait être accordé à dfa_app (MD-21, bloqué par trigger, pas par privilège).';
  end if;

  -- 16.2 transition_document_autorisee : devis 6 + bon_commande 4 + facture 3 + avoir 2 = 15.
  select count(*) into n from public.transition_document_autorisee;
  if n <> 15 then
    raise exception 'transition_document_autorisee : % lignes, 15 attendues.', n;
  end if;

  -- 16.3 États terminaux de document_vente : aucune sortie déclarée depuis les statuts terminaux.
  select string_agg(t.type_document::text || '.' || t.statut_depuis::text, ', ') into fautives
    from public.transition_document_autorisee t
   where t.statut_depuis in (
     'accepte', 'refuse', 'expire', 'remplace', 'transforme', 'annule', 'annule_par_avoir', 'abandonne'
   );
  if fautives is not null then
    raise exception 'Sortie déclarée depuis un état terminal de document_vente : %.', fautives;
  end if;

  -- 16.4 ordre_reparation gagne exactement 1 transition supplémentaire (§15) : 16 (0003) + 1 = 17.
  select count(*) into n from public.transition_autorisee where entite = 'ordre_reparation';
  if n <> 17 then
    raise exception 'transition_autorisee : % transitions pour ordre_reparation après 0010, 17 attendues.', n;
  end if;

  if not exists (
    select 1 from public.transition_autorisee
     where entite = 'ordre_reparation' and statut_depuis = 'restitue' and statut_vers = 'facture'
  ) then
    raise exception '0010 : restitue -> facture absente après insertion (RF-83).';
  end if;

  -- 16.5 compteur_document : valeur_depart bien posée et cohérente sur les lignes existantes.
  if exists (select 1 from public.compteur_document where valeur < valeur_depart) then
    raise exception 'compteur_document : au moins une ligne a valeur < valeur_depart après migration.';
  end if;

  -- 16.6 Posture RLS de transition_document_autorisee (référentiel partagé, même contrôle que
  -- transition_autorisee en 0003 §7.6).
  if not has_table_privilege('dfa_app', 'public.transition_document_autorisee', 'SELECT') then
    raise exception 'dfa_app n''a pas SELECT sur transition_document_autorisee.';
  end if;

  select string_agg(p.priv, ', ' order by p.priv) into fautives
    from (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) as p(priv)
   where has_table_privilege('dfa_app', 'public.transition_document_autorisee', p.priv);
  if fautives is not null then
    raise exception 'dfa_app détient % sur transition_document_autorisee : référentiel partagé en lecture seule attendu.', fautives;
  end if;

  -- 16.7 §0.2 : le CHECK Δ-RF40 est bien posé (ceinture et bretelles — la migration elle-même n'a
  -- rien inséré qui pourrait le contredire, mais un futur DEFAULT mal copié-collé se verrait ici).
  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conname = 'ligne_document_mode_ttc_lot_pilote_chk'
       and conrelid = 'public.ligne_document'::regclass
  ) then
    raise exception 'ligne_document_mode_ttc_lot_pilote_chk manquante — §0.2 non appliqué.';
  end if;
end
$$;
