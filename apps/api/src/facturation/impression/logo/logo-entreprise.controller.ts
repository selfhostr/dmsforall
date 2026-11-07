import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Put,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiCookieAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { LIMITE_TAILLE_LOGO_OCTETS } from '@dfa/shared';

import { ServiceContexteRequete } from '../../../common/contexte';
import { ExigerDroit, GardeDroit } from '../../../common/droits';
import { ApiReponseProbleme, ErreurMetier } from '../../../common/erreurs';

import { ReponseLogoEntrepriseDto } from './logo-entreprise.dto';
import { ServiceLogoEntreprise } from './service-logo-entreprise';

/**
 * `PUT|GET|DELETE /parametres-entreprise/logo` — logo imprimé sur les factures et devis.
 *
 * Droits : ceux de `/parametres-entreprise` (bloc créancier : direction, comptable ; jamais admin).
 * `logo` : `multipart/form-data`, un fichier, 1 Mo maximum, type vérifié par les premiers octets.
 * Gardé EN MÉMOIRE par multer (aucun `dest`) puis écrit via l'abstraction de stockage.
 */
@ApiTags('Paramétrage')
@ApiCookieAuth()
@Controller({ path: 'parametres-entreprise/logo', version: '1' })
@UseGuards(GardeDroit)
export class LogoEntrepriseController {
  constructor(
    private readonly service: ServiceLogoEntreprise,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @Put()
  @ExigerDroit('facturation.parametrage.creancier.modifier')
  @UseInterceptors(
    FileInterceptor('logo', { limits: { fileSize: LIMITE_TAILLE_LOGO_OCTETS, files: 1 } }),
  )
  @ApiOperation({
    summary: 'Dépose ou remplace le logo du garage (PNG, JPEG ou SVG, 1 Mo maximum).',
    description:
      'Le type est vérifié par les premiers octets du fichier, pas par son extension ni son type déclaré. Un SVG contenant un script, ' +
      'un gestionnaire d’événement ou une ressource externe est refusé. Seuls PNG et JPEG sont imprimés sur les PDF.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { logo: { type: 'string', format: 'binary' } },
      required: ['logo'],
    },
  })
  @ApiOkResponse({ type: ReponseLogoEntrepriseDto })
  @ApiReponseProbleme(400, 'Fichier absent, vide ou format non reconnu (VALIDATION_ECHOUEE).')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'DROIT_INSUFFISANT — réservé à direction/comptable.')
  @ApiReponseProbleme(413, 'Fichier de plus de 1 Mo.')
  async deposer(
    @UploadedFile() logo: Express.Multer.File | undefined,
  ): Promise<ReponseLogoEntrepriseDto> {
    if (!logo) {
      throw new ErreurMetier('VALIDATION_ECHOUEE', 'Champ « logo » absent.', {
        erreurs: [{ champ: 'logo', code: 'requis', message: 'Fichier requis.' }],
      });
    }
    return this.service.remplacer(this.contexte.contexteTenant(), logo.buffer);
  }

  @Get()
  @ExigerDroit('facturation.parametrage.creancier.lire')
  @ApiOperation({ summary: 'Le logo du garage (octets de l’image).' })
  @ApiProduces('image/png', 'image/jpeg', 'image/svg+xml')
  @ApiOkResponse({ description: 'L’image, avec son Content-Type.' })
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'DROIT_INSUFFISANT — réservé à direction/comptable.')
  @ApiReponseProbleme(404, 'RESSOURCE_INTROUVABLE — aucun logo déposé.')
  async lire(@Res() res: Response): Promise<void> {
    const logo = await this.service.lire(this.contexte.contexteTenant());
    if (!logo) throw new ErreurMetier('RESSOURCE_INTROUVABLE', 'Aucun logo déposé.');
    res
      .status(HttpStatus.OK)
      .setHeader('Content-Type', logo.typeMime)
      .setHeader('X-Content-Type-Options', 'nosniff')
      // Un SVG ouvert directement dans l'onglet ne doit exécuter ni charger quoi que ce soit.
      .setHeader(
        'Content-Security-Policy',
        "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      )
      .setHeader('Cache-Control', 'private, no-cache')
      .send(logo.contenu);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ExigerDroit('facturation.parametrage.creancier.modifier')
  @ApiOperation({ summary: 'Supprime le logo du garage. Idempotent.' })
  @ApiNoContentResponse({ description: 'Logo supprimé (ou déjà absent).' })
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'DROIT_INSUFFISANT — réservé à direction/comptable.')
  async supprimer(): Promise<void> {
    await this.service.supprimer(this.contexte.contexteTenant());
  }
}
