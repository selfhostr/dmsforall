import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import {
  EN_TETE_IDEMPOTENCE,
  schemaCreationOrdreDepuisDevis,
  schemaIdentifiant,
  type EntreeCreationOrdreDepuisDevis,
} from '@dfa/shared';

import { ServiceContexteRequete } from '../common/contexte';
import { CorpsZod } from '../common/documentation';
import { ExigerDroit, GardeDroit } from '../common/droits';
import { ApiReponseProbleme } from '../common/erreurs';
import { PipeZod } from '../common/validation';

import { EnveloppeCreationOrdreDepuisDevisDto } from './dto';
import { etagOrdreReparation } from './ordre-reparation.etag';
import { ServiceDevisVersOr } from './service-devis-vers-or';
import { ExigerModule } from '../common/droits/garde-module';

/**
 * Devis -> ordre de réparation. Sous le préfixe `documents-vente` (la ressource de départ est le
 * devis) mais servi par l'atelier : c'est lui qui possède l'OR. Droit : celui de la création d'OR
 * (`atelier.or.creer`).
 */
@ApiTags('Documents de vente')
@ApiCookieAuth()
@ExigerModule('atelier')
@Controller({ path: 'documents-vente', version: '1' })
@UseGuards(GardeDroit)
export class DevisVersOrController {
  constructor(
    private readonly service: ServiceDevisVersOr,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @Post(':id/creer-ordre-reparation')
  @HttpCode(HttpStatus.CREATED)
  @ExigerDroit('atelier.or.creer')
  @ApiOperation({
    summary: 'Crée un ordre de réparation depuis un devis et en reprend les lignes.',
    description:
      "Client, véhicule et site viennent du devis. Chaque ligne du devis devient une ligne d'OR " +
      '`validee` (origine `commandee`) avec ses montants HT/TVA/TTC recopiés à l’identique ; ' +
      'un devis `emis` passe à `accepte`. Le lien OR ← devis est posé (un devis ne crée qu’un seul OR). ' +
      'Mêmes confirmations que `POST /ordres-reparation` (client bloqué, deux OR sur le véhicule, OR sans RDV). ' +
      '`Idempotency-Key` obligatoire (uuid v4) : un rejeu ne crée ni second OR ni second numéro.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Identifiant du devis.' })
  @ApiHeader({
    name: EN_TETE_IDEMPOTENCE,
    required: true,
    description: 'uuid v4, identité de la requête.',
  })
  @ApiResponse({ status: 201, type: EnveloppeCreationOrdreDepuisDevisDto })
  @ApiReponseProbleme(400, 'Corps invalide ou Idempotency-Key manquante/mal formée.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Devis introuvable pour ce tenant.')
  @ApiReponseProbleme(
    409,
    'CONFLIT (devis sans véhicule, brouillon/refusé/expiré, devise ≠ CHF, ligne non reprenable, OR déjà ouvert), ' +
      'DOCUMENT_SOURCE_DEJA_TRANSFORME, CONFIRMATION_REQUISE, OR_KM_ENTREE_REQUIS ou IDEMPOTENCE_CONFLIT.',
  )
  async creerOrdreReparation(
    @Param('id', new PipeZod(schemaIdentifiant)) id: string,
    @CorpsZod(schemaCreationOrdreDepuisDevis, {
      exemple: {
        type: 'reparation',
        kilometrageEntree: 84_500,
        uniteKilometrage: 'km',
        demandes: [{ verbatim: 'Selon devis accepté.' }],
        statutInitial: 'ouvert',
      },
    })
    entree: EntreeCreationOrdreDepuisDevis,
    @Headers(EN_TETE_IDEMPOTENCE.toLowerCase()) cleIdempotence: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<unknown> {
    const ctx = this.contexte.contexteTenant();
    const principal = this.contexte.exigerPrincipal();
    const resultat = await this.service.creerOrdreReparation(
      ctx,
      principal,
      id,
      entree,
      cleIdempotence ?? '',
    );

    res.status(resultat.reponse.statutHttp);
    if (resultat.rejoue) res.setHeader('Idempotency-Rejeu', 'true');
    res.setHeader(
      'ETag',
      etagOrdreReparation(resultat.reponse.corps.donnees.ordreReparation.version),
    );
    return resultat.reponse.corps;
  }
}
