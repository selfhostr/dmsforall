-- =============================================================================================
-- 0046_ligne_or_types_sans_temps_et_delai_paiement_tenant.down.sql
-- Inverse de 0046_ligne_or_types_sans_temps_et_delai_paiement_tenant.sql.
--
-- Ordre inverse du up : PARTIE B défaite avant PARTIE A (dernier posé, premier retiré), puis à
-- l'intérieur de la PARTIE A : les 7 lignes type-spécifiques retirées, PUIS les deux fonctions
-- restaurées mot pour mot dans leur forme de 0003 (CREATE OR REPLACE, pas de DROP : la fonction
-- existait déjà avant ce up), PUIS la contrainte/colonne `type_ligne` retirées en dernier — dans
-- cet ordre parce que les fonctions restaurées ci-dessous ne référencent plus `type_ligne` : les
-- retirer avant la colonne évite une fenêtre où le corps de fonction courant dépendrait d'une
-- colonne sur le point de disparaître.
--
-- MIGRATION DE DONNÉES : aucune à préserver. Les 7 lignes retirées ont été insérées PAR ce up
-- (aucune existence antérieure) ; `tenant.delai_paiement_jours_defaut` n'existait pas avant ce up
-- (aucun tenant n'avait de valeur à perdre — RIEN n'est perdu en le supprimant, seul le
-- COMPORTEMENT décrit dans l'en-tête du up redevient celui d'avant : `dateEcheance` redevient
-- `null` pour tout client sans conditions de paiement propres).
-- =============================================================================================


-- ---------------------------------------------------------------------------------------------
-- PARTIE B — retrait de tenant.delai_paiement_jours_defaut.
-- ---------------------------------------------------------------------------------------------

alter table public.tenant
  drop constraint tenant_delai_paiement_jours_defaut_positif_chk;

alter table public.tenant
  drop column delai_paiement_jours_defaut;


-- ---------------------------------------------------------------------------------------------
-- PARTIE A.4 (inverse) — retrait des 7 transitions type-spécifiques.
-- ---------------------------------------------------------------------------------------------

delete from public.transition_autorisee
 where entite = 'ligne_or' and statut_depuis = 'validee' and statut_vers = 'realisee'
   and type_ligne = any (array[
     'piece', 'fourniture', 'produit_atelier', 'taxe', 'remise', 'texte', 'sous_traitance'
   ]);


-- ---------------------------------------------------------------------------------------------
-- PARTIE A.3 (inverse) — verifier_transition() restaurée mot pour mot (forme de 0003).
-- ---------------------------------------------------------------------------------------------

create or replace function public.verifier_transition() returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $fn$
declare
  entite_cible public.entite_auditee;
  depuis       text;
  vers         text;
  possibles    text;
  indication   text;
begin
  -- Un trigger posé sans argument ferait échouer TOUTES les transitions de la table (aucune
  -- ligne du référentiel ne correspondrait à l'entité NULL) — panne totale, diagnostic obscur.
  if tg_nargs < 1 or tg_argv[0] is null then
    raise exception
      'verifier_transition() posée sans argument sur « % ». Attendu : create trigger … execute function public.verifier_transition(''<entite_auditee>'').',
      tg_table_name
      using errcode = 'ZDFA1';
  end if;

  -- Posé sur INSERT, ce trigger échouerait sur « record old is not assigned yet » : un message
  -- de bug PL/pgSQL là où l'auteur du DDL a simplement écrit BEFORE INSERT OR UPDATE au lieu de
  -- BEFORE UPDATE. Une création n'a de toute façon pas de transition à valider — elle a un état
  -- initial, dont la légitimité relève d'un CHECK sur la table.
  if tg_op <> 'UPDATE' then
    raise exception
      'verifier_transition() posée sur % pour « % » : ce trigger ne vaut que pour BEFORE UPDATE.',
      tg_op, tg_table_name
      using errcode = 'ZDFA1';
  end if;

  entite_cible := tg_argv[0]::public.entite_auditee;

  depuis := old.statut::text;
  vers   := new.statut::text;

  -- Le statut n'a pas changé : ce n'est pas une transition, il n'y a rien à vérifier. C'est le
  -- cas de l'immense majorité des UPDATE (édition d'un commentaire, d'un kilométrage…), d'où ce
  -- retour avant toute lecture du référentiel.
  if depuis is not distinct from vers then
    return new;
  end if;

  if exists (
    select 1
      from public.transition_autorisee t
     where t.entite        = entite_cible
       and t.statut_depuis = depuis
       and t.statut_vers   = vers
  ) then
    return new;
  end if;

  select string_agg(t.statut_vers, ', ' order by t.statut_vers)
    into possibles
    from public.transition_autorisee t
   where t.entite = entite_cible
     and t.statut_depuis = depuis;

  if possibles is null then
    indication := format('« %s » est un état terminal : aucune transition n''en part.', depuis);
  else
    indication := format('Depuis « %s », transitions autorisées : %s.', depuis, possibles);
  end if;

  raise exception using
    errcode = 'ZDFA1',
    message = format('Transition %s → %s interdite sur %s.', depuis, vers, entite_cible),
    detail  = format('entite=%s;depuis=%s;vers=%s', entite_cible, depuis, vers),
    hint    = indication,
    table   = tg_table_name;
end
$fn$;


-- ---------------------------------------------------------------------------------------------
-- PARTIE A.2 (inverse) — transition_autorisee_valide_contenu() restaurée mot pour mot (forme de
-- 0003).
-- ---------------------------------------------------------------------------------------------

create or replace function public.transition_autorisee_valide_contenu() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $fn$
declare
  nom_type  text;
  type_oid  oid;
begin
  nom_type := 'public.statut_' || new.entite::text;
  type_oid := to_regtype(nom_type)::oid;

  if type_oid is null then
    raise exception
      'transition_autorisee : aucun type % pour l''entité « % ». Une entité sans type de statut n''a pas de machine à états à déclarer.',
      nom_type, new.entite;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_enum e
     where e.enumtypid = type_oid and e.enumlabel = new.statut_depuis
  ) then
    raise exception
      'transition_autorisee : « % » n''est pas une valeur de %. Valeurs admises : %.',
      new.statut_depuis, nom_type,
      (select string_agg(e.enumlabel, ', ' order by e.enumsortorder)
         from pg_catalog.pg_enum e where e.enumtypid = type_oid);
  end if;

  if not exists (
    select 1 from pg_catalog.pg_enum e
     where e.enumtypid = type_oid and e.enumlabel = new.statut_vers
  ) then
    raise exception
      'transition_autorisee : « % » n''est pas une valeur de %. Valeurs admises : %.',
      new.statut_vers, nom_type,
      (select string_agg(e.enumlabel, ', ' order by e.enumsortorder)
         from pg_catalog.pg_enum e where e.enumtypid = type_oid);
  end if;

  return new;
end
$fn$;


-- ---------------------------------------------------------------------------------------------
-- PARTIE A.1 (inverse) — retrait de la colonne type_ligne et retour à l'ancienne PK à 3
-- colonnes.
-- ---------------------------------------------------------------------------------------------

alter table public.transition_autorisee
  drop constraint transition_autorisee_type_ligne_non_vide_chk;

alter table public.transition_autorisee
  drop constraint transition_autorisee_pk;

alter table public.transition_autorisee
  add constraint transition_autorisee_pk primary key (entite, statut_depuis, statut_vers);

alter table public.transition_autorisee
  drop column type_ligne;


-- ---------------------------------------------------------------------------------------------
-- Assertions de fin de down
-- ---------------------------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'transition_autorisee'
       and column_name = 'type_ligne'
  ) then
    raise exception '0046 down : transition_autorisee.type_ligne toujours présente après le down.';
  end if;

  if (
    select count(*) from pg_catalog.pg_constraint
     where conname = 'transition_autorisee_pk' and conrelid = 'public.transition_autorisee'::regclass
       and array_length(conkey, 1) = 3
  ) <> 1 then
    raise exception '0046 down : transition_autorisee_pk doit redevenir une PK à 3 colonnes.';
  end if;

  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'tenant'
       and column_name = 'delai_paiement_jours_defaut'
  ) then
    raise exception '0046 down : tenant.delai_paiement_jours_defaut toujours présente après le down.';
  end if;

  -- 13, PAS 11 : 11 posées par 0003, PLUS 2 par 0009 (proposee/a_valider -> annulee, lacune
  -- comblée après coup) — le total réel juste avant 0046, pas seulement le total de 0003 seule.
  if (select count(*) from public.transition_autorisee where entite = 'ligne_or') <> 13 then
    raise exception '0046 down : transition_autorisee doit revenir à 13 lignes pour ligne_or (11 de 0003 + 2 de 0009).';
  end if;
end
$$;
