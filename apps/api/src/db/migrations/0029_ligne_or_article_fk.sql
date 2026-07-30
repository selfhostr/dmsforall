-- =============================================================================================
-- 0029_ligne_or_article_fk.sql — clôt l'accroche étape 3 posée sur `ligne_or.article_id` depuis
-- l'étape 1 (commentaire de colonne, 0008 : « Accroche étape 3 (stock pièces) : sans FK »).
--
-- EXPAND, PAS CONTRACT : `article_id` existe déjà (uuid nullable, sans contrainte) depuis 0008 —
-- cette migration ajoute UNIQUEMENT la FK, ne touche à aucune donnée, ne resserre aucune
-- nullabilité. Une ligne pièce SANS article_id reste possible (RP-20 : `fourniParClient = true`
-- ne référence jamais d'article ; `CP-07` documente même le cas où articleId reste renseigné
-- « pour traçabilité » sans conséquence de stock — la FK n'empêche ni l'un ni l'autre, elle
-- empêche seulement de pointer vers un article INEXISTANT ou D'UN AUTRE TENANT).
--
-- SÉCURITÉ AVANT D'AJOUTER LA CONTRAINTE : `article_id` n'a jamais pu être renseigné avec une
-- valeur signifiante avant ce lot (aucun module ne l'écrivait, `article` n'existait pas) — vérifié
-- juste avant cette migration : `select count(*) from ligne_or where article_id is not null` = 0
-- sur `dfa_dev`. L'ajout direct (sans `NOT VALID` + `VALIDATE CONSTRAINT` différée) est donc sûr
-- ICI. Un dépôt avec des tenants de production existants au moment d'une migration équivalente
-- devrait passer par `NOT VALID` puis valider hors des heures de pointe (verrou `SHARE UPDATE
-- EXCLUSIVE` seulement, pas `ACCESS EXCLUSIVE`) — non nécessaire à ce stade (CONTRIBUTING.md : aucun
-- tenant de production, feuille de route §6-7).
--
-- FK COMPOSITE AVEC LE TENANT (règle n°1 du projet), comme toutes les autres FK de ligne_or.
-- =============================================================================================

do $$
declare
  n integer;
begin
  select count(*) into n from public.ligne_or where article_id is not null;
  if n <> 0 then
    raise exception
      '0029 : % ligne(s) ligne_or portent déjà article_id — vérifier qu''elles référencent bien des lignes de public.article avant d''ajouter la FK directement (NOT VALID + VALIDATE recommandé sinon).',
      n;
  end if;
end
$$;

alter table public.ligne_or
  add constraint ligne_or_fk_article
  foreign key (tenant_id, article_id)
  references public.article (tenant_id, id) on delete restrict;

-- Sert le service de facturation/atelier qui doit retrouver toutes les lignes d'OR référençant un
-- article donné (ex. avant désactivation d'un article, RP-07 : vérifier qu'aucune ligne active ne
-- le référence). Partiel : la majorité des lignes d'OR ne sont pas de type piece.
create index ligne_or_article_idx on public.ligne_or (tenant_id, article_id)
  where article_id is not null;

comment on table public.ligne_or is
  'Ligne d''un ordre de réparation. taux_horaire_centimes/prix_unitaire_centimes FIGÉS à la '
  'création (RM-65). Aucun DELETE (RM-71) : une ligne se corrige par annulation motivée. '
  '`payeur_client_id` (0017, AC-08) désigne le tiers payeur (constructeur/assurance/tiers) quand '
  '`payeur` n''est pas `client`/`garage` — voir ligne_or_payeur_client_coherent_chk et MD-62 '
  '(regroupement des documents par (payeur, payeur_client_id)). `article_id` (0029, ligne_or_fk_'
  'article) référence public.article quand type=''piece'' et fourniParClient=false (RP-19) — une '
  'réservation existe alors dans reservation_piece (0026), jamais l''inverse.';

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conname = 'ligne_or_fk_article' and conrelid = 'public.ligne_or'::regclass
  ) then
    raise exception '0029 : contrainte ligne_or_fk_article absente après migration.';
  end if;
end
$$;
