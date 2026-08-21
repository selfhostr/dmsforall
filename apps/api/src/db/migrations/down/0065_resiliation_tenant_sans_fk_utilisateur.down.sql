-- =============================================================================================
-- 0065_resiliation_tenant_sans_fk_utilisateur.down.sql — inverse de
-- 0065_resiliation_tenant_sans_fk_utilisateur.sql.
--
-- Restaure les 4 contraintes de clé étrangère À L'IDENTIQUE (même nom, même `on delete
-- restrict`) — c'est-à-dire restaure aussi le défaut corrigé par le up (le blocage permanent de
-- `purger_donnees_tenant()` sur `utilisateur`). C'est le comportement ATTENDU d'un down : annuler
-- exactement le up, pas produire une version « améliorée » de l'état d'avant. Migration de
-- données : aucune — les colonnes et leurs valeurs ne sont jamais touchées, seule la contrainte
-- l'est.
--
-- COMMENTAIRES DE COLONNE REMIS À `NULL`, PAS À UN AUTRE TEXTE : la version COMMITTÉE de 0062 ne
-- posait AUCUN commentaire sur ces 4 colonnes (seule `export_repertoire` en avait un, non touché
-- ici). Le up de CETTE migration en ajoute quatre ; le down doit donc les RETIRER, pas les
-- remplacer par un texte différent — sinon le schéma après down ne serait pas OCTET POUR OCTET
-- celui d'avant le up (constaté en exécution : `verifier-reversibilite-migrations.sh` a détecté
-- l'écart, quatre `COMMENT ON COLUMN` en trop dans le dump post-down).
-- =============================================================================================

alter table public.resiliation_tenant
  add constraint resiliation_tenant_demandee_par_utilisateur_id_fkey
    foreign key (demandee_par_utilisateur_id) references public.utilisateur (id) on delete restrict,
  add constraint resiliation_tenant_remis_confirme_par_utilisateur_id_fkey
    foreign key (remis_confirme_par_utilisateur_id) references public.utilisateur (id) on delete restrict,
  add constraint resiliation_tenant_effacee_par_utilisateur_id_fkey
    foreign key (effacee_par_utilisateur_id) references public.utilisateur (id) on delete restrict;

comment on column public.resiliation_tenant.demandee_par_utilisateur_id is null;
comment on column public.resiliation_tenant.remis_confirme_par_utilisateur_id is null;
comment on column public.resiliation_tenant.effacee_par_utilisateur_id is null;

alter table public.resiliation_tenant_evenement
  add constraint resiliation_tenant_evenement_declenche_par_utilisateur_id_fkey
    foreign key (declenche_par_utilisateur_id) references public.utilisateur (id) on delete restrict;

comment on column public.resiliation_tenant_evenement.declenche_par_utilisateur_id is null;


-- ---------------------------------------------------------------------------------------------
-- Assertions de fin de down
-- ---------------------------------------------------------------------------------------------

do $$
declare
  v_nb integer;
begin
  select count(*) into v_nb
    from pg_catalog.pg_constraint
   where conname in (
     'resiliation_tenant_demandee_par_utilisateur_id_fkey',
     'resiliation_tenant_remis_confirme_par_utilisateur_id_fkey',
     'resiliation_tenant_effacee_par_utilisateur_id_fkey',
     'resiliation_tenant_evenement_declenche_par_utilisateur_id_fkey'
   );
  if v_nb <> 4 then
    raise exception '0065 down : % contrainte(s) vers utilisateur restaurée(s), 4 attendues.', v_nb;
  end if;

  -- Les 4 commentaires ajoutés par le up doivent avoir disparu — pas être remplacés par un autre
  -- texte (voir la note de tête : la version committée de 0062 n'en posait aucun ici).
  if col_description('public.resiliation_tenant'::regclass, (
       select attnum from pg_catalog.pg_attribute
        where attrelid = 'public.resiliation_tenant'::regclass
          and attname = 'demandee_par_utilisateur_id'
     )) is not null then
    raise exception '0065 down : commentaire encore présent sur resiliation_tenant.demandee_par_utilisateur_id.';
  end if;
  if col_description('public.resiliation_tenant'::regclass, (
       select attnum from pg_catalog.pg_attribute
        where attrelid = 'public.resiliation_tenant'::regclass
          and attname = 'remis_confirme_par_utilisateur_id'
     )) is not null then
    raise exception '0065 down : commentaire encore présent sur resiliation_tenant.remis_confirme_par_utilisateur_id.';
  end if;
  if col_description('public.resiliation_tenant'::regclass, (
       select attnum from pg_catalog.pg_attribute
        where attrelid = 'public.resiliation_tenant'::regclass
          and attname = 'effacee_par_utilisateur_id'
     )) is not null then
    raise exception '0065 down : commentaire encore présent sur resiliation_tenant.effacee_par_utilisateur_id.';
  end if;
  if col_description('public.resiliation_tenant_evenement'::regclass, (
       select attnum from pg_catalog.pg_attribute
        where attrelid = 'public.resiliation_tenant_evenement'::regclass
          and attname = 'declenche_par_utilisateur_id'
     )) is not null then
    raise exception '0065 down : commentaire encore présent sur resiliation_tenant_evenement.declenche_par_utilisateur_id.';
  end if;
end
$$;
