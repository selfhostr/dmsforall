/**
 * Contrats de l'installation d'une instance neuve (`GET /installation/etat`,
 * `POST /installation/premier-garage`).
 *
 * Les deux routes sont publiques (aucune session n'existe encore) : la seconde est protégée par un
 * code d'installation à usage unique, affiché dans les journaux de l'API au démarrage.
 */
import { z } from 'zod';

import { schemaMotDePasseNouveau } from './auth';

/** Forme saisie du code : `XXXX-XXXX-XXXX` (tirets et casse tolérés, normalisés côté serveur). */
export const LONGUEUR_CODE_INSTALLATION_MAX = 32;

/** `GET /installation/etat` — rien d'autre que ce booléen n'est révélé à un anonyme. */
export interface EtatInstallation {
  /** `true` tant que la base ne contient aucun garage : l'écran « Créer votre garage » s'impose. */
  readonly premierGarageRequis: boolean;
}

export const schemaPremierGarage = z
  .object({
    codeInstallation: z.string().trim().min(1).max(LONGUEUR_CODE_INSTALLATION_MAX),
    garage: z.string().trim().min(2).max(200),
    prenom: z.string().trim().min(1).max(100),
    nom: z.string().trim().min(1).max(100),
    email: z.string().trim().toLowerCase().email().max(320),
    motDePasse: schemaMotDePasseNouveau,
  })
  .strict();
export type EntreePremierGarage = z.infer<typeof schemaPremierGarage>;
