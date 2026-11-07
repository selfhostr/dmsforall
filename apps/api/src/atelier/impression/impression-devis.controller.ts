/**
 * `GET /ordres-reparation/{orId}/devis-complementaires/{devisId}/pdf` — devis complémentaire au
 * format PDF : le document à montrer ou transmettre au client quand les travaux découverts
 * dépassent le plafond de l'OR (RM-79 → RM-86), sur le modèle EXACT de
 * `impression-or.controller.ts` (conventions REST, gestion d'erreur) — mêmes en-têtes de réponse,
 * même doctrine `problem+json`.
 *
 * Droit et deuxième ligne de défense : voir la tête de fichier de `service-impression-devis.ts`.
 * `@ExigerDroit('atelier.or.lire')` est nécessaire mais PAS suffisant ici — `ServiceImpressionDevis.
 * obtenirPdf` refuse en plus `DROIT_INSUFFISANT` (403) pour tout rôle sans accès aux montants
 * (`technicien`, `poste_atelier`), un devis étant un document d'argent.
 */

import { Controller, Get, Param, Res, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiParam, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { schemaIdentifiant } from '@dfa/shared';

import { ServiceContexteRequete } from '../../common/contexte';
import { ExigerDroit, GardeDroit } from '../../common/droits';
import { ApiReponseProbleme } from '../../common/erreurs';
import { PipeZod } from '../../common/validation';

import { ServiceImpressionDevis } from './service-impression-devis';
import { ExigerModule } from '../../common/droits/garde-module';

@ApiTags('Ordres de réparation — devis complémentaires')
@ApiCookieAuth()
@ExigerModule('atelier')
@Controller({ path: 'ordres-reparation', version: '1' })
@UseGuards(GardeDroit)
export class ImpressionDevisController {
  constructor(
    private readonly service: ServiceImpressionDevis,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @Get(':orId/devis-complementaires/:devisId/pdf')
  @ExigerDroit('atelier.or.lire')
  @ApiOperation({
    summary: 'Devis complémentaire au format PDF, à montrer ou transmettre au client.',
    description:
      'RÉGÉNÉRÉ À CHAQUE APPEL, sans cache : un devis en attente peut recevoir une réponse entre ' +
      "deux impressions — le statut affiché reflète toujours l'état courant. Imprimable quel que " +
      'soit le statut du devis (en attente ou déjà répondu). Porte un montant TTC en clair : ' +
      "refusé (`DROIT_INSUFFISANT`) pour tout rôle sans accès aux montants de l'atelier " +
      "(`technicien`, `poste_atelier`), même si ce rôle peut lire l'ordre de réparation lui-même.",
  })
  @ApiParam({ name: 'orId', format: 'uuid' })
  @ApiParam({ name: 'devisId', format: 'uuid' })
  @ApiProduces('application/pdf')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(
    403,
    "Droit insuffisant (rôle sans atelier.or.lire), ou rôle sans accès aux montants de l'atelier.",
  )
  @ApiReponseProbleme(
    404,
    'Ordre de réparation ou devis complémentaire introuvable pour ce tenant.',
  )
  async telechargerPdf(
    @Param('orId', new PipeZod(schemaIdentifiant)) orId: string,
    @Param('devisId', new PipeZod(schemaIdentifiant)) devisId: string,
    @Res() res: Response,
  ): Promise<void> {
    const ctx = this.contexte.contexteTenant();
    const principal = this.contexte.exigerPrincipal();

    const { buffer, nomFichier } = await this.service.obtenirPdf(ctx, principal, orId, devisId);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${nomFichier}"`);
    res.setHeader('Content-Length', String(buffer.length));
    res.status(200).send(buffer);
  }
}
