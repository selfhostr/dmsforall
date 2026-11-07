import { ApiProperty } from '@nestjs/swagger';
import { STATUTS_DOCUMENT_VENTE, type ReponseCreationOrdreDepuisDevis } from '@dfa/shared';

import { EnveloppeOrDto } from './enveloppe.dto';
import { ReponseOrdreReparationDto } from './ordre-reparation.dto';

/** `POST /documents-vente/{id}/creer-ordre-reparation` — contrat : `document-ordre-reparation.ts`. */
export class ReponseCreationOrdreDepuisDevisDto implements ReponseCreationOrdreDepuisDevis {
  @ApiProperty({
    type: () => ReponseOrdreReparationDto,
    description: "L'OR créé, document complet — même forme que `GET /ordres-reparation/{orId}`.",
  })
  readonly ordreReparation!: ReponseOrdreReparationDto;

  @ApiProperty({ format: 'uuid' })
  readonly devisId!: string;

  @ApiProperty({ enum: STATUTS_DOCUMENT_VENTE, example: 'accepte' })
  readonly devisStatut!: ReponseCreationOrdreDepuisDevis['devisStatut'];

  @ApiProperty({
    description: "Lignes du devis reprises en lignes d'OR (lignes de texte comprises).",
  })
  readonly nombreLignesReprises!: number;
}

export const EnveloppeCreationOrdreDepuisDevisDto = EnveloppeOrDto(
  ReponseCreationOrdreDepuisDevisDto,
  'CreationOrdreDepuisDevis',
);
