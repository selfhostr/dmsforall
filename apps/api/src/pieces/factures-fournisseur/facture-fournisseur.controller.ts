import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
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
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import type { FiltresFacturesFournisseur } from '@dfa/shared';

import { ServiceContexteRequete } from '../../common/contexte';
import { ExigerDroit, GardeDroit } from '../../common/droits';
import { ApiReponseProbleme, ErreurMetier } from '../../common/erreurs';
import { PipeZod } from '../../common/validation';

import { FactureFournisseurDto, PageFactureFournisseurDto } from './dto';
import {
  LIMITE_TAILLE_FACTURE_FOURNISSEUR_OCTETS,
  ServiceFactureFournisseur,
} from './service-facture-fournisseur';
import {
  schemaFiltresFacturesFournisseur,
  schemaRejetFactureFournisseur,
  schemaUuid,
  type EntreeRejetFactureFournisseur,
} from './schemas';

/**
 * `POST /factures-fournisseur` — dépôt depuis le poste fixe UNIQUEMENT (décision @laupernoe : pas de
 * courriel entrant, pas de photo mobile pour l'instant). Déclenche la chaîne complète (QR → texte
 * du PDF → OCR de repli) et le rapprochement — voir `service-facture-fournisseur.ts`. AUCUNE
 * validation automatique : la réponse est une PROPOSITION, `POST /{id}/valider` reste un geste
 * humain distinct (même doctrine que `vehicule-ocr.controller.ts` pour le scan de permis).
 *
 * `@ExigerDroit(...)` sur chaque route, vérifié contre `MATRICE_DROITS` (`auth/matrice-droits.ts`,
 * bloc `pieces.facture_fournisseur.*`) par `GardeDroit` — plus de vérification de rôle en service
 * (bascule depuis le palliatif `droits-provisoires.ts`, retiré, qui portait la vérification RÉELLE
 * dans `ServiceFactureFournisseur` faute d'accès à la matrice centrale). Lecture (`lister`,
 * `obtenir`, `telechargerDocument`) sous `pieces.facture_fournisseur.lire` ; écriture (`deposer`,
 * `valider`, `rejeter`) chacune sous sa propre action, magasinier seul (« le magasinier confirme »
 * — voir la table de vérité rôle par rôle dans `matrice-droits.spec.ts`).
 */
@ApiTags('Pièces — Factures fournisseur')
@ApiCookieAuth()
@Controller({ path: 'factures-fournisseur', version: '1' })
@UseGuards(GardeDroit)
export class FactureFournisseurController {
  constructor(
    private readonly service: ServiceFactureFournisseur,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ExigerDroit('pieces.facture_fournisseur.deposer')
  @UseInterceptors(
    FileInterceptor('fichier', {
      limits: { fileSize: LIMITE_TAILLE_FACTURE_FOURNISSEUR_OCTETS, files: 1 },
      fileFilter: (_req, file, callback) => {
        // Filtre de PREMIÈRE ligne sur le Content-Type déclaré — jamais suffisant seul (un
        // appelant peut mentir sans effort), la signature binaire réelle est revérifiée dans
        // `ServiceFactureFournisseur.deposer` (`%PDF-`) avant tout traitement.
        callback(null, file.mimetype === 'application/pdf');
      },
    }),
  )
  @ApiOperation({
    summary: 'Dépose une facture fournisseur (PDF) — lecture automatique et rapprochement.',
    description:
      'Chaîne QR-facture → texte du PDF → OCR de repli. Rattache à la commande fournisseur par ' +
      'correspondance EXACTE uniquement (fournisseur par nom du créancier QR, commande par sa ' +
      'référence retrouvée dans le texte). Écarts prix/quantité/total calculés ligne à ligne, ' +
      "jamais de correction ni de mise à jour de stock/prix automatique — l'utilisateur confirme " +
      'via `POST /{id}/valider`. Un dépôt du MÊME fichier (empreinte SHA-256 identique) est refusé.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { fichier: { type: 'string', format: 'binary' } },
      required: ['fichier'],
    },
  })
  @ApiResponse({ status: 201, type: FactureFournisseurDto })
  @ApiReponseProbleme(400, 'Fichier absent ou signature PDF invalide (VALIDATION_ECHOUEE).')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Rôle sans droit de dépôt (DROIT_INSUFFISANT).')
  @ApiReponseProbleme(409, 'CONFLIT — ce fichier a déjà été déposé (même empreinte SHA-256).')
  @ApiReponseProbleme(413, 'Fichier trop volumineux (LIMITE_TAILLE_FACTURE_FOURNISSEUR_OCTETS).')
  async deposer(
    @UploadedFile() fichier: Express.Multer.File | undefined,
  ): Promise<FactureFournisseurDto> {
    if (!fichier || fichier.buffer.length === 0) {
      throw new ErreurMetier(
        'VALIDATION_ECHOUEE',
        'Fichier absent ou format non supporté (PDF attendu).',
      );
    }
    const ctx = this.contexte.contexteTenant();
    return this.service.deposer(ctx, fichier.buffer);
  }

  @Get()
  @ExigerDroit('pieces.facture_fournisseur.lire')
  @ApiOperation({ summary: 'Liste paginée des factures fournisseurs déposées (sans le binaire).' })
  @ApiOkResponse({ type: PageFactureFournisseurDto })
  @ApiReponseProbleme(400, 'Filtres, tri ou curseur invalides.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  async lister(
    @Query(new PipeZod(schemaFiltresFacturesFournisseur)) query: FiltresFacturesFournisseur,
  ): Promise<PageFactureFournisseurDto> {
    const ctx = this.contexte.contexteTenant();
    return this.service.lister(ctx, query);
  }

  @Get(':id')
  @ExigerDroit('pieces.facture_fournisseur.lire')
  @ApiOperation({ summary: 'Détail d’une facture fournisseur — lignes et écarts.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: FactureFournisseurDto })
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Facture introuvable pour ce tenant.')
  async obtenir(@Param('id', new PipeZod(schemaUuid)) id: string): Promise<FactureFournisseurDto> {
    const ctx = this.contexte.contexteTenant();
    return this.service.obtenir(ctx, id);
  }

  @Get(':id/document')
  @ExigerDroit('pieces.facture_fournisseur.lire')
  @ApiOperation({
    summary: 'Le PDF déposé, tel quel — jamais chargé par `GET /{id}` ni par la liste.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiProduces('application/pdf')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Facture introuvable pour ce tenant.')
  async telechargerDocument(
    @Param('id', new PipeZod(schemaUuid)) id: string,
    @Res() res: Response,
  ): Promise<void> {
    const ctx = this.contexte.contexteTenant();
    const { contenu, typeMime } = await this.service.obtenirDocument(ctx, id);

    // `nosniff` + `inline` avec un nom de fichier FIXE, jamais dérivé d'une entrée utilisateur
    // (aucun nom de fichier n'est conservé — voir la migration 0059) : un PDF ne doit jamais
    // s'exécuter dans un contexte où le navigateur pourrait le réinterpréter.
    res.setHeader('Content-Type', typeMime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `inline; filename="facture-fournisseur-${id}.pdf"`);
    res.setHeader('Content-Length', String(contenu.length));
    res.status(200).send(contenu);
  }

  @Post(':id/valider')
  @HttpCode(HttpStatus.OK)
  @ExigerDroit('pieces.facture_fournisseur.valider')
  @ApiOperation({
    summary: 'Le magasinier confirme la facture (aucune validation automatique).',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: FactureFournisseurDto })
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Facture introuvable pour ce tenant.')
  @ApiReponseProbleme(409, 'CONFLIT — déjà validée ou rejetée (décision terminale).')
  async valider(@Param('id', new PipeZod(schemaUuid)) id: string): Promise<FactureFournisseurDto> {
    const ctx = this.contexte.contexteTenant();
    return this.service.valider(ctx, id);
  }

  @Post(':id/rejeter')
  @HttpCode(HttpStatus.OK)
  @ExigerDroit('pieces.facture_fournisseur.rejeter')
  @ApiOperation({ summary: 'Refuse la facture (mauvais dépôt, doublon manuel…) — motif exigé.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: FactureFournisseurDto })
  @ApiReponseProbleme(400, 'Motif absent ou trop court.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Facture introuvable pour ce tenant.')
  @ApiReponseProbleme(409, 'CONFLIT — déjà validée ou rejetée (décision terminale).')
  async rejeter(
    @Param('id', new PipeZod(schemaUuid)) id: string,
    @Body(new PipeZod(schemaRejetFactureFournisseur)) corps: EntreeRejetFactureFournisseur,
  ): Promise<FactureFournisseurDto> {
    const ctx = this.contexte.contexteTenant();
    return this.service.rejeter(ctx, id, corps.motif);
  }
}
