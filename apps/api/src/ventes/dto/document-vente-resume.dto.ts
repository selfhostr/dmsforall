import { ApiProperty } from '@nestjs/swagger';
import {
  DEVISES_FACTURATION,
  NATURES_FACTURE,
  STATUTS_DOCUMENT_VENTE,
  STATUTS_REGLEMENT_DOCUMENT,
  TYPES_DOCUMENT_VENTE,
  type DocumentVenteResume,
} from '@dfa/shared';

/**
 * Projection LECTURE SEULE de `document_vente` (chaîne facturation, étape 2), embarquée dans
 * `ReponseDossierVente.documents` (`dossierVenteId`, MD-70). Copie module-locale du type de
 * contrat `DocumentVenteResume` (`contrats/facturation/document.ts`) — ce module ne possède ni
 * n'écrit jamais cette table.
 */
export class DocumentVenteResumeDto implements DocumentVenteResume {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ enum: TYPES_DOCUMENT_VENTE })
  readonly typeDocument!: DocumentVenteResume['typeDocument'];

  @ApiProperty({ enum: NATURES_FACTURE, nullable: true })
  readonly natureFacture!: DocumentVenteResume['natureFacture'];

  @ApiProperty({ type: String, nullable: true })
  readonly numero!: string | null;

  @ApiProperty({ enum: STATUTS_DOCUMENT_VENTE })
  readonly statut!: DocumentVenteResume['statut'];

  @ApiProperty({
    enum: STATUTS_REGLEMENT_DOCUMENT,
    required: false,
    nullable: true,
    description: 'Omis si le rôle appelant ne voit pas les montants (RF-116).',
  })
  readonly statutReglement?: DocumentVenteResume['statutReglement'];

  @ApiProperty({ format: 'uuid' })
  readonly clientId!: string;

  @ApiProperty()
  readonly clientDesignation!: string;

  @ApiProperty({ type: String, format: 'date' })
  readonly dateDocument!: string;

  @ApiProperty({ enum: DEVISES_FACTURATION })
  readonly devise!: DocumentVenteResume['devise'];

  @ApiProperty({
    required: false,
    description: 'Omis si le rôle appelant ne voit pas les montants (RF-116).',
  })
  readonly totalTtcCentimes?: number;

  @ApiProperty({
    required: false,
    description: 'Omis si le rôle appelant ne voit pas les montants (RF-116).',
  })
  readonly soldeCentimes?: number;
}
