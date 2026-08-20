-- =============================================================================================
-- 0061_anonymisation_client.sql — droit à l'effacement nLPD : anonymiser un client, garder la
-- comptabilité (arbitrage @laupernoe, 20.08.2026).
--
-- CE QUE CETTE MIGRATION FAIT, ET POURQUOI C'EST TOUT CE QU'ELLE FAIT :
--
--   1. `client_anonymisation` — trace d'audit DÉDIÉE (qui a demandé l'anonymisation, quand, sur
--      quel client, pour quel motif STAFF) : append-only (aucun UPDATE/DELETE pour dfa_app), même
--      doctrine que `client_consentement`/`journal_securite`. Sert AUSSI de verrou d'idempotence
--      (`unique(tenant_id, client_id)`) : un second geste sur le même client échoue par contrainte
--      base, pas seulement par contrôle applicatif.
--
--   2. `public.anonymiser_client_donnees(tenant_id, client_id)` — fonction SECURITY DEFINER qui
--      fait le travail que `dfa_app` ne peut PAS faire avec ses seuls privilèges :
--
--        a) `client` : identité remplacée par un marqueur neutre respectant `client_identite_chk`
--           (RM-01), tout le reste des champs identifiants mis à NULL, `plus_aucun_contact` posé
--           en défense (RA-14, migration 0045) — dfa_app A déjà UPDATE sur `client`, cette partie
--           pourrait s'écrire en TypeScript, mais elle vit ICI pour rester dans la MÊME fonction
--           atomique que (b)/(c)/(d), qui eux exigent réellement le contournement de privilège.
--
--        b) `client_adresse`/`client_contact`/`client_note` : champs identifiants mis à NULL (ou
--           un texte neutre pour `client_note.texte`, contraint NOT NULL par
--           `client_note_texte_non_vide_chk`) — JAMAIS de DELETE (Δ6/RM-110, migration 0006 :
--           aucune suppression physique dans ce produit, y compris ici). dfa_app a déjà UPDATE sur
--           ces trois tables ; posé dans cette fonction pour la même raison qu'en (a).
--
--        c) `audit_atelier`, entite='client', entite_id=ce client — RÉDACTION CIBLÉE. `client`
--           porte un trigger `client_audit` (migration 0006) qui copie la ligne ENTIÈRE
--           (`to_jsonb(old)`/`to_jsonb(new)`, `auditer_atelier()`, migration 0004) dans
--           `audit_atelier` à CHAQUE création/modification passée — donc l'historique complet des
--           anciennes valeurs identifiantes du client y dort déjà, permanent, hors d'atteinte de
--           `dfa_app` (SELECT+INSERT seulement sur `audit_atelier`, jamais UPDATE — 0004 §4). Sans
--           cette étape, « anonymiser le client » serait un mensonge : son nom resterait lisible
--           dans `audit_atelier` pour toujours. La fonction retire UNIQUEMENT les clés
--           identifiantes des deux colonnes jsonb (`valeur_avant`/`valeur_apres`), sur TOUTES les
--           lignes de ce client (passées ET celle que le trigger `client_audit` insère pour
--           l'UPDATE (a) ci-dessus, dans la MÊME transaction, avant que cette étape ne s'exécute)
--           — jamais `statut`/`action`/`utilisateur_id`/`cree_le`, qui restent l'audit légitime de
--           « qui a fait quoi, quand » sur cette fiche.
--
--        d) Rattrapage BEST-EFFORT, HORS du module clients, de deux colonnes de texte libre SANS
--           lien structurel (FK) vers `client` mais susceptibles de porter le nom du client en
--           clair : `vehicule.conducteur_habituel` (scope : véhicules ayant eu une
--           `vehicule_detention` pour ce client) et `rendez_vous.commentaire` (scope :
--           `rendez_vous.client_id` = ce client). Comparaison `ilike '%nom%'` sur les valeurs
--           nom/prénom/raison sociale lues AVANT l'anonymisation (jamais de correspondance
--           partielle réécrite — tout le champ est mis à NULL en cas de correspondance, pour
--           éviter tout artefact d'une substitution regex sur un texte à ponctuation libre).
--
--        e) `client_consentement.preuve` — ARBITRAGE @laupernoe (relayé par le coordinateur, 20.08.2026),
--           REVIENT sur l'exclusion initiale de cette table (voir git blame de cette section) :
--           « On garde la preuve, mais on l'anonymise. » `client_consentement` reste la seule
--           preuve nLPD que le garage n'a pas démarché un client SANS son accord — c'est sa raison
--           d'être, et cette raison d'être SURVIT à l'anonymisation (le garage doit pouvoir la
--           montrer même après). Mais rien n'exige que la preuve porte encore l'IDENTITÉ d'une
--           personne qui a précisément demandé à disparaître, et qu'il ne démarchera plus jamais.
--           Le FAIT juridique reste, la PERSONNE s'efface :
--             - RESTENT INTACTS : `type` (la PORTÉE — quel consentement), `accorde` (le FAIT —
--               accordé ou révoqué), `recueilli_le` (la DATE), `canal` (catégorie de collecte —
--               ex. « guichet », « site_web » — jamais une donnée personnelle en soi, à la même
--               famille que `audit_atelier.action`/`.utilisateur_id` en (c) ci-dessus : le
--               COMMENT/QUAND d'un fait juridique, pas une identité).
--             - RETIRÉ : `preuve` (jsonb, structure libre — IP, capture d'écran, verbatim d'un
--               appel téléphonique… tout ce qui identifie CONCRÈTEMENT la personne) → `NULL`
--               entier, jamais une rédaction partielle de clés (contrairement à (c) sur
--               `audit_atelier`, dont le schéma jsonb — colonnes du `client` — est connu et fixe ;
--               `preuve` n'a AUCUN schéma imposé, retirer des clés nommées laisserait passer
--               n'importe quelle autre forme de preuve non anticipée).
--           MÊME MÉCANISME que (c) : `dfa_app` n'a NI UPDATE NI DELETE sur `client_consentement`
--           (0006, append-only, vérifié par une assertion dédiée en fin de cette même migration
--           0006) — c'est EXACTEMENT la situation qui justifie `security definer` : une table
--           volontairement fermée en écriture à `dfa_app`, où seule une fonction contrôlée et
--           auditée (celle-ci) peut approcher, pour ce seul usage. La doctrine d'origine de
--           `client_consentement` (commentaire de table, 0006 : « la valeur de preuve nLPD, c'est
--           l'historique complet, jamais modifié ») n'est PAS abandonnée — elle s'applique tel
--           quel à `type`/`accorde`/`recueilli_le`/`canal`, qui ne bougent JAMAIS, y compris ici.
--           Elle est ASSOUPLIE sur la seule colonne `preuve`, et UNIQUEMENT depuis ce geste
--           d'anonymisation nommé — jamais un UPDATE ordinaire, jamais depuis `dfa_app` en direct.
--
-- CE QUE CETTE MIGRATION NE TOUCHE DÉLIBÉRÉMENT PAS (voir le rapport de tâche pour le recensement
-- complet, y compris les emplacements HORS du périmètre d'écriture de cette tâche) :
--
--   - `document_vente.client_designation_figee`/`.client_ide_fige`/`.adresse_facturation_figee`
--     et `ordre_reparation.client_designation_figee`/`.adresse_facturation_figee`/
--     `.conducteur_present_nom`/`.plaque_figee` — arbitrage @laupernoe littéral : « les factures, ordres
--     de réparation et écritures comptables restent en place, montants et dates intacts ». Un
--     document de vente ÉMIS est verrouillé (CONTRIBUTING.md) ; le corriger reviendrait à réécrire une
--     facture, ce que ce produit interdit structurellement (correction par avoir seulement). Le
--     bulletin QR-facture (RF-60) a en outre BESOIN du débiteur en clair pour rester un document
--     de paiement valide. `devis_complementaire.interlocuteur_nom`/`.retranscription` : même
--     famille (rattachés à l'OR par `ordre_reparation_id`), même exclusion.
--   - `relance_envoi.destinataire_fige`/`.contenu_fige` (`db/schema/relances/relance-envoi.ts`) —
--     DONNÉE PERSONNELLE FIGÉE explicitement documentée (RA-12) : adresse de destinataire et texte
--     RÉELLEMENT envoyé (donc portant le nom du client dans la formule de politesse). Table du
--     module `relances`, hors du périmètre d'écriture de cette tâche — signalé en clair dans le
--     rapport de tâche comme le résidu le PLUS sérieux de ce recensement, à traiter par l'agent
--     propriétaire de `apps/api/src/relances/` (jointure `relance_envoi.relance_planifiee_id` →
--     `relance_planifiee.client_id`).
--   - Journalisation applicative des envois de courriel (`courriel/service-courriel.ts`) — hors
--     base de données (logs structurés), donc hors périmètre d'une migration ; relève d'une
--     politique de rétention de logs, pas d'un DELETE/UPDATE SQL.
--   - `client_condition`, `dossier_vente`, `reprise`, `financement_vente`,
--     `vehicule_ocr_scan_journal` — examinés, ne portent AUCUNE donnée identifiante propre au
--     client (uniquement des FK vers `client`, déjà couvertes par l'anonymisation de la fiche
--     elle-même, ou des montants/conditions commerciales qui ne sont pas des données à caractère
--     personnel). `vehicule_ocr_scan_journal` (migration 0058) est un bon exemple de conception
--     préventive : conçue dès le départ pour ne JAMAIS porter de donnée personnelle lue (booléens
--     et FK seulement) — rien à corriger.
--
-- SÉCURITÉ — `anonymiser_client_donnees()` est `security definer`, donc exécutée avec les
-- privilèges de son PROPRIÉTAIRE (dfa_migrator), dont la politique RLS sur CHAQUE table touchée
-- est `using (true)` (bypass total du filtrage tenant — voir `<table>_migrator` sur `client`,
-- `client_adresse`, `client_contact`, `client_note`, `client_consentement`, `audit_atelier`,
-- `vehicule`, `rendez_vous`).
-- CONTRIBUTING.md : « le RLS est le filet de sécurité, pas le mécanisme principal » — ici RLS ne filtre
-- STRUCTURELLEMENT rien pendant l'exécution de cette fonction. CHAQUE instruction de son corps
-- porte donc un `where tenant_id = p_tenant_id` explicite, jamais une confiance implicite dans une
-- policy. `revoke all ... from public` + `grant execute ... to dfa_app` SEULEMENT : aucun autre
-- rôle applicatif ne peut l'appeler.
--
-- NUMÉROTATION : 0060 est la dernière migration existante au moment où cette tâche démarre.
-- Numéro 0061 réservé par consigne de tâche (un autre agent travaille en parallèle sur 0062,
-- périmètre disjoint).
--
-- Réversible : migrations/down/0061_anonymisation_client.down.sql.
-- =============================================================================================


-- ---------------------------------------------------------------------------------------------
-- 1. `client_anonymisation` — traçabilité (qui/quand/quel client/pour quel motif STAFF), JAMAIS
--    les données personnelles elles-mêmes.
-- ---------------------------------------------------------------------------------------------

create table public.client_anonymisation (
  id             uuid        not null default gen_random_uuid(),
  tenant_id      uuid        not null references public.tenant (id) on delete restrict,
  client_id      uuid        not null,
  utilisateur_id uuid        not null,
  -- Raison STAFF de la demande (ex. « demande écrite du client, art. 32 LPD, reçue le 18.08.2026 »)
  -- — jamais les données personnelles du client lui-même : convention d'usage, non applicable en
  -- CHECK (un motif est du texte libre par nature dans tout ce dépôt, voir client_note.texte).
  motif          text        not null,
  cree_le        timestamptz not null default now(),

  constraint client_anonymisation_pk primary key (id),
  constraint client_anonymisation_tenant_id_uk unique (tenant_id, id),
  -- Verrou d'idempotence en base : anonymiser deux fois le même client échoue par contrainte,
  -- jamais seulement par un contrôle applicatif contournable.
  constraint client_anonymisation_tenant_client_uk unique (tenant_id, client_id),
  constraint client_anonymisation_fk_client foreign key (tenant_id, client_id)
    references public.client (tenant_id, id) on delete restrict,
  constraint client_anonymisation_fk_utilisateur foreign key (tenant_id, utilisateur_id)
    references public.utilisateur (tenant_id, id) on delete restrict,
  constraint client_anonymisation_motif_non_vide_chk check (length(btrim(motif)) > 0)
);

comment on table public.client_anonymisation is
  'Trace nLPD (RGPD suisse) : qui a demandé l''anonymisation d''un client, quand, pour quel motif '
  'STAFF — jamais les données personnelles effacées par le geste. Append-only : dfa_app n''a que '
  'SELECT, INSERT (voir grants ci-dessous). unique(tenant_id, client_id) = un seul geste par '
  'client, irréversible.';

create index client_anonymisation_client_idx on public.client_anonymisation (tenant_id, client_id);

revoke all    on public.client_anonymisation from dfa_app;
grant  select, insert on public.client_anonymisation to dfa_app;

alter table public.client_anonymisation enable row level security;
alter table public.client_anonymisation force  row level security;

create policy client_anonymisation_isolation_tenant on public.client_anonymisation
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy client_anonymisation_migrator on public.client_anonymisation
  to dfa_migrator
  using (true) with check (true);


-- ---------------------------------------------------------------------------------------------
-- 2. `public.anonymiser_client_donnees(tenant_id, client_id)` — voir l'en-tête de fichier pour le
--    détail complet de ce que fait chaque étape et pourquoi.
-- ---------------------------------------------------------------------------------------------

create function public.anonymiser_client_donnees(p_tenant_id uuid, p_client_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_nom            text;
  v_prenom         text;
  v_raison_sociale text;
  v_type           public.type_client;
  v_placeholder    constant text := 'Client anonymisé';
  v_note_placeholder constant text := '[Anonymisé — droit à l''effacement nLPD]';
  v_cles_pii       constant text[] := array[
    'civilite', 'nom', 'prenom', 'raison_sociale', 'ide',
    'email', 'telephone', 'telephone_e164', 'canal_prefere', 'reference_externe', 'motif'
  ];
begin
  -- Valeurs AVANT scrub, pour le rattrapage best-effort (d) plus bas. `for update` : verrou de
  -- ligne, défense contre une lecture concurrente pendant que cette même transaction s'apprête à
  -- la modifier (au même titre que toute autre écriture de ce produit sur `client`).
  select nom, prenom, raison_sociale, type
    into v_nom, v_prenom, v_raison_sociale, v_type
    from public.client
   where tenant_id = p_tenant_id and id = p_client_id
   for update;

  if not found then
    raise exception 'anonymiser_client_donnees : client introuvable (tenant_id=%, client_id=%).',
      p_tenant_id, p_client_id;
  end if;

  -- (a) Fiche client — identité neutralisée, CHECK client_identite_chk respectée par construction
  -- (le type ne change pas, seul le champ requis PAR ce type reçoit le marqueur neutre).
  update public.client
     set civilite          = null,
         nom               = case when v_type = 'particulier' then v_placeholder else null end,
         prenom            = null,
         raison_sociale    = case when v_type = 'entreprise' then v_placeholder else null end,
         ide               = null,
         email             = null,
         telephone         = null,
         telephone_e164    = null,
         canal_prefere     = null,
         reference_externe = null,
         -- RA-14 (migration 0045) en défense : plus aucune relance/courriel ne doit être tentée
         -- vers une fiche anonymisée — motif requis par client_plus_aucun_contact_motif_chk.
         plus_aucun_contact = true,
         motif              = 'Anonymisé (droit à l''effacement nLPD).'
   where tenant_id = p_tenant_id and id = p_client_id;

  -- (b) Satellites — soft-null en place, JAMAIS de DELETE (Δ6/RM-110, dfa_app n'a d'ailleurs pas
  -- ce privilège sur ces trois tables : voir migration 0006).
  update public.client_adresse
     set rue = null, complement = null, npa = null, localite = null
   where tenant_id = p_tenant_id and client_id = p_client_id;

  update public.client_contact
     set nom = null, prenom = null, fonction = null,
         telephone = null, telephone_e164 = null, email = null
   where tenant_id = p_tenant_id and client_id = p_client_id;

  update public.client_note
     set texte = v_note_placeholder
   where tenant_id = p_tenant_id and client_id = p_client_id;

  -- (c) Rédaction ciblée de l'historique d'audit générique pour CETTE fiche — voir l'en-tête de
  -- fichier §c. `jsonb - text[]` retire chaque clé listée si présente, no-op sinon ; NULL - array
  -- reste NULL (action 'creation'/'annulation' peut laisser une des deux colonnes nulle), sans
  -- erreur. Couvre AUSSI la ligne que le trigger client_audit vient d'insérer pour l'UPDATE (a)
  -- ci-dessus, dans la MÊME transaction, puisque le filtre porte sur entite_id, pas sur cree_le.
  update public.audit_atelier
     set valeur_avant = valeur_avant - v_cles_pii,
         valeur_apres = valeur_apres - v_cles_pii
   where tenant_id = p_tenant_id
     and entite = 'client'::public.entite_auditee
     and entite_id = p_client_id;

  -- (d) Rattrapage best-effort, texte libre HORS module clients — voir l'en-tête de fichier §d.
  -- Ignoré si les trois valeurs sont vides (client déjà sans nom exploitable — ne devrait pas se
  -- produire, `client_identite_chk` l'interdit, mais reste défensif).
  if coalesce(btrim(v_nom), '') <> '' or coalesce(btrim(v_prenom), '') <> ''
     or coalesce(btrim(v_raison_sociale), '') <> '' then

    update public.vehicule veh
       set conducteur_habituel = null
      from public.vehicule_detention vd
     where veh.tenant_id = p_tenant_id
       and vd.tenant_id = p_tenant_id
       and vd.vehicule_id = veh.id
       and vd.client_id = p_client_id
       and veh.conducteur_habituel is not null
       and (
         (v_nom is not null and btrim(v_nom) <> '' and veh.conducteur_habituel ilike '%' || v_nom || '%')
         or (v_prenom is not null and btrim(v_prenom) <> '' and veh.conducteur_habituel ilike '%' || v_prenom || '%')
         or (v_raison_sociale is not null and btrim(v_raison_sociale) <> '' and veh.conducteur_habituel ilike '%' || v_raison_sociale || '%')
       );

    update public.rendez_vous
       set commentaire = null
     where tenant_id = p_tenant_id
       and client_id = p_client_id
       and commentaire is not null
       and (
         (v_nom is not null and btrim(v_nom) <> '' and commentaire ilike '%' || v_nom || '%')
         or (v_prenom is not null and btrim(v_prenom) <> '' and commentaire ilike '%' || v_prenom || '%')
         or (v_raison_sociale is not null and btrim(v_raison_sociale) <> '' and commentaire ilike '%' || v_raison_sociale || '%')
       );
  end if;

  -- (e) `client_consentement.preuve` — voir l'en-tête de fichier §e (arbitrage @laupernoe, 20.08.2026) :
  -- « on garde la preuve, mais on l'anonymise ». Le FAIT (`accorde`), la PORTÉE (`type`), la DATE
  -- (`recueilli_le`) et le canal de collecte NE BOUGENT JAMAIS — seule `preuve` (structure libre,
  -- sans schéma imposé) est retirée EN ENTIER, jamais une rédaction de clés nommées.
  update public.client_consentement
     set preuve = null
   where tenant_id = p_tenant_id
     and client_id = p_client_id
     and preuve is not null;
end
$fn$;

comment on function public.anonymiser_client_donnees(uuid, uuid) is
  'SECURITY DEFINER — droit à l''effacement nLPD (arbitrage @laupernoe, 20.08.2026) : neutralise '
  'l''identité d''un client, ses satellites (adresse/contact/note), redacte l''historique '
  'audit_atelier de sa fiche, retire client_consentement.preuve (garde type/accorde/recueilli_le/ '
  'canal — le FAIT juridique du consentement survit, la personne s''efface), et rattrape en '
  'best-effort deux colonnes de texte libre hors module clients (vehicule.conducteur_habituel, '
  'rendez_vous.commentaire). Ne touche JAMAIS les documents de vente ni les ordres de réparation '
  '(arbitrage : « restent en place, montants et dates intacts »). Chaque instruction scope '
  'tenant_id EXPLICITEMENT : RLS ne filtre rien pendant l''exécution (propriétaire dfa_migrator, '
  'policy `using (true)` sur toutes les tables touchées).';

revoke all on function public.anonymiser_client_donnees(uuid, uuid) from public;
grant execute on function public.anonymiser_client_donnees(uuid, uuid) to dfa_app;


-- ---------------------------------------------------------------------------------------------
-- 3. Assertions de fin de migration — même doctrine que 0006/0002 (la posture se vérifie, pas
--    seulement se déclare).
-- ---------------------------------------------------------------------------------------------

do $$
begin
  if has_table_privilege('dfa_app', 'public.client_anonymisation', 'DELETE') then
    raise exception '0061 : dfa_app détient DELETE sur client_anonymisation (append-only attendu).';
  end if;
  if has_table_privilege('dfa_app', 'public.client_anonymisation', 'UPDATE') then
    raise exception '0061 : dfa_app détient UPDATE sur client_anonymisation (append-only attendu).';
  end if;
  if not has_function_privilege('dfa_app', 'public.anonymiser_client_donnees(uuid, uuid)', 'EXECUTE') then
    raise exception '0061 : dfa_app n''a pas EXECUTE sur anonymiser_client_donnees.';
  end if;
  if has_function_privilege('public', 'public.anonymiser_client_donnees(uuid, uuid)', 'EXECUTE') then
    raise exception '0061 : PUBLIC détient encore EXECUTE sur anonymiser_client_donnees.';
  end if;
end
$$;
