import { ApiProperty } from '@nestjs/swagger';
import { LANGUES, type Langue, type TenantCourant } from '@dfa/shared';

export class TenantCourantDto implements TenantCourant {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ example: 'garage-du-leman' })
  readonly slug!: string;

  @ApiProperty({ example: 'Garage du Léman Sàrl' })
  readonly raisonSociale!: string;

  @ApiProperty({ enum: LANGUES })
  readonly langueDefaut!: Langue;
}
