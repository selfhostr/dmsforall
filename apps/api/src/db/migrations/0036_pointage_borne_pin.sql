-- =============================================================================================
-- 0036_pointage_borne_pin.sql — socle base du mode « borne PIN » du pointage. RM-124 → RM-128
-- (`docs/specification-pointage-borne.md`). Contrat déjà posé (non implémenté) :
-- `packages/shared/src/contrats/pointage/identification.ts`.
--
-- DEUX CHOSES POSÉES ICI :
--   1. `parametre_site.mode_identification_pointage` — colonne, RM-124.
--   2. `pin_pointage` — nouvelle table, RM-125 → RM-127 (identité + secret des PIN, PAR SITE).
--
-- CE QUI N'EST **PAS** POSÉ ICI, volontairement, et pourquoi :
--   - Le droit `atelier.pointage.gerer_pin` (RM-128) : une matrice de droits applicative
--     (`matrice-droits.ts` / `apps/web/src/ecrans/pointage/droits.ts`), pas une table. Rien en
--     base ne le porte, comme aucun autre droit du produit n'a de table dédiée.
--   - Le verrouillage anti-balayage (RM-129, §3 de la spec) : scopé sur la SESSION AUTHENTIFIÉE
--     de la borne, donc porté par le mécanisme de verrouillage de compte déjà existant
--     (`authentification.service.ts`, `PALIERS_VERROUILLAGE_MINUTES`) — pas une nouvelle colonne
--     ici. Cette migration ne crée AUCUNE table de verrouillage/tentatives : hors périmètre
--     déclaré de cette tâche (schéma pin_pointage + colonne de site uniquement).
--   - L'identité durable « compte de la borne » (§0.2 de la spec) : PRÉREQUIS déclaré par la
--     spec elle-même comme non tranché, à instruire avec `expert-auth`. Rien ici n'en dépend
--     structurellement — `pin_pointage` ne référence que `site`/`utilisateur`, jamais une
--     éventuelle table de comptes de borne.
--
-- =============================================================================================
-- DÉCISIONS DE SCHÉMA, EXPLICITES
-- =============================================================================================
--
-- (A) ENUM `mode_identification_pointage`, PAS booléen — voir RM-124 dans la spec pour la
--     justification métier (une 3ᵉ identité future — badge RFID, QR — coûterait une valeur enum
--     de plus, pas une migration destructive). Conforme au style déjà en place dans
--     `parametre_site`/`parametre_atelier` (`politique_controle_qualite`, etc.).
--
--     DÉVIATION ASSUMÉE de la doctrine « source unique @dfa/shared » qui gouverne normalement
--     TOUS les enums de `schema/atelier/enums.ts` (voir l'en-tête de ce fichier : chaque
--     `pgEnum(...)` y est un miroir d'une constante exportée par `@dfa/shared`). Le périmètre
--     EXCLUSIF de cette tâche est limité à cette migration et à `apps/api/src/db/schema/` —
--     `packages/shared` est hors périmètre déclaré. Le tableau de valeurs est donc posé EN DUR
--     dans `schema/atelier/enums.ts` plutôt qu'importé. Signalé comme point à résorber : voir le
--     commentaire au même endroit dans le fichier TypeScript, et le compte rendu de livraison de
--     cette tâche.
--
-- (B) `pin_pointage` NE PORTE AUCUN LIEN vers `entite_auditee`/`audit_atelier` — PAS d'ajout de
--     valeur à `entite_auditee`, PAS de trigger `auditer_atelier(...)` posé sur cette table.
--     Choix délibéré, pas un oubli :
--       - RM-128 exige de tracer « qui, quand, pour quel technicien/site » une attribution ou
--         réinitialisation de PIN — SANS jamais exposer le PIN lui-même (clair ou haché) dans le
--         trail. Les quatre colonnes `cree_le` / `cree_par_utilisateur_id` / `modifie_le` /
--         `modifie_par_utilisateur_id` (imposées par RM-125, reprises ici) répondent DÉJÀ à cette
--         exigence pour le DERNIER état connu de chaque ligne — même doctrine que
--         `pointage.derniere_correction_*` (0030) : le dernier état vit sur la ligne, l'historique
--         complet (s'il devient un besoin réel) vit dans un dispositif d'audit séparé.
--       - Brancher `auditer_atelier()` sur cette table AURAIT capturé l'INTÉGRALITÉ de la ligne
--         via `to_jsonb(new/old)` (0004 §4), `pin_hash` compris. Ce n'est PAS le PIN en clair
--         (l'exigence de RM-128 est respectée à la lettre : c'est un hachage Argon2id, jamais la
--         valeur tapée), mais faire dépendre cette garantie d'une lecture attentive du contenu
--         d'un trigger générique, POUR CHAQUE FUTUR RELECTEUR, est un risque évitable pour un
--         bénéfice (historique complet des resets) qu'aucune ligne de la spec ne réclame
--         explicitement. Un historique complet, s'il devient un besoin réel, est un ajout
--         ADDITIF ultérieur (nouvelle table `pin_pointage_historique`, ou extension explicite
--         d'`entite_auditee` dans une migration dédiée qui pourra alors choisir d'exclure
--         `pin_hash` de la charge auditée) — pas une rupture du modèle posé ici.
--       - `id` (uuid) est malgré tout posé comme colonne technique dès maintenant (voir §2
--         ci-dessous) précisément pour que CETTE extension additive, le jour où elle a lieu,
--         n'ait pas à rejouer la correction de 0035_pointage_verrouillage_site_id_et_grant_sequence_article.sql
--         (`auditer_atelier()` exige `NEW.id`/`OLD.id — une table sans identité technique casse
--         au premier branchement du trigger générique, PAS à la revue de schéma).
--
-- (C) Unicité du PIN PAR SITE (RM-127) : PAS une contrainte UNIQUE en base — impossible avec un
--     hachage Argon2id salé (deux hachages du même PIN ne sont jamais égaux). Vérifiée par le
--     SERVICE à l'écriture (itération + `argon2.verify()` sur les lignes actives du site cible).
--     Rien de cette section ne le contredit : AUCUNE contrainte n'est posée ici sur `pin_hash`
--     au-delà de « non vide ».
--
-- (D) `unique (tenant_id, site_id, utilisateur_id)` — CE QUE cette contrainte garantit N'EST PAS
--     l'unicité du PIN (couverte par (C), hors DB) mais l'unicité de la LIGNE DE RATTACHEMENT
--     elle-même (RM-125 : « une ligne par (site, technicien) », pas par technicien seul). C'est
--     cette ligne, et son `actif`, qui EST l'affectation « ce technicien peut pointer sur ce
--     site en mode borne » (§0.1 de la spec — trou comblé sans construire une table
--     d'affectation générale utilisateur↔site).
--
-- (E) DELETE non accordé à `dfa_app` (posture par défaut depuis 0002, aucun GRANT explicite
--     nécessaire ni marqueur `[dfa:suppression-physique]`) : réinitialiser un PIN est une
--     UPDATE de `pin_hash` (+ `modifie_le`/`modifie_par_utilisateur_id`) sur la ligne existante,
--     désactiver un technicien de la borne est une UPDATE de `actif` — jamais une suppression de
--     ligne. Conserver la ligne inactive garde l'historique « qui a été affecté à cette borne »
--     sans qu'elle interfère avec l'identification (RM-126/127 filtrent déjà sur `actif`).
--
-- Réversible INTÉGRALEMENT (aucun `ALTER TYPE ... ADD VALUE` sur un enum PRÉEXISTANT — le seul
-- type créé ici, `mode_identification_pointage`, est nouveau, donc `DROP TYPE` le défait sans
-- reste) : migrations/down/0036_pointage_borne_pin.down.sql.
-- =============================================================================================


-- ---------------------------------------------------------------------------------------------
-- 1. RM-124 — `parametre_site.mode_identification_pointage`
--
-- `ADD COLUMN ... NOT NULL DEFAULT 'session_personnelle'` : la valeur par défaut est une
-- constante enum (non volatile), donc PG11+ n'a PAS besoin de réécrire la table (« fast default
-- »). Chaque site déjà en base — jeu de démo compris, tout premier garage déjà en production —
-- se retrouve avec la colonne posée à `'session_personnelle'` SANS AUCUNE intervention, ce qui
-- EST le comportement actuel verbatim (impératif de la spec, §1) : aucun écran, aucun flux
-- existant ne change tant que personne ne bascule explicitement un site en `'borne_partagee'`
-- (`PATCH /sites/{siteId}/parametres-atelier`, endpoint déjà en place — hors périmètre ici).
-- ---------------------------------------------------------------------------------------------

create type public.mode_identification_pointage as enum (
  'session_personnelle',
  'borne_partagee'
);

comment on type public.mode_identification_pointage is
  'RM-124 : mode d''identification du pointage, paramétrable PAR SITE (parametre_site). '
  'session_personnelle = comportement actuel (technicien connecté sous son propre compte). '
  'borne_partagee = poste tactile mural, identification par PIN 4 chiffres (pin_pointage).';

alter table public.parametre_site
  add column mode_identification_pointage public.mode_identification_pointage
    not null default 'session_personnelle';

comment on column public.parametre_site.mode_identification_pointage is
  'RM-124. Défaut ''session_personnelle'' impératif : tous les sites existants continuent de '
  'fonctionner à l''identique sans intervention. Modifiable par parametrage.atelier.modifier '
  '(même droit que heureOuverture/capaciteHeuresJourCentiemes sur cette même table), via '
  'PATCH /sites/{siteId}/parametres-atelier — pas un nouvel endpoint.';


-- ---------------------------------------------------------------------------------------------
-- 2. RM-125 → RM-127 — `pin_pointage`
--
-- `id` : voir décision (B) en en-tête — colonne technique posée par prudence pour une extension
-- additive future (audit détaillé), NON consommée par cette migration (aucun trigger
-- `auditer_atelier` posé ici). L'identité MÉTIER de la ligne reste `(tenant_id, site_id,
-- utilisateur_id)` — voir `pin_pointage_tenant_site_utilisateur_uk` (décision D).
-- ---------------------------------------------------------------------------------------------

create table public.pin_pointage (
  id         uuid not null default gen_random_uuid(),
  tenant_id  uuid not null references public.tenant (id) on delete restrict,
  site_id    uuid not null,

  -- Le technicien rattaché à ce site en mode borne (§0.1 : l'existence de la ligne EST
  -- l'affectation).
  utilisateur_id uuid not null,

  -- Argon2id encodé PHC (RM-126 : même primitif et mêmes paramètres que
  -- `utilisateur.mot_de_passe_hash`, `$argon2id$v=19$m=19456,t=2,p=1$...`), PAS un HMAC/pepper.
  -- Jamais exposé par l'API, jamais en clair — voir (E) et l'en-tête pour le raisonnement complet
  -- (coût assumé : la recherche par PIN itère les lignes actives du site, N petit par
  -- construction — quelques techniciens à une vingtaine par site).
  pin_hash text not null,

  -- `false` = ce technicien n'est plus éligible à la borne de ce site (départ, changement
  -- d'affectation) — la ligne N'EST JAMAIS SUPPRIMÉE (E), seulement désactivée. RM-126/RM-127
  -- (identification, vérification d'unicité à l'écriture) ne considèrent QUE les lignes actives.
  actif boolean not null default true,

  cree_le    timestamptz not null default now(),
  modifie_le timestamptz not null default now(),

  -- RM-128 : attribution/réinitialisation tracées « qui, quand » — dernier état connu (voir
  -- décision (B) pour ce qui est délibérément hors de ce modèle : l'historique complet des
  -- resets successifs). Jamais NULL : une ligne n'existe que parce que quelqu'un habilité
  -- (`atelier.pointage.gerer_pin`) l'a créée/modifiée — il n'existe pas de chemin d'auto-service
  -- au lot 1 (RM-128).
  cree_par_utilisateur_id    uuid not null,
  modifie_par_utilisateur_id uuid not null,

  constraint pin_pointage_pk primary key (id),

  constraint pin_pointage_fk_site foreign key (tenant_id, site_id)
    references public.site (tenant_id, id) on delete restrict,
  constraint pin_pointage_fk_utilisateur foreign key (tenant_id, utilisateur_id)
    references public.utilisateur (tenant_id, id) on delete restrict,
  constraint pin_pointage_fk_cree_par foreign key (tenant_id, cree_par_utilisateur_id)
    references public.utilisateur (tenant_id, id) on delete restrict,
  constraint pin_pointage_fk_modifie_par foreign key (tenant_id, modifie_par_utilisateur_id)
    references public.utilisateur (tenant_id, id) on delete restrict,

  -- RM-125 : une ligne par (site, technicien) — voir décision (D). PORTE aussi l'accès
  -- « techniciens éligibles à CETTE borne » (§0.1) : `where actif` filtré côté requête, l'index
  -- de cette contrainte sert déjà le préfixe (tenant_id, site_id) sans index supplémentaire
  -- (RM-126 : N par site est petit par construction, un scan du préfixe suffit).
  constraint pin_pointage_tenant_site_utilisateur_uk unique (tenant_id, site_id, utilisateur_id),

  constraint pin_pointage_pin_hash_non_vide_chk check (length(pin_hash) > 0)
);

comment on table public.pin_pointage is
  'RM-125 → RM-127 : rattachement (site, technicien) en mode borne partagée, PIN haché en '
  'Argon2id. Une ligne par (site, technicien) — pas par technicien seul (un technicien '
  'multi-sites a une ligne par site, PIN identique ou non, aucune contrainte entre elles). '
  'Unicité DU PIN par site vérifiée par le SERVICE à l''écriture (itération + argon2.verify), '
  'PAS par contrainte DB — impossible avec un hachage salé. actif=false plutôt que suppression : '
  'aucun DELETE accordé à dfa_app (posture par défaut, aucun marqueur requis).';

create trigger pin_pointage_touche_modifie_le
  before update on public.pin_pointage
  for each row execute function public.touche_modifie_le();

-- --- 2.1 Index -----------------------------------------------------------------------------
--
-- Pas d'index dédié au-delà de celui déjà posé par `pin_pointage_tenant_site_utilisateur_uk` :
-- la requête d'identification (« techniciens actifs du site X ») et la vérification d'unicité à
-- l'écriture (même requête) filtrent sur le PRÉFIXE (tenant_id, site_id) de cet index unique —
-- Postgres l'exploite tel quel. `actif` reste un filtre résiduel appliqué en mémoire sur un
-- résultat déjà minuscule (RM-126 : « au pire N = techniciens actifs du site, jamais des
-- milliers »). Un index partiel supplémentaire `where actif` ajouterait un objet à maintenir
-- pour un gain non mesurable à cette volumétrie — écarté, à reconsidérer seulement si un site
-- réel dépasse un jour l'ordre de grandeur posé par la spec.

-- --- 2.2 Privilèges et RLS -------------------------------------------------------------------

revoke all    on public.pin_pointage from dfa_app;
grant  select, insert, update on public.pin_pointage to dfa_app;
revoke delete on public.pin_pointage from dfa_app;

alter table public.pin_pointage enable row level security;
alter table public.pin_pointage force  row level security;

create policy pin_pointage_isolation_tenant on public.pin_pointage
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy pin_pointage_migrator on public.pin_pointage
  to dfa_migrator
  using (true) with check (true);


-- ---------------------------------------------------------------------------------------------
-- 3. Assertions de fin de migration — ceinture et bretelles, même famille que 0002 §4 / 0012.
-- ---------------------------------------------------------------------------------------------

do $$
begin
  -- `pin_pointage` ne doit PAS avoir DELETE (E) : aucun marqueur [dfa:suppression-physique] posé,
  -- donc verifierPostureRls() doit voir un privilège absent, pas seulement un commentaire muet.
  if has_table_privilege('dfa_app', 'public.pin_pointage', 'DELETE') then
    raise exception '0036 : dfa_app a DELETE sur pin_pointage sans marqueur [dfa:suppression-physique] — posture non déclarée.';
  end if;

  -- `parametre_site` doit rester lisible/écrivable par dfa_app exactement comme avant (aucun
  -- GRANT touché par cette migration) — vérification défensive que l'ALTER TABLE §1 n'a pas eu
  -- d'effet de bord sur les privilèges de la table (ADD COLUMN n'en a jamais, mais le prouver
  -- coûte une ligne).
  if not has_table_privilege('dfa_app', 'public.parametre_site', 'UPDATE') then
    raise exception '0036 : dfa_app a perdu UPDATE sur parametre_site après l''ajout de colonne — effet de bord inattendu.';
  end if;
end
$$;
