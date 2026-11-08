import { ApiProperty } from '@nestjs/swagger';
import { MODULES_APP, type ModuleApp, type ReponseModules } from '@dfa/shared';

/** DTO Swagger de `GET|PATCH /parametres-entreprise/modules`. */
export class ReponseModulesDto implements ReponseModules {
  @ApiProperty({
    enum: MODULES_APP,
    isArray: true,
    example: ['pneus'],
    description:
      'Modules retirés par le garage (son choix). Un module dont une dépendance est retirée est inactif sans figurer ici.',
  })
  readonly modulesDesactives!: readonly ModuleApp[];

  @ApiProperty({
    enum: MODULES_APP,
    isArray: true,
    description:
      'Modules effectivement actifs (choix du garage et dépendances). Les écritures des autres répondent `403 MODULE_DESACTIVE`.',
  })
  readonly modulesActifs!: readonly ModuleApp[];
}
