-- =============================================================================================
-- 0085_ligne_or_photo.sql — photos jointes à une ligne d'ordre de réparation.
--
-- Le mécanicien photographie le défaut constaté (disque rayé, fuite, pneu fendu) ; le bureau et
-- le client voient la preuve avec le devis complémentaire. Un fichier = une ligne : le binaire
-- vit sur disque sous `<racine>/<tenant>/or/<orId>/<photoId>.<ext>` (cle_fichier / cle_vignette
-- sont ces chemins RELATIFS, opaques pour le reste du produit), jamais en base.
--
-- Rattachée à la LIGNE (et à l'OR par dénormalisation, pour lister les photos d'un OR et pour
-- que le répertoire disque soit celui de l'OR). Pas d'UPDATE : une photo est ajoutée ou
-- supprimée, jamais modifiée (la légende est posée à l'envoi). DELETE autorisé : supprimer une
-- photo est un geste métier explicite (tracé dans audit_atelier par le service), contrairement
-- aux lignes d'OR elles-mêmes.
--
-- Plafonds (8 Mo par photo, 20 photos par ligne) : la taille est contrainte ici ; les 20 photos
-- par ligne sont comptées par le service sous le verrou de la ligne (pas exprimable en CHECK).
--
-- Migration de DONNÉES : aucune. Réversible : down/0085_ligne_or_photo.down.sql.
-- =============================================================================================

create table public.ligne_or_photo (
  id                  uuid not null default gen_random_uuid(),
  tenant_id           uuid not null,
  ordre_reparation_id uuid not null,
  ligne_or_id         uuid not null,
  legende             text null,
  cle_fichier         text not null,
  cle_vignette        text null,
  type_mime           text not null,
  taille_octets       integer not null,
  cree_par_id         uuid null,
  cree_le             timestamptz not null default now(),

  constraint ligne_or_photo_pk primary key (id),
  constraint ligne_or_photo_tenant_id_uk unique (tenant_id, id),
  constraint ligne_or_photo_fk_or foreign key (tenant_id, ordre_reparation_id)
    references public.ordre_reparation (tenant_id, id) on delete restrict,
  constraint ligne_or_photo_fk_ligne foreign key (tenant_id, ligne_or_id)
    references public.ligne_or (tenant_id, id) on delete restrict,
  constraint ligne_or_photo_fk_cree_par foreign key (tenant_id, cree_par_id)
    references public.utilisateur (tenant_id, id) on delete restrict,
  constraint ligne_or_photo_type_mime_chk check (type_mime in ('image/jpeg', 'image/png')),
  constraint ligne_or_photo_taille_chk check (taille_octets between 1 and 8388608),
  constraint ligne_or_photo_legende_chk check (
    legende is null or (length(btrim(legende)) > 0 and length(legende) <= 200)
  ),
  constraint ligne_or_photo_cle_non_vide_chk check (length(btrim(cle_fichier)) > 0)
);

comment on table public.ligne_or_photo is
  'Photo jointe à une ligne d''OR (travail constaté). Binaire sur disque (cle_fichier), '
  'jamais en base. Ajout et suppression seulement, pas de modification. '
  '[dfa:suppression-physique] retirer une photo prise par erreur ou floue est un geste métier '
  'courant ; la trace reste dans audit_atelier et le fichier est effacé du disque.';

create index ligne_or_photo_ligne_idx
  on public.ligne_or_photo (tenant_id, ligne_or_id, cree_le, id);
create index ligne_or_photo_or_idx
  on public.ligne_or_photo (tenant_id, ordre_reparation_id, cree_le, id);

revoke all                    on public.ligne_or_photo from dfa_app;
grant  select, insert, delete on public.ligne_or_photo to   dfa_app;

alter table public.ligne_or_photo enable row level security;
alter table public.ligne_or_photo force  row level security;

create policy ligne_or_photo_isolation_tenant on public.ligne_or_photo
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy ligne_or_photo_migrator on public.ligne_or_photo
  to dfa_migrator
  using (true) with check (true);
