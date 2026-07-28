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
  })
  .superRefine((c, ctx) => {
    if (c.NODE_ENV === 'production' && !c.COOKIE_SECURE) {
      ctx.addIssue({
        code: 'custom',
        path: ['COOKIE_SECURE'],
        message: 'COOKIE_SECURE doit être true en production (sinon le cookie de session ne part jamais en HTTPS).',
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
