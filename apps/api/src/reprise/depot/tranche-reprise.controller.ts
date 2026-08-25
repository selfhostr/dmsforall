import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiConsumes,
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import {
  schemaFinalisationDepotReprise,
  schemaIdentifiant,
  schemaNumeroTranche,
  type EntreeFinalisationDepotReprise,
} from '@dfa/shared';

import { ServiceContexteRequete } from '../../common/contexte';
import { CorpsZod } from '../../common/documentation';
import { ExigerDroit, GardeDroit } from '../../common/droits';
import { ApiReponseProbleme, ErreurMetier } from '../../common/erreurs';
import { PipeZod } from '../../common/validation';

import { ReponseDossierRepriseDto, ArchiveDeposeeRepriseDto } from '../dto/dossier-reprise.dto';
import { ReponseTrancheDeposeeDto } from '../dto/dossier-reprise.dto';
import { ServiceDepotReprise } from './service-depot-reprise';

/**
 * Dépôt par tranches — routeur SÉPARÉ de `DossierRepriseController` pour une seule raison
 * mécanique : `PUT .../tranches/{numero}` porte un corps `application/octet-stream` SANS schéma
 * zod (§ contrat), lu via `express.raw()` (voir `RepriseModule.configure`, `NestModule`) — un
 * middleware appliqué à CE contrôleur seul, jamais au reste du module (qui reste en JSON normal).
 * `GET .../tranches` et `POST .../finaliser`, bien que « phase dépôt », restent JSON — regroupés
 * ici par cohésion de service (`ServiceDepotReprise`), pas par contrainte technique.
 */
@ApiTags('Reprise de données')
@ApiCookieAuth()
@Controller({ path: 'reprise/dossiers', version: '1' })
@UseGuards(GardeDroit)
export class TrancheRepriseController {
  constructor(
    private readonly service: ServiceDepotReprise,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @Put(':dossierId/tranches/:numero')
  @HttpCode(HttpStatus.OK)
  @ExigerDroit('reprise.dossier.deposer')
  @ApiOperation({
    summary: "Dépose une tranche binaire de l'archive — idempotent par numéro.",
    description:
      'Corps brut `application/octet-stream` (PAS de schéma zod, même doctrine que le scan de ' +
      'permis de circulation). Redéposer le MÊME numéro écrase la précédente sans effet de bord : ' +
      "c'est le mécanisme de reprise après coupure réseau.",
  })
  @ApiParam({ name: 'dossierId', format: 'uuid' })
  @ApiParam({ name: 'numero', type: Number, description: 'Numéro de tranche, 0-indexé.' })
  @ApiConsumes('application/octet-stream')
  @ApiBody({ schema: { type: 'string', format: 'binary' } })
  @ApiOkResponse({ type: ReponseTrancheDeposeeDto })
  @ApiReponseProbleme(400, 'Corps vide, ou dossier/numéro mal formés.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(404, 'Dossier introuvable pour ce tenant.')
  @ApiReponseProbleme(409, 'REPRISE_DOSSIER_TRANSITION_INTERDITE (dossier plus en depot_en_cours).')
  @ApiReponseProbleme(400, 'REPRISE_TRANCHE_HORS_SEQUENCE (dépasserait la taille annoncée).')
  async deposer(
    @Param('dossierId', new PipeZod(schemaIdentifiant)) dossierId: string,
    @Param('numero', new PipeZod(schemaNumeroTranche)) numero: number,
    @Req() req: Request,
  ) {
    const corps = req.body;
    if (!Buffer.isBuffer(corps)) {
      throw new ErreurMetier(
        'VALIDATION_ECHOUEE',
        'Corps de tranche absent ou Content-Type différent de application/octet-stream.',
      );
    }
    const ctx = this.contexte.contexteTenant();
    return this.service.deposerTranche(ctx, dossierId, numero, corps);
  }

  @Get(':dossierId/tranches')
  @ExigerDroit('reprise.dossier.lire')
  @ApiOperation({ summary: "État de réception de l'archive — reprise après interruption." })
  @ApiParam({ name: 'dossierId', format: 'uuid' })
  @ApiOkResponse({ type: ArchiveDeposeeRepriseDto })
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(404, 'Dossier introuvable pour ce tenant.')
  async etat(@Param('dossierId', new PipeZod(schemaIdentifiant)) dossierId: string) {
    const ctx = this.contexte.contexteTenant();
    return this.service.etatArchive(ctx, dossierId);
  }

  @Post(':dossierId/finaliser')
  @ExigerDroit('reprise.dossier.deposer')
  @ApiOperation({
    summary: "Finalise le dépôt — assemble les tranches, vérifie l'empreinte SHA-256 côté serveur.",
  })
  @ApiParam({ name: 'dossierId', format: 'uuid' })
  @ApiOkResponse({ type: ReponseDossierRepriseDto })
  @ApiReponseProbleme(400, 'Corps invalide.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(404, 'Dossier introuvable pour ce tenant.')
  @ApiReponseProbleme(409, 'REPRISE_ARCHIVE_INCOMPLETE ou REPRISE_EMPREINTE_INVALIDE.')
  async finaliser(
    @Param('dossierId', new PipeZod(schemaIdentifiant)) dossierId: string,
    @CorpsZod(schemaFinalisationDepotReprise) entree: EntreeFinalisationDepotReprise,
  ) {
    const ctx = this.contexte.contexteTenant();
    return this.service.finaliser(ctx, dossierId, entree.empreinteSha256Calculee);
  }
}
