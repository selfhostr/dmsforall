import { z } from 'zod';

/**
 * Schéma des variables `VITE_*` consommées par le front. Volontairement minimal à l'étape 0 :
 * une seule variable. Toute variable ajoutée plus tard DOIT passer par ce schéma — aucun autre
 * fichier du dépôt ne doit lire `import.meta.env` directement (même règle que côté API pour
 * `process.env`, voir contrats-etape-0.md §2.7).
 */
const schemaEnv = z.object({
  VITE_API_URL: z.string().trim().min(1, 'VITE_API_URL est obligatoire.'),
  // Optionnelle à dessein : Sentry est un outil de supervision, pas une dépendance de
  // fonctionnement. Son absence (dev local, garage sans configuration Sentry) ne doit jamais
  // empêcher l'application de démarrer — voir observabilite/sentry.ts.
  VITE_SENTRY_DSN: z.string().trim().min(1).optional(),
  // Page publique qui termine un signalement (« Signaler un problème »). Optionnelle : la valeur
  // par défaut est dans `diagnostic/rapport.ts`.
  VITE_URL_SIGNALEMENT: z.string().trim().url().optional(),
});

export type EnvWeb = Readonly<z.infer<typeof schemaEnv>>;

export interface ProblemeEnv {
  readonly variable: string;
  readonly message: string;
}

export class ErreurEnvInvalide extends Error {
  readonly problemes: readonly ProblemeEnv[];

  constructor(problemes: readonly ProblemeEnv[]) {
    super('Configuration frontend invalide : ' + problemes.map((p) => p.variable).join(', '));
    this.name = 'ErreurEnvInvalide';
    this.problemes = problemes;
  }
}

/** Valide `source` (par défaut `import.meta.env`) et lève `ErreurEnvInvalide` avec TOUTES les
 *  variables fautives, jamais uniquement la première. Pure : ne modifie aucun état module. */
export function chargerEnv(source: Readonly<Record<string, unknown>> = import.meta.env): EnvWeb {
  const resultat = schemaEnv.safeParse(source);
  if (!resultat.success) {
    const problemes = resultat.error.issues.map((probleme) => ({
      variable: probleme.path.join('.') || '(inconnue)',
      message: probleme.message,
    }));
    throw new ErreurEnvInvalide(problemes);
  }
  return resultat.data;
}

let envCourant: EnvWeb | null = null;

/** À appeler UNE SEULE FOIS, avant le montage de l'app (voir main.tsx). */
export function initialiserEnv(source?: Readonly<Record<string, unknown>>): EnvWeb {
  const env = chargerEnv(source);
  envCourant = env;
  return env;
}

/** Lue par la couche api/ une fois l'app montée. Ne doit jamais être appelée avant
 *  `initialiserEnv()` (qui garantit une config valide ou l'écran EcranConfigInvalide). */
export function obtenirEnv(): EnvWeb {
  if (!envCourant) {
    throw new Error('obtenirEnv() appelé avant initialiserEnv() — bug de bootstrap.');
  }
  return envCourant;
}

/** Réservé aux tests : permet d'injecter une config sans repasser par import.meta.env. */
export function definirEnvPourTests(env: EnvWeb): void {
  envCourant = env;
}
