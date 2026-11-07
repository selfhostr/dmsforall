-- =============================================================================================
-- 0084_export_comptable_fichier.sql — historique d'export fiduciaire relisible
--
-- CAUSE : `export_comptable` (0010 §13.4) ne conserve que l'empreinte du fichier produit, pas le
-- fichier ni les écritures qui l'ont généré. Un patron qui perd le fichier envoyé à sa fiduciaire
-- ne pouvait pas le redemander, et l'historique ne montrait ni compteurs ni plage de numéros.
--
-- CHOIX : le fichier est stocké compressé (gzip) dans une table SÉPARÉE, `export_comptable_fichier`,
-- et non en colonne de `export_comptable` : cette dernière est auditée par `auditer_atelier()`, qui
-- recopie `to_jsonb(new)` à chaque écriture — un blob de plusieurs Mo y serait dupliqué en base64
-- dans le journal d'audit. La table du fichier n'a pas de trigger d'audit (immuable, aucune mise à
-- jour ni suppression accordée) ; l'empreinte SHA-256 de `export_comptable` en reste la preuve.
-- Taille plafonnée à 16 Mio compressés (CHECK) ; au-delà, l'API refuse l'export (période à réduire).
--
-- `export_comptable` gagne des colonnes de synthèse, NULLABLES (expand) : les lots antérieurs à
-- cette migration restent valides, sans compteurs ni fichier (l'API répond alors 404 au
-- téléchargement, jamais un fichier reconstitué approximativement).
-- =============================================================================================

alter table public.export_comptable
  add column nb_factures      integer null,
  add column nb_avoirs        integer null,
  add column nb_encaissements integer null,
  add column total_ht_centimes  bigint null,
  add column total_tva_centimes bigint null,
  add column total_ttc_centimes bigint null,
  add column facture_premier  text null,
  add column facture_dernier  text null,
  add column avoir_premier    text null,
  add column avoir_dernier    text null,
  add constraint export_comptable_compteurs_chk check (
    coalesce(nb_factures, 0) >= 0 and coalesce(nb_avoirs, 0) >= 0 and coalesce(nb_encaissements, 0) >= 0
  );

create table public.export_comptable_fichier (
  id             uuid not null default gen_random_uuid(),
  tenant_id      uuid not null references public.tenant (id) on delete restrict,
  export_id      uuid not null,
  nom_fichier    text not null,
  type_mime      text not null,
  taille_octets  integer not null,
  contenu_gz     bytea not null,
  cree_le        timestamptz not null default now(),

  constraint export_comptable_fichier_pk primary key (id),
  constraint export_comptable_fichier_export_uk unique (tenant_id, export_id),
  constraint export_comptable_fichier_fk_export foreign key (tenant_id, export_id)
    references public.export_comptable (tenant_id, id) on delete restrict,
  constraint export_comptable_fichier_nom_chk check (length(btrim(nom_fichier)) > 0),
  constraint export_comptable_fichier_taille_chk check (taille_octets > 0),
  constraint export_comptable_fichier_plafond_chk check (octet_length(contenu_gz) <= 16777216)
);

comment on table public.export_comptable_fichier is
  'Fichier produit par un export fiduciaire, gzip, immuable. Table séparée de export_comptable pour '
  'ne pas dupliquer le blob dans le journal d''audit (auditer_atelier recopie la ligne entière).';

revoke all on public.export_comptable_fichier from dfa_app;
grant select, insert on public.export_comptable_fichier to dfa_app;

alter table public.export_comptable_fichier enable row level security;
alter table public.export_comptable_fichier force  row level security;

create policy export_comptable_fichier_isolation_tenant on public.export_comptable_fichier
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy export_comptable_fichier_migrator on public.export_comptable_fichier
  to dfa_migrator
  using (true) with check (true);
