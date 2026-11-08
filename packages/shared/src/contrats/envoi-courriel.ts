import { z } from 'zod';

/**
 * Réglage d'envoi des e-mails d'un garage (`GET|PATCH|DELETE /parametres-entreprise/envoi-courriel`,
 * `POST /parametres-entreprise/envoi-courriel/test`).
 *
 * Priorité de résolution à l'envoi : réglage du garage > variables `SMTP_*` de l'instance > aucun
 * envoi (état « non configuré », jamais un succès silencieux). Le mot de passe est chiffré au repos
 * et n'est JAMAIS renvoyé : la réponse n'expose que `motDePasseDefini`.
 */

/** Valeurs de l'enum Postgres `securite_smtp` (migration 0098). */
export const SECURITES_SMTP = ['tls_implicite', 'starttls', 'aucune'] as const;
export type SecuriteSmtp = (typeof SECURITES_SMTP)[number];

/** D'où viennent les e-mails sortants du garage. */
export const SOURCES_ENVOI_COURRIEL = ['garage', 'instance', 'aucune'] as const;
export type SourceEnvoiCourriel = (typeof SOURCES_ENVOI_COURRIEL)[number];

/** Cause d'un test d'envoi échoué (le garagiste voit un message précis, jamais la trace SMTP). */
export const CAUSES_ECHEC_ENVOI_COURRIEL = [
  'authentification',
  'connexion',
  'tls',
  'refuse',
  'hote_interdit',
  'inconnue',
] as const;
export type CauseEchecEnvoiCourriel = (typeof CAUSES_ECHEC_ENVOI_COURRIEL)[number];

/** Préréglages courants : remplissent hôte, port et sécurité (le reste est propre au compte). */
export const PREREGLAGES_ENVOI_COURRIEL = {
  infomaniak: { hote: 'mail.infomaniak.com', port: 587, securite: 'starttls' },
  google: { hote: 'smtp.gmail.com', port: 587, securite: 'starttls' },
  microsoft365: { hote: 'smtp.office365.com', port: 587, securite: 'starttls' },
} as const satisfies Readonly<
  Record<string, { readonly hote: string; readonly port: number; readonly securite: SecuriteSmtp }>
>;
export type PreregladeEnvoiCourriel = keyof typeof PREREGLAGES_ENVOI_COURRIEL;

const SANS_SAUT_DE_LIGNE = /^[^\r\n]*$/;

const schemaAdresse = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(320)
  .email()
  .regex(SANS_SAUT_DE_LIGNE);

/** `true` pour un nom d'hôte, une adresse IPv4 ou une adresse IPv6 : ni espace, ni schéma, ni port
 *  (le port est un champ à part — `smtp.exemple.ch:25` est refusé). */
export function hoteSmtpValide(hote: string): boolean {
  if (/^[A-Za-z0-9._-]+$/.test(hote)) return true;
  return /^[0-9A-Fa-f:.]+$/.test(hote) && (hote.match(/:/g) ?? []).length >= 2;
}

const schemaHote = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .refine(hoteSmtpValide, 'Nom de serveur invalide (ni espace, ni http://, ni port).');

export const schemaModificationEnvoiCourriel = z.object({
  hote: schemaHote.optional(),
  port: z.number().int().min(1).max(65535).optional(),
  securite: z.enum(SECURITES_SMTP).optional(),
  /** `null` : serveur sans authentification (le mot de passe est alors effacé). */
  utilisateur: z.string().trim().min(1).max(320).regex(SANS_SAUT_DE_LIGNE).nullable().optional(),
  /** Absent : mot de passe inchangé. `null` : effacé. Texte : remplace (chiffré au repos). */
  motDePasse: z.string().min(1).max(512).nullable().optional(),
  adresseExpediteur: schemaAdresse.optional(),
  nomAffiche: z.string().trim().min(1).max(100).regex(SANS_SAUT_DE_LIGNE).nullable().optional(),
  adresseReponse: schemaAdresse.nullable().optional(),
});
export type EntreeModificationEnvoiCourriel = z.infer<typeof schemaModificationEnvoiCourriel>;

export const schemaTestEnvoiCourriel = z.object({
  destinataire: schemaAdresse,
});
export type EntreeTestEnvoiCourriel = z.infer<typeof schemaTestEnvoiCourriel>;

export interface DernierTestEnvoiCourriel {
  /** Horodatage UTC (ISO 8601). */
  readonly le: string;
  readonly succes: boolean;
  /** `null` si le test a réussi. */
  readonly cause: CauseEchecEnvoiCourriel | null;
}

export interface ReglageEnvoiCourriel {
  readonly hote: string;
  readonly port: number;
  readonly securite: SecuriteSmtp;
  readonly utilisateur: string | null;
  /** Le mot de passe lui-même n'est jamais renvoyé. */
  readonly motDePasseDefini: boolean;
  readonly adresseExpediteur: string;
  readonly nomAffiche: string | null;
  readonly adresseReponse: string | null;
  /** `null` : aucun test depuis la dernière modification. */
  readonly dernierTest: DernierTestEnvoiCourriel | null;
}

export interface ReponseEnvoiCourriel {
  /** Réglage propre au garage ; `null` s'il n'en a pas saisi. */
  readonly reglage: ReglageEnvoiCourriel | null;
  /** Ce qui sera réellement utilisé pour envoyer. */
  readonly source: SourceEnvoiCourriel;
  /** `false` : aucun envoi possible (ni réglage du garage ni serveur d'instance). */
  readonly configure: boolean;
  /** `true` : l'environnement ne remet pas les e-mails (capture : développement ou démonstration). */
  readonly modeCapture: boolean;
  /** `true` : l'instance fournit un serveur d'envoi de repli. */
  readonly instanceDisponible: boolean;
  /** `true` : un mot de passe peut être enregistré (clé de chiffrement de l'instance présente). */
  readonly chiffrementDisponible: boolean;
}

export interface ReponseTestEnvoiCourriel {
  readonly envoyeLe: string;
}
