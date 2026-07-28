import { ApiProperty } from '@nestjs/swagger';
import type { ReponseVehiculePlaque } from '@dfa/shared';

export class ReponseVehiculePlaqueDto implements ReponseVehiculePlaque {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ example: 'VD 123456' })
  readonly valeur!: string;

  @ApiProperty({ type: String, nullable: true, example: 'VD' })
  readonly canton!: string | null;

  @ApiProperty({ example: 'CH' })
  readonly pays!: string;

  @ApiProperty({ format: 'date' })
  readonly debutLe!: string;

  @ApiProperty({ type: String, nullable: true, format: 'date' })
  readonly finLe!: string | null;

  @ApiProperty()
  readonly interchangeable!: boolean;

  @ApiProperty()
  readonly professionnelle!: boolean;
}
