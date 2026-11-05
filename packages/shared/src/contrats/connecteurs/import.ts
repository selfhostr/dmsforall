import { z } from 'zod';

import { NATURES_IMPORT_CONNECTEUR } from './enums';
import { schemaEmpreinteSha256 } from './primitives';
import type { ReponseExecutionConnecteur } from './execution';

/**
 * Mécanisme GÉNÉRIQUE d'import — priorité 2 du brief, une des « deux formes du même mécanisme »
 * avec `export.ts`.
 *
 * CE QUE CE FICHIER NE FAIT PAS : interpréter le contenu du fichier importé. `POST
 * /connecteurs/activations/{id}/imports` se contente d'ENREGISTRER une exécution et de la mettre
 * en file (`RC-02` : jamais un traitement bloquant dans la requête HTTP) ; le worker qui lit
 * effectivement le fichier et produit `ResumeExecutionConnecteur` est spécifique à `nature` et vit
 * dans `apps/api`, hors du contrat partagé — exactement comme `AccountingExporter` (`contrats/
 * facturation/export.ts`) ne porte que la FORME des écritures, jamais leur sérialisation.
 *
 * TRANSPORT DU FICHIER NON MODÉLISÉ ICI : ce contrat suppose le fichier déjà accessible côté
 * serveur (déposé par un canal à définir — upload direct, dépôt sur un stockage objet…) au moment
 * de l'appel. Aucun mécanisme d'upload générique n'existe encore dans ce dépôt à la date
 * d'écriture — voir le rapport d'accompagnement, à trancher avec l'équipe backend/l'équipe infrastructure avant
 * implémentation.
 */

/**
 * `POST /connecteurs/activations/{id}/imports` — `Idempotency-Key` OBLIGATOIRE (création sensible
 * d'une exécution, `RC-06`). `empreinteFichier` porte une SECONDE couche d'idempotence, au niveau
 * du FICHIER plutôt que de la requête (`RC-64`) : un fichier déjà importé avec succès pour cette
 * activation, réimporté sous une NOUVELLE `Idempotency-Key` (cas réel : le comptable retélécharge
 * et redépose le même relevé, `CC-06`), ne relance jamais le traitement — voir
 * `ReponseLancerImportConnecteur.dejaImporte`.
 */
export const schemaLancerImportConnecteur = z
  .object({
    nature: z.enum(NATURES_IMPORT_CONNECTEUR),
    empreinteFichier: schemaEmpreinteSha256,
    tailleOctets: z.number().int().min(1).max(2_000_000_000).optional(),
    /** Facultatif, pour le journal — jamais utilisé pour décider quoi que ce soit côté serveur. */
    nomFichierOriginal: z.string().trim().max(255).optional(),
  })
  .strict();
export type EntreeLancerImportConnecteur = z.infer<typeof schemaLancerImportConnecteur>;

export interface ReponseLancerImportConnecteur {
  readonly execution: ReponseExecutionConnecteur;
  /**
   * `true` si `empreinteFichier` correspond à un import DÉJÀ traité avec succès pour cette
   * activation (`RC-64`, `CC-06`) : `execution` est alors celle d'ORIGINE, aucune nouvelle mise en
   * file n'a eu lieu. Volontairement un SUCCÈS (pas un `409`) — `CC-06` : « chaque transaction déjà
   * connue est ignorée sans créer de doublon », jamais une erreur à traiter par le comptable qui
   * n'a fait qu'un geste normal (redéposer un fichier par précaution).
   */
  readonly dejaImporte: boolean;
}
