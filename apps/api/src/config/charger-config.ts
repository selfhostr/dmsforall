import { z } from 'zod';

import { schemaConfigCourriel } from '../courriel/config-courriel';
import { schemaConfigConsole } from '../exploitation/config-console';
import { schemaConfigJobPurgeAutomatiqueTenant } from '../exploitation/cycle-vie-tenant/config-job-purge-automatique-tenant';
import { schemaConfigJobClotureAutomatiquePointage } from '../pointage/config-job-cloture-automatique-pointage';
import { schemaConfigJobRelances } from '../relances/config-job-relances';
import { schemaConfigJobReferentielVehiculesCh } from '../vehicules/referentiel/config-job-referentiel-vehicules-ch';
import { schemaConfigOcrPermis } from '../vehicules/ocr/config-ocr';
import { calculerBrancheParDefaut, calculerVersionAppParDefaut } from './version-app';

/**
 * Jeton d'injection de la configuration validée. Toute la config transite par ce jeton —
 * aucun service ne relit `process.env` directement (seul ce fichier et `main.ts` le font).
 */
export const JETON_CONFIG = Symbol.for('DFA_CONFIG');

export const schemaConfig = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    // Rôle du process (chantier « socle d'ordonnancement — découplage worker/API », 27.08.2026) —
    // voir `apps/api/src/ordonnancement/mode-processus.ts` pour les deux fonctions qui LISENT
    // cette valeur (jamais une comparaison directe dispersée dans chaque module de job) :
    //   - 'api'     : `apps/api/src/main.ts`, aucun processeur BullMQ enregistré (pas seulement
    //                 inactif — absent du graphe Nest, voir les modules `*JobModule` de chaque
    //                 domaine job) ;
    //   - 'worker'  : `apps/api/src/main-worker.ts`, aucun serveur HTTP métier (application
    //                 context Nest pur + sonde de santé minimale sur PORT, voir ce fichier) ;
    //   - 'combine' : DÉFAUT — les deux à la fois, dans le MÊME process. Reste le défaut pour que
    //                 `pnpm dev` (qui démarre `main.ts` sans variable supplémentaire) continue de
    //                 tout exécuter localement, exactement comme avant ce chantier.
    // Producteurs BullMQ (`@InjectQueue`, ex. `ServiceAnalyseReprise.lancer`) ni gardés ni coupés
    // par cette variable : un `Queue` producteur ne consomme rien, il reste toujours disponible
    // pour qu'un endpoint HTTP puisse poser un job, y compris en mode 'api' pur.
    MODE_PROCESSUS: z.enum(['api', 'worker', 'combine']).default('combine'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    API_URL_PUBLIQUE: z.string().url(),
    WEB_URL_PUBLIQUE: z.string().url(),
    // rôle dfa_app — seul rôle utilisé par l'API en exécution, soumis au RLS.
    DATABASE_URL: z.string().min(1).startsWith('postgres'),
    // rôle dfa_migrator — migrations uniquement, jamais utilisé par l'API en exécution.
    DATABASE_URL_MIGRATION: z.string().min(1).startsWith('postgres'),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
    // Connexions maintenues ouvertes en permanence, même hors trafic (0 = comportement
    // historique : le pool se vide complètement dès que `DATABASE_TIMEOUT_IDLE_MS` s'écoule sans
    // activité). Défaut 2, justifié par un défaut mesuré : `pg-pool` ferme toute connexion
    // inactive après `idleTimeoutMillis` (10 s par défaut, jusqu'ici jamais réglé explicitement —
    // voir DATABASE_TIMEOUT_IDLE_MS ci-dessous) tant que `min` (jusqu'ici jamais réglé non plus,
    // défaut `pg-pool` = 0) ne l'en empêche pas. Un garage qui rouvre son poste après la pause de
    // midi envoie une salve de requêtes de LISTE (OR, documents de vente) sur un pool à zéro
    // connexion établie : chacune paie le coût plein d'un nouveau handshake TCP + authentification
    // SCRAM avant de répondre, et une salve suffisamment large fait la queue derrière
    // `DATABASE_POOL_MAX`. Garder 2 connexions chaudes absorbe ce cas courant sans immobiliser
    // une part significative du budget `max` (défaut 10) ni du `max_connections` PostgreSQL
    // partagé par les 200 tenants visés — un `min` réglé au niveau de `max` annulerait le
    // bénéfice même d'un pool à taille variable et gèlerait des connexions à vide sur un tenant
    // inactif la nuit.
    // SANS DÉFAUT ICI : le défaut « 2, sauf si DATABASE_POOL_MAX est plus petit » est calculé par
    // le `.transform()` de fin de schéma, une fois DATABASE_POOL_MAX connu — un `.default(2)` fixe
    // posé directement ici est incompatible avec un `DATABASE_POOL_MAX` réduit à 1 (pool à une
    // seule connexion physique, délibéré dans les tests d'isolation tenant — rls.spec.ts,
    // isolation-parametrage/vehicules.spec.ts — pour prouver que l'isolement tient même quand
    // deux tenants consécutifs SE PARTAGENT la même connexion) : `chargerConfig` refusait alors de
    // démarrer avant même l'exécution du test, empêchant précisément le test qui est la raison
    // d'être de tout le dispositif d'isolation. Voir le `.transform()` en bas de fichier pour le
    // calcul complet. Une valeur EXPLICITE de DATABASE_POOL_MIN reste validée par le superRefine
    // juste en dessous : seul le défaut implicite s'ajuste, jamais une valeur que l'opérateur a
    // réellement tapée — un vrai `min > max` explicite doit continuer à échouer au démarrage.
    DATABASE_POOL_MIN: z.coerce.number().int().min(0).max(50).optional(),
    DATABASE_TIMEOUT_REQUETE_MS: z.coerce.number().int().min(100).default(10_000),
    // `connectionTimeoutMillis` du pool `pg` : délai maximal accordé à UNE tentative de connexion
    // (nouvelle ou en file d'attente derrière `DATABASE_POOL_MAX`) avant `pg-pool` ne lève
    // `timeout exceeded when trying to connect` — l'erreur mesurée sous charge (88 reproductions,
    // `DocumentVenteController.lister`/`OrdreReparationController.lister`). Auparavant câblée en
    // dur (`5_000`) dans `acces-base.service.ts`/`acces-amorcage.service.ts`, jamais validée ni
    // ajustable par déploiement. Défaut inchangé (5 s) : ni trop court pour une poignée de main
    // SCRAM sous charge légitime, ni assez long pour transformer une vraie saturation en attente
    // silencieuse côté client (le corps HTTP ne part qu'à l'expiration).
    DATABASE_TIMEOUT_CONNEXION_MS: z.coerce.number().int().min(100).default(5_000),
    // `idleTimeoutMillis` du pool `pg` : délai d'inactivité avant qu'une connexion AU-DESSUS de
    // `DATABASE_POOL_MIN` ne soit fermée. Auparavant jamais réglé — `pg-pool` retombe alors sur
    // son propre défaut (10 s, `node_modules/pg-pool/index.js`), implicite et donc invisible à la
    // relecture de ce fichier, qui est censé être la source unique de vérité sur ce que l'API
    // accepte comme configuration. Défaut porté à 30 s : assez long pour qu'un poste d'atelier qui
    // interroge la liste des OR toutes les 15-20 s (rafraîchissement d'écran typique) ne fasse
    // jamais fermer puis rouvrir la même connexion en boucle, sans pour autant garder des
    // connexions ouvertes des heures sur un tenant inactif la nuit (le pool retombe à
    // DATABASE_POOL_MIN, pas à zéro).
    DATABASE_TIMEOUT_IDLE_MS: z.coerce.number().int().min(1_000).default(30_000),
    REDIS_URL: z.string().min(1).startsWith('redis'),
    SESSION_COOKIE_NOM: z
      .string()
      .regex(/^[A-Za-z0-9_-]+$/)
      .default('dfa_session'),
    SESSION_DUREE_MINUTES: z.coerce.number().int().min(5).max(43_200).default(480),
    SESSION_INACTIVITE_MINUTES: z.coerce.number().int().min(5).max(1_440).default(120),
    COOKIE_DOMAINE: z.string().optional(),
    // Nombre EXACT de reverse proxies entre le client et le conteneur API (Express `trust
    // proxy`, passé tel quel comme nombre de hops — jamais `true`, voir le commentaire sur
    // TRUST_PROXY_HOPS dans .env.example). Défaut 0 = aucun proxy de confiance, `req.ip` reste
    // l'adresse TCP entrante : c'est le comportement historique, sûr par défaut. En production
    // derrière un reverse proxy (déploiement prévu), doit être réglé au nombre réel de hops,
    // sous peine que la limitation de débit par IP scope tous les tenants sur une seule clé
    // (finding 2, audit sécurité) — et jamais à un nombre supérieur au nombre réel de proxies,
    // sous peine qu'un `X-Forwarded-For` forgé par le client contourne la limitation par IP.
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
    // `.default()` AVANT `.transform()` : en zod 4, la valeur par défaut est typée sur la
    // sortie de la chaîne. Placée après le transform, elle devrait être un booléen, pas la
    // chaîne 'true' issue de l'environnement.
    COOKIE_SECURE: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),
    ARGON2_MEMOIRE_KIB: z.coerce.number().int().min(19_456).default(19_456),
    ARGON2_ITERATIONS: z.coerce.number().int().min(2).default(2),
    ARGON2_PARALLELISME: z.coerce.number().int().min(1).default(1),
    LIMITE_CONNEXION_IP: z.coerce.number().int().min(1).default(20),
    // Budget Redis anti-brute-force PAR EMAIL (fenêtre glissante `LIMITE_FENETRE_SECONDES`).
    // Défaut 15, STRICTEMENT supérieur à SEUIL_VERROUILLAGE_COMPTE (défaut 5, voir plus bas) :
    // les deux dispositifs sont indépendants (l'un un compteur Redis à fenêtre glissante, l'autre
    // un verrouillage progressif persisté en base) et ne doivent PAS partager la même valeur,
    // sous peine que les tentatives échouées qui déclenchent le verrouillage épuisent aussi tout
    // le budget de débit avant que la tentative suivante (mot de passe enfin correct) puisse
    // prouver le verrouillage et recevoir `423 AUTH_COMPTE_VERROUILLE` — elle recevrait alors
    // `429 AUTH_TROP_DE_TENTATIVES` à la place, rendant le 423 inatteignable en pratique
    // (bloquant B1, rapport QA étape 0). Le fond de la correction, dans
    // `authentification.service.ts`, est que ce budget n'est de toute façon plus consommé que
    // sur ÉCHEC de vérification (jamais sur une connexion réussie, bloquant B2) — cette marge
    // reste néanmoins une seconde barrière indépendante.
    LIMITE_CONNEXION_COMPTE: z.coerce.number().int().min(1).default(15),
    LIMITE_FENETRE_SECONDES: z.coerce.number().int().min(30).default(900),
    // Nombre d'échecs de mot de passe CONSÉCUTIFS avant le premier verrouillage progressif du
    // compte (persisté en base, `utilisateur.verrouille_jusqu_a` — voir
    // `authentification.service.ts:calculerVerrouillage`). Distinct et indépendant de
    // LIMITE_CONNEXION_COMPTE ci-dessus : voir le commentaire sur cette variable pour le
    // pourquoi de la séparation (bloquant B1, rapport QA étape 0).
    SEUIL_VERROUILLAGE_COMPTE: z.coerce.number().int().min(1).default(5),
    // --- Limitation de débit sur la recherche (GET /recherche, finding D-01 audit sécurité) ---
    // PAR UTILISATEUR, jamais par IP ni globalement (voir garde-limitation-recherche.ts pour le
    // détail du raisonnement) : le pool de connexions Postgres (DATABASE_POOL_MAX) est PARTAGÉ
    // entre tous les tenants — sans cette limite, une salve de requêtes sur /recherche l'épuise
    // pour l'ENSEMBLE des garages, pas seulement pour l'auteur des requêtes.
    // Dimensionnement retenu : 40 requêtes / 30 s, soit ≈ 1,3 req/s par utilisateur — calibré
    // pour une plaque suisse tapée caractère par caractère (8 à 10 requêtes en quelques
    // secondes), avec de la marge pour des recherches consécutives au comptoir (véhicule après
    // véhicule), tout en restant loin de ce qu'il faudrait pour épuiser à lui seul le pool de 10
    // connexions par défaut (DATABASE_POOL_MAX). C'est un débit moyen soutenu, pas une limite de
    // concurrence : les valeurs par défaut de ces deux dispositifs sont donc volontairement dans
    // un rapport où LIMITE_RECHERCHE_UTILISATEUR (40) dépasse DATABASE_POOL_MAX (10) sans que ce
    // soit un piège de configuration analogue à LIMITE_CONNEXION_COMPTE/SEUIL_VERROUILLAGE_COMPTE
    // ci-dessus — il n'y a ici qu'un seul dispositif (un compteur Redis à fenêtre glissante), pas
    // deux mécanismes indépendants pouvant se rendre mutuellement inatteignables. Voir le
    // commentaire ci-dessus sur ce couple pour la distinction.
    LIMITE_RECHERCHE_UTILISATEUR: z.coerce.number().int().min(1).default(40),
    LIMITE_RECHERCHE_FENETRE_SECONDES: z.coerce.number().int().min(1).default(30),
    LOG_NIVEAU: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    // Défaut 'false' (finding 8, audit sécurité) : Swagger/OpenAPI est monté directement sur
    // Express par `SwaggerModule.setup()` (main.ts), donc HORS du graphe Nest — l'`APP_GUARD`
    // d'authentification ne s'y applique pas. Un oubli de variable en production exposerait
    // sans authentification `GET /api/docs.json` (cartographie complète des endpoints, schémas,
    // nom exact du cookie de session). C'est le seul point du socle qui doive être fail-closed
    // par défaut plutôt que de dépendre d'un opérateur qui pense à le désactiver.
    OPENAPI_EXPOSER_DOCS: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    // Version applicative + branche exposées par `GET /sante` (pied de la barre latérale,
    // support téléphonique : « quelle version tourne chez ce garage ? ») et par les métadonnées
    // d'observabilité (logs JSON, release Sentry, document OpenAPI). SANS DÉFAUT STATIQUE :
    // l'ancien `.default('0.0.0-dev')` ne bougeait plus jamais une fois copié dans un `.env` (
    // constat réel : `VERSION_APP=0.1.0-dev` figé depuis le tout début du projet, alors même que
    // le numéro est maintenant affiché en permanence en pied de barre latérale). `.preprocess`
    // convertit la chaîne vide (ligne laissée en blanc dans `.env.example`/`.env`, même patron
    // que SENTRY_DSN/SENTRY_ENVIRONMENT plus bas) en `undefined` : seul un `undefined` déclenche
    // le calcul dynamique de repli (`calculerVersionAppParDefaut`/`calculerBrancheParDefaut`,
    // voir version-app.ts pour le schéma de numérotation et pourquoi il ne lève jamais). Une
    // valeur EXPLICITE — toujours le cas en production, voir `apps/api/Dockerfile` (`ARG`/`ENV`
    // fixés au moment du build par `.github/workflows/publier-images.yml`) — est prise telle
    // quelle, jamais recalculée : le conteneur de production n'a de toute façon pas de `.git`.
    VERSION_APP: z.preprocess(
      (v) => (v === '' ? undefined : v),
      z.string().min(1).default(calculerVersionAppParDefaut),
    ),
    // Nom de la branche (ou du tag) qui a produit ce build — affiché à côté de VERSION_APP dans
    // le pied de la barre latérale (ex. « main 0.1.234 »). Même mécanisme de repli que
    // VERSION_APP ci-dessus ; voir `calculerBrancheParDefaut` (version-app.ts) pour le cas du
    // HEAD détaché (checkout d'un tag précis), qui ne doit jamais rendre la chaîne `HEAD` telle
    // quelle. En CI/production, la valeur vient directement du contexte GitHub Actions
    // (`github.ref_name`) plutôt que d'une commande git — voir publier-images.yml — donc jamais
    // de HEAD détaché non plus à ce niveau-là.
    VERSION_APP_BRANCHE: z.preprocess(
      (v) => (v === '' ? undefined : v),
      z.string().min(1).default(calculerBrancheParDefaut),
    ),
    // Vérification de la dernière version publiée (menu du profil : « nouvelle version
    // disponible »). L'API interroge GitHub côté serveur, avec cache ; `false` coupe tout appel
    // sortant (installation isolée du réseau).
    VERIFIER_MISE_A_JOUR: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),
    // --- Supervision (Sentry, auto-hébergé en Suisse — décision de conception, cohérence nLPD) --------
    // DSN de l'instance Sentry. OPTIONNELLE et SANS DÉFAUT : son absence ne doit JAMAIS
    // empêcher l'API de démarrer, elle désactive proprement la supervision (voir
    // `observabilite/initialiser-sentry.ts`). Auto-hébergement : ce DSN pointe une instance
    // Sentry interne plutôt que sentry.io — même format d'URL (`https://<clé>@<hôte>/<projet>`),
    // rien de spécifique à coder côté SDK, seul l'hôte change selon l'environnement.
    // `.preprocess` transforme la chaîne vide (valeur laissée en blanc dans .env.example ou un
    // `.env` local) en `undefined`, sinon `z.string().url().optional()` la rejetterait (une
    // chaîne vide n'est pas une URL valide, et `.optional()` n'autorise que `undefined`).
    SENTRY_DSN: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()),
    // Nom d'environnement affiché dans Sentry (production | staging | development…). OPTIONNELLE :
    // à défaut, `initialiserSentry` retombe sur NODE_ENV — évite de dupliquer la même valeur
    // dans deux variables en usage courant, tout en laissant la main pour un déploiement où les
    // deux devraient diverger (ex. plusieurs environnements de staging sous NODE_ENV=production).
    // Même `.preprocess` que SENTRY_DSN ci-dessus, et pour la même raison : `.env.example` livre
    // la ligne `SENTRY_ENVIRONMENT=` vide, et dotenv produit alors une chaîne vide — définie,
    // donc non couverte par `.optional()`, et rejetée par `.min(1)`. Sans cette conversion, la
    // séquence de démarrage documentée (`cp .env.example .env` puis `pnpm db:migrate`) échoue sur
    // tout clone neuf, avec un message qui désigne Sentry alors que le projet n'utilise aucune
    // supervision en dev.
    SENTRY_ENVIRONMENT: z.preprocess(
      (v) => (v === '' ? undefined : v),
      z.string().min(1).optional(),
    ),
    // Taux d'échantillonnage des traces de performance (0 à 1). Défaut À ZÉRO (audit sécurité,
    // finding H2) : le tracing produit des événements de TRANSACTION, qui contiennent les mêmes
    // catégories de données que les erreurs (requête, URL, spans avec leurs attributs) mais dont
    // le nettoyage (`beforeSendTransaction`/`beforeSendSpan`, voir observabilite/) est un ajout
    // récent et donc moins éprouvé que celui des erreurs — tant qu'aucun besoin de traçage de
    // performance n'est identifié, ne pas activer une seconde voie de sortie du tout. À monter
    // explicitement par déploiement une fois ce besoin réel et le nettoyage éprouvé en
    // production.
    SENTRY_TAUX_ECHANTILLONNAGE_TRACES: z.coerce.number().min(0).max(1).default(0),
    // --- Courriel (SMTP Infomaniak, envoi verrouillé hors production) ----------------------
    // Bloc défini une seule fois dans `courriel/config-courriel.ts` et fusionné ici via
    // `.shape`, même patron que `schemaConfigConsole` ci-dessous — une seule source de vérité
    // sur le schéma, jamais une redéclaration séparée qui pourrait diverger. Voir ce fichier
    // pour le détail de chaque variable et le verrou à deux clés (`NODE_ENV`/
    // `COURRIEL_ENVOI_REEL`) qui décide entre transport réel et transport de capture.
    ...schemaConfigCourriel.shape,
    // --- Console d'exploitation (plateforme, PORTE 1 uniquement) --------------------------
    // Bloc ENTIÈREMENT optionnel, défini une seule fois dans `exploitation/config-console.ts`
    // et fusionné ici via `.shape` : dupliquer les champs à la main les ferait diverger
    // silencieusement de la validation réellement appliquée par `resoudreConfigConsole`.
    // `DATABASE_URL_CONSOLE` ABSENTE (cas par défaut) ⇒ `ExploitationModule.pourConfig` rend un
    // module vide (aucun contrôleur, aucun pool `dfa_console`) — voir app.module.ts et
    // exploitation/exploitation.module.ts pour le mécanisme d'extinction. Une valeur PRÉSENTE
    // mais incohérente (URL identique à DATABASE_URL/DATABASE_URL_MIGRATION, cookie homonyme de
    // SESSION_COOKIE_NOM, inactivité > durée absolue) ne fait PAS échouer `chargerConfig` ici :
    // `resoudreConfigConsole` porte ces contrôles croisés (elle a besoin de DATABASE_URL et
    // SESSION_COOKIE_NOM, déjà résolus à ce stade) et lève au moment où `AppModule.pourConfig`
    // monte `ExploitationModule` — donc toujours avant l'ouverture du port, jamais un démarrage
    // silencieux avec une console mal branchée.
    ...schemaConfigConsole.shape,
    // --- Job quotidien de contrôle/import du référentiel véhicules suisse ASTRA -------------
    // Bloc défini une seule fois dans `vehicules/referentiel/config-job-referentiel-vehicules-ch.ts`
    // et fusionné ici via `.shape`, même patron que les deux blocs juste au-dessus.
    ...schemaConfigJobReferentielVehiculesCh.shape,
    // --- Job quotidien de clôture automatique de fin de journée du pointage (RM-91/RM-119) ---
    // Bloc défini une seule fois dans `pointage/config-job-cloture-automatique-pointage.ts` et
    // fusionné ici via `.shape`, même patron que le bloc ASTRA juste au-dessus.
    ...schemaConfigJobClotureAutomatiquePointage.shape,
    // --- Scan OCR du permis de circulation (reconnaissance automatique, carte grise) ---
    // Bloc défini une seule fois dans `vehicules/ocr/config-ocr.ts` et fusionné ici via `.shape`,
    // même patron que les blocs ci-dessus.
    ...schemaConfigOcrPermis.shape,
    // --- Job quotidien de purge automatique à la sortie du garage (offboarding,
    // migration 0062) ---
    // Bloc défini une seule fois dans
    // `exploitation/cycle-vie-tenant/config-job-purge-automatique-tenant.ts` et fusionné ici via
    // `.shape`, même patron que le bloc de clôture automatique du pointage ci-dessus. Urgent :
    // sans cette fusion, RESILIATION_PURGE_AUTOMATIQUE_JOB_ACTIF/_CRON restent silencieusement
    // `undefined` au runtime même posées dans `.env` — en production, NODE_ENV suffit à faire
    // franchir au job la porte « actif » (voir `purgeAutomatiqueTenantJobDoitEtreActif`), avec un
    // motif de planification `undefined` : l'inscription du planificateur échouerait probablement
    // au démarrage de l'API.
    ...schemaConfigJobPurgeAutomatiqueTenant.shape,
    // --- Job horaire de relances de facturation (rappel #2,
    // docs/specification-relances-automatiques.md) ---
    // Bloc défini une seule fois dans `relances/config-job-relances.ts` et fusionné ici via
    // `.shape`, même patron que les blocs de job ci-dessus. Sans cette fusion,
    // RELANCES_FACTURE_JOB_ACTIF/_CRON restent silencieusement `undefined` au runtime même posées
    // dans `.env` — le job reste inactif quoi qu'on écrive dans l'environnement (fail-closed,
    // jamais un envoi accidentel, mais aussi jamais un job programmable).
    ...schemaConfigJobRelances.shape,
  })
  .superRefine((c, ctx) => {
    if (c.NODE_ENV === 'production' && !c.COOKIE_SECURE) {
      ctx.addIssue({
        code: 'custom',
        path: ['COOKIE_SECURE'],
        message:
          'COOKIE_SECURE must be true in production (otherwise the session cookie is never sent over HTTPS).',
      });
    }
    if (c.DATABASE_URL === c.DATABASE_URL_MIGRATION) {
      ctx.addIssue({
        code: 'custom',
        path: ['DATABASE_URL_MIGRATION'],
        message:
          'DATABASE_URL and DATABASE_URL_MIGRATION must differ (separate dfa_app and dfa_migrator roles, see RLS).',
      });
    }
    // Finding M4 (audit sécurité) : `docker/postgres/init/01-roles.sql` fixe en dur les mots de
    // passe de dev (`dfa_app_dev`, `dfa_migrator_dev`), publiés dans le dépôt Git, et ce script
    // rejoue à chaque initialisation d'un volume Postgres vide — y compris sur le conteneur de
    // production, lors d'une montée de version majeure de Postgres. `pg_dump -d` ne sauvegarde
    // pas les rôles : une restauration ne corrige rien, et le chemin de moindre résistance à 2h
    // du matin est de remettre l'identifiant de dev dans `.env.production`. Uniquement en
    // production (dev/CI utilisent légitimement ces identifiants) : refus fail-fast plutôt que
    // de laisser la base de dizaines de garages tourner avec un mot de passe lisible sur GitHub.
    if (c.NODE_ENV === 'production') {
      const IDENTIFIANTS_DEV = ['dfa_app_dev', 'dfa_migrator_dev'];
      for (const [variable, url] of [
        ['DATABASE_URL', c.DATABASE_URL],
        ['DATABASE_URL_MIGRATION', c.DATABASE_URL_MIGRATION],
      ] as const) {
        if (IDENTIFIANTS_DEV.some((identifiant) => url.includes(identifiant))) {
          ctx.addIssue({
            code: 'custom',
            path: [variable],
            message:
              `${variable} uses a development password (dfa_app_dev/dfa_migrator_dev) in production — ` +
              'these values are published in the Git repository. Rotate the PostgreSQL passwords ' +
              'before restarting: see docs/reference/configuration.md.',
          });
        }
      }
    }
    // Bloquant B1 (rapport QA étape 0) : si le budget de débit par email n'est pas STRICTEMENT
    // supérieur au seuil de verrouillage, les échecs qui déclenchent le verrouillage épuisent
    // aussi le budget Redis, et la tentative suivante avec le bon mot de passe — celle qui doit
    // prouver le verrouillage et rendre 423 — se fait refuser par le limiteur avant même
    // d'atteindre la vérification du mot de passe, et rend 429 à la place. Fail-fast plutôt que
    // de laisser ce piège de configuration se reproduire silencieusement.
    if (c.LIMITE_CONNEXION_COMPTE <= c.SEUIL_VERROUILLAGE_COMPTE) {
      ctx.addIssue({
        code: 'custom',
        path: ['LIMITE_CONNEXION_COMPTE'],
        message:
          'LIMITE_CONNEXION_COMPTE must be strictly greater than SEUIL_VERROUILLAGE_COMPTE, otherwise the 423 AUTH_COMPTE_VERROUILLE response becomes unreachable (see blocker B1, stage 0 QA report).',
      });
    }
    // Un `min` supérieur à `max` n'a aucun sens pour le pool `pg` (`Pool.options.min`/`.max`) et
    // produirait un pool qui tente de maintenir plus de connexions chaudes qu'il n'a le droit
    // d'en ouvrir — fail-fast plutôt que de laisser `pg-pool` arbitrer silencieusement. Ne
    // s'applique qu'à une valeur EXPLICITE (`c.DATABASE_POOL_MIN !== undefined`) : le défaut
    // implicite est recalculé par le `.transform()` ci-dessous en fonction de DATABASE_POOL_MAX et
    // ne peut donc jamais violer cette contrainte — voir son commentaire pour le raisonnement.
    if (c.DATABASE_POOL_MIN !== undefined && c.DATABASE_POOL_MIN > c.DATABASE_POOL_MAX) {
      ctx.addIssue({
        code: 'custom',
        path: ['DATABASE_POOL_MIN'],
        message: 'DATABASE_POOL_MIN cannot exceed DATABASE_POOL_MAX.',
      });
    }
  })
  // Défaut de DATABASE_POOL_MIN calculé APRÈS coup, une fois DATABASE_POOL_MAX connu : `min(2,
  // DATABASE_POOL_MAX)`. Motivé par une régression réelle (commit fcc9d71) — `DATABASE_POOL_MIN`
  // portait un `.default(2)` fixe, incompatible avec les trois tests d'isolation tenant qui
  // réduisent DATABASE_POOL_MAX à 1 pour prouver que l'isolement tient même sur un pool à une
  // seule connexion physique (rls.spec.ts, isolation-parametrage/vehicules.spec.ts) :
  // `chargerConfig` refusait de démarrer avant même l'exécution du test. Clamper le défaut au
  // maximum protège symétriquement un déploiement réel qui réduirait DATABASE_POOL_MAX en
  // production sans penser à ajuster DATABASE_POOL_MIN en conséquence. Ceci ne masque aucune
  // vraie erreur de configuration : une valeur EXPLICITE de DATABASE_POOL_MIN qui dépasse
  // DATABASE_POOL_MAX continue à être rejetée par le superRefine ci-dessus — seul le défaut
  // IMPLICITE (l'opérateur n'a rien tapé) s'ajuste silencieusement, et seulement vers le bas
  // (jamais au-dessus de 2), donc jamais vers un comportement plus gourmand que ce que documente
  // le commentaire de DATABASE_POOL_MIN plus haut.
  .transform((c) => ({
    ...c,
    DATABASE_POOL_MIN: c.DATABASE_POOL_MIN ?? Math.min(2, c.DATABASE_POOL_MAX),
  }));

export type Config = Readonly<z.infer<typeof schemaConfig>>;

export interface ProblemeConfig {
  readonly variable: string;
  readonly message: string;
}

/**
 * Levée par `chargerConfig` quand une ou plusieurs variables d'environnement sont manquantes
 * ou invalides. `problemes` liste TOUJOURS l'intégralité des variables fautives — jamais
 * seulement la première — pour éviter à qui démarre l'app de corriger une variable à la fois.
 */
export class ErreurConfigInvalide extends Error {
  readonly problemes: ReadonlyArray<ProblemeConfig>;

  constructor(problemes: ReadonlyArray<ProblemeConfig>) {
    super(`Invalid configuration: ${problemes.length} invalid variable(s).`);
    this.name = 'ErreurConfigInvalide';
    this.problemes = problemes;
  }
}

/**
 * Valide `env` contre `schemaConfig` et renvoie la config typée, ou lève `ErreurConfigInvalide`
 * avec la liste complète des variables fautives. Doit être appelée dans `main.ts` AVANT
 * `NestFactory.create` : si la config est invalide, aucun port ne doit être ouvert.
 */
export function chargerConfig(env: NodeJS.ProcessEnv): Config {
  const resultat = schemaConfig.safeParse(env);
  if (!resultat.success) {
    const problemes: ProblemeConfig[] = resultat.error.issues.map((issue) => ({
      variable: issue.path.length > 0 ? issue.path.join('.') : '(config)',
      message: issue.message,
    }));
    throw new ErreurConfigInvalide(problemes);
  }
  return resultat.data;
}
