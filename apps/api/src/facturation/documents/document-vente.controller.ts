import {
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import {
  EN_TETE_IDEMPOTENCE,
  schemaCreationDocumentVente,
  schemaCreationLigneDocument,
  schemaFiltresDocumentsVente,
  schemaIdentifiant,
  schemaModificationDocumentVente,
  schemaModificationLigneDocument,
  type EntreeCreationDocumentVente,
  type EntreeCreationLigneDocument,
  type EntreeModificationDocumentVente,
  type EntreeModificationLigneDocument,
  type ReponseDocumentVente,
} from '@dfa/shared';

import { ServiceContexteRequete } from '../../common/contexte';
import { CorpsZod } from '../../common/documentation';
import { ExigerDroit, GardeDroit } from '../../common/droits';
import { ApiReponseProbleme } from '../../common/erreurs';
import { PipeZod } from '../../common/validation';

import { etagDocumentVente, extraireVersionEtagDocument } from './document-vente.etag';
import { EnveloppeDocumentDto, PageDocumentDto, ReponseDocumentVenteDto } from './dto';
import { ErreurMetier } from '../../common/erreurs/erreur-metier';
import { ServiceDocumentsVente } from './service-documents';

const EnveloppeDocumentVenteDto = EnveloppeDocumentDto(ReponseDocumentVenteDto, 'DocumentVente');
const PageDocumentVenteDto = PageDocumentDto(ReponseDocumentVenteDto, 'DocumentVente');

const schemaListeDocuments = schemaFiltresDocumentsVente.extend({
  limite: z.coerce.number().int().min(1).max(200).default(50),
  curseur: z.string().max(512).optional(),
});
type EntreeListeDocuments = z.infer<typeof schemaListeDocuments>;

/** `W/"<version>"` -> entier ; format invalide -> `400 VALIDATION_ECHOUEE`. */
function exigerVersionIfMatch(ifMatch: string | undefined): number {
  if (!ifMatch) {
    throw new ErreurMetier('VALIDATION_ECHOUEE', 'En-tête If-Match requis.', {
      erreurs: [{ champ: 'If-Match', code: 'requis', message: 'En-tête If-Match manquant.' }],
    });
  }
  const version = extraireVersionEtagDocument(ifMatch);
  if (version === null) {
    throw new ErreurMetier(
      'VALIDATION_ECHOUEE',
      'En-tête If-Match doit porter la forme W/"<version>".',
      {
        erreurs: [
          {
            champ: 'If-Match',
            code: 'format_invalide',
            message: 'Forme attendue : W/"<version>".',
          },
        ],
      },
    );
  }
  return version;
}

/**
 * Chaîne documentaire — ressource `document_vente` : liste, création de brouillon, fiche, mise à
 * jour de l'en-tête et lignes. Les transitions (émettre/accepter/refuser/annuler) et les avoirs
 * sont dans `document-vente-transitions.controller.ts` — même découpage par sous-domaine que
 * `atelier/` (`ordre-reparation.controller.ts` + `ordre-reparation-transitions.controller.ts`).
 */
@ApiTags('Documents de vente')
@ApiCookieAuth()
@Controller({ path: 'documents-vente', version: '1' })
@UseGuards(GardeDroit)
export class DocumentVenteController {
  constructor(
    private readonly service: ServiceDocumentsVente,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @Get()
  @ExigerDroit('facturation.document.lire')
  @ApiOperation({
    summary: 'Liste des documents de vente du tenant courant.',
    description:
      'SOUS-ENSEMBLE des filtres du contrat (`siteId`, `typeDocument`, `statut`, `clientId`, `vehiculeId`) — voir `ServiceDocumentsVente.lister`.',
  })
  @ApiOkResponse({ type: PageDocumentVenteDto })
  @ApiReponseProbleme(400, 'Filtres, tri ou curseur invalides.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  async lister(@Query(new PipeZod(schemaListeDocuments)) query: EntreeListeDocuments) {
    const ctx = this.contexte.contexteTenant();
    const principal = this.contexte.exigerPrincipal();
    const { limite, curseur, ...filtres } = query;
    const { donnees, curseurSuivant } = await this.service.lister(
      ctx,
      principal,
      filtres,
      limite,
      curseur,
    );
    return { donnees, curseurSuivant, limite };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ExigerDroit('facturation.document.creer')
  @ApiOperation({
    summary: "Création d'un brouillon (devis, bon de commande ou facture créée directement).",
    description:
      '`Idempotency-Key` obligatoire (uuid v4) — un brouillon ne consomme aucun numéro (RF-9), mais un double-clic comptoir ne doit pas produire deux brouillons. ' +
      '`documentSourceId` transforme un devis accepté ou un bon de commande émis (RF-8) — jamais une facture recopiée depuis un OR (POST /ordres-reparation/{id}/facturer, hors périmètre de ce lot).',
  })
  @ApiHeader({
    name: EN_TETE_IDEMPOTENCE,
    required: true,
    description: 'uuid v4, identité de la requête.',
  })
  @ApiResponse({ status: 201, type: EnveloppeDocumentVenteDto })
  @ApiReponseProbleme(400, 'Corps invalide ou Idempotency-Key manquante/mal formée.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Client, véhicule ou document source introuvable pour ce tenant.')
  @ApiReponseProbleme(
    409,
    'DOCUMENT_SOURCE_DEJA_TRANSFORME, DOCUMENT_TRANSITION_INTERDITE ou IDEMPOTENCE_CONFLIT.',
  )
  async creer(
    @CorpsZod(schemaCreationDocumentVente, {
      exemple: {
        typeDocument: 'facture',
        siteId: '2f6c9e1a-8b3d-4e7a-9c2b-1a5d6e8f9012',
        clientId: '4b8e1f3c-0d5f-4a9c-1e4d-3c7f80a11234',
        devise: 'CHF',
        lignes: [
          {
            type: 'forfait',
            designation: 'Forfait diagnostic',
            quantiteMillieme: 1000,
            prixUnitaireTtcCentimes: 7000,
            tauxTvaPourmille: 81,
            datePrestation: '2026-07-29',
          },
        ],
      },
    })
    entree: EntreeCreationDocumentVente,
    @Headers(EN_TETE_IDEMPOTENCE.toLowerCase()) cleIdempotence: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<unknown> {
    const ctx = this.contexte.contexteTenant();
    const principal = this.contexte.exigerPrincipal();
    const resultat = await this.service.creer(ctx, principal, entree, cleIdempotence ?? '');

    res.status(resultat.reponse.statutHttp);
    if (resultat.rejoue) res.setHeader('Idempotency-Rejeu', 'true');
    res.setHeader('ETag', etagDocumentVente(new Date(resultat.reponse.corps.donnees.modifieLe)));
    return resultat.reponse.corps;
  }

  @Get(':id')
  @ExigerDroit('facturation.document.lire')
  @ApiOperation({ summary: "Fiche complète d'un document de vente." })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ReponseDocumentVenteDto })
  @ApiReponseProbleme(400, 'Identifiant mal formé.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Document introuvable pour ce tenant.')
  async parId(
    @Param('id', new PipeZod(schemaIdentifiant)) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ReponseDocumentVente> {
    const ctx = this.contexte.contexteTenant();
    const principal = this.contexte.exigerPrincipal();
    const document = await this.service.obtenirComplet(ctx, principal, id);
    res.setHeader('ETag', etagDocumentVente(new Date(document.modifieLe)));
    return document;
  }

  @Patch(':id')
  @ExigerDroit('facturation.document.modifier')
  @ApiOperation({
    summary: "Modification de l'en-tête d'un brouillon (MD-19).",
    description: '`If-Match: W/"<version>"` OBLIGATOIRE. `statut` reste en lecture seule.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiHeader({
    name: 'If-Match',
    required: true,
    description: 'W/"<version>" lu sur la dernière lecture (ETag).',
  })
  @ApiOkResponse({ type: EnveloppeDocumentVenteDto })
  @ApiReponseProbleme(400, 'Corps invalide ou If-Match manquant/mal formé.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Document introuvable pour ce tenant.')
  @ApiReponseProbleme(409, 'CONFLIT (version périmée) ou DOCUMENT_VERROUILLE (document émis).')
  async modifier(
    @Param('id', new PipeZod(schemaIdentifiant)) id: string,
    @Headers('if-match') ifMatch: string | undefined,
    @CorpsZod(schemaModificationDocumentVente, { exemple: { remiseGlobalePourmille: 50 } })
    entree: EntreeModificationDocumentVente,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ctx = this.contexte.contexteTenant();
    const principal = this.contexte.exigerPrincipal();
    const versionAttendue = exigerVersionIfMatch(ifMatch);

    // Concurrence optimiste vérifiée ICI (avant l'écriture, sous verrou de ligne côté service) —
    // voir `document-vente.etag.ts` pour la substitution `version = modifie_le` epoch ms.
    const lecture = await this.service.obtenirComplet(ctx, principal, id);
    if (lecture.version !== versionAttendue) {
      throw new ErreurMetier(
        'CONFLIT',
        'La version du document a changé depuis la dernière lecture.',
        {
          detail: `version_attendue=${String(versionAttendue)};version_actuelle=${String(lecture.version)}`,
          actionsProposees: [{ code: 'RAFRAICHIR' }],
        },
      );
    }

    const { donnees, avertissements } = await this.service.modifier(ctx, principal, id, entree);
    res.setHeader('ETag', etagDocumentVente(new Date(donnees.modifieLe)));
    return { donnees, avertissements };
  }

  @Post(':id/lignes')
  @HttpCode(HttpStatus.CREATED)
  @ExigerDroit('facturation.document.modifier')
  @ApiOperation({ summary: "Ajout d'une ligne sur un brouillon (MD-21)." })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 201, type: EnveloppeDocumentVenteDto })
  @ApiReponseProbleme(400, 'Corps invalide.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Document introuvable pour ce tenant.')
  @ApiReponseProbleme(409, 'DOCUMENT_VERROUILLE (document émis).')
  async ajouterLigne(
    @Param('id', new PipeZod(schemaIdentifiant)) id: string,
    @CorpsZod(schemaCreationLigneDocument, {
      exemple: {
        type: 'piece',
        designation: 'Plaquettes de frein avant',
        quantiteMillieme: 1000,
        prixUnitaireTtcCentimes: 8900,
        tauxTvaPourmille: 81,
        datePrestation: '2026-07-29',
      },
    })
    entree: EntreeCreationLigneDocument,
  ) {
    const ctx = this.contexte.contexteTenant();
    const principal = this.contexte.exigerPrincipal();
    return this.service.ajouterLigne(ctx, principal, id, entree);
  }

  @Patch(':id/lignes/:ligneId')
  @ExigerDroit('facturation.document.modifier')
  @ApiOperation({ summary: "Modification d'une ligne sur un brouillon (MD-21)." })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'ligneId', format: 'uuid' })
  @ApiOkResponse({ type: EnveloppeDocumentVenteDto })
  @ApiReponseProbleme(400, 'Corps invalide.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Document ou ligne introuvable pour ce tenant.')
  @ApiReponseProbleme(409, 'DOCUMENT_VERROUILLE (document émis).')
  async modifierLigne(
    @Param('id', new PipeZod(schemaIdentifiant)) id: string,
    @Param('ligneId', new PipeZod(schemaIdentifiant)) ligneId: string,
    @CorpsZod(schemaModificationLigneDocument, { exemple: { prixUnitaireTtcCentimes: 9500 } })
    entree: EntreeModificationLigneDocument,
  ) {
    const ctx = this.contexte.contexteTenant();
    const principal = this.contexte.exigerPrincipal();
    return this.service.modifierLigne(ctx, principal, id, ligneId, entree);
  }

  @Delete(':id/lignes/:ligneId')
  @ExigerDroit('facturation.document.modifier')
  @ApiOperation({ summary: "Suppression d'une ligne sur un brouillon (MD-21, MD-19)." })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'ligneId', format: 'uuid' })
  @ApiOkResponse({ type: EnveloppeDocumentVenteDto })
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Document ou ligne introuvable pour ce tenant.')
  @ApiReponseProbleme(409, 'DOCUMENT_VERROUILLE (document émis).')
  async supprimerLigne(
    @Param('id', new PipeZod(schemaIdentifiant)) id: string,
    @Param('ligneId', new PipeZod(schemaIdentifiant)) ligneId: string,
  ) {
    const ctx = this.contexte.contexteTenant();
    const principal = this.contexte.exigerPrincipal();
    return this.service.supprimerLigne(ctx, principal, id, ligneId);
  }
}
