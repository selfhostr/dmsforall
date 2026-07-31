-- =============================================================================================
-- 0032_ventes.sql — étape 4 (Ventes VN/VO) : `vehicule_stock`, `dossier_vente`, `reprise`,
-- `financement_vente`. Spécification : docs/specification-etape-4-ventes.md, repères
-- RV-01→RV-62, machines à états §6.1→§6.3.
--
-- PRÉALABLE 0031 : `entite_auditee` gagne les quatre valeurs de ce module dans une migration
-- SÉPARÉE et ANTÉRIEURE (0031_ventes_entite_auditee.sql), pas ici — même raison que
-- 0023/0024 pour les pièces : PostgreSQL refuse qu'une valeur ajoutée par `ALTER TYPE ... ADD
-- VALUE` soit COMPARÉE dans la même transaction (ce que fait `insert into transition_autorisee`
-- ci-dessous, §7).
--
-- DÉCISION DE CONCEPTION N°1 — véhicule en stock : MÊME enregistrement `vehicule` que l'atelier
-- connaît, enrichi (RV-01, littéral : « il n'existe pas de table véhicule de vente séparée »).
-- `vehicule_stock.id` EST `vehicule.id` — pas de second identifiant. Voir
-- schema/ventes/vehicule-stock.ts pour la justification complète et le signalement de la colonne
-- `vehicule.vehicule_stock_id` devenue redondante avec ce choix (hors périmètre d'écriture de
-- cette migration, non touchée ici).
--
-- MACHINES À ÉTATS : réutilisent le dispositif GÉNÉRIQUE déjà en place depuis 0003
-- (`transition_autorisee` + `verifier_transition()`), même doctrine que
-- `document_vente`/`ordre_reparation`/`ligne_or`/`commande_fournisseur`. CONTRAINTE DE NOMMAGE
-- constatée en écrivant cette migration (`transition_autorisee_valide_contenu()`, 0003 §4.3) :
-- le type Postgres associé à l'entité `<entite>` doit s'appeler EXACTEMENT `statut_<entite>`.
-- Deux des quatre types ci-dessous portent donc un nom différent de celui suggéré par les
-- commentaires de `contrats/ventes/enums.ts` (`statut_vehicule_stock` et non
-- `statut_commercial_vehicule` ; `statut_financement_vente` et non
-- `statut_confirmation_financement`) — signalé à l'orchestrateur, voir
-- schema/ventes/enums.ts en-tête. Les VALEURS de chaque type restent identiques aux constantes
-- partagées.
--
-- ORDRE DE CRÉATION — `vehicule_stock` et `dossier_vente` se référencent mutuellement
-- (`vehicule_stock.origine_reprise_dossier_vente_id → dossier_vente.id`,
-- `dossier_vente.vehicule_id → vehicule_stock.id`) : `vehicule_stock` est créée SANS la première
-- FK (§2), `dossier_vente` est créée ensuite (§3, peut alors référencer `vehicule_stock`), puis
-- la FK manquante est posée par `ALTER TABLE` (§4) — technique standard pour une paire de tables
-- en référence croisée, même esprit que `document_vente_fk_source`/`document_vente_fk_remplace`
-- (0010) qui se referencent elles-mêmes.
--
-- QUESTION FISCALE NON TRANCHÉE, DÉLIBÉRÉMENT ABSENTE D'ICI (RV-22/QV-05, rappelée par
-- contrats/ventes/reprise.ts en tête de fichier) : le traitement TVA de la reprise gonflée
-- (base de calcul sur la valeur négociée ou la valeur marchande objective) appartient à @laupernoe. Ce
-- module pose `valeur_estimee_centimes` et `valeur_negociee_centimes` comme deux colonnes
-- TOUJOURS distinctes (RV-19/RV-20) et ne calcule ni ne fige AUCUNE base TVA — aucune règle
-- fiscale codée en dur.
-- =============================================================================================


-- ---------------------------------------------------------------------------------------------
-- 1. Types enum
-- ---------------------------------------------------------------------------------------------

create type public.statut_vehicule_stock as enum (
  'en_commande', 'disponible', 'reserve', 'vendu', 'livre'
);

create type public.statut_dossier_vente as enum (
  'prospection', 'engage', 'en_preparation', 'pret_a_livrer', 'livre', 'clos', 'annule', 'abandonne'
);

create type public.statut_reprise as enum (
  'estimee', 'negociee', 'confirmee', 'refusee'
);

create type public.type_financement_vente as enum (
  'comptant', 'credit', 'leasing'
);

create type public.statut_financement_vente as enum (
  'en_attente', 'confirme', 'refuse'
);


-- ---------------------------------------------------------------------------------------------
-- 2. `vehicule_stock` — RV-01→RV-14, §6.1
-- ---------------------------------------------------------------------------------------------

create table public.vehicule_stock (
  id                                uuid                          not null,
  tenant_id                         uuid                          not null references public.tenant (id) on delete restrict,
  site_id                           uuid                          not null,
  provenance                        text                          not null,
  date_entree_stock                 date                          not null,
  prix_achat_centimes               integer                       not null,
  prix_vente_affiche_centimes       integer                       null,
  statut                            public.statut_vehicule_stock  not null,
  vendeur_precedent_assujetti       boolean                       null,
  -- FK vers dossier_vente posée en §4 : dossier_vente n'existe pas encore à ce point (référence
  -- croisée, voir en-tête).
  origine_reprise_dossier_vente_id  uuid                          null,
  dernier_motif_transition          text                          null,
  receptionne_le                    timestamptz                   null,
  reserve_le                        timestamptz                   null,
  vendu_le                          timestamptz                   null,
  livre_le                          timestamptz                   null,
  version                           integer                       not null default 1,
  cree_le                           timestamptz                   not null default now(),
  modifie_le                        timestamptz                   not null default now(),

  constraint vehicule_stock_pk primary key (id),
  constraint vehicule_stock_tenant_id_uk unique (tenant_id, id),
  -- RV-01 : id PARTAGÉ avec vehicule, pas un second identifiant. L'EXISTENCE d'une ligne ici est
  -- le marqueur « ce véhicule est/a été en stock ».
  constraint vehicule_stock_fk_vehicule
    foreign key (tenant_id, id) references public.vehicule (tenant_id, id) on delete restrict,
  constraint vehicule_stock_fk_site
    foreign key (tenant_id, site_id) references public.site (tenant_id, id) on delete restrict,
  constraint vehicule_stock_provenance_non_vide_chk check (length(btrim(provenance)) > 0),
  constraint vehicule_stock_prix_achat_chk check (prix_achat_centimes >= 0),
  constraint vehicule_stock_prix_vente_affiche_chk
    check (prix_vente_affiche_centimes is null or prix_vente_affiche_centimes >= 0),
  constraint vehicule_stock_origine_reprise_coherente_chk
    check (origine_reprise_dossier_vente_id is null or provenance = 'reprise'),
  -- RV-09 : « en_commande » (VN pas encore livré) n'a de sens que pour une provenance
  -- neuf_constructeur.
  constraint vehicule_stock_en_commande_provenance_chk
    check (statut <> 'en_commande' or provenance = 'neuf_constructeur')
);

comment on table public.vehicule_stock is
  'Véhicule en stock à vendre (RV-01→RV-14, §6.1) — EXTENSION 1:1 de vehicule, id partagé, pas '
  'une table racine séparée. Machine à états portée par transition_autorisee '
  '(entite=''vehicule_stock'', type PG statut_vehicule_stock) + verifier_transition() — '
  'dispositif générique de 0003, pas une réimplémentation. Auditée.';

comment on column public.vehicule_stock.id is
  'EST vehicule.id — RV-01, littéral : pas de second identifiant. Fourni par le service, jamais '
  'gen_random_uuid() ici.';

create trigger vehicule_stock_touche_modifie_le
  before update on public.vehicule_stock
  for each row execute function public.touche_modifie_le();

create trigger vehicule_stock_verifier_transition
  before update on public.vehicule_stock
  for each row execute function public.verifier_transition('vehicule_stock');

create trigger vehicule_stock_audit
  after insert or update or delete on public.vehicule_stock
  for each row execute function public.auditer_atelier('vehicule_stock');

revoke all    on public.vehicule_stock from dfa_app;
grant  select, insert, update on public.vehicule_stock to dfa_app;

alter table public.vehicule_stock enable row level security;
alter table public.vehicule_stock force  row level security;

create policy vehicule_stock_isolation_tenant on public.vehicule_stock
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy vehicule_stock_migrator on public.vehicule_stock
  to dfa_migrator
  using (true) with check (true);

create index vehicule_stock_site_statut_idx
  on public.vehicule_stock (tenant_id, site_id, statut);
create index vehicule_stock_date_entree_idx
  on public.vehicule_stock (tenant_id, date_entree_stock desc);
create index vehicule_stock_prix_vente_idx
  on public.vehicule_stock (tenant_id, prix_vente_affiche_centimes)
  where prix_vente_affiche_centimes is not null;
create index vehicule_stock_origine_reprise_idx
  on public.vehicule_stock (tenant_id, origine_reprise_dossier_vente_id)
  where origine_reprise_dossier_vente_id is not null;


-- ---------------------------------------------------------------------------------------------
-- 3. `dossier_vente` — RV-29→RV-38, §6.2
-- ---------------------------------------------------------------------------------------------

create table public.dossier_vente (
  id                        uuid        not null default gen_random_uuid(),
  tenant_id                 uuid        not null references public.tenant (id) on delete restrict,
  site_id                   uuid        not null,
  statut                    public.statut_dossier_vente not null default 'prospection',
  vehicule_id               uuid        null,
  client_acheteur_id        uuid        not null,
  client_facture_id         uuid        null,
  client_conducteur_id      uuid        null,
  date_livraison_estimee    date        null,
  date_livraison_effective  date        null,
  -- RV-34 : identité vérifiée à la signature du bon de commande, renseignés par l'action
  -- "engager" (contrats/ventes/dossier-vente.ts::schemaActionEngager.identitePieceType,
  -- obligatoire à cette action).
  identite_piece_type       text        null,
  identite_verifiee_le      timestamptz null,
  -- Horodatage de chaque transition du diagramme §6.2 (contrat, ReponseDossierVente) — un par
  -- état entrant, hors "prospection" (== cree_le, jamais dupliqué ici).
  engage_le                 timestamptz null,
  en_preparation_le         timestamptz null,
  pret_a_livrer_le          timestamptz null,
  livre_le                  timestamptz null,
  clos_le                   timestamptz null,
  annule_le                 timestamptz null,
  abandonne_le              timestamptz null,
  motif_cloture             text        null,
  version                   integer     not null default 1,
  cree_le                   timestamptz not null default now(),
  modifie_le                timestamptz not null default now(),

  constraint dossier_vente_pk primary key (id),
  constraint dossier_vente_tenant_id_uk unique (tenant_id, id),
  constraint dossier_vente_fk_site
    foreign key (tenant_id, site_id) references public.site (tenant_id, id) on delete restrict,
  constraint dossier_vente_fk_vehicule_stock
    foreign key (tenant_id, vehicule_id) references public.vehicule_stock (tenant_id, id) on delete restrict,
  constraint dossier_vente_fk_client_acheteur
    foreign key (tenant_id, client_acheteur_id) references public.client (tenant_id, id) on delete restrict,
  constraint dossier_vente_fk_client_facture
    foreign key (tenant_id, client_facture_id) references public.client (tenant_id, id) on delete restrict,
  constraint dossier_vente_fk_client_conducteur
    foreign key (tenant_id, client_conducteur_id) references public.client (tenant_id, id) on delete restrict,
  -- RV-30, littéral : « l'association au véhicule en stock devient obligatoire au passage à
  -- l'état engagé ».
  constraint dossier_vente_vehicule_requis_engage_chk
    check (statut = 'prospection' or vehicule_id is not null),
  constraint dossier_vente_motif_cloture_chk
    check (statut not in ('annule', 'abandonne') or motif_cloture is not null)
);

comment on table public.dossier_vente is
  'Dossier de vente (RV-29→RV-38, §6.2) — objet central du module, lie véhicule en stock, '
  'client(s), reprise et financement optionnels, documents de facturation (document_vente.'
  'dossier_vente_id). Machine à états portée par transition_autorisee '
  '(entite=''dossier_vente'') + verifier_transition() — dispositif générique de 0003. Auditée.';

create trigger dossier_vente_touche_modifie_le
  before update on public.dossier_vente
  for each row execute function public.touche_modifie_le();

create trigger dossier_vente_verifier_transition
  before update on public.dossier_vente
  for each row execute function public.verifier_transition('dossier_vente');

create trigger dossier_vente_audit
  after insert or update or delete on public.dossier_vente
  for each row execute function public.auditer_atelier('dossier_vente');

revoke all    on public.dossier_vente from dfa_app;
grant  select, insert, update on public.dossier_vente to dfa_app;

alter table public.dossier_vente enable row level security;
alter table public.dossier_vente force  row level security;

create policy dossier_vente_isolation_tenant on public.dossier_vente
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy dossier_vente_migrator on public.dossier_vente
  to dfa_migrator
  using (true) with check (true);

create index dossier_vente_pagination_idx
  on public.dossier_vente (tenant_id, cree_le desc, id desc);
create index dossier_vente_client_acheteur_idx
  on public.dossier_vente (tenant_id, client_acheteur_id);
create index dossier_vente_statut_idx
  on public.dossier_vente (tenant_id, statut);

-- RV-10, verrou de concurrence (CV-01) : un véhicule ENGAGÉ (bon de commande signé jusqu'à
-- pret_a_livrer inclus, avant facturation) ne peut pas être engagé par un second dossier en même
-- temps. `prospection` (simple devis, plusieurs vendeurs peuvent proposer le même véhicule) et
-- les états post-facturation (`livre`, `clos`) sont volontairement EXCLUS : le même véhicule
-- physique peut légitimement redevenir l'objet d'une reprise puis d'une nouvelle vente des années
-- plus tard (§7.6, CV-06) — un index unique permanent bloquerait ce cas réel.
create unique index dossier_vente_vehicule_engage_uk
  on public.dossier_vente (tenant_id, vehicule_id)
  where vehicule_id is not null and statut in ('engage', 'en_preparation', 'pret_a_livrer');


-- ---------------------------------------------------------------------------------------------
-- 4. FK manquante sur `vehicule_stock` (référence croisée, voir en-tête)
-- ---------------------------------------------------------------------------------------------

alter table public.vehicule_stock
  add constraint vehicule_stock_fk_origine_reprise
  foreign key (tenant_id, origine_reprise_dossier_vente_id)
  references public.dossier_vente (tenant_id, id) on delete restrict;


-- ---------------------------------------------------------------------------------------------
-- 5. `reprise` — RV-19→RV-28, §6.3
-- ---------------------------------------------------------------------------------------------

create table public.reprise (
  id                                     uuid        not null default gen_random_uuid(),
  tenant_id                              uuid        not null,
  dossier_vente_id                       uuid        not null,
  vehicule_reprise_id                    uuid        not null,
  statut                                 public.statut_reprise not null default 'estimee',
  valeur_estimee_centimes                integer     not null,
  valeur_negociee_centimes               integer     null,
  dette_financement_residuelle_centimes  integer     null,
  dette_financement_organisme_id         uuid        null,
  dette_financement_organisme_nom        text        null,
  motif_refus                            text        null,
  estimee_le                             timestamptz not null default now(),
  negociee_le                            timestamptz null,
  confirmee_le                           timestamptz null,
  refusee_le                             timestamptz null,
  version                                integer     not null default 1,
  cree_le                                timestamptz not null default now(),
  modifie_le                             timestamptz not null default now(),

  constraint reprise_pk primary key (id),
  constraint reprise_tenant_id_uk unique (tenant_id, id),
  -- Sous-ressource SINGULIÈRE d'un dossier (contrats/ventes/reprise.ts, littéral : « au plus une
  -- par dossier, 409 sinon »).
  constraint reprise_tenant_dossier_uk unique (tenant_id, dossier_vente_id),
  constraint reprise_fk_dossier_vente
    foreign key (tenant_id, dossier_vente_id) references public.dossier_vente (tenant_id, id) on delete restrict,
  constraint reprise_fk_vehicule_reprise
    foreign key (tenant_id, vehicule_reprise_id) references public.vehicule (tenant_id, id) on delete restrict,
  constraint reprise_fk_dette_organisme
    foreign key (tenant_id, dette_financement_organisme_id) references public.client (tenant_id, id) on delete restrict,
  constraint reprise_valeur_estimee_chk check (valeur_estimee_centimes >= 0),
  constraint reprise_valeur_negociee_chk
    check (valeur_negociee_centimes is null or valeur_negociee_centimes >= 0),
  constraint reprise_dette_residuelle_chk
    check (dette_financement_residuelle_centimes is null or dette_financement_residuelle_centimes >= 0),
  -- RV-27 : une reprise confirmée est liée à un bon de commande déjà signé, donc à une valeur
  -- négociée déjà connue.
  constraint reprise_valeur_negociee_requise_chk
    check (statut = 'estimee' or valeur_negociee_centimes is not null),
  constraint reprise_motif_refus_chk check (statut <> 'refusee' or motif_refus is not null),
  constraint reprise_dette_organisme_nom_non_vide_chk
    check (dette_financement_organisme_nom is null or length(btrim(dette_financement_organisme_nom)) > 0),
  -- contrats/ventes/reprise.ts, littéral : « au moins l'un des deux [organismeId, organismeNom]
  -- est renseigné quand la dette n'est pas null — non vérifié par le TYPE, vérifié serveur ».
  -- CHECK posé ici EN PLUS du contrôle serveur annoncé par le contrat (défense en profondeur).
  constraint reprise_dette_organisme_coherent_chk
    check (dette_financement_residuelle_centimes is null
           or dette_financement_organisme_id is not null
           or dette_financement_organisme_nom is not null)
);

comment on table public.reprise is
  'Reprise du véhicule client (RV-19→RV-28, §6.3) — sous-ressource singulière d''un dossier de '
  'vente, au plus une par dossier. Les deux valeurs (estimée/négociée) restent TOUJOURS '
  'distinctes (RV-19/RV-20, reprise gonflée) : aucune fusion, aucune base TVA calculée ici '
  '(RV-22/QV-05, non tranché). Machine à états portée par transition_autorisee '
  '(entite=''reprise'') + verifier_transition() — dispositif générique de 0003. Auditée.';

create trigger reprise_touche_modifie_le
  before update on public.reprise
  for each row execute function public.touche_modifie_le();

create trigger reprise_verifier_transition
  before update on public.reprise
  for each row execute function public.verifier_transition('reprise');

create trigger reprise_audit
  after insert or update or delete on public.reprise
  for each row execute function public.auditer_atelier('reprise');

revoke all    on public.reprise from dfa_app;
grant  select, insert, update on public.reprise to dfa_app;

alter table public.reprise enable row level security;
alter table public.reprise force  row level security;

create policy reprise_isolation_tenant on public.reprise
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy reprise_migrator on public.reprise
  to dfa_migrator
  using (true) with check (true);

create index reprise_vehicule_reprise_idx
  on public.reprise (tenant_id, vehicule_reprise_id);


-- ---------------------------------------------------------------------------------------------
-- 6. `financement_vente` — RV-39→RV-45
-- ---------------------------------------------------------------------------------------------

create table public.financement_vente (
  id                 uuid        not null default gen_random_uuid(),
  tenant_id          uuid        not null,
  dossier_vente_id   uuid        not null,
  type               public.type_financement_vente not null,
  organisme_id       uuid        null,
  reference_contrat  text        null,
  statut             public.statut_financement_vente not null,
  confirme_le        timestamptz null,
  refuse_le          timestamptz null,
  motif_refus        text        null,
  version            integer     not null default 1,
  cree_le            timestamptz not null default now(),
  modifie_le         timestamptz not null default now(),

  constraint financement_vente_pk primary key (id),
  constraint financement_vente_tenant_id_uk unique (tenant_id, id),
  constraint financement_vente_fk_dossier_vente
    foreign key (tenant_id, dossier_vente_id) references public.dossier_vente (tenant_id, id) on delete restrict,
  constraint financement_vente_fk_organisme
    foreign key (tenant_id, organisme_id) references public.client (tenant_id, id) on delete restrict,
  -- contrats/ventes/financement.ts, littéral : « organismeId obligatoire côté serveur pour
  -- credit/leasing » — les DEUX types, pas seulement leasing (RV-39/40 pris isolément aurait
  -- suggéré leasing seul, le contrat gelé est plus précis).
  constraint financement_vente_organisme_requis_chk
    check (type = 'comptant' or organisme_id is not null),
  constraint financement_vente_motif_refus_chk
    check (statut <> 'refuse' or motif_refus is not null)
);

comment on table public.financement_vente is
  'Financement/leasing d''un dossier de vente (RV-39→RV-45). PLUSIEURS lignes possibles par '
  'dossier (append-only côté remplacement, CV-03 : un financement refusé est TERMINAL, jamais '
  'rouvert — un nouveau mode de financement est une NOUVELLE ligne). Le "financement courant" '
  '(contrats/ventes/financement.ts::FinancementResume) est une notion DE LECTURE (le plus récent '
  'non refusé, ou le plus récent tout court) — aucun drapeau "actif" stocké, le contrat n''en '
  'expose aucun. Machine à états (entite=''financement_vente'') + verifier_transition() — '
  'dispositif générique de 0003. Auditée.';

create trigger financement_vente_touche_modifie_le
  before update on public.financement_vente
  for each row execute function public.touche_modifie_le();

create trigger financement_vente_verifier_transition
  before update on public.financement_vente
  for each row execute function public.verifier_transition('financement_vente');

create trigger financement_vente_audit
  after insert or update or delete on public.financement_vente
  for each row execute function public.auditer_atelier('financement_vente');

revoke all    on public.financement_vente from dfa_app;
grant  select, insert, update on public.financement_vente to dfa_app;

alter table public.financement_vente enable row level security;
alter table public.financement_vente force  row level security;

create policy financement_vente_isolation_tenant on public.financement_vente
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy financement_vente_migrator on public.financement_vente
  to dfa_migrator
  using (true) with check (true);

-- Sert directement la dérivation en lecture du « financement courant » (voir le commentaire de
-- tête de la table) : le plus récent d'un dossier, cree_le desc.
create index financement_vente_dossier_idx
  on public.financement_vente (tenant_id, dossier_vente_id, cree_le desc);


-- ---------------------------------------------------------------------------------------------
-- 7. `dossier_vente_document_requis` — RV-35, check-list de livraison (RV-52)
--
-- Pas de machine à états, pas d'entité auditée séparée : un item de check-list est une sous-ligne
-- administrative du dossier de vente, déjà auditée à travers lui — cocher/décocher un item n'est
-- pas, à ce stade, jugé assez sensible pour porter sa propre entrée entite_auditee (à revoir si
-- une revue sécurité en décide autrement).
-- ---------------------------------------------------------------------------------------------

create table public.dossier_vente_document_requis (
  id                uuid        not null default gen_random_uuid(),
  tenant_id         uuid        not null,
  dossier_vente_id  uuid        not null,
  code              text        not null,
  libelle           text        not null,
  fourni            boolean     not null default false,
  fourni_le         timestamptz null,
  cree_le           timestamptz not null default now(),
  modifie_le        timestamptz not null default now(),

  constraint dossier_vente_document_requis_pk primary key (id),
  constraint dossier_vente_document_requis_tenant_id_uk unique (tenant_id, id),
  constraint dossier_vente_document_requis_tenant_dossier_code_uk unique (tenant_id, dossier_vente_id, code),
  constraint dossier_vente_document_requis_fk_dossier
    foreign key (tenant_id, dossier_vente_id) references public.dossier_vente (tenant_id, id) on delete restrict,
  constraint dossier_vente_document_requis_code_non_vide_chk check (length(btrim(code)) > 0),
  constraint dossier_vente_document_requis_libelle_non_vide_chk check (length(btrim(libelle)) > 0),
  constraint dossier_vente_document_requis_fourni_coherent_chk check (fourni = (fourni_le is not null))
);

comment on table public.dossier_vente_document_requis is
  'Check-list de livraison par dossier (RV-35, RV-52). code/libelle COPIÉS depuis le référentiel '
  'tenant au moment de l''attache (pas de FK vers une table de paramétrage — PV-03 n''existe pas '
  'encore côté contrat, gap connu documenté dans contrats/ventes/index.ts) : une évolution '
  'ultérieure du référentiel ne réécrit jamais un dossier déjà en cours.';

create trigger dossier_vente_document_requis_touche_modifie_le
  before update on public.dossier_vente_document_requis
  for each row execute function public.touche_modifie_le();

revoke all    on public.dossier_vente_document_requis from dfa_app;
grant  select, insert, update on public.dossier_vente_document_requis to dfa_app;

alter table public.dossier_vente_document_requis enable row level security;
alter table public.dossier_vente_document_requis force  row level security;

create policy dossier_vente_document_requis_isolation_tenant on public.dossier_vente_document_requis
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy dossier_vente_document_requis_migrator on public.dossier_vente_document_requis
  to dfa_migrator
  using (true) with check (true);

create index dossier_vente_document_requis_dossier_idx
  on public.dossier_vente_document_requis (tenant_id, dossier_vente_id);


-- ---------------------------------------------------------------------------------------------
-- 8. Accroche facturation — FK manquante sur `document_vente.dossier_vente_id`
--
-- Colonne posée sans FK à l'étape 2 (migrations/0010_facturation.sql, commentaire : « Accroche
-- étape 4 (MD-70) : vide tant que la vente de véhicule n'existe pas, sans FK »). `dossier_vente`
-- existe désormais (§3) : la FK peut être posée. Le modèle Drizzle de `document_vente`
-- (schema/facturation/document-vente.ts) reste hors périmètre d'écriture de cette migration —
-- signalé à l'orchestrateur pour mise à jour du fichier TypeScript source, la contrainte SQL
-- ci-dessous fait foi en attendant (même doctrine que les colonnes GENERATED de ce dépôt).
-- ---------------------------------------------------------------------------------------------

alter table public.document_vente
  add constraint document_vente_fk_dossier_vente
  foreign key (tenant_id, dossier_vente_id) references public.dossier_vente (tenant_id, id) on delete restrict;


-- ---------------------------------------------------------------------------------------------
-- 9. Contenu du référentiel de transitions — §6.1, §6.2, §6.3, littéralement
-- ---------------------------------------------------------------------------------------------

insert into public.transition_autorisee (entite, statut_depuis, statut_vers, exige_motif) values
  -- --- vehicule_stock (§6.1) -------------------------------------------------------------------
  ('vehicule_stock', 'en_commande', 'disponible', false),  -- réception physique
  ('vehicule_stock', 'disponible',  'reserve',    false),  -- bon de commande signé (RV-32)
  -- Retour en stock avant facturation (annulation/abandon du dossier, ou correction manuelle
  -- exceptionnelle via remettre-disponible) : motif exigé dans les deux cas, même doctrine que
  -- OR "en_cours -> ouvert".
  ('vehicule_stock', 'reserve',     'disponible', true),
  ('vehicule_stock', 'reserve',     'vendu',      false),  -- facture émise
  ('vehicule_stock', 'vendu',       'livre',      false),  -- livraison effective (RV-52)

  -- --- dossier_vente (§6.2) ---------------------------------------------------------------------
  ('dossier_vente', 'prospection',    'engage',         false),  -- bon de commande signé (RV-32)
  ('dossier_vente', 'engage',         'en_preparation', false),
  ('dossier_vente', 'en_preparation', 'pret_a_livrer',  false),
  ('dossier_vente', 'pret_a_livrer',  'livre',          false),  -- RV-52→RV-56
  ('dossier_vente', 'livre',          'clos',           false),  -- paperasse complète
  -- Rupture volontaire, motif exigé (RM-62, même doctrine que OR "*->annule") : possible UNIQUEMENT
  -- depuis prospection/engage/en_preparation — contrats/ventes/dossier-vente.ts, littéral :
  -- « JAMAIS depuis pret_a_livrer ou au-delà : RV-38 verrouille toute correction de prix derrière
  -- l'avoir dès la facture émise, et une facture émise implique au minimum en_preparation
  -- franchi ». PAS de ('dossier_vente', 'pret_a_livrer', 'annule'/'abandonne', …) ici — absence
  -- volontaire, pas un oubli.
  ('dossier_vente', 'prospection',    'annule',    true),
  ('dossier_vente', 'prospection',    'abandonne', true),
  ('dossier_vente', 'engage',         'annule',    true),
  ('dossier_vente', 'engage',         'abandonne', true),
  ('dossier_vente', 'en_preparation', 'annule',    true),
  ('dossier_vente', 'en_preparation', 'abandonne', true),

  -- --- reprise (§6.3) -----------------------------------------------------------------------------
  ('reprise', 'estimee',  'negociee',  false),
  ('reprise', 'negociee', 'confirmee', false),
  -- RV-25 : le refus peut survenir dès l'estimation initiale ou en cours de négociation, jamais
  -- après confirmation.
  ('reprise', 'estimee',  'refusee',   true),
  ('reprise', 'negociee', 'refusee',   true),

  -- --- financement_vente ---------------------------------------------------------------------
  -- `comptant` naît directement `confirme` (CV-03) : pas de transition entrante depuis
  -- en_attente pour ce type, c'est une valeur initiale, pas une transition.
  ('financement_vente', 'en_attente', 'confirme', false),
  ('financement_vente', 'en_attente', 'refuse',   true);


-- ---------------------------------------------------------------------------------------------
-- 10. Assertions de fin de migration
-- ---------------------------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_trigger tg
      join pg_catalog.pg_class c on c.oid = tg.tgrelid
      join pg_catalog.pg_proc p on p.oid = tg.tgfoid
     where c.relname = 'vehicule_stock' and tg.tgname = 'vehicule_stock_verifier_transition'
       and p.proname = 'verifier_transition' and not tg.tgisinternal
  ) then
    raise exception '0032 : trigger vehicule_stock_verifier_transition absent ou mal câblé.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_trigger tg
      join pg_catalog.pg_class c on c.oid = tg.tgrelid
      join pg_catalog.pg_proc p on p.oid = tg.tgfoid
     where c.relname = 'dossier_vente' and tg.tgname = 'dossier_vente_verifier_transition'
       and p.proname = 'verifier_transition' and not tg.tgisinternal
  ) then
    raise exception '0032 : trigger dossier_vente_verifier_transition absent ou mal câblé.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_trigger tg
      join pg_catalog.pg_class c on c.oid = tg.tgrelid
      join pg_catalog.pg_proc p on p.oid = tg.tgfoid
     where c.relname = 'reprise' and tg.tgname = 'reprise_verifier_transition'
       and p.proname = 'verifier_transition' and not tg.tgisinternal
  ) then
    raise exception '0032 : trigger reprise_verifier_transition absent ou mal câblé.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_trigger tg
      join pg_catalog.pg_class c on c.oid = tg.tgrelid
      join pg_catalog.pg_proc p on p.oid = tg.tgfoid
     where c.relname = 'financement_vente' and tg.tgname = 'financement_vente_verifier_transition'
       and p.proname = 'verifier_transition' and not tg.tgisinternal
  ) then
    raise exception '0032 : trigger financement_vente_verifier_transition absent ou mal câblé.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conname = 'document_vente_fk_dossier_vente' and conrelid = 'public.document_vente'::regclass
  ) then
    raise exception '0032 : FK document_vente_fk_dossier_vente absente.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conname = 'vehicule_stock_fk_origine_reprise' and conrelid = 'public.vehicule_stock'::regclass
  ) then
    raise exception '0032 : FK vehicule_stock_fk_origine_reprise absente.';
  end if;

  if to_regclass('public.dossier_vente_document_requis') is null then
    raise exception '0032 : table dossier_vente_document_requis absente.';
  end if;

  -- financement_vente ne doit PLUS porter de colonne "actif" (voir le commentaire de tête de la
  -- table) — garde-fou contre une réintroduction accidentelle du drapeau lors d'une future
  -- migration de correction.
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'financement_vente' and column_name = 'actif'
  ) then
    raise exception '0032 : financement_vente porte une colonne "actif" — voir le commentaire de tête de la table, ce drapeau est délibérément absent.';
  end if;
end
$$;
