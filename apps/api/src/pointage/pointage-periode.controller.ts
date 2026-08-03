import { Controller, Post, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  schemaDeverrouillagePeriodePointage,
  schemaVerrouillagePeriodePointage,
  type EntreeDeverrouillagePeriodePointage,
  type EntreeVerrouillagePeriodePointage,
} from '@dfa/shared';

import { ServiceContexteRequete } from '../common/contexte';
import { CorpsZod } from '../common/documentation';
import { ExigerDroit, GardeDroit } from '../common/droits';
import { ApiReponseProbleme } from '../common/erreurs';

import { ReponseDeverrouillagePeriodePointageDto, ReponseVerrouillagePeriodePointageDto } from './dto';
import { ServiceVerrouillagePeriode } from './service-verrouillage-periode';

/**
 * Verrouillage de période (RM-95) — DEUX ACTIONS, PAS UNE RESSOURCE (voir `contrats/pointage/
 * periode.ts`, en-tête). Racine `/pointages`, même préfixe que `PointageController` mais fichier
 * séparé (périmètre distinct : agit EN LOT sur tous les pointages d'un site).
 */
@ApiTags('Pointage — verrouillage de période')
@ApiCookieAuth()
@Controller({ path: 'pointages', version: '1' })
@UseGuards(GardeDroit)
export class PointagePeriodeController {
  constructor(
    private readonly service: ServiceVerrouillagePeriode,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @Post('verrouiller-periode')
  @ExigerDroit('atelier.pointage.verrouiller_periode')
  @ApiOperation({
    summary: 'RM-95 : verrouille tout pointage `termine`/`valide` dont `debutLe` précède `jusquauLe` (borne incluse), sur un site.',
    description: "Refusée (`409 CONFLIT`) si un pointage `en_cours` tombe dans la plage — jamais fermé de force (RM-113 : falsifierait la donnée).",
  })
  @ApiOkResponse({ type: ReponseVerrouillagePeriodePointageDto })
  @ApiReponseProbleme(400, 'Corps invalide.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(409, 'Des pointages sont encore en cours dans la plage à verrouiller.')
  async verrouiller(
    @CorpsZod(schemaVerrouillagePeriodePointage, { exemple: { siteId: '5a1c9e2e-2f0a-4b3a-9c1a-8e6f2d4b7a10', jusquauLe: '2026-07-31' } })
    entree: EntreeVerrouillagePeriodePointage,
  ) {
    const ctx = this.contexte.contexteTenant();
    const principal = this.contexte.exigerPrincipal();
    return this.service.verrouiller(ctx, principal, entree);
  }

  @Post('deverrouiller-periode')
  @ExigerDroit('atelier.pointage.deverrouiller_periode')
  @ApiOperation({ summary: 'RM-95 : contre-passation — motif OBLIGATOIRE. Ne transitionne que les pointages `verrouille` du site vers `valide`.' })
  @ApiOkResponse({ type: ReponseDeverrouillagePeriodePointageDto })
  @ApiReponseProbleme(400, 'Corps invalide (motif manquant).')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  async deverrouiller(
    @CorpsZod(schemaDeverrouillagePeriodePointage, {
      exemple: { siteId: '5a1c9e2e-2f0a-4b3a-9c1a-8e6f2d4b7a10', jusquauLe: '2026-07-15', motif: 'Période exportée par erreur, à recalculer.' },
    })
    entree: EntreeDeverrouillagePeriodePointage,
  ) {
    const ctx = this.contexte.contexteTenant();
    const principal = this.contexte.exigerPrincipal();
    return this.service.deverrouiller(ctx, principal, entree);
  }
}
