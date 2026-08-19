-- =============================================================================================
-- 0060_type_approbation_ch_trgm_idx.sql — index trigramme pour la recherche APPROXIMATIVE de code
-- type ASTRA (`type_approbation_ch`, 0050)
--
-- BESOIN — calibrage OCR du scan de permis de circulation (`vehicules/ocr/`) : le code type lu au
-- comptoir est parfois faux à 1-2 caractères près (confusion visuelle 0/O, 1/I, 5/S…), jamais
-- rattrapé par la recherche EXACTE existante (0050, tolérante seulement au bruit de BORDURE — un
-- caractère en trop en tête/fin, pas une confusion de caractère). `correspondance-permis.ts`
-- (`rechercherCorrespondanceTypeApprobationApprox`) ajoute une recherche par DISTANCE D'ÉDITION en
-- repli de la recherche exacte, contre les 216 819 lignes du référentiel.
--
-- MESURÉ AVANT CETTE MIGRATION, en exécution sur `dfa_dev` (216 819 lignes réelles) : le filtre
-- trigramme `%` (pg_trgm, DÉJÀ créée par 0003) sans index dédié force un Seq Scan complet —
-- ~980 ms pour une seule recherche. Le même filtre, MÊME requête, avec l'index GIN posé ici (créé
-- dans une transaction annulée pour la mesure, jamais committé avant cette migration) : ~25-160 ms
-- selon la longueur du candidat (Bitmap Index Scan). Un scan comptoir tente jusqu'à 5 candidats en
-- approximatif (`CANDIDATS_CODE_TYPE_ESSAYES_APPROX`) : sans cet index, l'addition dépasserait
-- largement le budget de 5 s fixé pour tout le calibrage ; avec, elle reste de l'ordre de quelques
-- centaines de millisecondes.
--
-- `gin_trgm_ops`, PAS `text_pattern_ops` (à la différence de l'index marque/modèle posé par 0050) :
-- le besoin ici est une SOUS-CHAÎNE/proximité arbitraire (l'erreur de lecture peut être n'importe
-- où dans le code type), pas un préfixe ancré — exactement le cas d'usage documenté par 0050 pour
-- justifier `text_pattern_ops` À L'INVERSE (préfixe ancré, `like 'prefixe%'`) : les deux index
-- coexistent, chacun sert un besoin différent, aucun doublon.
--
-- PAS DE NOUVELLE EXTENSION — `pg_trgm` existe déjà (0003_prealables_etape1.sql). Seul un nouvel
-- index est posé ici.
--
-- Réversible : migrations/down/0060_type_approbation_ch_trgm_idx.down.sql.
-- =============================================================================================


-- ---------------------------------------------------------------------------------------------
-- Index GIN trigramme sur `normaliser_recherche(code_type_ch)` — même fonction de normalisation
-- que TOUS les index de ce référentiel (0050/0051), pour ne jamais diverger entre la forme
-- indexée et la forme comparée côté requête.
-- ---------------------------------------------------------------------------------------------

create index type_approbation_ch_code_type_trgm_idx on public.type_approbation_ch
  using gin ((public.normaliser_recherche(code_type_ch)) gin_trgm_ops);


-- ---------------------------------------------------------------------------------------------
-- Assertions de fin de migration
-- ---------------------------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'type_approbation_ch_code_type_trgm_idx'
  ) then
    raise exception '0060 : index type_approbation_ch_code_type_trgm_idx introuvable après création.';
  end if;
end
$$;
