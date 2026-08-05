import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { schemaFiltreTableauBord, type FiltreTableauBord } from '@dfa/shared';

import { ServiceContexteRequete } from '../common/contexte';
import { ExigerDroit, GardeDroit } from '../common/droits';
import { ApiReponseProbleme } from '../common/erreurs';
import { PipeZod } from '../common/validation';

import { ReponseFinancierTableauBordDto } from './dto';
import { ServiceTableauBordFinancier } from './service-tableau-bord-financier';

/**
 * `GET /tableau-bord/financier` — chiffre d'affaires, encaissements, encours clients. Réservé
 * `direction`/`comptable` (`tableau_bord.financier.lire`, `auth/matrice-droits.ts` — `RF-115` :
 * `admin` explicitement exclu). LE point sensible de tout ce module.
 *
 * `@ExigerDroit('tableau_bord.financier.lire')` — mécanisme normal, `GardeDroit` refuse
 * `403 DROIT_INSUFFISANT` en `canActivate()` AVANT que ce handler (donc `service.obtenir()`, donc
 * toute requête d'agrégation financière) ne s'exécute : un rôle non autorisé n'atteint
 * structurellement jamais la base. Remplace le palliatif `@AucunDroitRequis()` + vérification de
 * rôle en service (`tableau-bord/droits-provisoires.ts`, retiré), posé faute d'accès de son auteur
 * à `auth/matrice-droits.ts` au moment de la livraison de ce module.
 */
@ApiTags('Tableau de bord')
@ApiCookieAuth()
@Controller({ path: 'tableau-bord', version: '1' })
@UseGuards(GardeDroit)
export class TableauBordFinancierController {
  constructor(
    private readonly service: ServiceTableauBordFinancier,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @Get('financier')
  @ExigerDroit('tableau_bord.financier.lire')
  @ApiOperation({
    summary: 'Chiffre d’affaires, encaissements, encours clients — réservé direction/comptable.',
    description:
      "Chiffre d'affaires HT/TVA/TTC (factures + avoirs ÉMIS de la période, net d'annulation), " +
      'encaissements (paiements de la période, net des remboursements), encours clients (snapshot, ' +
      'factures encore émises non soldées). `du`/`au` omis → mois civil UTC courant. Aucune notion ' +
      'de marge : voir la documentation du contrat (`@dfa/shared`, `contrats/tableau-bord/financier.ts`).',
  })
  @ApiQuery({ name: 'siteId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'du', required: false, format: 'date' })
  @ApiQuery({ name: 'au', required: false, format: 'date' })
  @ApiOkResponse({ type: ReponseFinancierTableauBordDto })
  @ApiReponseProbleme(400, '`du`/`au`/`siteId` invalides, ou `du` postérieur à `au`.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant — réservé à direction/comptable.')
  async financier(
    @Query(new PipeZod(schemaFiltreTableauBord)) query: FiltreTableauBord,
  ): Promise<ReponseFinancierTableauBordDto> {
    const ctx = this.contexte.contexteTenant();
    return this.service.obtenir(ctx, query);
  }
}
