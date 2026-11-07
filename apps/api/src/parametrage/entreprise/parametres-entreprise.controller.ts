/**
 * `GET|PATCH /parametres-entreprise` — identité fiscale du garage (n° IDE/TVA).
 *
 * Droits : ceux du bloc créancier (`facturation.parametrage.creancier.lire`/`.modifier`, direction
 * et comptable, jamais admin, RF-115) — le n° TVA est imprimé sur les factures au même titre que
 * l'IBAN, et aucune action dédiée n'existe dans la matrice.
 */
import { Controller, Get, Patch } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  schemaModificationParametresEntreprise,
  type EntreeModificationParametresEntreprise,
} from '@dfa/shared';

import { ServiceContexteRequete } from '../../common/contexte';
import { CorpsZod } from '../../common/documentation';
import { ExigerDroit } from '../../common/droits';
import { ApiReponseProbleme } from '../../common/erreurs';
import { ReponseParametresEntrepriseDto } from '../dto/reponse-parametres-entreprise.dto';
import { ServiceParametresEntreprise } from './service-parametres-entreprise';

@ApiTags('Paramétrage')
@ApiCookieAuth()
@Controller('parametres-entreprise')
export class ParametresEntrepriseController {
  constructor(
    private readonly service: ServiceParametresEntreprise,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @ExigerDroit('facturation.parametrage.creancier.lire')
  @Get()
  @ApiOperation({
    summary: 'Identité fiscale du garage (raison sociale, n° TVA).',
    description:
      "Le garage est celui de la session. `numeroTva` vaut `null` tant qu'il n'est pas saisi.",
  })
  @ApiOkResponse({ type: ReponseParametresEntrepriseDto })
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'DROIT_INSUFFISANT — réservé à direction/comptable.')
  async obtenir(): Promise<ReponseParametresEntrepriseDto> {
    return this.service.obtenir(this.contexte.contexteTenant());
  }

  @ExigerDroit('facturation.parametrage.creancier.modifier')
  @Patch()
  @ApiOperation({
    summary: 'Saisit ou efface le n° TVA du garage.',
    description:
      'Format IDE suisse `CHE-123.456.789 TVA` (`MWST`/`IVA` acceptés), clé de contrôle modulo 11 ' +
      'vérifiée. `numeroTva: null` efface le numéro (garage non assujetti). Corps vide : aucun effet.',
  })
  @ApiOkResponse({ type: ReponseParametresEntrepriseDto })
  @ApiReponseProbleme(400, 'VALIDATION_ECHOUEE — format ou clé de contrôle du n° TVA invalide.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'DROIT_INSUFFISANT — réservé à direction/comptable.')
  async modifier(
    @CorpsZod(schemaModificationParametresEntreprise, {
      exemple: { numeroTva: 'CHE-116.281.710 TVA' },
    })
    corps: EntreeModificationParametresEntreprise,
  ): Promise<ReponseParametresEntrepriseDto> {
    return this.service.modifier(this.contexte.contexteTenant(), corps);
  }
}
