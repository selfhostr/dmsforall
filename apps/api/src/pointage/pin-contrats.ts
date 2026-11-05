import { schemaIdentifiant, schemaIdentificationPin } from '@dfa/shared';
import { z } from 'zod';

/**
 * Schémas de validation des routes de GESTION des PIN (`atelier.pointage.gerer_pin`), LOCAUX au
 * module API — délibérément PAS dans `packages/shared/src/contrats/pointage/`.
 *
 * Raison : ce point de contact partagé est négocié entre développeurs/lots (voir CONTRIBUTING.md), et
 * le périmètre d'écriture de cette tâche s'arrête à `apps/api/src/pointage/**`. Le front n'en a pas
 * besoin en tant que type écrit à la main : ses types sont GÉNÉRÉS depuis l'OpenAPI (règle
 * projet), lequel est alimenté par les DTO Swagger de `dto/pin.dto.ts`. Le SEUL contrat partagé
 * réutilisé ici est `schemaIdentificationPin` (la borne, `POST /pointages/identification`, déjà
 * gelé dans `@dfa/shared`) — dont on reprend la sous-forme `codePin` pour ne pas redéclarer le
 * format « 4 chiffres » et rester aligné au caractère près.
 */

/** Le format du code PIN, repris tel quel du contrat gelé de la borne (`schemaCodePin`, 4 chiffres). */
const schemaCodePin = schemaIdentificationPin.shape.codePin;

/**
 * `PUT /pointages/pins` — attribuer OU réinitialiser le PIN d'un technicien sur un site (RM-128).
 *
 * `siteId` est ICI un paramètre de corps LÉGITIME, et ce n'est PAS une entorse à « le tenant/site
 * se résout depuis la session » : cette règle vise le TENANT (résolu depuis la session, toujours)
 * et la BORNE (dont le site vient de sa propre session). Le gestionnaire, lui, est une PERSONNE
 * (chef d'atelier/direction/admin) sans rattachement de site — il administre plusieurs sites de SON
 * tenant. Le site est donc une donnée métier de la requête, bornée au tenant par le RLS + le
 * rescoping explicite, et vérifiée cohérente avec la portée du principal par `verifierSiteAutorise`.
 */
export const schemaAttributionPin = z.object({
  siteId: schemaIdentifiant,
  utilisateurId: schemaIdentifiant,
  codePin: schemaCodePin,
});
export type EntreeAttributionPin = z.infer<typeof schemaAttributionPin>;

/** `POST /pointages/pins/revocation` — retirer un technicien de la borne d'un site (`actif=false`). */
export const schemaRevocationPin = z.object({
  siteId: schemaIdentifiant,
  utilisateurId: schemaIdentifiant,
});
export type EntreeRevocationPin = z.infer<typeof schemaRevocationPin>;

/**
 * Réponse des routes de gestion : l'état du rattachement APRÈS l'opération, JAMAIS le PIN (ni clair
 * ni haché). De quoi confirmer à l'écran d'administration « c'est bien fait », rien de plus.
 */
export interface ReponsePinPointage {
  readonly siteId: string;
  readonly utilisateurId: string;
  readonly actif: boolean;
}
