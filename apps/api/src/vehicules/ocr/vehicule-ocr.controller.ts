import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiCookieAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  LIMITE_TAILLE_IMAGE_PERMIS_OCTETS,
  TYPES_MIME_IMAGE_PERMIS_ACCEPTES,
  type ReponseScanPermisCirculation,
} from '@dfa/shared';

import { ServiceContexteRequete } from '../../common/contexte';
import { ExigerDroit, GardeDroit } from '../../common/droits';
import { ApiReponseProbleme, ErreurMetier } from '../../common/erreurs';
import { ReponseScanPermisCirculationDto } from './dto';
import { ServiceVehiculeOcr } from './service-vehicule-ocr';

/**
 * `POST /scan/permis-circulation` — reconnaissance automatique du permis de circulation suisse.
 * NE CRÉE RIEN (décision @laupernoe) : rend une proposition, la création reste `POST /vehicules` /
 * `POST /clients`, inchangés — voir `packages/shared/src/contrats/vehicules/scan-permis-circulation.ts`
 * pour le contrat complet et ses justifications.
 *
 * Chemin/nom de champ ALIGNÉS sur l'écran de scan (`apps/web/src/ecrans/scan/`, contrat
 * temporaire `contrat-ocr.temporaire.ts` à supprimer une fois `pnpm api:openapi && pnpm
 * web:types` généré ce contrôleur) — convergence arbitrée par l'orchestrateur : `/scan/…`, champ
 * `photo`, pas `/vehicules/ocr/…`/`image` (choix initial de cet agent, abandonné pour éviter une
 * seconde forme de contrat en parallèle du front déjà livré).
 *
 * `vehicule.creer`, pas un droit dédié : scanner un permis n'a de sens que pour préparer la
 * création d'une fiche véhicule, le droit naturel est donc celui qui gouverne déjà cette création.
 *
 * `photo` : `multipart/form-data`, un seul fichier, `LIMITE_TAILLE_IMAGE_PERMIS_OCTETS` maximum,
 * MIME dans `TYPES_MIME_IMAGE_PERMIS_ACCEPTES` (jpeg/png/webp/heic/heif — le front réencode déjà
 * en JPEG avant envoi, `ecrans/scan/reduireImage.ts`, l'endpoint reste défensif pour tout autre
 * appelant) — filtré par `FileInterceptor` SANS option `storage` : multer garde alors le fichier
 * EN MÉMOIRE (`file.buffer`), jamais sur disque (aucun `dest`, aucun `diskStorage`) — condition
 * nécessaire à la décision « la photo n'est jamais conservée ».
 */
@ApiTags('Véhicules')
@ApiCookieAuth()
@Controller({ path: 'scan', version: '1' })
@UseGuards(GardeDroit)
export class VehiculeOcrController {
  constructor(
    private readonly service: ServiceVehiculeOcr,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @Post('permis-circulation')
  @HttpCode(HttpStatus.OK)
  @ExigerDroit('vehicule.creer')
  @UseInterceptors(
    FileInterceptor('photo', {
      limits: { fileSize: LIMITE_TAILLE_IMAGE_PERMIS_OCTETS, files: 1 },
      fileFilter: (_req, file, callback) => {
        callback(
          null,
          (TYPES_MIME_IMAGE_PERMIS_ACCEPTES as readonly string[]).includes(file.mimetype),
        );
      },
    }),
  )
  @ApiOperation({
    summary: 'Reconnaissance automatique du permis de circulation (carte grise).',
    description:
      'Ne crée NI véhicule NI client — rend une donnée extraite (trois niveaux de confiance par ' +
      'champ : sûr / douteux / absent) et des correspondances EXACTES TROUVÉES parmi les véhicules ' +
      "et les clients du tenant. À l'utilisateur de confirmer via `POST /vehicules` / " +
      "`POST /clients`. La photo n'est jamais conservée (traitée en mémoire, ni disque ni base).",
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { photo: { type: 'string', format: 'binary' } },
      required: ['photo'],
    },
  })
  @ApiResponse({ status: 200, type: ReponseScanPermisCirculationDto })
  @ApiReponseProbleme(400, 'Photo absente ou format non supporté.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant (rôle sans vehicule.creer).')
  @ApiReponseProbleme(413, 'Photo trop volumineuse (LIMITE_TAILLE_IMAGE_PERMIS_OCTETS).')
  @ApiReponseProbleme(
    422,
    'SCAN_PHOTO_ILLISIBLE — aucun champ exploitable extrait (document absent du cadre, flou, trop sombre). ' +
      'Code proposé par l’écran, non encore ajouté à CODES_ERREUR (packages/shared/src/contrats/probleme.ts, ' +
      'hors périmètre de cet agent) — VALIDATION_ECHOUEE avec statut 422 en attendant cet arbitrage.',
  )
  @ApiReponseProbleme(429, 'AUTH_TROP_DE_TENTATIVES — trop de scans pour cet utilisateur.')
  @ApiReponseProbleme(503, 'Service OCR indisponible.')
  async scannerPermisCirculation(
    @UploadedFile() photo: Express.Multer.File | undefined,
  ): Promise<ReponseScanPermisCirculation> {
    if (!photo || photo.buffer.length === 0) {
      throw new ErreurMetier(
        'VALIDATION_ECHOUEE',
        'Photo absente ou format non supporté (jpeg, png, webp, heic, heif attendus).',
      );
    }

    const ctx = this.contexte.contexteTenant();
    return this.service.scanner(ctx, photo.buffer);
  }
}
