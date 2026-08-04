import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { schemaFiltreTableauBord, type FiltreTableauBord } from '@dfa/shared';

import { ServiceContexteRequete } from '../common/contexte';
import { AucunDroitRequis, GardeDroit } from '../common/droits';
import { ApiReponseProbleme } from '../common/erreurs';
import { PipeZod } from '../common/validation';

import { ReponseActiviteTableauBordDto } from './dto';
import { ServiceTableauBordActivite } from './service-tableau-bord-activite';

/**
 * `GET /tableau-bord/activite` — indicateurs d'activité atelier + stock, EN QUANTITÉS/COMPTES
 * seulement, jamais un montant. Ouvert à tout rôle de personne (voir `droits-provisoires.ts`).
 *
 * `@AucunDroitRequis()` PROVISOIRE, PAS un accès ouvert par négligence — voir l'en-tête de
 * `droits-provisoires.ts` : `ServiceTableauBordActivite.obtenir` vérifie le rôle réel EN SERVICE,
 * avant tout accès base, en l'absence de l'action `tableau_bord.activite.lire` dans
 * `auth/matrice-droits.ts` (hors du périmètre d'écriture de ce module).
 */
@ApiTags('Tableau de bord')
@ApiCookieAuth()
@Controller({ path: 'tableau-bord', version: '1' })
@UseGuards(GardeDroit)
export class TableauBordActiviteController {
  constructor(
    private readonly service: ServiceTableauBordActivite,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @Get('activite')
  @AucunDroitRequis()
  @ApiOperation({
    summary: "Indicateurs d'activité atelier + stock (aucun montant).",
    description:
      'OR encore actifs par statut (snapshot), OR ouverts/restitués sur la période, délai moyen ' +
      'de restitution, lignes en attente de validation, articles sous seuil de réapprovisionnement. ' +
      '`du`/`au` omis → mois civil UTC courant. Réservé aux rôles de personne ' +
      '(`poste_atelier`, la borne murale, en est exclu).',
  })
  @ApiQuery({ name: 'siteId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'du', required: false, format: 'date' })
  @ApiQuery({ name: 'au', required: false, format: 'date' })
  @ApiOkResponse({ type: ReponseActiviteTableauBordDto })
  @ApiReponseProbleme(400, '`du`/`au`/`siteId` invalides, ou `du` postérieur à `au`.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant (rôle `poste_atelier`).')
  async activite(
    @Query(new PipeZod(schemaFiltreTableauBord)) query: FiltreTableauBord,
  ): Promise<ReponseActiviteTableauBordDto> {
    const ctx = this.contexte.contexteTenant();
    const { role } = this.contexte.exigerPrincipal();
    return this.service.obtenir(ctx, role, query);
  }
}
