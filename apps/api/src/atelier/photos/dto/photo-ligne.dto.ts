import { ApiProperty } from '@nestjs/swagger';
import {
  TYPES_MIME_PHOTO_LIGNE,
  type ReponseListePhotosLigne,
  type ReponsePhotoLigne,
  type TypeMimePhotoLigne,
} from '@dfa/shared';

export class ReponsePhotoLigneDto implements ReponsePhotoLigne {
  @ApiProperty({ format: 'uuid' }) readonly id!: string;
  @ApiProperty({ format: 'uuid' }) readonly ordreReparationId!: string;
  @ApiProperty({ format: 'uuid' }) readonly ligneId!: string;
  @ApiProperty({ type: String, nullable: true }) readonly legende!: string | null;
  @ApiProperty({ enum: TYPES_MIME_PHOTO_LIGNE }) readonly typeMime!: TypeMimePhotoLigne;
  @ApiProperty() readonly tailleOctets!: number;
  @ApiProperty({ description: 'Sinon `/vignette` sert la photo entière.' })
  readonly vignetteDisponible!: boolean;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  readonly creeParId!: string | null;
  @ApiProperty({ format: 'date-time' }) readonly creeLe!: string;
  @ApiProperty({ description: 'Le demandeur peut supprimer cette photo.' })
  readonly supprimable!: boolean;
}

export class ReponseListePhotosLigneDto implements ReponseListePhotosLigne {
  @ApiProperty({ type: () => [ReponsePhotoLigneDto] })
  readonly donnees!: readonly ReponsePhotoLigne[];
}
