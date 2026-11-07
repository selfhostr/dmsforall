-- =============================================================================================
-- 0087_capacites_par_personne.sql — grille de capacités par personne (rôles = préréglages)
--
-- CAUSE : un garage était enfermé dans 9 rôles exclusifs alors qu'une même personne y fait souvent
-- plusieurs métiers (mécanicien + magasinier, accueil + vente VO…). Le rôle devient un PRÉRÉGLAGE
-- D'ORIGINE ; ce qu'une personne peut faire est une grille « Rien / Voir / Faire » sur six domaines
-- (atelier, accueil, facturation, pièces, ventes, finances), plus « encadrer », plus « employés &
-- réglages » (+ gestes de patron), plus trois options (voit les montants, voit les prix d'achat,
-- avoirs plafonnés). Voir `packages/shared/src/contrats/capacites.ts` (PREREGLAGES) : ce fichier
-- RECOPIE ces valeurs, et `matrice-droits.spec.ts` prouve qu'elles sont identiques.
--
-- CHOIX DE STOCKAGE : colonnes TYPÉES (enum `niveau_acces` + booléens), pas JSONB. La grille est un
-- ensemble FERMÉ de six niveaux et six drapeaux, jamais un attribut variable : le type et le CHECK
-- rejettent une valeur illisible en base, et la fonction d'amorçage de session les remonte sans
-- parser. JSONB aurait déplacé la validation dans l'application — l'inverse de « contraintes en
-- base ».
--
-- AUCUNE PERSONNE NE PERD UN DROIT : chaque ligne existante reçoit la grille du préréglage de son
-- rôle (backfill), prouvée supérieure ou égale aux droits historiques par les tests.
--
-- COMPATIBILITÉ DES INSERTIONS : les colonnes sont NOT NULL SANS valeur par défaut ; un trigger
-- BEFORE INSERT remplit toute colonne omise depuis le préréglage du rôle. Les fixtures, la CLI
-- `creer-garage` et le seed qui n'écrivent que `role` continuent donc de produire un compte
-- fonctionnel (un défaut « tout à rien » aurait créé des patrons sans aucun droit). Un UPDATE de
-- `role` ne touche PAS la grille : c'est `ServiceUtilisateur.modifier` qui applique le préréglage.
--
-- SESSION : `amorcage.session_par_empreinte` est recréée avec la grille, en DERNIÈRES colonnes
-- (même méthode que 0039 pour `site_id`) : la grille est relue de la base À CHAQUE requête, comme
-- le rôle — jamais d'un jeton. Une baisse de droits prend effet à la requête suivante.
--
-- Réversible : migrations/down/0087_capacites_par_personne.down.sql.
-- =============================================================================================

create type public.niveau_acces as enum ('rien', 'voir', 'faire');

alter table public.utilisateur
  add column niveau_atelier       public.niveau_acces null,
  add column niveau_accueil       public.niveau_acces null,
  add column niveau_facturation   public.niveau_acces null,
  add column niveau_pieces        public.niveau_acces null,
  add column niveau_ventes        public.niveau_acces null,
  add column niveau_finances      public.niveau_acces null,
  add column peut_encadrer        boolean null,
  add column peut_gerer_employes  boolean null,
  add column est_patron           boolean null,
  add column voit_montants        boolean null,
  add column voit_prix_achat      boolean null,
  add column avoirs_plafonnes     boolean null;

-- Préréglage de chaque rôle — SOURCE SQL UNIQUE (backfill ET trigger d'insertion). Un rôle inconnu
-- (ajouté à l'enum sans préréglage) ne rend aucune ligne : le trigger échoue alors bruyamment.
create function public.grille_prereglage(p_role public.role_utilisateur)
returns table (
  niveau_atelier      public.niveau_acces,
  niveau_accueil      public.niveau_acces,
  niveau_facturation  public.niveau_acces,
  niveau_pieces       public.niveau_acces,
  niveau_ventes       public.niveau_acces,
  niveau_finances     public.niveau_acces,
  peut_encadrer       boolean,
  peut_gerer_employes boolean,
  est_patron          boolean,
  voit_montants       boolean,
  voit_prix_achat     boolean,
  avoirs_plafonnes    boolean
)
language sql
immutable
set search_path = pg_catalog, public
as $$
  select v.niveau_atelier::public.niveau_acces, v.niveau_accueil::public.niveau_acces,
         v.niveau_facturation::public.niveau_acces, v.niveau_pieces::public.niveau_acces,
         v.niveau_ventes::public.niveau_acces, v.niveau_finances::public.niveau_acces,
         v.peut_encadrer, v.peut_gerer_employes, v.est_patron, v.voit_montants,
         v.voit_prix_achat, v.avoirs_plafonnes
    from (values
      ('admin', 'faire', 'faire', 'rien', 'rien', 'rien', 'rien', true, true, false, true, false, false),
      ('direction', 'faire', 'faire', 'faire', 'faire', 'faire', 'faire', true, true, true, true, true, false),
      ('vendeur', 'rien', 'voir', 'faire', 'voir', 'faire', 'rien', false, false, false, true, false, true),
      ('receptionnaire', 'voir', 'faire', 'faire', 'voir', 'voir', 'rien', false, false, false, true, false, true),
      ('chef_atelier', 'faire', 'faire', 'faire', 'faire', 'rien', 'rien', true, false, false, true, true, true),
      ('technicien', 'faire', 'voir', 'voir', 'voir', 'rien', 'rien', false, false, false, false, false, false),
      ('magasinier', 'faire', 'voir', 'faire', 'faire', 'rien', 'rien', false, false, false, true, true, true),
      ('comptable', 'voir', 'voir', 'faire', 'voir', 'voir', 'faire', false, false, false, true, true, false),
      ('poste_atelier', 'rien', 'rien', 'rien', 'rien', 'rien', 'rien', false, false, false, false, false, false)
    ) as v(role, niveau_atelier, niveau_accueil, niveau_facturation, niveau_pieces, niveau_ventes,
           niveau_finances, peut_encadrer, peut_gerer_employes, est_patron, voit_montants,
           voit_prix_achat, avoirs_plafonnes)
   where v.role = p_role::text
$$;

comment on function public.grille_prereglage(public.role_utilisateur) is
  'Préréglage (grille de capacités) d''un rôle. Recopie de PREREGLAGES (@dfa/shared) ; vérifié par matrice-droits.spec.ts.';

update public.utilisateur u
   set niveau_atelier = g.niveau_atelier, niveau_accueil = g.niveau_accueil,
       niveau_facturation = g.niveau_facturation, niveau_pieces = g.niveau_pieces,
       niveau_ventes = g.niveau_ventes, niveau_finances = g.niveau_finances,
       peut_encadrer = g.peut_encadrer, peut_gerer_employes = g.peut_gerer_employes,
       est_patron = g.est_patron, voit_montants = g.voit_montants,
       voit_prix_achat = g.voit_prix_achat, avoirs_plafonnes = g.avoirs_plafonnes
  from (
    select r.role, p.*
      from unnest(enum_range(null::public.role_utilisateur)) as r(role)
      cross join lateral public.grille_prereglage(r.role) as p
  ) g
 where g.role = u.role;

alter table public.utilisateur
  alter column niveau_atelier       set not null,
  alter column niveau_accueil       set not null,
  alter column niveau_facturation   set not null,
  alter column niveau_pieces        set not null,
  alter column niveau_ventes        set not null,
  alter column niveau_finances      set not null,
  alter column peut_encadrer        set not null,
  alter column peut_gerer_employes  set not null,
  alter column est_patron           set not null,
  alter column voit_montants        set not null,
  alter column voit_prix_achat      set not null,
  alter column avoirs_plafonnes     set not null;

alter table public.utilisateur
  add constraint utilisateur_patron_gere_employes_chk
    check (not est_patron or peut_gerer_employes),
  add constraint utilisateur_borne_sans_grille_chk
    check (role <> 'poste_atelier' or (
      niveau_atelier = 'rien' and niveau_accueil = 'rien' and niveau_facturation = 'rien'
      and niveau_pieces = 'rien' and niveau_ventes = 'rien' and niveau_finances = 'rien'
      and not peut_encadrer and not peut_gerer_employes and not est_patron
      and not voit_montants and not voit_prix_achat and not avoirs_plafonnes));

-- Trigger d'insertion : complète les colonnes omises depuis le préréglage du rôle.
create function public.utilisateur_grille_par_defaut()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  p record;
begin
  select * into p from public.grille_prereglage(new.role);
  if not found then
    raise exception 'Aucun préréglage de capacités pour le rôle %', new.role;
  end if;
  new.niveau_atelier      := coalesce(new.niveau_atelier, p.niveau_atelier);
  new.niveau_accueil      := coalesce(new.niveau_accueil, p.niveau_accueil);
  new.niveau_facturation  := coalesce(new.niveau_facturation, p.niveau_facturation);
  new.niveau_pieces       := coalesce(new.niveau_pieces, p.niveau_pieces);
  new.niveau_ventes       := coalesce(new.niveau_ventes, p.niveau_ventes);
  new.niveau_finances     := coalesce(new.niveau_finances, p.niveau_finances);
  new.peut_encadrer       := coalesce(new.peut_encadrer, p.peut_encadrer);
  new.peut_gerer_employes := coalesce(new.peut_gerer_employes, p.peut_gerer_employes);
  new.est_patron          := coalesce(new.est_patron, p.est_patron);
  new.voit_montants       := coalesce(new.voit_montants, p.voit_montants);
  new.voit_prix_achat     := coalesce(new.voit_prix_achat, p.voit_prix_achat);
  new.avoirs_plafonnes    := coalesce(new.avoirs_plafonnes, p.avoirs_plafonnes);
  return new;
end
$$;

create trigger utilisateur_grille_par_defaut
  before insert on public.utilisateur
  for each row execute function public.utilisateur_grille_par_defaut();

revoke all on function public.grille_prereglage(public.role_utilisateur) from public;
revoke all on function public.utilisateur_grille_par_defaut() from public;
grant execute on function public.grille_prereglage(public.role_utilisateur) to dfa_app;
grant execute on function public.utilisateur_grille_par_defaut() to dfa_app;

comment on column public.utilisateur.niveau_atelier is
  'Grille de capacités (rien/voir/faire) par domaine : atelier, accueil, facturation, pièces, ventes, finances. Le rôle n''est que le préréglage d''origine.';
comment on column public.utilisateur.est_patron is
  'Gestes irréversibles (IBAN, lancement de la reprise). Suit le préréglage du rôle, non modifiable par PATCH capacités.';

-- Session : même fonction qu'en 0039 + la grille en dernières colonnes.
drop function amorcage.session_par_empreinte(bytea);

create function amorcage.session_par_empreinte(p_empreinte bytea)
returns table (
  session_id          uuid,
  tenant_id           uuid,
  utilisateur_id      uuid,
  cree_le             timestamptz,
  expire_le           timestamptz,
  vu_le               timestamptz,
  revoquee_le         timestamptz,
  role                role_utilisateur,
  langue              langue,
  statut_utilisateur  statut_utilisateur,
  statut_tenant       statut_tenant,
  site_id             uuid,
  niveau_atelier      public.niveau_acces,
  niveau_accueil      public.niveau_acces,
  niveau_facturation  public.niveau_acces,
  niveau_pieces       public.niveau_acces,
  niveau_ventes       public.niveau_acces,
  niveau_finances     public.niveau_acces,
  peut_encadrer       boolean,
  peut_gerer_employes boolean,
  est_patron          boolean,
  voit_montants       boolean,
  voit_prix_achat     boolean,
  avoirs_plafonnes    boolean
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select s.id, s.tenant_id, s.utilisateur_id, s.cree_le, s.expire_le, s.vu_le, s.revoquee_le,
         u.role, u.langue, u.statut, t.statut, u.site_id,
         u.niveau_atelier, u.niveau_accueil, u.niveau_facturation, u.niveau_pieces,
         u.niveau_ventes, u.niveau_finances, u.peut_encadrer, u.peut_gerer_employes,
         u.est_patron, u.voit_montants, u.voit_prix_achat, u.avoirs_plafonnes
    from public.session s
    join public.utilisateur u on u.id = s.utilisateur_id and u.tenant_id = s.tenant_id
    join public.tenant t      on t.id = s.tenant_id
   where s.empreinte_token = p_empreinte
   limit 1
$$;

comment on function amorcage.session_par_empreinte(bytea) is
  'Résolution d''une session par empreinte SHA-256. Ne filtre ni expiration ni révocation : ServiceSession doit distinguer session absente et session expirée. Rend aussi la grille de capacités, relue à chaque requête.';

revoke all on function amorcage.session_par_empreinte(bytea) from public;
grant execute on function amorcage.session_par_empreinte(bytea) to dfa_app;

do $$
begin
  if exists (select 1 from public.utilisateur where niveau_atelier is null) then
    raise exception '0087 : une ligne utilisateur est restée sans grille.';
  end if;
  if has_function_privilege('public', 'amorcage.session_par_empreinte(bytea)', 'execute') then
    raise exception '0087 : amorcage.session_par_empreinte est exécutable par PUBLIC.';
  end if;
end
$$;
