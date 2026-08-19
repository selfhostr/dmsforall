import { z } from 'zod';

/**
 * Configuration de l'OCR de repli (étape 3, DERNIER recours de la chaîne).
 *
 * ⚠️ HORS DU SOCLE DE CONFIGURATION CENTRAL (écart signalé, pas une omission) : le contrat gelé
 * place `chargerConfig()`/`JETON_CONFIG` dans `apps/api/src/config/` (§2.7), HORS du périmètre
 * d'écriture de ce lot (`apps/api/src/pieces/factures-fournisseur/` uniquement). CONTRIBUTING.md exige
 * des « env validées zod au démarrage, refus si invalide » — cette variable-ci n'a PAS ce
 * traitement : elle est lue paresseusement (première utilisation, `ServiceOcrTexteFacture`), et
 * une valeur malformée dégrade en « OCR non configuré » plutôt que de refuser le démarrage de
 * toute l'API pour un module dont l'OCR est explicitement le DERNIER recours. À CORRIGER par
 * l'agent qui possède `config/charger-config.ts` : fusionner `schemaConfigOcrTexteFacture` dans
 * `schemaConfig` (même patron que `schemaConfigOcrPermis`, `vehicules/ocr/config-ocr.ts`), puis
 * remplacer `lireConfigOcrTexteFacture()` par une injection de `JETON_CONFIG` ici.
 *
 * `FACTURES_FOURNISSEUR_OCR_SERVICE_URL` ABSENTE en pratique aujourd'hui : AUCUN service ne
 * l'implémente encore (voir le rapport de livraison — le conteneur `vehicules/ocr/` expose
 * UNIQUEMENT `/scan-permis`, spécialisé au permis de circulation, hors périmètre d'écriture de ce
 * lot). `PortOcrTexteFacture` (`port-ocr-texte.ts`) est le CONTRAT que ce futur service devra
 * satisfaire — précisément spécifié pour qu'un autre lot puisse le provisionner sans deviner.
 */
export const schemaConfigOcrTexteFacture = z.object({
  FACTURES_FOURNISSEUR_OCR_SERVICE_URL: z.string().url().optional(),
  FACTURES_FOURNISSEUR_OCR_TIMEOUT_MS: z.coerce.number().int().min(1000).default(20_000),
});
export type ConfigOcrTexteFacture = z.infer<typeof schemaConfigOcrTexteFacture>;

let configEnCache: ConfigOcrTexteFacture | null = null;

/**
 * `undefined` sur `FACTURES_FOURNISSEUR_OCR_SERVICE_URL` — configurée ou non, malformée ou non —
 * signifie TOUJOURS « OCR indisponible » : jamais une exception qui ferait échouer tout le dépôt
 * d'une facture pour l'étape la moins essentielle de la chaîne (§ « ne te jette pas sur l'OCR »
 * de la tâche).
 */
export function lireConfigOcrTexteFacture(): ConfigOcrTexteFacture {
  if (configEnCache) return configEnCache;
  const resultat = schemaConfigOcrTexteFacture.safeParse({
    FACTURES_FOURNISSEUR_OCR_SERVICE_URL: process.env.FACTURES_FOURNISSEUR_OCR_SERVICE_URL,
    FACTURES_FOURNISSEUR_OCR_TIMEOUT_MS: process.env.FACTURES_FOURNISSEUR_OCR_TIMEOUT_MS,
  });
  configEnCache = resultat.success
    ? resultat.data
    : {
        FACTURES_FOURNISSEUR_OCR_SERVICE_URL: undefined,
        FACTURES_FOURNISSEUR_OCR_TIMEOUT_MS: 20_000,
      };
  return configEnCache;
}

/** Réservé aux tests — vide le cache pour rejouer `lireConfigOcrTexteFacture()` après modification
 *  de `process.env`. */
export function reinitialiserConfigOcrTexteFacturePourTests(): void {
  configEnCache = null;
}
