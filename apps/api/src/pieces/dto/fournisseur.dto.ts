import { ApiProperty } from '@nestjs/swagger';
import {
  STATUTS_FOURNISSEUR,
  type PageCurseur,
  type ReponseAvecAvertissements,
  type ReponseFournisseur,
} from '@dfa/shared';

import { AvertissementDto } from './avertissement.dto';

export class FournisseurDto implements ReponseFournisseur {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty()
  readonly nom!: string;

  @ApiProperty({ type: String, nullable: true })
  readonly email!: string | null;

  @ApiProperty({ type: String, nullable: true })
  readonly telephone!: string | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Délai habituel de livraison, en jours (RP-26) — indicatif.',
  })
  readonly delaiHabituelJours!: number | null;

  @ApiProperty({ enum: STATUTS_FOURNISSEUR })
  readonly statut!: ReponseFournisseur['statut'];

  @ApiProperty({ format: 'date-time' })
  readonly creeLe!: string;

  @ApiProperty({ format: 'date-time' })
  readonly modifieLe!: string;
}

/**
 * `creer`/`modifier`/`desactiver`/`reactiver` ne déclarent aucun type de réponse explicite côté
 * contrat (`fournisseur.ts`) — même convention que le reste du domaine (voir `service-article.ts`,
 * en-tête) : la fiche rafraîchie, enveloppée d'avertissements.
 */
export class FournisseurAvecAvertissementsDto implements ReponseAvecAvertissements<FournisseurDto> {
  @ApiProperty({ type: () => FournisseurDto })
  readonly donnees!: FournisseurDto;

  @ApiProperty({ type: () => [AvertissementDto] })
  readonly avertissements!: readonly AvertissementDto[];
}

export class PageFournisseurDto implements PageCurseur<FournisseurDto> {
  @ApiProperty({ type: () => [FournisseurDto] })
  readonly donnees!: readonly FournisseurDto[];

  @ApiProperty({ type: String, nullable: true })
  readonly curseurSuivant!: string | null;

  @ApiProperty({ example: 50 })
  readonly limite!: number;
}
