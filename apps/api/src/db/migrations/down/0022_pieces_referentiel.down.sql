-- =============================================================================================
-- 0022_pieces_referentiel.down.sql — inverse de 0022_pieces_referentiel.sql.
--
-- NE PEUT PAS DÉFAIRE : `entite_auditee` gagne `article` en montante — PostgreSQL n'offre aucun
-- DROP VALUE sur un type enum. Même limite acceptée que 0010/0016 (voir leurs en-têtes) : la
-- valeur reste dans le type après ce DOWN, sans effet observable (plus aucun trigger ne la
-- produit), documentée pour qu'un futur lecteur de `\dT+ entite_auditee` ne la découvre pas par
-- surprise.
-- =============================================================================================

alter table public.article drop constraint article_fk_reference_remplacement;
drop index public.article_reference_remplacement_idx;

drop table public.article_reference;

drop index public.article_tenant_numero_uk;
drop table public.article;

drop function public.attribuer_numero_article();
drop sequence public.article_numero_seq;

drop table public.fournisseur;

drop type public.categorie_article;
drop type public.type_reference_article;
drop type public.statut_article;
drop type public.statut_fournisseur;
