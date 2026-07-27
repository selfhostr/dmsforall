import { ApiProperty } from '@nestjs/swagger';

export class SanteDto {
  @ApiProperty({ enum: ['ok'] })
  readonly statut!: 'ok';

  @ApiProperty({ example: '0.1.0-dev' })
  readonly version!: string;
}

export class SantePreteDto {
  @ApiProperty({ enum: ['ok'] })
  readonly base!: 'ok';

  @ApiProperty({ enum: ['ok'] })
  readonly redis!: 'ok';
}
