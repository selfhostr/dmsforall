/**
 * `GET /documents-vente/{id}/pdf` — bulletin QR-facture au format PDF.
 *
 * `RF-116` : la charge QR contient le montant en clair, donc un rôle sans droit aux montants ne
 * doit jamais pouvoir obtenir ce PDF — contrôle par un vrai `@ExigerDroit(...)` sur la route, pas
 * un masquage d'affichage. `'facturation.document.imprimer'` (`auth/matrice-droits.ts`) est
 * accordée EXACTEMENT aux rôles pour lesquels `roleVoitLesMontants()`
 * (`facturation/documents/mappeurs.ts`) est vrai — direction, comptable, vendeur, réceptionnaire,
 * chef_atelier, magasinier ; PAS technicien, PAS admin. Le test dédié dans `matrice-droits.spec.ts`
 * compare `MATRICE_DROITS[role]` à `roleVoitLesMontants(role)` rôle par rôle (pas une liste
 * recopiée) : le droit d'imprimer ne peut pas dériver du droit d'émettre, et inversement.
 */

import { Controller, Get, Param, Res, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiParam, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { schemaIdentifiant } from '@dfa/shared';

import { ServiceContexteRequete } from '../../common/contexte';
import { ExigerDroit, GardeDroit } from '../../common/droits';
import { ApiReponseProbleme } from '../../common/erreurs';
import { PipeZod } from '../../common/validation';

import { ServiceImpressionFacture } from './service-impression-facture';

@ApiTags('Documents de vente')
@ApiCookieAuth()
@Controller({ path: 'documents-vente', version: '1' })
@UseGuards(GardeDroit)
export class ImpressionFactureController {
  constructor(
    private readonly service: ServiceImpressionFacture,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @Get(':id/pdf')
  @ExigerDroit('facturation.document.imprimer')
  @ApiOperation({
    summary: 'Bulletin QR-facture au format PDF (facture émise uniquement).',
    description:
      'Génération paresseuse au premier appel, mise en cache (`document_vente.pdfCle`/`pdfSha256`), ' +
      'JAMAIS régénérée ensuite — une facture émise est immuable, son PDF aussi (DI-3). ' +
      '`RF-116` : la charge QR contient le montant en clair — droit dédié, distinct de `facturation.document.lire`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiProduces('application/pdf')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Document introuvable pour ce tenant.')
  @ApiReponseProbleme(409, "DOCUMENT_PDF_INDISPONIBLE — le document n'est pas une facture émise.")
  async telechargerPdf(
    @Param('id', new PipeZod(schemaIdentifiant)) id: string,
    @Res() res: Response,
  ): Promise<void> {
    const ctx = this.contexte.contexteTenant();
    const principal = this.contexte.exigerPrincipal();

    const { buffer, sha256, nomFichier } = await this.service.obtenirPdf(ctx, principal, id);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${nomFichier}"`);
    res.setHeader('Content-Length', String(buffer.length));
    res.setHeader('ETag', `"${sha256}"`);
    res.status(200).send(buffer);
  }
}
