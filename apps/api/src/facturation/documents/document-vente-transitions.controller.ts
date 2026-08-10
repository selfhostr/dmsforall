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
  schemaAccepterDevis,
  schemaAnnulerDocument,
  schemaCreationAvoir,
  schemaEmissionDocumentVente,
  schemaIdentifiant,
  schemaRefuserDocument,
  type EntreeAnnulerDocument,
  type EntreeCreationAvoir,
  type EntreeEmissionDocumentVente,
  type EntreeRefuserDocument,
} from '@dfa/shared';

import { ServiceContexteRequete } from '../../common/contexte';
import { CorpsZod } from '../../common/documentation';
import { ExigerDroit, GardeDroit } from '../../common/droits';
import { ApiReponseProbleme } from '../../common/erreurs';
import { PipeZod } from '../../common/validation';

import { etagDocumentVente } from './document-vente.etag';
import { EnveloppeDocumentDto, ReponseDocumentVenteDto } from './dto';
import { ServiceAvoir } from './service-avoir';
import { ServiceEmissionDocument } from './service-emission';

const EnveloppeDocumentVenteDto = EnveloppeDocumentDto(ReponseDocumentVenteDto, 'DocumentVente');

/**
 * `schemaEmissionDocumentVente`/`schemaAccepterDevis` (`@dfa/shared`) n'imposent AUCUN champ — seul
 * `confirmations` existe, et il est optionnel. Mais `z.object(...)` refuse `undefined` À LA RACINE
 * même quand toutes ses propriétés le sont : Express ne construit `req.body` QUE s'il reconnaît le
 * `Content-Type` de la requête, donc un appelant qui n'envoie AUCUN corps — notre propre front,
 * tout connecteur tiers, et le SEUL appel possible sur ces deux routes avant l'ajout de
 * `confirmations` — livre `undefined`, pas `{}`. Régression constatée : `POST .../emettre` et
 * `POST .../accepter` rendaient `400 VALIDATION_ECHOUEE` (« (racine) : expected object, received
 * undefined ») pour tout appelant existant, sur le point de non-retour de la chaîne documentaire —
 * rupture de compatibilité ascendante (règle non négociable du dépôt).
 *
 * `.optional()` rend le CORPS ENTIER facultatif : absent -> `entree === undefined`, transmis tel
 * quel aux services `ServiceEmissionDocument.emettre`/`.accepter`, dont le paramètre `entree`
 * porte déjà `= {}` en valeur par défaut (`service-emission.ts`) — un `undefined` explicite
 * déclenche ce défaut exactement comme un argument omis, comportement déjà couvert par
 * `service-emission-confirmations.spec.ts` (« appel à 4 arguments (entree absent) »). Corps
 * envoyé (`{}` ou `{ confirmations: [...] }`) continue de passer par la validation normale.
 */
const schemaEmissionDocumentVenteCorpsOptionnel = schemaEmissionDocumentVente.optional();
const schemaAccepterDevisCorpsOptionnel = schemaAccepterDevis.optional();

/**
 * Transitions de la chaîne documentaire — émission (`RF-5`, `RF-10`, `RF-22`→`RF-28`), acceptation/
 * refus/annulation, et création d'avoir (`RF-11`→`RF-18`). Découpage par sous-domaine, même
 * organisation que `atelier/ordre-reparation-transitions.controller.ts`.
 */
@ApiTags('Documents de vente — transitions')
@ApiCookieAuth()
@Controller({ path: 'documents-vente', version: '1' })
@UseGuards(GardeDroit)
export class DocumentVenteTransitionsController {
  constructor(
    private readonly emission: ServiceEmissionDocument,
    private readonly avoirs: ServiceAvoir,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @Post(':id/emettre')
  @HttpCode(HttpStatus.OK)
  @ExigerDroit('facturation.document.emettre')
  @ApiOperation({
    summary: 'Émission — le point de non-retour (RF-10, MD-18).',
    description:
      '`Idempotency-Key` obligatoire (RF-25) : rejouer la même requête avec la même clé rend le MÊME document, avec le MÊME numéro. ' +
      'Applicable aux quatre types de document (devis, bon de commande, facture, avoir).',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiHeader({
    name: EN_TETE_IDEMPOTENCE,
    required: true,
    description: 'uuid v4, identité de la requête.',
  })
  @ApiResponse({ status: 200, type: EnveloppeDocumentVenteDto })
  @ApiReponseProbleme(400, 'Idempotency-Key manquante/mal formée.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Document introuvable pour ce tenant.')
  @ApiReponseProbleme(
    409,
    'DOCUMENT_VERROUILLE (déjà émis/abandonné) ou DOCUMENT_PERIODE_CLOSE (MD-34).',
  )
  async emettre(
    @Param('id', new PipeZod(schemaIdentifiant)) id: string,
    @CorpsZod(schemaEmissionDocumentVenteCorpsOptionnel, { exemple: {} })
    entree: EntreeEmissionDocumentVente | undefined,
    @Headers(EN_TETE_IDEMPOTENCE.toLowerCase()) cleIdempotence: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<unknown> {
    const ctx = this.contexte.contexteTenant();
    const principal = this.contexte.exigerPrincipal();
    const resultat = await this.emission.emettre(ctx, principal, id, cleIdempotence ?? '', entree);

    res.status(resultat.reponse.statutHttp);
    if (resultat.rejoue) res.setHeader('Idempotency-Rejeu', 'true');
    res.setHeader('ETag', etagDocumentVente(new Date(resultat.reponse.corps.donnees.modifieLe)));
    return resultat.reponse.corps;
  }

  @Post(':id/accepter')
  @HttpCode(HttpStatus.OK)
  @ExigerDroit('facturation.document.transitionner')
  @ApiOperation({ summary: 'Acceptation — devis uniquement (devis.emis → accepte, terminal).' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: EnveloppeDocumentVenteDto })
  @ApiReponseProbleme(400, 'Type de document invalide (seul un devis peut être accepté).')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Document introuvable pour ce tenant.')
  @ApiReponseProbleme(409, 'DOCUMENT_TRANSITION_INTERDITE.')
  async accepter(
    @Param('id', new PipeZod(schemaIdentifiant)) id: string,
    @CorpsZod(schemaAccepterDevisCorpsOptionnel, { exemple: {} }) _entree: unknown,
  ) {
    const ctx = this.contexte.contexteTenant();
    const principal = this.contexte.exigerPrincipal();
    return this.emission.accepter(ctx, principal, id);
  }

  @Post(':id/refuser')
  @HttpCode(HttpStatus.OK)
  @ExigerDroit('facturation.document.transitionner')
  @ApiOperation({ summary: 'Refus — devis ou bon de commande.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: EnveloppeDocumentVenteDto })
  @ApiReponseProbleme(400, 'Type de document invalide.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Document introuvable pour ce tenant.')
  @ApiReponseProbleme(409, 'DOCUMENT_TRANSITION_INTERDITE.')
  async refuser(
    @Param('id', new PipeZod(schemaIdentifiant)) id: string,
    @CorpsZod(schemaRefuserDocument, { exemple: { motif: 'Le client a renoncé au devis.' } })
    entree: EntreeRefuserDocument,
  ) {
    const ctx = this.contexte.contexteTenant();
    const principal = this.contexte.exigerPrincipal();
    return this.emission.refuser(ctx, principal, id, entree);
  }

  @Post(':id/annuler')
  @HttpCode(HttpStatus.OK)
  @ExigerDroit('facturation.document.transitionner')
  @ApiOperation({ summary: 'Annulation — bon de commande uniquement, motif obligatoire.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: EnveloppeDocumentVenteDto })
  @ApiReponseProbleme(400, 'Corps invalide (motif manquant) ou type de document invalide.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Document introuvable pour ce tenant.')
  @ApiReponseProbleme(409, 'DOCUMENT_TRANSITION_INTERDITE.')
  async annuler(
    @Param('id', new PipeZod(schemaIdentifiant)) id: string,
    @CorpsZod(schemaAnnulerDocument, {
      exemple: { motif: 'Commande annulée par le client avant livraison.' },
    })
    entree: EntreeAnnulerDocument,
  ) {
    const ctx = this.contexte.contexteTenant();
    const principal = this.contexte.exigerPrincipal();
    return this.emission.annuler(ctx, principal, id, entree);
  }

  @Post(':factureId/avoirs')
  @HttpCode(HttpStatus.CREATED)
  @ExigerDroit('facturation.avoir.creer')
  @ApiOperation({
    summary: "Création d'un avoir (brouillon) créditant une facture émise (RF-11 → RF-18).",
    description:
      "`Idempotency-Key` obligatoire — c'est une création de document sensible. L'avoir naît en BROUILLON : il est émis séparément via `POST /documents-vente/{id}/emettre`, " +
      "qui est aussi le moment où un avoir `portee = 'total'` fait basculer la facture créditée à `annule_par_avoir` (RF-32).",
  })
  @ApiParam({ name: 'factureId', format: 'uuid' })
  @ApiHeader({
    name: EN_TETE_IDEMPOTENCE,
    required: true,
    description: 'uuid v4, identité de la requête.',
  })
  @ApiResponse({ status: 201, type: EnveloppeDocumentVenteDto })
  @ApiReponseProbleme(400, 'Corps invalide ou Idempotency-Key manquante/mal formée.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Facture ou ligne référencée introuvable pour ce tenant.')
  @ApiReponseProbleme(
    409,
    'DOCUMENT_TRANSITION_INTERDITE (facture non émise), AVOIR_MONTANT_EXCEDENTAIRE (MD-23) ou IDEMPOTENCE_CONFLIT.',
  )
  async creerAvoir(
    @Param('factureId', new PipeZod(schemaIdentifiant)) factureId: string,
    @CorpsZod(schemaCreationAvoir, { exemple: { portee: 'total', motif: 'erreur_adresse' } })
    entree: EntreeCreationAvoir,
    @Headers(EN_TETE_IDEMPOTENCE.toLowerCase()) cleIdempotence: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<unknown> {
    const ctx = this.contexte.contexteTenant();
    const principal = this.contexte.exigerPrincipal();
    const resultat = await this.avoirs.creer(
      ctx,
      principal,
      factureId,
      entree,
      cleIdempotence ?? '',
    );

    res.status(resultat.reponse.statutHttp);
    if (resultat.rejoue) res.setHeader('Idempotency-Rejeu', 'true');
    res.setHeader('ETag', etagDocumentVente(new Date(resultat.reponse.corps.donnees.modifieLe)));
    return resultat.reponse.corps;
  }
}
