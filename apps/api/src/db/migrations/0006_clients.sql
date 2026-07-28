-- =============================================================================================
-- 0006_clients.sql — L1-05 (2/4) : module clients
--
-- `client`, `client_adresse`, `client_contact`, `client_condition` (historisée, EXCLUDE),
-- `client_consentement` (append-only, nLPD), `client_note`.
--
-- Réutilise `langue` (type PG du socle, 0000) et `normaliser_recherche()` / `btree_gin` /
-- `pg_trgm` (0003). Δ6 : `revoke delete` explicite sur chaque table malgré 0002.
-- Réversible : migrations/down/0006_clients.down.sql.
-- =============================================================================================


-- ---------------------------------------------------------------------------------------------
-- 1. `client`
-- ---------------------------------------------------------------------------------------------

create table public.client (
  id                       uuid              not null default gen_random_uuid(),
  tenant_id                uuid              not null references public.tenant (id) on delete restrict,
  numero                   text              not null,
  type                     public.type_client not null,
  civilite                 text              null,
  nom                      text              null,
  prenom                   text              null,
  raison_sociale           text              null,
  ide                      text              null,
  langue                   public.langue     not null,
  email                    text              null,
  telephone                text              null,
  telephone_e164           text              null,
  canal_prefere            text              null,
  statut                   public.statut_client not null default 'actif',
  -- RM-14 : un numéro de commande interne (PO) est exigé sur chaque OR de ce client avant clôture.
  po_obligatoire           boolean           not null default false,
  -- RM-10 : regroupement de clients (flotte). Auto-référence, FK composite comme toute FK entre
  -- deux tables métier (§2.1 règle 2) — y compris quand la cible est la table elle-même.
  groupe_client_id         uuid              null,
  -- RM-06 : fusion (lot 2). La colonne existe dès le lot 1 (accroche), aucun endpoint ne l'écrit.
  fusionne_vers_client_id  uuid              null,
  reference_externe        text              null,

  cree_le    timestamptz not null default now(),
  modifie_le timestamptz not null default now(),

  constraint client_pk primary key (id),
  constraint client_tenant_id_uk unique (tenant_id, id),
  constraint client_tenant_numero_uk unique (tenant_id, numero),

  constraint client_fk_groupe foreign key (tenant_id, groupe_client_id)
    references public.client (tenant_id, id) on delete restrict,
  constraint client_fk_fusionne_vers foreign key (tenant_id, fusionne_vers_client_id)
    references public.client (tenant_id, id) on delete restrict,

  constraint client_numero_non_vide_chk check (length(btrim(numero)) > 0),
  constraint client_identite_chk check (
    (type = 'particulier' and nom is not null)
    or (type = 'entreprise' and raison_sociale is not null)
  ),
  constraint client_telephone_e164_chk
    check (telephone_e164 is null or telephone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  constraint client_ide_chk
    check (ide is null or ide ~ '^CHE-[0-9]{3}\.[0-9]{3}\.[0-9]{3}$'),
  -- Un client fusionné n'est plus « actif » : la fusion ferme le compte fusionné (RM-06).
  constraint client_fusionne_inactif_chk
    check (fusionne_vers_client_id is null or statut = 'inactif')
);

comment on table public.client is
  'Client du garage (RM-01→RM-14). type immuable après création — voir le trigger '
  'client_verrouiller_type ci-dessous.';

create trigger client_touche_modifie_le
  before update on public.client
  for each row execute function public.touche_modifie_le();

-- --- Immuabilité du type (RM-01) ----------------------------------------------------------------
-- Un CHECK ne voit pas OLD : seul un trigger BEFORE UPDATE peut comparer à la valeur précédente.
-- SQLSTATE ZDFA3 (modification d'un champ figé, famille posée en 0003 §6 / plan §2 correction).

create function public.client_verrouiller_type() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $fn$
begin
  if new.type is distinct from old.type then
    raise exception using
      errcode = 'ZDFA3',
      message = format('client.type est figé après création (RM-01) : %s → %s refusé.', old.type, new.type),
      detail  = format('entite=client;entite_id=%s;champ=type', old.id);
  end if;
  return new;
end
$fn$;

comment on function public.client_verrouiller_type() is
  'Trigger BEFORE UPDATE : refuse toute modification de client.type après création (RM-01), SQLSTATE ZDFA3.';

revoke all on function public.client_verrouiller_type() from public;

create trigger client_verrouiller_type
  before update on public.client
  for each row execute function public.client_verrouiller_type();

create trigger client_audit
  after insert or update or delete on public.client
  for each row execute function public.auditer_atelier('client');

-- Recherche comptoir (RM-112) : préfixe tenant_id dans l'index GIN composite (0003 §1 — sans
-- btree_gin, le trigramme scannerait tous les tenants avant que le RLS ne filtre).
-- coalesce(…, '') défensif : normaliser_recherche() est STRICT, et le CHECK d'identité ne prouve
-- pas formellement au planificateur que l'expression ne peut jamais être NULL.
create index client_recherche_idx on public.client
  using gin (
    tenant_id,
    public.normaliser_recherche(
      coalesce(raison_sociale, nom || ' ' || coalesce(prenom, ''), '')
    ) gin_trgm_ops
  );

create index client_telephone_idx on public.client (tenant_id, telephone_e164);
create index client_email_idx     on public.client (tenant_id, lower(email));
create index client_ide_idx       on public.client (tenant_id, ide);
create index client_pagination_idx on public.client (tenant_id, cree_le desc, id desc);

revoke all    on public.client from dfa_app;
grant  select, insert, update on public.client to dfa_app;
-- Δ6 + RM-110 : aucune suppression physique, la désactivation est logique (statut).
revoke delete on public.client from dfa_app;

alter table public.client enable row level security;
alter table public.client force  row level security;

create policy client_isolation_tenant on public.client
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy client_migrator on public.client
  to dfa_migrator
  using (true) with check (true);


-- ---------------------------------------------------------------------------------------------
-- 2. `client_adresse`
-- ---------------------------------------------------------------------------------------------

create table public.client_adresse (
  id         uuid    not null default gen_random_uuid(),
  tenant_id  uuid    not null,
  client_id  uuid    not null,
  type       public.type_adresse not null,
  rue        text    null,
  complement text    null,
  npa        text    null,
  localite   text    null,
  pays       char(2) not null default 'CH',
  actif      boolean not null default true,

  cree_le    timestamptz not null default now(),
  modifie_le timestamptz not null default now(),

  constraint client_adresse_pk primary key (id),
  constraint client_adresse_tenant_id_uk unique (tenant_id, id),
  constraint client_adresse_fk foreign key (tenant_id, client_id)
    references public.client (tenant_id, id) on delete restrict,
  constraint client_adresse_pays_chk check (pays ~ '^[A-Z]{2}$')
);

comment on table public.client_adresse is
  'Adresses d''un client (principale/facturation/livraison). RM-03 : une seule principale et une '
  'seule de facturation actives à la fois — voir les index partiels ci-dessous.';

create trigger client_adresse_touche_modifie_le
  before update on public.client_adresse
  for each row execute function public.touche_modifie_le();

-- RM-03 : au plus une adresse « principale » active, au plus une « facturation » active, par
-- client. Index partiel unique — pas de contrainte EXCLUDE ici, il n'y a pas de période à
-- chevaucher, seulement un drapeau `actif`.
create unique index client_adresse_principale_uk
  on public.client_adresse (tenant_id, client_id)
  where type = 'principale' and actif;
create unique index client_adresse_facturation_uk
  on public.client_adresse (tenant_id, client_id)
  where type = 'facturation' and actif;

revoke all    on public.client_adresse from dfa_app;
grant  select, insert, update on public.client_adresse to dfa_app;
revoke delete on public.client_adresse from dfa_app;

alter table public.client_adresse enable row level security;
alter table public.client_adresse force  row level security;

create policy client_adresse_isolation_tenant on public.client_adresse
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy client_adresse_migrator on public.client_adresse
  to dfa_migrator
  using (true) with check (true);


-- ---------------------------------------------------------------------------------------------
-- 3. `client_contact`
-- ---------------------------------------------------------------------------------------------

create table public.client_contact (
  id             uuid    not null default gen_random_uuid(),
  tenant_id      uuid    not null,
  client_id      uuid    not null,
  nom            text    null,
  prenom         text    null,
  fonction       text    null,
  telephone      text    null,
  telephone_e164 text    null,
  email          text    null,
  langue         public.langue null,
  -- RM-04 : rôles CUMULABLES — tableau d'enum et non table de liaison (cardinalité 1 à 4, aucune
  -- jointure utile ; « qui est signataire ? » s'écrit roles @> '{signataire}' sur index GIN).
  roles          public.role_contact[] not null,
  actif          boolean not null default true,

  cree_le    timestamptz not null default now(),
  modifie_le timestamptz not null default now(),

  constraint client_contact_pk primary key (id),
  constraint client_contact_tenant_id_uk unique (tenant_id, id),
  constraint client_contact_fk foreign key (tenant_id, client_id)
    references public.client (tenant_id, id) on delete restrict,
  constraint client_contact_roles_non_vide_chk check (cardinality(roles) > 0)
);

comment on table public.client_contact is
  'Contacts d''un client (flotte). roles est un tableau d''enum, cumulable (RM-04).';

create trigger client_contact_touche_modifie_le
  before update on public.client_contact
  for each row execute function public.touche_modifie_le();

create index client_contact_roles_idx on public.client_contact using gin (roles);

revoke all    on public.client_contact from dfa_app;
grant  select, insert, update on public.client_contact to dfa_app;
revoke delete on public.client_contact from dfa_app;

alter table public.client_contact enable row level security;
alter table public.client_contact force  row level security;

create policy client_contact_isolation_tenant on public.client_contact
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy client_contact_migrator on public.client_contact
  to dfa_migrator
  using (true) with check (true);


-- ---------------------------------------------------------------------------------------------
-- 4. `client_condition` — historisée (RM-07)
--
-- L'EXCLUDE porte RM-07/CT-03 : la base garantit qu'il n'existe JAMAIS deux jeux de conditions
-- concurrents à une même date pour un client. C'est ce qui rend une facture reproductible à
-- rejouer : à une date donnée, les conditions applicables sont sans ambiguïté.
-- ---------------------------------------------------------------------------------------------

create table public.client_condition (
  id                       uuid     not null default gen_random_uuid(),
  tenant_id                uuid     not null,
  client_id                uuid     not null,
  rabais_mo_pourmille      smallint null,
  rabais_pieces_pourmille  smallint null,
  rabais_pneus_pourmille   smallint null,
  taux_horaire_code        text     null,
  delai_paiement_jours     smallint null,
  mode_paiement            text     null,
  plafond_centimes         integer  null,
  valide_du                date     not null,
  valide_au                date     null,

  cree_le    timestamptz not null default now(),
  modifie_le timestamptz not null default now(),

  constraint client_condition_pk primary key (id),
  constraint client_condition_tenant_id_uk unique (tenant_id, id),
  constraint client_condition_fk foreign key (tenant_id, client_id)
    references public.client (tenant_id, id) on delete restrict,

  constraint client_condition_rabais_mo_chk     check (rabais_mo_pourmille     is null or rabais_mo_pourmille     between 0 and 1000),
  constraint client_condition_rabais_pieces_chk check (rabais_pieces_pourmille is null or rabais_pieces_pourmille between 0 and 1000),
  constraint client_condition_rabais_pneus_chk  check (rabais_pneus_pourmille  is null or rabais_pneus_pourmille  between 0 and 1000),
  constraint client_condition_delai_paiement_chk check (delai_paiement_jours is null or delai_paiement_jours >= 0),
  constraint client_condition_plafond_chk check (plafond_centimes is null or plafond_centimes between 0 and 100000000),
  constraint client_condition_periode_chk check (valide_au is null or valide_au > valide_du),

  -- RM-07/CT-03 : ceinture de base, indispensable en concurrence — deux réceptionnaires qui
  -- ouvrent chacun une nouvelle période de conditions au même moment ne doivent jamais réussir
  -- tous les deux si les périodes se chevauchent.
  constraint client_condition_periode_excl
    exclude using gist (
      tenant_id with =,
      client_id with =,
      daterange(valide_du, valide_au, '[)') with &&
    )
);

comment on table public.client_condition is
  'Conditions commerciales datées d''un client (rabais, délai, plafond). EXCLUDE : jamais deux '
  'périodes concurrentes pour un même client (RM-07, CT-03).';

create trigger client_condition_touche_modifie_le
  before update on public.client_condition
  for each row execute function public.touche_modifie_le();

revoke all    on public.client_condition from dfa_app;
grant  select, insert, update on public.client_condition to dfa_app;
revoke delete on public.client_condition from dfa_app;

alter table public.client_condition enable row level security;
alter table public.client_condition force  row level security;

create policy client_condition_isolation_tenant on public.client_condition
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy client_condition_migrator on public.client_condition
  to dfa_migrator
  using (true) with check (true);


-- ---------------------------------------------------------------------------------------------
-- 5. `client_consentement` — append-only (RM-09, nLPD)
--
-- Pas de `modifie_le` : une ligne de consentement ne se modifie pas (même convention que
-- `journal_securite`, socle). Une révocation est une NOUVELLE ligne `accorde = false` — c'est ce
-- qui donne sa valeur de preuve nLPD : l'historique complet reste consultable.
-- ---------------------------------------------------------------------------------------------

create table public.client_consentement (
  id            uuid        not null default gen_random_uuid(),
  tenant_id     uuid        not null,
  client_id     uuid        not null,
  type          public.type_consentement not null,
  accorde       boolean     not null,
  recueilli_le  timestamptz not null default now(),
  canal         text        null,
  preuve        jsonb       null,

  cree_le timestamptz not null default now(),

  constraint client_consentement_pk primary key (id),
  constraint client_consentement_tenant_id_uk unique (tenant_id, id),
  constraint client_consentement_fk foreign key (tenant_id, client_id)
    references public.client (tenant_id, id) on delete restrict
);

comment on table public.client_consentement is
  'Consentements marketing (RM-09, nLPD). Append-only par privilège : dfa_app n''a que SELECT, '
  'INSERT. Une révocation est une NOUVELLE ligne accorde=false, jamais une modification.';

revoke all    on public.client_consentement from dfa_app;
grant  select, insert on public.client_consentement to dfa_app;

create index client_consentement_client_idx
  on public.client_consentement (tenant_id, client_id, type, recueilli_le desc);

alter table public.client_consentement enable row level security;
alter table public.client_consentement force  row level security;

create policy client_consentement_isolation_tenant on public.client_consentement
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy client_consentement_migrator on public.client_consentement
  to dfa_migrator
  using (true) with check (true);


-- ---------------------------------------------------------------------------------------------
-- 6. `client_note`
-- ---------------------------------------------------------------------------------------------

create table public.client_note (
  id         uuid    not null default gen_random_uuid(),
  tenant_id  uuid    not null,
  client_id  uuid    not null,
  nature     public.nature_note not null default 'interne',
  texte      text    not null,
  auteur_id  uuid    null,

  cree_le    timestamptz not null default now(),
  modifie_le timestamptz not null default now(),

  constraint client_note_pk primary key (id),
  constraint client_note_tenant_id_uk unique (tenant_id, id),
  constraint client_note_fk foreign key (tenant_id, client_id)
    references public.client (tenant_id, id) on delete restrict,
  constraint client_note_fk_auteur foreign key (tenant_id, auteur_id)
    references public.utilisateur (tenant_id, id) on delete restrict,
  constraint client_note_texte_non_vide_chk check (length(btrim(texte)) > 0)
);

comment on table public.client_note is
  'Notes libres sur un client. nature=alerte remonte au contexte-atelier (RM-13, RM-36) — voir '
  'l''index partiel ci-dessous, lu à chaque ouverture de fiche, au RDV et à la réception.';

create trigger client_note_touche_modifie_le
  before update on public.client_note
  for each row execute function public.touche_modifie_le();

create index client_note_alerte_idx
  on public.client_note (tenant_id, client_id)
  where nature = 'alerte';

revoke all    on public.client_note from dfa_app;
grant  select, insert, update on public.client_note to dfa_app;
revoke delete on public.client_note from dfa_app;

alter table public.client_note enable row level security;
alter table public.client_note force  row level security;

create policy client_note_isolation_tenant on public.client_note
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy client_note_migrator on public.client_note
  to dfa_migrator
  using (true) with check (true);


-- ---------------------------------------------------------------------------------------------
-- 7. Assertions de fin de migration
-- ---------------------------------------------------------------------------------------------

do $$
declare
  fautives text;
begin
  select string_agg(t.tbl, ', ') into fautives
    from (values
      ('client'), ('client_adresse'), ('client_contact'),
      ('client_condition'), ('client_consentement'), ('client_note')
    ) as t(tbl)
   where has_table_privilege('dfa_app', format('public.%I', t.tbl), 'DELETE');

  if fautives is not null then
    raise exception 'DELETE encore accordé à dfa_app sur % (Δ6 / RM-110 violé).', fautives;
  end if;

  if has_table_privilege('dfa_app', 'public.client_consentement', 'UPDATE') then
    raise exception 'client_consentement : UPDATE ne devrait pas être accordé à dfa_app (append-only, RM-09).';
  end if;
end
$$;
