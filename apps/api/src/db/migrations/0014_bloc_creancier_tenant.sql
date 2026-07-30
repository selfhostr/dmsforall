-- =============================================================================================
-- 0014_bloc_creancier_tenant.sql — les deux données que l'encodeur QR-facture attend et qui
-- n'existent nulle part en base : le bloc créancier (adresse structurée à 7 champs du garage) et
-- son/ses compte(s) bancaire(s). Sans cette migration, l'encodeur livré et testé
-- (`apps/api/src/facturation/qr/`, 17 fichiers) n'a rien à encoder — c'est aujourd'hui le seul
-- blocage entre l'étape 2 et une facture réellement payable.
--
-- ARBITRAGES REPRIS TELS QUE TRANCHÉS (pas rouverts ici) :
--
--   1. Bloc créancier porté par le TENANT, pas par le site. Le tenant est l'entité juridique de
--      ce modèle — la numérotation continue des factures est déjà par tenant/année, ce qui
--      présuppose exactement ça. Pas d'override par site.
--
--   2. IBAN et QR-IBAN sont deux choses distinctes, stockées dans deux colonnes séparées
--      (`iban`, `qr_iban`), jamais une seule colonne qui jouerait les deux rôles. Un garage peut
--      avoir un IBAN ordinaire sans avoir encore demandé de QR-IBAN à sa banque (les deux ne
--      s'obtiennent pas au même moment), ou l'inverse ; les deux doivent survivre indépendamment
--      dans le temps. Lequel des deux gouverne l'émission d'une facture donnée (QRR si
--      `qr_iban` est renseigné, sinon SCOR/aucune référence via `iban`) est une décision
--      applicative — `determinerTypeReference()` (`facturation/qr/iban.ts`) la prend déjà à
--      partir d'un seul IBAN passé en paramètre ; cette table ne fait qu'offrir les deux
--      candidats, sans arbitrer entre eux.
--
--   3. `client_adresse.numero` : nouvelle colonne `text` NULLABLE (§2 de cette migration).
--      Nullable est délibéré et non négociable : une case postale, un lieu-dit ou un hameau n'ont
--      pas de numéro (assouplissement de `RF-60` vers le standard SIX, en attente d'arbitrage de
--      @laupernoe — cette colonne ne préjuge pas de cette décision, elle rend seulement possible de
--      remplir les 7 champs structurés du QR quand le numéro existe). AUCUNE reprise des données
--      existantes n'est faite ici : découper `rue` par heuristique pour en extraire un numéro
--      serait destructif et faux dès la première adresse inhabituelle (rue avec numéro au milieu,
--      lieu-dit, adresse déjà mal saisie). La reprise reste un TODO explicite, pas un oubli.
--
-- CONTRAINTE IBAN EN BASE — CE QUI EST VÉRIFIÉ ET CE QUI NE L'EST PAS, ET POURQUOI :
--   `validerIbanCreancier()` (`facturation/qr/iban.ts`) vérifie trois choses : (a) la FORME
--   (deux lettres pays + deux chiffres de contrôle + alphanumérique), (b) le PAYS (CH ou LI
--   uniquement pour un compte de QR-facture suisse — `PAYS_IBAN_ADMIS`), (c) la LONGUEUR exacte
--   (21 caractères — `LONGUEURS_MAX.iban`), et enfin (d) la CLÉ DE CONTRÔLE par modulo 97-10
--   (ISO 7064, fonction `resteModulo97` de `modulo97.ts`).
--   Les CHECK ci-dessous reprennent (a)+(b)+(c) en un seul motif `^(CH|LI)[0-9]{2}[0-9A-Z]{17}$`
--   (2+2+17 = 21, donc la longueur est déjà couverte par le motif — pas besoin d'un `length()`
--   séparé). (d), la clé modulo 97, est délibérément LAISSÉE À L'APPLICATIF : PostgreSQL n'a pas
--   d'arithmétique native sur des entiers de plus de 64 bits, et le calcul mod-97 d'un IBAN
--   (chiffres convertis lettre→chiffres puis réduits progressivement, jusqu'à ~34 chiffres avant
--   réduction) demanderait soit `numeric` avec une fonction PL/pgSQL réimplémentant
--   `resteModulo97` en SQL, soit une extension. Le coût (dupliquer un algorithme déjà écrit,
--   testé et documenté en TypeScript, dans un second langage, avec le risque de divergence entre
--   les deux implémentations que ça crée) dépasse le bénéfice : la clé de contrôle protège contre
--   une FAUTE DE FRAPPE au moment de la saisie, un événement rare (un seul bloc créancier par
--   tenant, saisi une fois en paramétrage, pas à chaque facture) et déjà couvert par la validation
--   applicative AVANT écriture. Le CHECK en base reste la ceinture contre une écriture qui
--   contournerait le service (script de maintenance, `db:seed`, correctif manuel) : il attrape
--   la classe d'erreur la plus commune (mauvais pays, mauvaise longueur, caractères invalides),
--   pas la totalité.
--   `qr_iban` reçoit une contrainte SUPPLÉMENTAIRE : l'IID (les 5 chiffres après la clé de
--   contrôle, position 5-9) doit tomber dans la plage réservée 30000-31999 (`IID_QR_IBAN_MIN`/
--   `MAX` de `iban.ts`) — sinon la colonne mentirait sur son propre nom. Même expression que le
--   `qr_iban_est_qr_iban` GENERATED de `document_vente` (0010), en CHECK plutôt qu'en colonne
--   générée : ici la colonne EST le fait vérifié (« ceci est un QR-IBAN »), pas une propriété
--   dérivée d'une valeur qui pourrait légitimement être autre chose.
--   Convention delibérée : les deux colonnes stockent la forme COMPACTE (majuscules, sans espace,
--   exactement 21 caractères) — c'est la forme que `validerIbanCreancier()` renvoie et celle qui
--   entre dans la charge utile QR. Contrairement à `document_vente.qr_iban` (0010), dont le
--   `GENERATED` défend contre des espaces résiduels par `regexp_replace` (données qui existaient
--   déjà avant la contrainte), cette table est neuve : aucune raison d'admettre une forme non
--   normalisée dès l'écriture, donc le CHECK ne tolère aucun espace.
--
-- CE QUE CETTE MIGRATION N'ENGAGE PAS :
--   - aucune valeur par défaut raisonnable pour nom/rue/numero/npa/localite/iban/qr_iban : toutes
--     les colonnes sont NULLABLE, la table n'a AUCUNE ligne après cette migration (voir §1 avant
--     les assertions). C'est un choix : forcer un onboarding de tenant à fournir immédiatement son
--     IBAN pour pouvoir exister romprait un flux d'inscription qui doit rester possible avant que
--     le garage ait ses coordonnées bancaires sous la main. Le CARACTÈRE BLOQUANT (RF-54/PF-03 :
--     un créancier incomplet bloque l'ÉMISSION d'une facture, jamais la création du tenant) est
--     déjà porté par `CHAMPS_REQUIS_BLOC_CREANCIER` côté applicatif (`facturation/qr/adresse.ts`)
--     — cette migration lui donne seulement un endroit où lire ces champs.
--   - aucun câblage de `document_vente.creancier_*`/`qr_iban` (0010) depuis cette nouvelle table :
--     c'est le service d'émission de facture (hors périmètre `db/migrations/`) qui devra lire
--     `tenant_bloc_creancier` et RECOPIER (jamais référencer en direct) ses valeurs dans les
--     colonnes figées de `document_vente` au moment de l'émission — exactement le même principe
--     de gel que `adresse_facturation_figee` pour le client.
--
-- Réversible : migrations/down/0014_bloc_creancier_tenant.down.sql.
-- =============================================================================================


-- ---------------------------------------------------------------------------------------------
-- 1. `client_adresse.numero` — numéro de rue séparé, condition nécessaire pour remplir le bloc
--    débiteur à 7 champs du QR (arbitrage 3 ci-dessus).
-- ---------------------------------------------------------------------------------------------

alter table public.client_adresse
  add column numero text null;

comment on table public.client_adresse is
  'Adresses d''un client (principale/facturation/livraison). RM-03 : une seule principale et une '
  'seule de facturation actives à la fois — voir les index partiels ci-dessous. '
  '`numero` (0014) : numéro de rue séparé de `rue`, requis pour le bloc débiteur du QR-facture '
  '(RF-60) mais NULLABLE à dessein — case postale/lieu-dit/hameau n''en ont pas. Aucune reprise '
  'automatique n''a été faite depuis `rue` pour les adresses existantes (découpage par heuristique '
  'écarté comme destructif) : les adresses migrées ont `numero` vide tant qu''une ressaisie '
  'manuelle ou un import dédié ne l''alimente pas.';


-- ---------------------------------------------------------------------------------------------
-- 2. `tenant_bloc_creancier` — un bloc créancier au plus par tenant (RF-54/PF-03, arbitrage 1).
-- ---------------------------------------------------------------------------------------------

create table public.tenant_bloc_creancier (
  id         uuid    not null default gen_random_uuid(),
  tenant_id  uuid    not null,

  -- Adresse structurée à 7 champs (avec AdrTp et pays, comptés côté encodeur — voir
  -- `facturation/qr/structure.ts`, `NOMBRE_CHAMPS_BLOC_ADRESSE`). Les 6 colonnes ci-dessous sont
  -- les données métier ; `AdrTp` ('S', adresse structurée) est une constante d'encodage, jamais
  -- stockée.
  nom      text    null,
  rue      text    null,
  numero   text    null,
  npa      text    null,
  localite text    null,
  pays     char(2) not null default 'CH',

  -- Comptes bancaires du créancier — deux colonnes distinctes, voir arbitrage 2 en tête de
  -- fichier. Forme COMPACTE exigée (majuscules, sans espace, 21 caractères) : c'est la forme que
  -- `validerIbanCreancier()` renvoie et celle qui entre dans la charge utile QR.
  iban     text null,
  qr_iban  text null,

  cree_le    timestamptz not null default now(),
  modifie_le timestamptz not null default now(),

  constraint tenant_bloc_creancier_pk primary key (id),

  -- Un bloc créancier au plus par tenant — c'est l'invariant du domaine, pas une simple aide à la
  -- jointure (à la différence de `client_adresse_tenant_id_uk`, qui autorise plusieurs adresses
  -- par client et n'existe que pour permettre des FK composites (tenant_id, id) depuis d'autres
  -- tables). Rien ne référence cette table par (tenant_id, id) : `document_vente` RECOPIE ses
  -- valeurs à l'émission (voir tête de fichier), il ne la référence jamais en direct.
  constraint tenant_bloc_creancier_tenant_id_uk unique (tenant_id),

  constraint tenant_bloc_creancier_fk_tenant foreign key (tenant_id)
    references public.tenant (id) on delete restrict,

  constraint tenant_bloc_creancier_pays_chk check (pays ~ '^[A-Z]{2}$'),

  -- IBAN ordinaire : forme + pays (CH/LI) + longueur (21, impliquée par le motif). Clé de
  -- contrôle modulo 97 volontairement absente ici — voir justification en tête de fichier.
  constraint tenant_bloc_creancier_iban_chk
    check (iban is null or iban ~ '^(CH|LI)[0-9]{2}[0-9A-Z]{17}$'),

  -- QR-IBAN : même forme, PLUS l'IID (position 5-9) dans la plage réservée 30000-31999
  -- (`IID_QR_IBAN_MIN`/`MAX`, `facturation/qr/iban.ts`) — sinon la colonne ne serait pas ce que
  -- son nom promet.
  constraint tenant_bloc_creancier_qr_iban_chk check (
    qr_iban is null
    or (
      qr_iban ~ '^(CH|LI)[0-9]{2}[0-9A-Z]{17}$'
      and substring(qr_iban from 5 for 5) ~ '^[0-9]{5}$'
      and substring(qr_iban from 5 for 5)::integer between 30000 and 31999
    )
  )
);

comment on table public.tenant_bloc_creancier is
  'Bloc créancier du QR-facture (RF-54/PF-03) : adresse structurée à 7 champs du garage plus ses '
  'comptes bancaires. Un au plus par TENANT (jamais par site, arbitrage @laupernoe 30.07.2026) — voir '
  'tenant_bloc_creancier_tenant_id_uk. Toutes les colonnes sont nullables : un créancier '
  'incomplet ne bloque JAMAIS la création du tenant, seulement l''ÉMISSION d''une facture '
  '(CHAMPS_REQUIS_BLOC_CREANCIER, facturation/qr/adresse.ts, contrôle applicatif). '
  '`iban`/`qr_iban` sont deux comptes distincts et indépendants, jamais un seul champ qui jouerait '
  'les deux rôles — lequel gouverne une émission donnée est une décision applicative '
  '(determinerTypeReference, facturation/qr/iban.ts), pas un fait figé en base.';

create trigger tenant_bloc_creancier_touche_modifie_le
  before update on public.tenant_bloc_creancier
  for each row execute function public.touche_modifie_le();

-- Table de paramétrage, éditée par un service applicatif via UPDATE (ou upsert), jamais purgée
-- par l'application : pas de DELETE, comme la quasi-totalité des tables de 0010 (mapping_compte,
-- mapping_code_tva, correspondance_externe, periode_comptable, paiement, document_vente...).
revoke all    on public.tenant_bloc_creancier from dfa_app;
grant  select, insert, update on public.tenant_bloc_creancier to dfa_app;
revoke delete on public.tenant_bloc_creancier from dfa_app;

alter table public.tenant_bloc_creancier enable row level security;
alter table public.tenant_bloc_creancier force  row level security;

create policy tenant_bloc_creancier_isolation_tenant on public.tenant_bloc_creancier
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy tenant_bloc_creancier_migrator on public.tenant_bloc_creancier
  to dfa_migrator
  using (true) with check (true);


-- ---------------------------------------------------------------------------------------------
-- Assertions de fin de migration
-- ---------------------------------------------------------------------------------------------

do $$
begin
  -- 1. `client_adresse.numero` existe, nullable, type text.
  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'client_adresse'
       and column_name = 'numero'
       and is_nullable = 'YES'
       and data_type = 'text'
  ) then
    raise exception '0014 : client_adresse.numero absente, non-nullable, ou de mauvais type après migration.';
  end if;

  -- 2. `tenant_bloc_creancier` existe.
  if not exists (
    select 1
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = 'tenant_bloc_creancier'
       and c.relkind = 'r'
  ) then
    raise exception '0014 : table tenant_bloc_creancier introuvable après création.';
  end if;

  -- 3. RLS activé ET forcé (FORCE : sans lui, le propriétaire de la table contournerait ses
  -- propres politiques — non pertinent pour dfa_app qui n'est jamais propriétaire, mais c'est la
  -- posture uniforme du dépôt, vérifiée ici pour ne pas dépendre d'un oubli futur).
  if not exists (
    select 1
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = 'tenant_bloc_creancier'
       and c.relrowsecurity
       and c.relforcerowsecurity
  ) then
    raise exception '0014 : tenant_bloc_creancier n''a pas RLS activé ET forcé.';
  end if;

  -- 4. Les deux politiques attendues existent, avec l'expression d'isolation exacte.
  if not exists (
    select 1 from pg_catalog.pg_policies
     where schemaname = 'public' and tablename = 'tenant_bloc_creancier'
       and policyname = 'tenant_bloc_creancier_isolation_tenant'
       and qual = '(tenant_id = tenant_courant())'
       and with_check = '(tenant_id = tenant_courant())'
  ) then
    raise exception '0014 : politique tenant_bloc_creancier_isolation_tenant absente ou mal formée.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_policies
     where schemaname = 'public' and tablename = 'tenant_bloc_creancier'
       and policyname = 'tenant_bloc_creancier_migrator'
  ) then
    raise exception '0014 : politique tenant_bloc_creancier_migrator absente.';
  end if;

  -- 5. dfa_app n'a PAS DELETE (aucun marqueur [dfa:suppression-physique] posé, il ne doit pas en
  -- avoir besoin).
  if has_table_privilege('dfa_app', 'public.tenant_bloc_creancier', 'DELETE') then
    raise exception '0014 : dfa_app détient DELETE sur tenant_bloc_creancier sans marqueur [dfa:suppression-physique].';
  end if;

  -- 6. dfa_app a bien SELECT/INSERT/UPDATE.
  if not (
    has_table_privilege('dfa_app', 'public.tenant_bloc_creancier', 'SELECT')
    and has_table_privilege('dfa_app', 'public.tenant_bloc_creancier', 'INSERT')
    and has_table_privilege('dfa_app', 'public.tenant_bloc_creancier', 'UPDATE')
  ) then
    raise exception '0014 : dfa_app n''a pas SELECT/INSERT/UPDATE complets sur tenant_bloc_creancier.';
  end if;

  -- 7. Les CHECK attendues sont bien posées (contrôle grossier par nom, cohérent avec 0012 §1).
  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid = 'public.tenant_bloc_creancier'::regclass
       and conname = 'tenant_bloc_creancier_iban_chk'
  ) then
    raise exception '0014 : contrainte tenant_bloc_creancier_iban_chk absente.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid = 'public.tenant_bloc_creancier'::regclass
       and conname = 'tenant_bloc_creancier_qr_iban_chk'
  ) then
    raise exception '0014 : contrainte tenant_bloc_creancier_qr_iban_chk absente.';
  end if;

  -- 8. Un seul bloc créancier par tenant est bien impossible : l'unicité doit porter sur
  -- tenant_id seul (pas (tenant_id, id), qui n'empêcherait rien).
  if not exists (
    select 1
      from pg_catalog.pg_constraint
     where conrelid = 'public.tenant_bloc_creancier'::regclass
       and conname = 'tenant_bloc_creancier_tenant_id_uk'
       and contype = 'u'
       and conkey = (
         select array_agg(attnum order by attnum)
           from pg_catalog.pg_attribute
          where attrelid = 'public.tenant_bloc_creancier'::regclass
            and attname = 'tenant_id'
       )
  ) then
    raise exception '0014 : tenant_bloc_creancier_tenant_id_uk absente ou ne porte pas exactement sur (tenant_id).';
  end if;
end
$$;
