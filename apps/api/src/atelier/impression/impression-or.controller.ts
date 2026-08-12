/**
 * `GET /ordres-reparation/{orId}/pdf` — feuille d'atelier au format PDF, destinée à être
 * accrochée au rétroviseur du véhicule (besoin métier : le mécanicien doit pouvoir imprimer l'OR
 * pour travailler dessus). Ce n'est PAS un document comptable — voir `generation-pdf-or.ts`.
 *
 * Droit : `'atelier.or.lire'`, le MÊME que `OrdreReparationController.parId`
 * (`GET /ordres-reparation/{orId}`, `ordre-reparation.controller.ts`) — imprimer la feuille
 * d'atelier est le même geste de gouvernance que consulter la fiche complète, pas un geste distinct.
 * Un droit dédié `atelier.or.imprimer` pourrait se justifier plus tard si l'impression devait un
 * jour être restreinte indépendamment de la lecture (ex. poste de comptoir sans imprimante) — signalé
 * dans le rapport de livraison, PAS créé ici : `auth/matrice-droits.ts` est hors du périmètre
 * d'écriture de cette tâche.
 */

import { Controller, Get, Param, Res, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiParam, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { schemaIdentifiant } from '@dfa/shared';

import { ServiceContexteRequete } from '../../common/contexte';
import { ExigerDroit, GardeDroit } from '../../common/droits';
import { ApiReponseProbleme } from '../../common/erreurs';
import { PipeZod } from '../../common/validation';

import { ServiceImpressionOr } from './service-impression-or';

@ApiTags('Ordres de réparation')
@ApiCookieAuth()
@Controller({ path: 'ordres-reparation', version: '1' })
@UseGuards(GardeDroit)
export class ImpressionOrController {
  constructor(
    private readonly service: ServiceImpressionOr,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @Get(':orId/pdf')
  @ExigerDroit('atelier.or.lire')
  @ApiOperation({
    summary: "Feuille d'atelier de l'ordre de réparation au format PDF (impression comptoir).",
    description:
      'RÉGÉNÉRÉE À CHAQUE APPEL, sans cache : contrairement au PDF de facture (immuable une fois ' +
      "émis), un OR est VIVANT — lignes, statut et restitution promise évoluent tant qu'il n'est " +
      'pas clôturé. Imprimable quel que soit le statut de l’OR — ce document sert à travailler sur ' +
      "le véhicule, pas à l'engager. Les colonnes de prix sont omises (jamais un zéro, jamais un " +
      'tiret) pour un rôle sans droit aux montants (`atelier/mappeurs.ts::roleVoitLesMontants`).',
  })
  @ApiParam({ name: 'orId', format: 'uuid' })
  @ApiProduces('application/pdf')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant (rôle sans atelier.or.lire).')
  @ApiReponseProbleme(404, 'Ordre de réparation introuvable pour ce tenant.')
  async telechargerPdf(
    @Param('orId', new PipeZod(schemaIdentifiant)) orId: string,
    @Res() res: Response,
  ): Promise<void> {
    const ctx = this.contexte.contexteTenant();
    const principal = this.contexte.exigerPrincipal();

    const { buffer, nomFichier } = await this.service.obtenirPdf(ctx, principal, orId);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${nomFichier}"`);
    res.setHeader('Content-Length', String(buffer.length));
    res.status(200).send(buffer);
  }
}
