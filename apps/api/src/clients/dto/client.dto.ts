import { ApiProperty } from '@nestjs/swagger';
import type { ClientResume, PageCurseur, ReponseAvecAvertissements, ReponseClient } from '@dfa/shared';

import { AvertissementDto } from './avertissement.dto';

export class ClientDto implements ReponseClient {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ example: 'CL-000123', description: 'Numéro continu par tenant, jamais réutilisé (RM-11).' })
  readonly numeroClient!: string;

  @ApiProperty({ enum: ['particulier', 'entreprise'], description: 'Immuable après création (RM-01).' })
  readonly type!: ReponseClient['type'];

  @ApiProperty({ enum: ['actif', 'inactif', 'bloque'] })
  readonly statut!: ReponseClient['statut'];

  @ApiProperty({ type: String, nullable: true })
  readonly civilite!: string | null;

  @ApiProperty({ type: String, nullable: true })
  readonly nom!: string | null;

  @ApiProperty({ type: String, nullable: true })
  readonly prenom!: string | null;

  @ApiProperty({ type: String, nullable: true })
  readonly raisonSociale!: string | null;

  @ApiProperty({ description: 'Rendu d’affichage calculé par le serveur (raisonSociale, ou nom prenom).' })
  readonly nomAffiche!: string;

  @ApiProperty({ type: String, nullable: true, example: 'CHE-123.456.789' })
  readonly ide!: string | null;

  @ApiProperty({ enum: ['fr', 'de', 'it'] })
  readonly langueCorrespondance!: ReponseClient['langueCorrespondance'];

  @ApiProperty({ type: String, nullable: true })
  readonly email!: string | null;

  @ApiProperty({ type: String, nullable: true })
  readonly telephone!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '+41791234567' })
  readonly telephoneE164!: string | null;

  @ApiProperty({ description: 'RM-14 : impose `numeroCommandeInterne` sur les OR de ce client.' })
  readonly poObligatoire!: boolean;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  readonly groupeId!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: 'Renseigné sur la fiche ABSORBÉE (RM-06, lot 2).' })
  readonly fusionneVersClientId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  readonly referenceExterne!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'Dérivé du dernier OR ouvert pour ce client.' })
  readonly dernierPassageLe!: string | null;

  @ApiProperty({ format: 'date-time' })
  readonly creeLe!: string;

  @ApiProperty({ format: 'date-time' })
  readonly modifieLe!: string;
}

export class ClientResumeDto implements ClientResume {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ example: 'CL-000123' })
  readonly numeroClient!: string;

  @ApiProperty()
  readonly nomAffiche!: string;

  @ApiProperty({ enum: ['particulier', 'entreprise'] })
  readonly type!: ClientResume['type'];

  @ApiProperty({ enum: ['actif', 'inactif', 'bloque'] })
  readonly statut!: ClientResume['statut'];

  @ApiProperty({ enum: ['fr', 'de', 'it'] })
  readonly langueCorrespondance!: ClientResume['langueCorrespondance'];

  @ApiProperty()
  readonly poObligatoire!: boolean;
}

export class PageClientResumeDto implements PageCurseur<ClientResumeDto> {
  @ApiProperty({ type: () => [ClientResumeDto] })
  readonly donnees!: readonly ClientResumeDto[];

  @ApiProperty({ type: String, nullable: true, description: 'Opaque base64url ; null = fin de liste.' })
  readonly curseurSuivant!: string | null;

  @ApiProperty({ example: 50 })
  readonly limite!: number;
}

export class ClientAvecAvertissementsDto implements ReponseAvecAvertissements<ClientDto> {
  @ApiProperty({ type: () => ClientDto })
  readonly donnees!: ClientDto;

  @ApiProperty({ type: () => [AvertissementDto] })
  readonly avertissements!: readonly AvertissementDto[];
}
