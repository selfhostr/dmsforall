-- =============================================================================================
-- 0064_anonymisation_relances.down.sql — inverse de 0064_anonymisation_relances.sql
--
-- Deux gestes :
--   1. Retirer CHIRURGICALEMENT le bloc greffé par la montante (commentaire + appel) du corps de
--      `anonymiser_client_donnees`, en le localisant par recherche de sous-chaîne EXACTE
--      (`position(v_bloc_milieu in ...)`) plutôt qu'en recopiant/recréant le corps « d'origine »
--      à la main — voir l'en-tête de la montante §« comment l'appel est branché » : c'est
--      exactement ce genre de copie manuelle que ce lot vient d'éliminer après que le script de
--      réversibilité a attrapé une divergence sur un simple commentaire. `v_bloc_milieu`
--      ci-dessous doit rester OCTET POUR OCTET identique à celui de la montante — c'est le seul
--      texte que ces deux fichiers doivent garder synchronisé, et s'il divergeait quand même,
--      `position()` rendrait 0 et la migration s'arrêterait bruyamment plutôt que de couper au
--      mauvais endroit.
--   2. Retirer `anonymiser_relances_client`, créée par la montante — rien d'autre n'en dépend
--      après le geste (1).
-- =============================================================================================

do $$
declare
  v_corps_actuel text;
  -- IDENTIQUE OCTET POUR OCTET à `v_bloc_milieu` dans la montante — voir son en-tête.
  v_bloc_milieu constant text :=
    E'\n' ||
    E'  -- (f) Résidu `relances` (0064_anonymisation_relances.sql) — relance_envoi.destinataire_fige/\n' ||
    E'  -- .contenu_fige, DONNÉE PERSONNELLE FIGÉE (RA-12) hors du périmètre de 0061, traitée par une\n' ||
    E'  -- fonction dédiée du module relances. Utilise les MÊMES valeurs capturées tout en haut, avant\n' ||
    E'  -- tout scrub — voir l''en-tête de 0064 pour le détail complet (ce qui est gardé/retiré et\n' ||
    E'  -- pourquoi).\n' ||
    E'  perform public.anonymiser_relances_client(p_tenant_id, p_client_id, v_nom, v_prenom, v_raison_sociale);\n';
  v_pos          int;
  v_corps_avant  text;
begin
  select prosrc into v_corps_actuel
    from pg_catalog.pg_proc
   where proname = 'anonymiser_client_donnees'
     and pronamespace = 'public'::regnamespace;

  if v_corps_actuel is null then
    raise exception '0064 down : anonymiser_client_donnees introuvable.';
  end if;

  v_pos := position(v_bloc_milieu in v_corps_actuel);

  if v_pos = 0 then
    raise exception
      '0064 down : le bloc (f) attendu est introuvable tel quel dans anonymiser_client_donnees — '
      'la fonction a divergé depuis la montante de 0064 (ou le bloc a été modifié dans un seul des '
      'deux fichiers), retrait automatique abandonné plutôt qu''une coupe au mauvais endroit.';
  end if;

  -- Retire exactement le bloc greffé, en gardant OCTET POUR OCTET tout ce qui l'entourait —
  -- notamment le `end` final et son espace blanc, jamais recréés à la main.
  v_corps_avant := left(v_corps_actuel, v_pos - 1)
                || substring(v_corps_actuel from v_pos + length(v_bloc_milieu));

  execute format(
    'create or replace function public.anonymiser_client_donnees(p_tenant_id uuid, p_client_id uuid) '
    'returns void language plpgsql security definer set search_path = pg_catalog, public as %L',
    v_corps_avant
  );

  if position('anonymiser_relances_client' in
       (select prosrc from pg_catalog.pg_proc
         where proname = 'anonymiser_client_donnees' and pronamespace = 'public'::regnamespace)
     ) > 0 then
    raise exception '0064 down : anonymiser_client_donnees appelle encore anonymiser_relances_client après le retrait.';
  end if;

  drop function if exists public.anonymiser_relances_client(uuid, uuid, text, text, text);
end
$$;

-- Pas de `comment on function` ici non plus — la montante n'en pose aucun (voir son en-tête), et
-- `create or replace function` (SQL dynamique ci-dessus) préserve tel quel le commentaire déjà en
-- place (posé par 0061), donc rien à restaurer ni à effacer.

revoke all on function public.anonymiser_client_donnees(uuid, uuid) from public;
grant execute on function public.anonymiser_client_donnees(uuid, uuid) to dfa_app;


-- ---------------------------------------------------------------------------------------------
-- Assertions de fin de down
-- ---------------------------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1 from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'anonymiser_relances_client'
  ) then
    raise exception '0064 down : fonction anonymiser_relances_client toujours présente après le down.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'anonymiser_client_donnees'
  ) then
    raise exception '0064 down : anonymiser_client_donnees a disparu — elle doit survivre (créée par 0061).';
  end if;

  if pg_get_functiondef('public.anonymiser_client_donnees(uuid, uuid)'::regprocedure)
       ilike '%anonymiser_relances_client%' then
    raise exception '0064 down : anonymiser_client_donnees appelle encore anonymiser_relances_client.';
  end if;
end
$$;
