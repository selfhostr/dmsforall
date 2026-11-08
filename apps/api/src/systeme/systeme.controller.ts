import { Controller, Get } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import type { VersionSysteme } from '@dfa/shared';

import { AucunDroitRequis } from '../common/droits';
import { ApiReponseProbleme } from '../common/erreurs';
import { ServiceVersion } from './service-version';

export class VersionSystemeDto implements VersionSysteme {
  @ApiProperty({ example: '0.3.0' })
  readonly actuelle!: string;
  @ApiProperty({ type: String, nullable: true, example: '0.4.0' })
  readonly derniere!: string | null;
  @ApiProperty()
  readonly miseAJourDisponible!: boolean;
  @ApiProperty({ type: String, nullable: true })
  readonly urlNotes!: string | null;
}

@ApiTags('Système')
@ApiCookieAuth()
@Controller('systeme')
export class SystemeController {
  constructor(private readonly service: ServiceVersion) {}

  // Information publique (numéro de version et notes de version GitHub) : authentifié suffit.
  // L'écran n'affiche l'alerte qu'à la direction et à l'administration.
  @AucunDroitRequis()
  @Get('version')
  @ApiOperation({
    summary: 'Version installée et dernière version publiée.',
    description:
      "`derniere` vaut `null` si la vérification est désactivée (`VERIFIER_MISE_A_JOUR=false`) ou si GitHub ne répond pas. Résultat mis en cache 12 h côté serveur.",
  })
  @ApiOkResponse({ type: VersionSystemeDto })
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  obtenir(): Promise<VersionSysteme> {
    return this.service.obtenir();
  }
}
