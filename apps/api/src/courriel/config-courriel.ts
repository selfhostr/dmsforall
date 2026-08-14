import { z } from 'zod';

/**
 * Configuration SMTP — capacité d'envoi de courriel, SOCLE SEUL (aucun branchement métier ici :
 * ni relances, ni envoi de facture, ni invitation d'utilisateur — voir `service-courriel.ts`).
 *
 * Expéditeur unique multi-tenant (arbitrage @laupernoe) : tous les courriels partent TECHNIQUEMENT de
 * `SMTP_EXPEDITEUR` (no-reply@dmsforall.example), quel que soit le garage — jamais de SMTP par
 * tenant. On n'usurpe JAMAIS le domaine du garage : sans son propre SPF/DKIM, le courriel
 * tomberait en spam. Le nom affiché et le `Reply-To` portent l'identité du garage — voir
 * `EnveloppeCourriel` dans `transport-courriel.interface.ts`.
 *
 * Capture par défaut, envoi réel verrouillé à DEUX clés indépendantes (défense en profondeur,
 * même esprit que LIMITE_CONNEXION_COMPTE/SEUIL_VERROUILLAGE_COMPTE dans charger-config.ts) :
 * `NODE_ENV` ET `COURRIEL_ENVOI_REEL` doivent valoir respectivement `'production'` et `true` —
 * voir `courrielDoitEnvoyerReellement` ci-dessous, SEUL point de décision entre les deux
 * transports (jamais un `if (process.env.NODE_ENV)` dispersé dans le code). Le drapeau seul, mis
 * par erreur en développement, reste sans effet ; `NODE_ENV=production` seul (sans le drapeau)
 * reste aussi sans effet — l'un des deux absent suffit à retomber sur la capture, jamais
 * l'envoi.
 *
 * Variables SMTP_* toutes OPTIONNELLES au niveau du schéma (même logique que `SENTRY_DSN`,
 * `charger-config.ts`) : leur absence ne doit JAMAIS empêcher l'API de démarrer en
 * développement, elle désactive simplement l'envoi réel. La présence effective des identifiants
 * n'est exigée qu'au moment de construire un transport réel — voir `resoudreConfigSmtp`,
 * appelée uniquement quand `courrielDoitEnvoyerReellement` est vrai (`courriel.module.ts`).
 *
 * Fusionnée dans `schemaConfig` par `apps/api/src/config/charger-config.ts` via
 * `...schemaConfigCourriel.shape` — même patron que `schemaConfigConsole`
 * (`exploitation/config-console.ts`) : une seule source de vérité sur le schéma, jamais une
 * redéclaration séparée qui pourrait diverger.
 */
/**
 * Repli défensif pour l'adresse d'expédition technique quand `SMTP_EXPEDITEUR` n'est pas
 * renseignée (dev sans `.env` complet). En production, `SMTP_EXPEDITEUR` porte toujours cette
 * même valeur (voir `.env.example`) — ce n'est jamais qu'une seconde affirmation indépendante de
 * l'invariant « l'expéditeur est toujours no-reply@dmsforall.example », jamais une valeur qui
 * divergerait de la config réelle en production.
 */
export const EXPEDITEUR_DFA_PAR_DEFAUT = 'no-reply@dmsforall.example';

export const schemaConfigCourriel = z.object({
  /** Hôte SMTP. Infomaniak : `smtp.example.org`. Absent ⇒ transport réel impossible à
   *  construire (voir `resoudreConfigSmtp`), sans effet tant que la capture est utilisée. */
  SMTP_HOTE: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(1).optional()),
  /** Port SMTP. 587 (STARTTLS) par défaut — celui utilisé par Infomaniak. */
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  // Piège maison (issue #43, déjà coûté du temps réel) : `z.coerce.boolean()` rend `"false"`
  // vrai — une chaîne non vide est toujours "truthy" pour `Boolean(...)`. Même patron que
  // `COOKIE_SECURE`/`OPENAPI_EXPOSER_DOCS` dans `charger-config.ts` : un enum à deux valeurs
  // LITTÉRALES, transformé APRÈS le `.default()` (zod 4 type le défaut sur la sortie de la
  // chaîne, pas sur l'entrée — un `.default(false)` posé avant `.transform` serait un booléen
  // là où le schéma attend encore la chaîne `'true' | 'false'`).
  SMTP_SECURISE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  SMTP_UTILISATEUR: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(1).optional()),
  SMTP_MOT_DE_PASSE: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(1).optional()),
  /** Adresse d'expédition technique — TOUJOURS `no-reply@dmsforall.example` en pratique, jamais une
   *  adresse de garage (voir tête de fichier). */
  SMTP_EXPEDITEUR: z.preprocess((v) => (v === '' ? undefined : v), z.string().email().optional()),
  /**
   * Drapeau d'activation EXPLICITE de l'envoi réel — même esprit que `DATABASE_URL_CONSOLE`
   * (`exploitation/config-console.ts`) : ne se coche pas par accident, ce n'est pas un confort
   * de développeur mais une contrainte de sécurité (le jeu de démo contient de vraies-fausses
   * adresses de clients qui ne doivent jamais être atteintes). Défaut `'false'` : comportement
   * par défaut = capture, jamais l'envoi. Ce drapeau SEUL ne suffit PAS à activer l'envoi réel —
   * voir `courrielDoitEnvoyerReellement`, qui exige AUSSI `NODE_ENV === 'production'`.
   */
  COURRIEL_ENVOI_REEL: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

/**
 * Forme MINIMALE de `Config` nécessaire à ce module — structurelle, volontairement PAS
 * `Pick<Config, …>` : même raison que `ConfigAvecConsole`
 * (`exploitation/config-console.ts`) — importer `Config` depuis `charger-config.ts` créerait un
 * cycle, puisque `charger-config.ts` importe CE fichier pour fusionner son schéma.
 */
export interface ConfigAvecCourriel {
  readonly NODE_ENV: 'development' | 'test' | 'production';
  readonly COURRIEL_ENVOI_REEL: boolean;
  readonly SMTP_HOTE?: string | undefined;
  readonly SMTP_PORT: number;
  readonly SMTP_SECURISE: boolean;
  readonly SMTP_UTILISATEUR?: string | undefined;
  readonly SMTP_MOT_DE_PASSE?: string | undefined;
  readonly SMTP_EXPEDITEUR?: string | undefined;
}

/**
 * SEUL point de décision entre transport réel (SMTP) et transport de capture — voir la tête de
 * fichier pour le raisonnement de défense en profondeur. Point d'appel unique :
 * `courriel.module.ts` (sélection du provider) — ne jamais reproduire ce test ailleurs.
 */
export function courrielDoitEnvoyerReellement(config: ConfigAvecCourriel): boolean {
  return config.NODE_ENV === 'production' && config.COURRIEL_ENVOI_REEL;
}

/** Identifiants SMTP résolus, garantis complets — voir `resoudreConfigSmtp`. */
export interface ConfigSmtpResolue {
  readonly hote: string;
  readonly port: number;
  readonly securise: boolean;
  readonly utilisateur: string;
  readonly motDePasse: string;
  readonly expediteur: string;
}

/**
 * Levée au démarrage quand l'envoi réel est demandé (`courrielDoitEnvoyerReellement` vrai) mais
 * que les identifiants SMTP sont incomplets. Fail-fast, jamais un démarrage silencieux qui
 * échouerait seulement au premier courriel envoyé — même esprit qu'`ErreurConfigConsoleInvalide`
 * (`exploitation/config-console.ts`).
 */
export class ErreurConfigCourrielInvalide extends Error {
  constructor(readonly problemes: readonly string[]) {
    super(
      `Configuration SMTP invalide pour l'envoi réel, l'API refuse de démarrer :\n` +
        problemes.map((p) => `  - ${p}`).join('\n'),
    );
    this.name = 'ErreurConfigCourrielInvalide';
  }
}

/**
 * Résout les identifiants SMTP pour construire un transport réel. À n'appeler QUE quand
 * `courrielDoitEnvoyerReellement(config)` est vrai (voir `courriel.module.ts`) — lève sinon les
 * identifiants sont incomplets, plutôt que de laisser `nodemailer` échouer plus tard avec une
 * erreur d'authentification incompréhensible.
 */
export function resoudreConfigSmtp(config: ConfigAvecCourriel): ConfigSmtpResolue {
  const problemes: string[] = [];
  if (!config.SMTP_HOTE) {
    problemes.push('SMTP_HOTE est requis pour activer l’envoi réel (COURRIEL_ENVOI_REEL=true).');
  }
  if (!config.SMTP_UTILISATEUR) {
    problemes.push(
      'SMTP_UTILISATEUR est requis pour activer l’envoi réel (COURRIEL_ENVOI_REEL=true).',
    );
  }
  if (!config.SMTP_MOT_DE_PASSE) {
    problemes.push(
      'SMTP_MOT_DE_PASSE est requis pour activer l’envoi réel (COURRIEL_ENVOI_REEL=true).',
    );
  }
  if (!config.SMTP_EXPEDITEUR) {
    problemes.push(
      'SMTP_EXPEDITEUR est requis pour activer l’envoi réel (COURRIEL_ENVOI_REEL=true).',
    );
  }
  if (problemes.length > 0) {
    throw new ErreurConfigCourrielInvalide(problemes);
  }
  return {
    hote: config.SMTP_HOTE as string,
    port: config.SMTP_PORT,
    securise: config.SMTP_SECURISE,
    utilisateur: config.SMTP_UTILISATEUR as string,
    motDePasse: config.SMTP_MOT_DE_PASSE as string,
    expediteur: config.SMTP_EXPEDITEUR as string,
  };
}
