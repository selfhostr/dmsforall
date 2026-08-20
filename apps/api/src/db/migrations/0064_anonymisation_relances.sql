-- =============================================================================================
-- 0064_anonymisation_relances.sql — droit à l'effacement nLPD, résidu `relances` (arbitrage @laupernoe,
-- 20.08.2026). Suite de 0061_anonymisation_client.sql, qui a signalé ce résidu en clair dans son
-- en-tête (§« ne touche pas ») plutôt que de l'écrire hors de son périmètre.
--
-- LE RÉSIDU : `relance_envoi.destinataire_fige`/`.contenu_fige` (`schema/relances/relance-
-- envoi.ts`) portent une DONNÉE PERSONNELLE FIGÉE (RA-12, commentaire de colonne dans le code
-- source) — l'adresse RÉELLEMENT utilisée pour l'envoi, et le texte RÉELLEMENT envoyé (qui
-- contient le nom du client dans la formule d'appel). Ces deux colonnes ne sont JAMAIS
-- recalculées depuis `client` — c'est leur raison d'être, prouver ce qui a été envoyé, à qui —
-- donc une anonymisation de la fiche `client` ne les touche jamais par ricochet. Sans cette
-- migration, anonymiser un client laisserait son nom et son adresse lisibles dans son historique
-- de relances : le garage croirait avoir effacé.
--
-- CE QUE CETTE MIGRATION GARDE, ET POURQUOI :
--
--   La preuve utile d'une relance n'est PAS l'identité du destinataire : c'est le FAIT qu'une
--   relance a été envoyée, quand, par quel canal, pour quel palier/tentative, avec quel verdict
--   (`envoye`/`echoue`), et pour quel objet (`relance_planifiee.objet_type`/`.objet_id`, donc
--   in fine quelle facture pour `facture_echue`). C'est ce qui permet au garage de montrer qu'il
--   a relancé avant de mettre en demeure — ces éléments doivent survivre l'anonymisation, EXACTS,
--   au centime et à la microseconde près. Rien de tout cela n'est touché ici : `tentative`,
--   `canal`, `langue_figee`, `statut_envoi`, `fournisseur_message_id`, `erreur`, `envoye_le`,
--   `cree_le`, et le lien `relance_planifiee_id` restent INTACTS. `relance_planifiee` elle-même
--   (échéance, statut, palier, objet) n'est pas non plus touchée par cette migration — RIEN dans
--   ce module ne remplace `client_id` par un marqueur : la ligne reste rattachée au client
--   anonymisé (déjà neutre depuis 0061), même patron que les documents de vente/OR qui gardent
--   leur `client_id` intact après anonymisation.
--
-- CE QUI PART :
--
--   1. `destinataire_fige` — PII pure par construction (adresse e-mail ou numéro de téléphone du
--      destinataire, rien d'autre dans ce champ) : remplacement TOTAL et INCONDITIONNEL par un
--      marqueur neutre, aucune correspondance à chercher.
--
--   2. `contenu_fige` — texte libre où le nom peut apparaître n'importe où (formule d'appel,
--      mais aussi potentiellement une signature ou un rappel de coordonnées selon le gabarit) :
--      RÉDACTION CIBLÉE, même patron que 0061 §d (`vehicule.conducteur_habituel`,
--      `rendez_vous.commentaire`) — comparaison `ilike '%nom%'` sur les valeurs nom/prénom/raison
--      sociale lues AVANT le scrub de la fiche `client` (paramètres `p_nom`/`p_prenom`/
--      `p_raison_sociale`, capturés par l'appelant), remplacement INTÉGRAL du champ (jamais de
--      substitution partielle regex sur un texte à ponctuation libre) par le même marqueur.
--      `contenu_fige` est `not null` (même contrainte que `client_note.texte` dans 0061 §b) :
--      un marqueur textuel, jamais NULL.
--
-- POURQUOI UNE FONCTION SÉPARÉE (`anonymiser_relances_client`) PLUTÔT QU'UN AJOUT DIRECT DANS LE
-- CORPS DE `anonymiser_client_donnees` :
--
--   Le module `relances` (`apps/api/src/relances/`) est le périmètre d'écriture de cette tâche ;
--   `apps/api/src/clients/` (propriétaire de 0061) est hors périmètre. Une fonction PL/pgSQL
--   dédiée, déclarée ICI, appelée depuis `anonymiser_client_donnees`, garde une frontière nette :
--   le SQL propre au module `relances` vit dans un fichier possédé par ce module, jamais dans le
--   corps d'une fonction que 0061 a écrite.
--
-- COMMENT L'APPEL EST BRANCHÉ SANS TOUCHER 0061 — ET SANS EN RECOPIER LE CORPS À LA MAIN :
--
--   Une première version de cette migration faisait un `create or replace function
--   anonymiser_client_donnees(...)` avec un corps RECOPIÉ À LA MAIN depuis 0061 (augmenté de
--   l'appel). Le script de réversibilité (`scripts/verifier-reversibilite-migrations.sh`) a
--   attrapé une divergence entre les deux copies dès le premier commentaire retouché au passage —
--   la preuve concrète que maintenir deux copies textuelles de la même fonction PL/pgSQL DÉRIVE,
--   même à l'identique en apparence, même en relisant, même sur un simple commentaire. Ce n'était
--   pas un accident isolé à corriger une fois : c'est la classe d'erreur elle-même qui est
--   mauvaise, donc la copie elle-même est éliminée plutôt que rendue « plus soigneuse ».
--
--   Cette version-ci ne recopie plus RIEN du corps de 0061. Elle lit le corps ACTUEL de
--   `anonymiser_client_donnees` directement depuis le catalogue (`pg_proc.prosrc` — pour une
--   fonction PL/pgSQL, c'est le texte source LITTÉRAL, caractère pour caractère, tel qu'écrit
--   dans la migration qui l'a créée ou redéfinie ; PostgreSQL ne le reformate ni ne le réanalyse),
--   puis greffe l'appel `perform anonymiser_relances_client(...)` juste avant le `end` final de
--   ce corps EXISTANT — quel qu'il soit, quoi qu'il contienne, sans jamais en retaper une ligne.
--   `create or replace` est alors exécuté en SQL DYNAMIQUE (`execute format(..., %L, corps)`),
--   seule façon d'injecter un corps de fonction calculé à l'exécution plutôt qu'écrit en dur.
--
--   Le seul texte que CETTE migration possède en propre, et qui doit rester identique entre
--   celle-ci et son `down` (jamais avec 0061 — 0061 n'a plus BESOIN d'être recopiée), est le
--   petit bloc `v_bloc_milieu` ci-dessous (commentaire + appel, une poignée de lignes) : la
--   surface de duplication passe de « tout le corps d'une fonction qui peut grossir à chaque
--   migration future » à « huit lignes qui n'appartiennent qu'à ce module et que personne
--   d'autre ne modifie jamais ». Et si elle divergeait quand même un jour entre les deux
--   fichiers, le `down` ne couperait PAS au mauvais endroit en silence : `position(v_bloc_milieu
--   in ...)` rendrait 0, et la migration s'arrêterait sur une exception — voir le `down` pour le
--   détail. C'est la différence entre un garde-fou qui rassure et un garde-fou qui protège : celui
--   -ci échoue bruyamment plutôt que de produire un résultat plausible mais faux.
--
--   Le corps de 0061 ne dépend d'AUCUNE façon de cette migration : si 0061 change encore demain
--   (nouvelle étape, commentaire retouché, peu importe), cette migration greffe son appel sur la
--   version alors en vigueur, automatiquement, sans qu'aucune ligne de CE fichier n'ait besoin de
--   changer. C'est la « rendre la copie inutile » plutôt que « rendre la copie plus fiable » — la
--   seconde option (par ex. une empreinte figée du corps de 0061 à comparer) a été écartée : elle
--   n'aurait fait que déplacer le problème (il aurait fallu regénérer l'empreinte à chaque futur
--   changement de 0061, donc maintenir malgré tout un artefact synchronisé à la main).
--
-- DROITS EN BASE :
--
--   `relance_envoi` est append-only par construction (0045 §A) : `dfa_app` n'a que SELECT+INSERT,
--   JAMAIS UPDATE ni DELETE — cette migration ne change PAS cette posture pour `dfa_app` (aucune
--   fiche de service applicative ne doit pouvoir réécrire une ligne de preuve d'envoi). Seule une
--   fonction `security definer`, comme (c) de 0061 pour `audit_atelier`, peut légitimement
--   modifier ces deux colonnes précises, pour cette seule raison précise (droit à l'effacement).
--   `anonymiser_relances_client` est donc `security definer`, propriétaire `dfa_migrator` (rôle
--   qui applique cette migration), et n'accorde EXECUTE À PERSONNE — ni `dfa_app` ni `public` :
--   elle n'est jamais appelée directement, seulement depuis l'intérieur de
--   `anonymiser_client_donnees` (elle-même `security definer`, propriétaire `dfa_migrator`), où
--   l'appel s'exécute déjà sous les privilèges du PROPRIÉTAIRE (owner) — EXECUTE explicite inutile
--   dans ce sens, et l'omettre réduit la surface au strict nécessaire (principe du moindre
--   privilège, une frontière de plus qu'un `dfa_app` compromis ne pourrait pas franchir en
--   appelant la fonction interne directement).
--
--   RLS : comme pour 0061, `security definer` fait tourner cette fonction sous les privilèges de
--   `dfa_migrator`, dont la policy `using (true)` sur `relance_envoi`/`relance_planifiee`
--   (`relance_envoi_migrator`/`relance_planifiee_migrator`, 0045) bypasse TOTALEMENT le filtrage
--   RLS pendant l'exécution — CONTRIBUTING.md : « le RLS est le filet, pas le mécanisme ». Chaque
--   instruction du corps porte donc `tenant_id = p_tenant_id` explicite, sur LES DEUX tables
--   jointes, jamais une confiance implicite dans la policy ni dans la seule FK composite
--   `relance_envoi_fk_relance_planifiee` (qui garantit déjà `re.tenant_id = rp.tenant_id`
--   structurellement, mais un filtre redondant explicite coûte rien et documente l'intention).
--
-- AUDIT : aucune trace supplémentaire nécessaire ici — `relance_envoi` n'est délibérément PAS
-- dans `entite_auditee` (append-only, 0045 §A : rien à rédiger dans `audit_atelier` puisqu'aucune
-- ligne n'y est jamais écrite pour cette table). La trace de l'anonymisation elle-même
-- (qui/quand/quel client/motif STAFF) vit dans `client_anonymisation` (0061), écrite AVANT
-- l'appel à `anonymiser_client_donnees` (`service-client-rgpd.ts::anonymiser`) — cette trace ne
-- contient déjà, par construction, aucune des données que ce geste efface.
--
-- NUMÉROTATION : 0060 était la dernière migration existante au démarrage du lot ; 0061/0062/0063
-- réservées par consigne de tâche à d'autres agents en parallèle (périmètres disjoints). Numéro
-- 0064 réservé par la même consigne pour ce périmètre (`apps/api/src/relances/`).
--
-- Réversible : migrations/down/0064_anonymisation_relances.down.sql.
-- =============================================================================================


-- ---------------------------------------------------------------------------------------------
-- 1. `public.anonymiser_relances_client(...)` — voir l'en-tête de fichier pour le détail complet.
-- ---------------------------------------------------------------------------------------------

create function public.anonymiser_relances_client(
  p_tenant_id       uuid,
  p_client_id       uuid,
  p_nom             text,
  p_prenom          text,
  p_raison_sociale  text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_placeholder constant text := '[Anonymisé — droit à l''effacement nLPD]';
begin
  -- destinataire_fige : PII pure (adresse du destinataire) — remplacement total inconditionnel,
  -- filtre `<> v_placeholder` pour rester un no-op idempotent si rejoué (défense en profondeur ;
  -- `client_anonymisation_tenant_client_uk` (0061) empêche déjà un second geste applicatif sur le
  -- même client, mais rien n'empêche un appel direct répété de cette fonction interne).
  update public.relance_envoi re
     set destinataire_fige = v_placeholder
    from public.relance_planifiee rp
   where re.tenant_id = p_tenant_id
     and rp.tenant_id = p_tenant_id
     and re.relance_planifiee_id = rp.id
     and rp.client_id = p_client_id
     and re.destinataire_fige <> v_placeholder;

  -- contenu_fige : texte libre — rédaction ciblée (même patron que 0061 §d), remplacement
  -- INTÉGRAL du champ (jamais de substitution partielle) dès qu'une des trois valeurs
  -- identifiantes capturées AVANT le scrub de `client` s'y trouve.
  update public.relance_envoi re
     set contenu_fige = v_placeholder
    from public.relance_planifiee rp
   where re.tenant_id = p_tenant_id
     and rp.tenant_id = p_tenant_id
     and re.relance_planifiee_id = rp.id
     and rp.client_id = p_client_id
     and re.contenu_fige <> v_placeholder
     and (
       (p_nom is not null and btrim(p_nom) <> '' and re.contenu_fige ilike '%' || p_nom || '%')
       or (p_prenom is not null and btrim(p_prenom) <> ''
           and re.contenu_fige ilike '%' || p_prenom || '%')
       or (p_raison_sociale is not null and btrim(p_raison_sociale) <> ''
           and re.contenu_fige ilike '%' || p_raison_sociale || '%')
     );
end
$fn$;

comment on function public.anonymiser_relances_client(uuid, uuid, text, text, text) is
  'SECURITY DEFINER — droit à l''effacement nLPD (résidu relances, arbitrage @laupernoe, 20.08.2026) : '
  'neutralise relance_envoi.destinataire_fige (total, inconditionnel) et .contenu_fige (rédaction '
  'ciblée sur nom/prénom/raison sociale fournis par l''appelant, capturés AVANT le scrub de '
  'client) pour toutes les tentatives d''envoi des relances planifiées du client. Ne touche NI '
  'relance_planifiee NI les colonnes de preuve (canal, tentative, statut_envoi, envoye_le…). '
  'N''accorde EXECUTE à AUCUN rôle applicatif : appelée uniquement depuis '
  'anonymiser_client_donnees (elle-même security definer, propriétaire dfa_migrator), jamais '
  'directement. Chaque instruction scope tenant_id EXPLICITEMENT sur les deux tables jointes : '
  'RLS ne filtre rien pendant l''exécution (propriétaire dfa_migrator, policy `using (true)`).';

revoke all on function public.anonymiser_relances_client(uuid, uuid, text, text, text) from public;


-- ---------------------------------------------------------------------------------------------
-- 2. Greffe de l'appel dans `anonymiser_client_donnees`, SANS recopier son corps — voir l'en-tête
--    de fichier §« comment l'appel est branché » pour le raisonnement complet.
-- ---------------------------------------------------------------------------------------------

do $$
declare
  -- Corps ACTUEL de anonymiser_client_donnees, tel que 0061 (et ses propres évolutions
  -- éventuelles, appliquées AVANT cette migration puisque son numéro est postérieur) l'a
  -- effectivement laissé — jamais une supposition écrite en dur ici.
  v_corps_avant text;
  -- Suffixe final EXACT du corps actuel : le `end` de la fonction, avec tout espace blanc qui le
  -- suit jusqu'à la fin du texte (souvent un simple retour à la ligne). Capturé pour être restitué
  -- OCTET POUR OCTET dans le nouveau corps — un `end` recréé à la main perdrait cet espace blanc
  -- final et romprait la réversibilité exacte (c'est précisément ce genre d'écart d'un caractère
  -- que le script de réversibilité est fait pour attraper).
  v_fin         text;
  -- Bloc ajouté par CETTE migration — commentaire + appel. SEUL texte que cette migration doit
  -- garder identique à celui du `down` (jamais avec 0061 : elle n'est plus recopiée).
  v_bloc_milieu constant text :=
    E'\n' ||
    E'  -- (f) Résidu `relances` (0064_anonymisation_relances.sql) — relance_envoi.destinataire_fige/\n' ||
    E'  -- .contenu_fige, DONNÉE PERSONNELLE FIGÉE (RA-12) hors du périmètre de 0061, traitée par une\n' ||
    E'  -- fonction dédiée du module relances. Utilise les MÊMES valeurs capturées tout en haut, avant\n' ||
    E'  -- tout scrub — voir l''en-tête de 0064 pour le détail complet (ce qui est gardé/retiré et\n' ||
    E'  -- pourquoi).\n' ||
    E'  perform public.anonymiser_relances_client(p_tenant_id, p_client_id, v_nom, v_prenom, v_raison_sociale);\n';
  v_corps_apres text;
begin
  select prosrc into v_corps_avant
    from pg_catalog.pg_proc
   where proname = 'anonymiser_client_donnees'
     and pronamespace = 'public'::regnamespace;

  if v_corps_avant is null then
    raise exception '0064 : anonymiser_client_donnees introuvable — 0061 doit s''exécuter avant 0064.';
  end if;

  v_fin := substring(v_corps_avant from 'end\s*$');

  if v_fin is null then
    raise exception
      '0064 : le corps de anonymiser_client_donnees ne se termine pas par "end" — ancrage de '
      'greffe introuvable, abandon plutôt qu''une insertion à un endroit incertain.';
  end if;

  v_corps_apres :=
    left(v_corps_avant, length(v_corps_avant) - length(v_fin)) || v_bloc_milieu || v_fin;

  execute format(
    'create or replace function public.anonymiser_client_donnees(p_tenant_id uuid, p_client_id uuid) '
    'returns void language plpgsql security definer set search_path = pg_catalog, public as %L',
    v_corps_apres
  );

  -- La greffe a-t-elle vraiment eu lieu, et rien d'autre n'a bougé ? Comparaison directe contre
  -- ce que la construction ci-dessus DEVAIT produire — pas une supposition sur le contenu de
  -- 0061, une vérification de ce que cette migration vient elle-même de faire.
  if (select prosrc from pg_catalog.pg_proc
       where proname = 'anonymiser_client_donnees' and pronamespace = 'public'::regnamespace)
      <> v_corps_apres then
    raise exception '0064 : le corps de anonymiser_client_donnees après greffe ne correspond pas au corps attendu.';
  end if;
end
$$;

-- Pas de `comment on function` ici, délibérément : `create or replace function` PRÉSERVE le
-- commentaire existant (même OID d'objet, `pg_description` n'est pas touché) — celui posé par
-- 0061 reste donc affiché tel quel, y compris s'il évolue dans une future version de 0061. Poser
-- un commentaire concurrent ici aurait recréé exactement le problème que ce fichier vient
-- d'éliminer pour le CORPS de la fonction (deux textes à synchroniser à la main), pour un
-- bénéfice nul — voir l'en-tête de fichier.

-- `create or replace` (via SQL dynamique ci-dessus) préserve aussi les privilèges déjà accordés
-- par 0061 — réaffirmés explicitement quand même (même doctrine paranoïaque que 0061, « la
-- posture se vérifie »).
revoke all on function public.anonymiser_client_donnees(uuid, uuid) from public;
grant execute on function public.anonymiser_client_donnees(uuid, uuid) to dfa_app;


-- ---------------------------------------------------------------------------------------------
-- 3. Assertions de fin de migration.
-- ---------------------------------------------------------------------------------------------

do $$
begin
  -- `anonymiser_relances_client` : aucun rôle applicatif ne peut l'appeler directement.
  if has_function_privilege(
       'dfa_app', 'public.anonymiser_relances_client(uuid, uuid, text, text, text)', 'EXECUTE'
     ) then
    raise exception '0064 : dfa_app détient EXECUTE sur anonymiser_relances_client (attendu : aucun accès direct).';
  end if;
  if has_function_privilege(
       'public', 'public.anonymiser_relances_client(uuid, uuid, text, text, text)', 'EXECUTE'
     ) then
    raise exception '0064 : PUBLIC détient EXECUTE sur anonymiser_relances_client.';
  end if;

  -- `anonymiser_client_donnees` : posture 0061 inchangée après la greffe.
  if not has_function_privilege('dfa_app', 'public.anonymiser_client_donnees(uuid, uuid)', 'EXECUTE') then
    raise exception '0064 : dfa_app n''a plus EXECUTE sur anonymiser_client_donnees après la greffe.';
  end if;
  if has_function_privilege('public', 'public.anonymiser_client_donnees(uuid, uuid)', 'EXECUTE') then
    raise exception '0064 : PUBLIC détient EXECUTE sur anonymiser_client_donnees.';
  end if;

  -- `relance_envoi` : append-only pour dfa_app, posture 0045 inchangée (cette migration n'y
  -- touche pas — le contournement passe uniquement par la fonction security definer ci-dessus).
  if has_table_privilege('dfa_app', 'public.relance_envoi', 'UPDATE') then
    raise exception '0064 : dfa_app détient UPDATE sur relance_envoi (append-only attendu).';
  end if;
  if has_table_privilege('dfa_app', 'public.relance_envoi', 'DELETE') then
    raise exception '0064 : dfa_app détient DELETE sur relance_envoi (append-only attendu).';
  end if;

  -- Défense contre une régression future qui redéfinirait anonymiser_client_donnees sans
  -- reconduire l'appel au résidu relances : le corps DOIT contenir l'appel. Vérification
  -- indépendante de la mécanique de greffe ci-dessus (celle-ci inspecte le résultat final tel
  -- qu'il vit en base, pas ce que la migration croit avoir produit).
  if pg_get_functiondef('public.anonymiser_client_donnees(uuid, uuid)'::regprocedure)
       not ilike '%anonymiser_relances_client%' then
    raise exception '0064 : anonymiser_client_donnees n''appelle plus anonymiser_relances_client.';
  end if;
end
$$;
