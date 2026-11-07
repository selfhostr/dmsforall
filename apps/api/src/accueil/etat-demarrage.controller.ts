import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ServiceContexteRequete } from '../common/contexte';
import { ExigerDroit, GardeDroit } from '../common/droits';
import { ApiReponseProbleme } from '../common/erreurs';

import { ReponseEtatDemarrageDto } from './etat-demarrage.dto';
import { ServiceEtatDemarrage } from './service-etat-demarrage';

@ApiTags('Accueil')
@ApiCookieAuth()
@Controller({ path: 'accueil', version: '1' })
@UseGuards(GardeDroit)
export class EtatDemarrageController {
  constructor(
    private readonly service: ServiceEtatDemarrage,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @Get('etat-demarrage')
  @ExigerDroit('accueil.demarrage.lire')
  @ApiOperation({
    summary:
      'Où en est la mise en route du garage (coordonnées, IBAN, TVA, taux, motifs, équipe, borne).',
    description:
      'Calculé côté serveur en une seule lecture. Chaque étape est un booléen définitif. Réservé à direction/admin.',
  })
  @ApiOkResponse({ type: ReponseEtatDemarrageDto })
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'DROIT_INSUFFISANT — réservé à direction/admin.')
  async etatDemarrage(): Promise<ReponseEtatDemarrageDto> {
    const principal = this.contexte.exigerPrincipal();
    return this.service.obtenir(this.contexte.contexteTenant(), principal.utilisateurId);
  }
}
