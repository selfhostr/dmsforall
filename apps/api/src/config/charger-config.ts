import { z } from 'zod';

/**
 * Jeton d'injection de la configuration validée. Toute la config transite par ce jeton —
 * aucun service ne relit `process.env` directement (seul ce fichier et `main.ts` le font).
 */
export const JETON_CONFIG = Symbol.for('DFA_CONFIG');

export const schemaConfig = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    API_URL_PUBLIQUE: z.string().url(),
    WEB_URL_PUBLIQUE: z.string().url(),
    // rôle dfa_app — seul rôle utilisé par l'API en exécution, soumis au RLS.
    DATABASE_URL: z.string().min(1).startsWith('postgres'),
    // rôle dfa_migrator — migrations uniquement, jamais utilisé par l'API en exécution.
    DATABASE_URL_MIGRATION: z.string().min(1).startsWith('postgres'),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
    DATABASE_TIMEOUT_REQUETE_MS: z.coerce.number().int().min(100).default(10_000),
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
    VERSION_APP: z.string().default('0.0.0-dev'),
    // --- Supervision (Sentry, auto-hébergé en Suisse — décision @laupernoe, cohérence nLPD) --------
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
  })
  .superRefine((c, ctx) => {
    if (c.NODE_ENV === 'production' && !c.COOKIE_SECURE) {
      ctx.addIssue({
        code: 'custom',
        path: ['COOKIE_SECURE'],
        message:
          'COOKIE_SECURE doit être true en production (sinon le cookie de session ne part jamais en HTTPS).',
      });
    }
    if (c.DATABASE_URL === c.DATABASE_URL_MIGRATION) {
      ctx.addIssue({
        code: 'custom',
        path: ['DATABASE_URL_MIGRATION'],
        message:
          'DATABASE_URL et DATABASE_URL_MIGRATION doivent être différentes (rôles dfa_app et dfa_migrator distincts, voir RLS).',
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
              `${variable} porte un mot de passe de développement (dfa_app_dev/dfa_migrator_dev) en production — ` +
              'ces valeurs sont publiées dans le dépôt Git. Rejouer la procédure de rotation des ' +
              'mots de passe PostgreSQL avant de redémarrer : docs/deploiement-production.md §3.2.',
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
          'LIMITE_CONNEXION_COMPTE doit être strictement supérieure à SEUIL_VERROUILLAGE_COMPTE, sinon le 423 AUTH_COMPTE_VERROUILLE devient inatteignable (voir bloquant B1, rapport QA étape 0).',
      });
    }
  });

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
    super(`Configuration invalide : ${problemes.length} variable(s) fautive(s).`);
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
