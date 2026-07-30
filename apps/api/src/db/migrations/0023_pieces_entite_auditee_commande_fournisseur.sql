-- =============================================================================================
-- 0023_pieces_entite_auditee_commande_fournisseur.sql — préalable ISOLÉ à 0024, une seule ligne
-- utile.
--
-- CONSTAT, obtenu en exécution en écrivant 0024 : `alter type entite_auditee add value
-- 'commande_fournisseur'` PUIS, dans la MÊME transaction, `insert into transition_autorisee
-- (entite, ...) values ('commande_fournisseur', ...)` échoue avec
-- `unsafe use of new value "commande_fournisseur" of enum type entite_auditee` — PostgreSQL
-- refuse qu'une valeur ajoutée par `ALTER TYPE ... ADD VALUE` soit COMPARÉE (ce qu'un INSERT
-- typé fait implicitement) avant que la transaction qui l'a ajoutée ne soit committée. C'est
-- DIFFÉRENT du cas déjà couvert par 0010/0016/0022 : ceux-là n'utilisent la valeur nouvelle que
-- comme argument de trigger (texte brut, `tg_argv[0]`, casté seulement à l'exécution future du
-- trigger — une transaction ultérieure, donc sûr). 0024 a en plus besoin d'INSÉRER des lignes
-- `transition_autorisee` portant cette même valeur, dans la même migration que celle qui créerait
-- la table `commande_fournisseur` — d'où cette migration séparée, uniquement pour committer
-- l'ADD VALUE avant que 0024 n'en ait besoin.
--
-- RÉVERSIBILITÉ : le DOWN ne peut RIEN défaire — PostgreSQL n'offre aucun DROP VALUE sur un type
-- enum existant. Cette migration n'a d'ailleurs QUE cet effet (aucune table, aucun trigger) :
-- son DOWN est donc un fichier volontairement vide de toute instruction utile, documenté comme
-- tel plutôt que silencieusement absent. Enregistrée dans
-- scripts/verifier-reversibilite-migrations.sh (EXCEPTIONS_DOWN_PARTIEL), même famille que
-- 0010/0016/0022.
-- =============================================================================================

alter type public.entite_auditee add value if not exists 'commande_fournisseur';

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_enum e join pg_catalog.pg_type t on t.oid = e.enumtypid
     where t.typname = 'entite_auditee' and e.enumlabel = 'commande_fournisseur'
  ) then
    raise exception '0023 : entite_auditee ne porte pas la valeur commande_fournisseur après migration.';
  end if;
end
$$;
