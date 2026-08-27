/**
 * Réponse de `POST /documents-vente/{id}/envoyer-courriel` — DTO Nest-only (pas de contrat
 * `@dfa/shared` dédié : cette action n'a aucun consommateur front dans le périmètre de cette
 * tâche ; un futur écran « envoyer la facture » pourrait justifier de la faire migrer vers
 * `packages/shared/src/contrats/facturation/` le jour où le front en a besoin — voir le rapport de
 * livraison).
 */
import { ApiProperty } from '@nestjs/swagger';

export class ReponseEnvoiFactureCourrielDto {
  @ApiProperty({ example: true })
  readonly envoye!: boolean;

  @ApiProperty({
    example: 'client@example.ch',
    description: 'Adresse courriel réellement utilisée (celle de la fiche client).',
  })
  readonly destinataire!: string;

  @ApiProperty({
    example: 'capture-3f8e...',
    description: 'Identifiant de message rendu par le transport (SMTP réel ou capture).',
  })
  readonly idMessage!: string;
}
