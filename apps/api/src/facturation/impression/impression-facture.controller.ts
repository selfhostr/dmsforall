/**
 * `GET /documents-vente/{id}/pdf` — bulletin QR-facture au format PDF.
 * `POST /documents-vente/{id}/envoyer-courriel` — envoie la même facture, PDF en pièce jointe, à
 * l'adresse courriel de la fiche client (voir `service-envoi-facture-courriel.ts` pour la
 * doctrine complète : `PrincipalAuthentifie` réel, RF-116 respecté, PDF généré paresseusement si
 * besoin — CONTRAIREMENT au job de relances, `relances/service-relances-facture.ts`, qui n'a pas
 * de principal et se contente de LIRE un PDF déjà en cache).
 *
 * `RF-116` : la charge QR contient le montant en clair, donc un rôle sans droit aux montants ne
 * doit jamais pouvoir obtenir ce PDF — contrôle par un vrai `@ExigerDroit(...)` sur la route, pas
 * un masquage d'affichage. `'facturation.document.imprimer'` (`auth/matrice-droits.ts`) est
 * accordée EXACTEMENT aux rôles pour lesquels `roleVoitLesMontants()`
 * (`facturation/documents/mappeurs.ts`) est vrai — direction, comptable, vendeur, réceptionnaire,
 * chef_atelier, magasinier ; PAS technicien, PAS admin. Le test dédié dans `matrice-droits.spec.ts`
 * compare `MATRICE_DROITS[role]` à `roleVoitLesMontants(role)` rôle par rôle (pas une liste
 * recopiée) : le droit d'imprimer ne peut pas dériver du droit d'émettre, et inversement. MÊME
 * droit réutilisé pour l'envoi par courriel : envoyer la facture est un geste de CONSULTATION du
 * même contenu (montants compris), pas un second engagement distinct.
 */

import { Controller, Get, HttpCode, HttpStatus, Param, Post, Res, UseGuards } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { schemaIdentifiant } from '@dfa/shared';

import { ServiceContexteRequete } from '../../common/contexte';
import { ExigerDroit, GardeDroit } from '../../common/droits';
import { ApiReponseProbleme } from '../../common/erreurs';
import { PipeZod } from '../../common/validation';

import { ReponseEnvoiFactureCourrielDto } from './dto/envoi-facture-courriel.dto';
import { ServiceEnvoiFactureCourriel } from './service-envoi-facture-courriel';
import { ServiceImpressionFacture } from './service-impression-facture';

@ApiTags('Documents de vente')
@ApiCookieAuth()
@Controller({ path: 'documents-vente', version: '1' })
@UseGuards(GardeDroit)
export class ImpressionFactureController {
  constructor(
    private readonly service: ServiceImpressionFacture,
    private readonly serviceEnvoiCourriel: ServiceEnvoiFactureCourriel,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @Get(':id/pdf')
  @ExigerDroit('facturation.document.imprimer')
  @ApiOperation({
    summary: 'PDF d’une facture émise (avec bulletin QR) ou d’un devis (sans QR).',
    description:
      'Facture émise : génération paresseuse au premier appel, mise en cache (`document_vente.pdfCle`/`pdfSha256`), ' +
      'Un DEVIS (tout statut, brouillon compris) produit un PDF « Devis » sans bulletin QR, ' +
      'valable 30 jours après sa date, rendu à chaque appel et non mis en cache. ' +
      'JAMAIS régénérée ensuite — une facture émise est immuable, son PDF aussi (DI-3). ' +
      '`RF-116` : la charge QR contient le montant en clair — droit dédié, distinct de `facturation.document.lire`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiProduces('application/pdf')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Document introuvable pour ce tenant.')
  @ApiReponseProbleme(
    409,
    "DOCUMENT_PDF_INDISPONIBLE — le document n'est ni un devis ni une facture émise.",
  )
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

  @Post(':id/envoyer-courriel')
  @ExigerDroit('facturation.document.imprimer')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Envoie la facture (PDF en pièce jointe) à l’adresse courriel de la fiche client.',
    description:
      "Réutilise `obtenirPdf` (génération paresseuse si le PDF n'est pas encore en cache, DI-3) " +
      '— la facture part TOUJOURS avec son PDF, jamais un envoi amputé. Refuse (409, ' +
      '`FACTURE_DESTINATAIRE_COURRIEL_ABSENT`) si la fiche client ne porte aucune adresse ' +
      'courriel — rien ne le garantit aujourd’hui dans le modèle de données.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ReponseEnvoiFactureCourrielDto })
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Document introuvable pour ce tenant.')
  @ApiReponseProbleme(409, "DOCUMENT_PDF_INDISPONIBLE — le document n'est pas une facture émise.")
  @ApiReponseProbleme(
    409,
    'FACTURE_DESTINATAIRE_COURRIEL_ABSENT — la fiche client ne porte aucune adresse courriel.',
  )
  async envoyerParCourriel(
    @Param('id', new PipeZod(schemaIdentifiant)) id: string,
  ): Promise<ReponseEnvoiFactureCourrielDto> {
    const ctx = this.contexte.contexteTenant();
    const principal = this.contexte.exigerPrincipal();

    return this.serviceEnvoiCourriel.envoyer(ctx, principal, id);
  }
}
