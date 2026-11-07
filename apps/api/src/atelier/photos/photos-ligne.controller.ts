import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import {
  LIMITE_TAILLE_PHOTO_LIGNE_OCTETS,
  schemaCreationPhotoLigne,
  schemaIdentifiant,
} from '@dfa/shared';

import { ServiceContexteRequete } from '../../common/contexte';
import { ExigerDroit, GardeDroit } from '../../common/droits';
import { ApiReponseProbleme, ErreurMetier } from '../../common/erreurs';
import { PipeZod } from '../../common/validation';

import { ReponseListePhotosLigneDto, ReponsePhotoLigneDto } from './dto';
import { ServicePhotosLigne } from './service-photos-ligne';

interface FichiersEnvoyes {
  readonly photo?: Express.Multer.File[];
  readonly vignette?: Express.Multer.File[];
}

/**
 * Photos d'une ligne d'OR. Le tenant vient de la session. Les fichiers restent EN MÉMOIRE côté
 * multer (aucun `storage`) : le service valide les octets (JPEG/PNG par octets magiques, 8 Mo)
 * AVANT d'écrire quoi que ce soit sur disque.
 */
@ApiTags('Ordres de réparation — photos')
@ApiCookieAuth()
@Controller({ version: '1' })
@UseGuards(GardeDroit)
export class PhotosLigneController {
  constructor(
    private readonly service: ServicePhotosLigne,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @Post('ordres-reparation/:orId/lignes/:ligneId/photos')
  @HttpCode(HttpStatus.CREATED)
  @ExigerDroit('atelier.ligne.photo.ajouter')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'photo', maxCount: 1 },
        { name: 'vignette', maxCount: 1 },
      ],
      { limits: { fileSize: LIMITE_TAILLE_PHOTO_LIGNE_OCTETS, files: 2, fields: 4 } },
    ),
  )
  @ApiOperation({
    summary: 'Joindre une photo à une ligne (travail constaté).',
    description:
      'JPEG ou PNG, 8 Mo au plus, 20 photos par ligne. `vignette` (JPEG ≤ 320 px) facultative, ' +
      'produite par le navigateur. Refusé si l’OR est facturé ou clos.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        photo: { type: 'string', format: 'binary' },
        vignette: { type: 'string', format: 'binary' },
        legende: { type: 'string', maxLength: 200 },
      },
      required: ['photo'],
    },
  })
  @ApiParam({ name: 'orId', format: 'uuid' })
  @ApiParam({ name: 'ligneId', format: 'uuid' })
  @ApiCreatedResponse({ type: ReponsePhotoLigneDto })
  @ApiReponseProbleme(400, 'Photo absente, vide, au format non reconnu ou HEIC.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'OR ou ligne introuvable pour ce tenant.')
  @ApiReponseProbleme(409, 'OR_LIGNE_VERROUILLEE (OR facturé/clos) ou 20 photos déjà jointes.')
  @ApiReponseProbleme(413, 'Photo de plus de 8 Mo.')
  async ajouter(
    @Param('orId', new PipeZod(schemaIdentifiant)) orId: string,
    @Param('ligneId', new PipeZod(schemaIdentifiant)) ligneId: string,
    @UploadedFiles() fichiers: FichiersEnvoyes | undefined,
    @Body() corps: Record<string, unknown> | undefined,
  ) {
    const photo = fichiers?.photo?.[0];
    if (!photo) {
      throw new ErreurMetier('VALIDATION_ECHOUEE', 'Photo absente.');
    }
    const { legende } = new PipeZod(schemaCreationPhotoLigne).transform(corps ?? {});
    return this.service.ajouter(
      this.contexte.contexteTenant(),
      this.contexte.exigerPrincipal(),
      orId,
      ligneId,
      { photo, vignette: fichiers?.vignette?.[0], legende },
    );
  }

  @Get('ordres-reparation/:orId/lignes/:ligneId/photos')
  @ExigerDroit('atelier.ligne.photo.lire')
  @ApiOperation({ summary: 'Photos d’une ligne, de la plus ancienne à la plus récente.' })
  @ApiParam({ name: 'orId', format: 'uuid' })
  @ApiParam({ name: 'ligneId', format: 'uuid' })
  @ApiOkResponse({ type: ReponseListePhotosLigneDto })
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'OR introuvable pour ce tenant.')
  async listerParLigne(
    @Param('orId', new PipeZod(schemaIdentifiant)) orId: string,
    @Param('ligneId', new PipeZod(schemaIdentifiant)) ligneId: string,
  ) {
    return this.service.listerParLigne(
      this.contexte.contexteTenant(),
      this.contexte.exigerPrincipal(),
      orId,
      ligneId,
    );
  }

  @Get('ordres-reparation/:orId/photos')
  @ExigerDroit('atelier.ligne.photo.lire')
  @ApiOperation({
    summary: 'Toutes les photos d’un OR (une requête pour tout l’écran), triées par ancienneté.',
    description: 'Le champ `ligneId` de chaque photo permet de les regrouper par ligne.',
  })
  @ApiParam({ name: 'orId', format: 'uuid' })
  @ApiOkResponse({ type: ReponseListePhotosLigneDto })
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'OR introuvable pour ce tenant.')
  async listerParOr(@Param('orId', new PipeZod(schemaIdentifiant)) orId: string) {
    return this.service.listerParOr(
      this.contexte.contexteTenant(),
      this.contexte.exigerPrincipal(),
      orId,
    );
  }

  @Get('photos/:id')
  @ExigerDroit('atelier.ligne.photo.lire')
  @ApiOperation({ summary: 'Image de la photo (fichier binaire).' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiProduces('image/jpeg', 'image/png')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Photo introuvable pour ce tenant.')
  async telecharger(
    @Param('id', new PipeZod(schemaIdentifiant)) id: string,
    @Res() res: Response,
  ): Promise<void> {
    await this.servir(id, false, res);
  }

  @Get('photos/:id/vignette')
  @ExigerDroit('atelier.ligne.photo.lire')
  @ApiOperation({
    summary: 'Vignette (≤ 320 px) de la photo ; la photo entière si aucune vignette n’existe.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiProduces('image/jpeg', 'image/png')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Photo introuvable pour ce tenant.')
  async telechargerVignette(
    @Param('id', new PipeZod(schemaIdentifiant)) id: string,
    @Res() res: Response,
  ): Promise<void> {
    await this.servir(id, true, res);
  }

  @Delete('photos/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ExigerDroit('atelier.ligne.photo.supprimer')
  @ApiOperation({
    summary: 'Supprimer une photo (son auteur, ou l’encadrement), tant que l’OR n’est pas facturé.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiNoContentResponse({ description: 'Photo supprimée.' })
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant, ou photo d’un autre pour un non-encadrement.')
  @ApiReponseProbleme(404, 'Photo introuvable pour ce tenant.')
  @ApiReponseProbleme(409, 'OR_LIGNE_VERROUILLEE — OR facturé ou clos.')
  async supprimer(@Param('id', new PipeZod(schemaIdentifiant)) id: string): Promise<void> {
    await this.service.supprimer(
      this.contexte.contexteTenant(),
      this.contexte.exigerPrincipal(),
      id,
    );
  }

  private async servir(id: string, vignette: boolean, res: Response): Promise<void> {
    const { buffer, typeMime, nomFichier } = await this.service.lireFichier(
      this.contexte.contexteTenant(),
      id,
      vignette,
    );
    res.setHeader('Content-Type', typeMime);
    res.setHeader('Content-Disposition', `inline; filename="${nomFichier}"`);
    res.setHeader('Content-Length', String(buffer.length));
    // Contenu du client : jamais interprété comme autre chose qu'une image, jamais mis en cache
    // partagé (proxy), conservé par le navigateur de l'utilisateur seulement.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.status(200).send(buffer);
  }
}
