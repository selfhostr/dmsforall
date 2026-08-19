import { z } from 'zod';

/**
 * Configuration du scan OCR de permis de circulation (`POST /vehicules/ocr/permis-circulation`).
 * Fusionnée dans `schemaConfig` par `apps/api/src/config/charger-config.ts` via
 * `...schemaConfigOcrPermis.shape` — même patron que `schemaConfigJobReferentielVehiculesCh`
 * (`vehicules/referentiel/config-job-referentiel-vehicules-ch.ts`) : une seule source de vérité
 * sur le schéma, jamais une redéclaration séparée qui pourrait diverger.
 */
export const schemaConfigOcrPermis = z.object({
  /**
   * URL interne du service OCR conteneurisé (voir `moteur-ocr-conteneur/`) — réseau Docker
   * interne, jamais exposé publiquement (aucun `ExigerDroit`/auth côté conteneur : le tri MIME/
   * taille/droit/tenant a déjà eu lieu côté API principale avant l'appel).
   */
  OCR_SERVICE_URL: z.string().url().default('http://ocr-permis:8090'),
  /** Un scan mobilise le processeur du conteneur ; au-delà, mieux vaut échouer proprement
   *  (`moteur_indisponible`) que de laisser un réceptionniste attendre indéfiniment au comptoir. */
  OCR_SERVICE_TIMEOUT_MS: z.coerce.number().int().min(1000).default(20_000),
  // --- Limitation de débit sur le scan (un scan mobilise le processeur du conteneur OCR) ---
  // PAR UTILISATEUR, même doctrine que LIMITE_RECHERCHE_UTILISATEUR (garde-limitation-recherche.ts) :
  // plusieurs réceptionnistes d'un même garage scannent souvent derrière la même IP publique (NAT
  // du site), une limite par IP les pénaliserait tous pour l'usage normal de l'un d'eux.
  // Dimensionnement : 15 scans / 5 min — largement au-dessus d'un usage comptoir normal (quelques
  // permis par heure de pointe), assez bas pour qu'un poste compromis ou un bug de rejeu client ne
  // sature pas indéfiniment le petit pool de workers du conteneur (2 par défaut, voir
  // `moteur-ocr-conteneur/moteur-tesseract.mjs`).
  LIMITE_OCR_PERMIS_UTILISATEUR: z.coerce.number().int().min(1).default(15),
  LIMITE_OCR_PERMIS_FENETRE_SECONDES: z.coerce.number().int().min(1).default(300),
});

export type ConfigOcrPermis = z.infer<typeof schemaConfigOcrPermis>;
