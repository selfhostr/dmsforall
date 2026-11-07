-- =============================================================================================
-- 0081_courtoisie.sql — parc de véhicules de courtoisie et prêts aux clients.
--
-- Table dédiée plutôt qu'un marqueur sur `vehicule` : un véhicule de courtoisie appartient au
-- garage, il n'a ni détenteur, ni historique de plaque, ni expertise client à suivre — réutiliser
-- `vehicule` obligerait à contourner la détention (RM-20) et polluerait les recherches comptoir.
--
-- Les enums `etat_vehicule_courtoisie` et `statut_pret_courtoisie` existent depuis 0005. L'état
-- stocké sur `vehicule_courtoisie` ne porte QUE l'indisponibilité administrative
-- (disponible / en_entretien / hors_service) : « prêté » se déduit des prêts, jamais d'une
-- seconde vérité à synchroniser (contrainte vehicule_courtoisie_etat_stocke_chk).
--
-- Un prêt actif ('reserve' ou 'en_cours') ne peut pas en chevaucher un autre sur le même véhicule
-- (EXCLUDE gist). Statuts utilisés : reserve (à venir), en_cours (prêté), retourne (rendu),
-- annule. 'cloture' reste réservé à un usage ultérieur.
--
-- Migration de DONNÉES : aucune. Réversible : down/0081_courtoisie.down.sql.
-- =============================================================================================

create table public.vehicule_courtoisie (
  id          uuid not null default gen_random_uuid(),
  tenant_id   uuid not null,
  designation text not null,
  plaque      text null,
  kilometrage integer null,
  etat        public.etat_vehicule_courtoisie not null default 'disponible',
  note        text null,
  cree_le     timestamptz not null default now(),
  modifie_le  timestamptz not null default now(),

  constraint vehicule_courtoisie_pk primary key (id),
  constraint vehicule_courtoisie_tenant_id_uk unique (tenant_id, id),
  constraint vehicule_courtoisie_designation_non_vide_chk check (length(btrim(designation)) > 0),
  constraint vehicule_courtoisie_plaque_non_vide_chk check (plaque is null or length(btrim(plaque)) > 0),
  constraint vehicule_courtoisie_km_chk check (kilometrage is null or kilometrage >= 0),
  constraint vehicule_courtoisie_etat_stocke_chk check (etat <> 'prete')
);

comment on table public.vehicule_courtoisie is
  'Parc de véhicules de courtoisie du garage. etat = indisponibilité administrative seulement ; '
  '« prêté » se déduit de pret_courtoisie.';

create trigger vehicule_courtoisie_touche_modifie_le
  before update on public.vehicule_courtoisie
  for each row execute function public.touche_modifie_le();

create index vehicule_courtoisie_pagination_idx
  on public.vehicule_courtoisie (tenant_id, designation, id);

revoke all                    on public.vehicule_courtoisie from dfa_app;
grant  select, insert, update on public.vehicule_courtoisie to   dfa_app;
revoke delete                 on public.vehicule_courtoisie from dfa_app;

alter table public.vehicule_courtoisie enable row level security;
alter table public.vehicule_courtoisie force  row level security;

create policy vehicule_courtoisie_isolation_tenant on public.vehicule_courtoisie
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy vehicule_courtoisie_migrator on public.vehicule_courtoisie
  to dfa_migrator
  using (true) with check (true);


create table public.pret_courtoisie (
  id                      uuid not null default gen_random_uuid(),
  tenant_id               uuid not null,
  vehicule_courtoisie_id  uuid not null,
  client_id               uuid not null,
  ordre_reparation_id     uuid null,
  rendez_vous_id          uuid null,
  debut_le                timestamptz not null,
  fin_prevue_le           timestamptz not null,
  rendu_le                timestamptz null,
  km_depart               integer null,
  km_retour               integer null,
  statut                  public.statut_pret_courtoisie not null default 'en_cours',
  note                    text null,
  cree_par_id             uuid null,
  cree_le                 timestamptz not null default now(),
  modifie_le              timestamptz not null default now(),

  constraint pret_courtoisie_pk primary key (id),
  constraint pret_courtoisie_tenant_id_uk unique (tenant_id, id),
  constraint pret_courtoisie_fk_vehicule foreign key (tenant_id, vehicule_courtoisie_id)
    references public.vehicule_courtoisie (tenant_id, id) on delete restrict,
  constraint pret_courtoisie_fk_client foreign key (tenant_id, client_id)
    references public.client (tenant_id, id) on delete restrict,
  constraint pret_courtoisie_fk_or foreign key (tenant_id, ordre_reparation_id)
    references public.ordre_reparation (tenant_id, id) on delete restrict,
  constraint pret_courtoisie_fk_rdv foreign key (tenant_id, rendez_vous_id)
    references public.rendez_vous (tenant_id, id) on delete restrict,
  constraint pret_courtoisie_fk_cree_par foreign key (tenant_id, cree_par_id)
    references public.utilisateur (tenant_id, id) on delete restrict,
  constraint pret_courtoisie_periode_chk check (fin_prevue_le > debut_le),
  constraint pret_courtoisie_km_chk check (
    (km_depart is null or km_depart >= 0)
    and (km_retour is null or km_retour >= 0)
    and (km_depart is null or km_retour is null or km_retour >= km_depart)
  ),
  constraint pret_courtoisie_rendu_coherent_chk
    check ((rendu_le is not null) = (statut in ('retourne', 'cloture'))),
  constraint pret_courtoisie_statut_utilise_chk
    check (statut in ('reserve', 'en_cours', 'retourne', 'annule')),
  constraint pret_courtoisie_pas_de_chevauchement
    exclude using gist (
      tenant_id with =,
      vehicule_courtoisie_id with =,
      tstzrange(debut_le, fin_prevue_le) with &&
    ) where (statut in ('reserve', 'en_cours'))
);

comment on table public.pret_courtoisie is
  'Prêt d''un véhicule de courtoisie à un client (OR ou RDV facultatifs). reserve = à venir, '
  'en_cours = prêté, retourne = rendu, annule. Pas de chevauchement entre prêts actifs.';

create trigger pret_courtoisie_touche_modifie_le
  before update on public.pret_courtoisie
  for each row execute function public.touche_modifie_le();

create index pret_courtoisie_vehicule_idx
  on public.pret_courtoisie (tenant_id, vehicule_courtoisie_id, debut_le desc);
create index pret_courtoisie_client_idx
  on public.pret_courtoisie (tenant_id, client_id, debut_le desc);
create index pret_courtoisie_or_idx
  on public.pret_courtoisie (tenant_id, ordre_reparation_id) where ordre_reparation_id is not null;
create index pret_courtoisie_pagination_idx
  on public.pret_courtoisie (tenant_id, cree_le desc, id desc);

revoke all                    on public.pret_courtoisie from dfa_app;
grant  select, insert, update on public.pret_courtoisie to   dfa_app;
revoke delete                 on public.pret_courtoisie from dfa_app;

alter table public.pret_courtoisie enable row level security;
alter table public.pret_courtoisie force  row level security;

create policy pret_courtoisie_isolation_tenant on public.pret_courtoisie
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy pret_courtoisie_migrator on public.pret_courtoisie
  to dfa_migrator
  using (true) with check (true);
