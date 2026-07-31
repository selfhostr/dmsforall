-- =============================================================================================
-- 0031_ventes_entite_auditee.sql — préalable ISOLÉ à 0032, quatre lignes utiles seulement.
--
-- Même situation, même remède que 0023_pieces_entite_auditee_commande_fournisseur.sql (à relire
-- pour la preuve détaillée) : `alter type entite_auditee add value` PUIS, dans la MÊME
-- transaction, `insert into transition_autorisee (entite, ...) values (...)` échoue avec
-- `unsafe use of new value "…" of enum type entite_auditee` — PostgreSQL refuse qu'une valeur
-- ajoutée par `ALTER TYPE ... ADD VALUE` soit COMPARÉE (ce qu'un INSERT typé fait implicitement,
-- via la contrainte de clé primaire de `transition_autorisee`) avant que la transaction qui l'a
-- ajoutée n'ait committé. `migrations/0032_ventes.sql` a besoin d'insérer des lignes
-- `transition_autorisee` pour les QUATRE machines à états de ce module (`vehicule_stock`,
-- `dossier_vente`, `reprise`, `financement_vente`) — d'où cette migration séparée et ANTÉRIEURE,
-- limitée au seul ADD VALUE, committée avant que 0032 n'en ait besoin.
--
-- Note pour un lecteur qui compterait les numéros : le brief d'origine désignait « 0031_ventes »
-- comme fichier unique. La contrainte PostgreSQL ci-dessus impose exactement le même découpage
-- en deux fichiers que 0023/0024 pour les pièces — 0031 (ce fichier, préalable) + 0032 (le corps
-- du module). Décision technique, pas une extension de périmètre : aucune autre migration
-- n'utilise le numéro 0032 à la date d'écriture.
--
-- RÉVERSIBILITÉ : le DOWN ne peut RIEN défaire — PostgreSQL n'offre aucun DROP VALUE sur un type
-- enum existant. Cette migration n'a d'ailleurs QUE cet effet (aucune table, aucun trigger) : son
-- DOWN est donc un fichier volontairement vide de toute instruction utile, documenté comme tel.
-- Enregistrée dans scripts/verifier-reversibilite-migrations.sh (EXCEPTIONS_DOWN_PARTIEL), même
-- famille que 0010/0016/0022/0023/0025/0027.
-- =============================================================================================

alter type public.entite_auditee add value if not exists 'vehicule_stock';
alter type public.entite_auditee add value if not exists 'dossier_vente';
alter type public.entite_auditee add value if not exists 'reprise';
alter type public.entite_auditee add value if not exists 'financement_vente';

do $$
declare
  manquantes text;
begin
  select string_agg(v, ', ') into manquantes
    from unnest(array['vehicule_stock', 'dossier_vente', 'reprise', 'financement_vente']) as v
   where not exists (
     select 1 from pg_catalog.pg_enum e join pg_catalog.pg_type t on t.oid = e.enumtypid
      where t.typname = 'entite_auditee' and e.enumlabel = v
   );

  if manquantes is not null then
    raise exception '0031 : entite_auditee ne porte pas la(les) valeur(s) % après migration.', manquantes;
  end if;
end
$$;
