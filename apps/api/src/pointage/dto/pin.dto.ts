import { ApiProperty } from '@nestjs/swagger';
import type { ReponseIdentificationPin } from '@dfa/shared';

import type { ReponsePinPointage } from '../pin-contrats';

/**
 * DTO Swagger de `ReponseIdentificationPin` (contrat gelé `@dfa/shared`,
 * `pointage/identification.ts`) — réponse de `POST /pointages/identification`. VOLONTAIREMENT
 * MINIMALE : de quoi afficher « Bonjour Marco » et attacher `technicienId` aux appels suivants,
 * rien de plus. Pas de droits, pas de rôle, pas de liste d'OR — ce n'est pas un login.
 */
export class ReponseIdentificationPinDto implements ReponseIdentificationPin {
  @ApiProperty({ format: 'uuid', description: 'Identifiant du technicien reconnu.' })
  readonly technicienId!: string;

  @ApiProperty({ description: 'Prénom, pour un accueil nominatif à l’écran.' })
  readonly prenom!: string;

  @ApiProperty({ description: 'Nom, pour un accueil nominatif à l’écran.' })
  readonly nom!: string;

  @ApiProperty({
    format: 'uuid',
    description:
      'Site de la borne (résolu depuis `pin_pointage.site_id`, jamais depuis un paramètre de ' +
      'requête) — ajout rétrocompatible : permet à l’écran borne de ne plus jamais demander le ' +
      'site autrement que par cette identification.',
  })
  readonly siteId!: string;
}

/**
 * DTO Swagger de la réponse des routes de GESTION des PIN (`PUT /pointages/pins`,
 * `POST /pointages/pins/revocation`) : l'état du rattachement après l'opération, JAMAIS le PIN.
 */
export class ReponsePinPointageDto implements ReponsePinPointage {
  @ApiProperty({ format: 'uuid' })
  readonly siteId!: string;

  @ApiProperty({ format: 'uuid' })
  readonly utilisateurId!: string;

  @ApiProperty({ description: 'true après attribution/réinitialisation, false après révocation.' })
  readonly actif!: boolean;
}
