-- =============================================================================================
-- 0091_site_code_court_site_principal.sql — un site principal par collaborateur, un code court
-- par site.
--
--   1. `site.code_court` varchar(5) NOT NULL, unique par tenant : l'étiquette compacte affichée
--      dans les filtres de site (« MART », « SION »). Distinct de `site.code` (identifiant long
--      des numéros de documents) : on n'y touche pas. Backfill depuis le `code` (sinon le nom ; majuscules, sans
--      accents ni espaces, 5 caractères), doublons départagés par un chiffre final.
--
--   2. `utilisateur.site_principal_id` : site où travaille la personne, défaut de tous les
--      filtres de site. NULLABLE (un collaborateur sans affectation n'en a pas). Distinct de
--      `utilisateur.site_id` (0039), réservé à la borne d'atelier et lié par une biconditionnelle.
--      NE donne AUCUN droit : l'autorisation reste rôle x action, l'étanchéité reste le tenant.
--      Backfill : première affectation descriptive `utilisateur_site` (la plus ancienne).
--
-- Réversible : migrations/down/0091_site_code_court_site_principal.down.sql.
-- =============================================================================================

alter table public.site add column code_court varchar(5);

-- Dérivation du code court : le `code` du site (déjà court, choisi par le garage) en priorité,
-- sinon le nom. Majuscules, accents retirés, uniquement A-Z et 0-9, 5 caractères max.
create function public.site_code_court_base(p_code text, p_nom text) returns text
language sql immutable
set search_path = pg_catalog, public
as $fn$
  select coalesce(
    nullif(left(regexp_replace(translate(upper(coalesce(p_code, '')),
      'ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝ', 'AAAAAACEEEEIIIINOOOOOUUUUY'), '[^A-Z0-9]', '', 'g'), 5), ''),
    nullif(left(regexp_replace(translate(upper(coalesce(p_nom, '')),
      'ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝ', 'AAAAAACEEEEIIIINOOOOOUUUUY'), '[^A-Z0-9]', '', 'g'), 5), ''),
    'SITE'
  )
$fn$;

update public.site set code_court = public.site_code_court_base(code, nom);

-- Doublons dans un même tenant : le plus ancien garde la base, les suivants reçoivent un
-- suffixe numérique (MART, MAR2, MAR3...), en vérifiant à chaque essai que le candidat est libre.
do $$
declare
  ligne record;
  n int;
  candidat text;
begin
  for ligne in
    select id, tenant_id, code_court,
           row_number() over (partition by tenant_id, code_court order by cree_le, id) as rang
      from public.site
  loop
    if ligne.rang > 1 then
      n := ligne.rang;
      loop
        candidat := left(ligne.code_court, 5 - length(n::text)) || n::text;
        exit when not exists (
          select 1 from public.site s
           where s.tenant_id = ligne.tenant_id and s.code_court = candidat
        );
        n := n + 1;
      end loop;
      update public.site set code_court = candidat where id = ligne.id;
    end if;
  end loop;
end
$$;

-- Filet de compatibilité : tout INSERT qui ne renseigne pas `code_court` (seed, fixtures, CLI de
-- création de garage, anciens clients) en reçoit un dérivé, unique dans le tenant.
create function public.site_code_court_defaut() returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $fn$
declare
  base text;
  candidat text;
  n int := 1;
begin
  if new.code_court is null or new.code_court = '' then
    base := public.site_code_court_base(new.code, new.nom);
    candidat := base;
    while exists (
      select 1 from public.site s
       where s.tenant_id = new.tenant_id and s.code_court = candidat
    ) loop
      n := n + 1;
      candidat := left(base, 5 - length(n::text)) || n::text;
    end loop;
    new.code_court := candidat;
  end if;
  return new;
end
$fn$;

create trigger site_code_court_defaut_trg
  before insert on public.site
  for each row execute function public.site_code_court_defaut();

alter table public.site alter column code_court set not null;
alter table public.site
  add constraint site_code_court_format_chk check (code_court ~ '^[A-Z0-9]{1,5}$');
alter table public.site
  add constraint site_tenant_code_court_uk unique (tenant_id, code_court);

comment on column public.site.code_court is
  'Étiquette compacte du site (1 à 5 caractères A-Z/0-9, ex. MART, SION), affichée dans les '
  'filtres de site. Modifiable dans Réglages > sites. Distinct de `code` (numérotation).';

-- ---------------------------------------------------------------------------------------------

alter table public.utilisateur add column site_principal_id uuid;

alter table public.utilisateur
  add constraint utilisateur_fk_site_principal
  foreign key (tenant_id, site_principal_id)
  references public.site (tenant_id, id) on delete restrict;

-- Une borne (compte de service) n'a pas de « site principal » : son site est `site_id`.
alter table public.utilisateur
  add constraint utilisateur_site_principal_personne_chk
  check (role <> 'poste_atelier' or site_principal_id is null);

update public.utilisateur u
   set site_principal_id = (
     select us.site_id
       from public.utilisateur_site us
      where us.tenant_id = u.tenant_id and us.utilisateur_id = u.id
      order by us.cree_le, us.id
      limit 1
   )
 where u.role <> 'poste_atelier';

create index utilisateur_site_principal_idx on public.utilisateur (tenant_id, site_principal_id)
  where site_principal_id is not null;

comment on column public.utilisateur.site_principal_id is
  'Site principal de la personne : défaut des filtres de site. Ne confère aucun droit '
  '(autorisation = rôle x action, étanchéité = tenant). NULL pour une borne (voir site_id).';
