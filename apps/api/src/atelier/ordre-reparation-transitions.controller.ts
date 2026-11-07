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
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import {
  EN_TETE_IDEMPOTENCE,
  schemaActionAnnuler,
  schemaActionCloturer,
  schemaActionDemarrer,
  schemaActionPasserEnControle,
  schemaActionReceptionner,
  schemaActionRefuserControle,
  schemaActionReprendreTravaux,
  schemaActionRestituer,
  schemaActionRouvrir,
  schemaActionTerminer,
  schemaActionValiderControle,
  schemaCreationRapideOrdreReparation,
  schemaFacturationOrdreReparation,
  schemaFacturerEtEncaisserOr,
  schemaIdentifiant,
  type EntreeActionAnnuler,
  type EntreeActionReceptionner,
  type EntreeActionRefuserControle,
  type EntreeActionReprendreTravaux,
  type EntreeActionRestituer,
  type EntreeActionRouvrir,
  type EntreeActionTerminer,
  type EntreeActionValiderControle,
  type EntreeCreationRapideOrdreReparation,
  type EntreeFacturationOrdreReparation,
  type EntreeFacturerEtEncaisserOr,
} from '@dfa/shared';

import { ServiceContexteRequete } from '../common/contexte';
import { CorpsZod } from '../common/documentation';
import { ExigerDroit, GardeDroit } from '../common/droits';
import { ApiReponseProbleme } from '../common/erreurs';
import { PipeZod } from '../common/validation';

import {
  EnveloppeOrDto,
  ReponseCreationRapideOrdreReparationDto,
  ReponseFacturationOrdreReparationDto,
  ReponseFacturerEtEncaisserOrDto,
  ReponseOrdreReparationDto,
} from './dto';
import { ServiceCreationRapideOr } from './service-creation-rapide-or';
import { ServiceFacturationEncaissementOr } from './service-facturation-encaissement-or';
import { ServiceFacturationOr } from './service-facturation-or';
import { ServiceTransitions } from './service-transitions';

const EnveloppeOrdreReparationDto = EnveloppeOrDto(
  ReponseOrdreReparationDto,
  'OrdreReparationTransition',
);
const EnveloppeFacturationOrDto = EnveloppeOrDto(
  ReponseFacturationOrdreReparationDto,
  'FacturationOr',
);
const EnveloppeCreationRapideOrDto = EnveloppeOrDto(
  ReponseCreationRapideOrdreReparationDto,
  'CreationRapideOr',
);
const EnveloppeFacturerEtEncaisserOrDto = EnveloppeOrDto(
  ReponseFacturerEtEncaisserOrDto,
  'FacturerEtEncaisserOr',
);

/**
 * Les 11 actions de transition de l'OR (§7.7, §5.1) : chacune porte son CORPS propre, son DROIT
 * propre et ses codes d'erreur propres — DÉCISION STRUCTURANTE du contrat, jamais un
 * `PATCH {"statut": ...}` générique (voir `packages/shared/src/contrats/atelier/ordre-reparation.ts`).
 * Toutes rendent le document OR COMPLET (§7.7), avec l'`ETag` de sa nouvelle version.
 *
 * `POST .../facturer` (`RF-81`) est un DOUZIÈME geste, posé ici plutôt que dans un contrôleur
 * dédié : même racine `ordres-reparation`, mais forme de réponse et statut HTTP différents (201,
 * `Idempotency-Key` obligatoire — création de document, pas transition de statut pure) — voir
 * `service-facturation-or.ts` pour la logique.
 */
@ApiTags('Ordres de réparation — transitions')
@ApiCookieAuth()
@Controller({ path: 'ordres-reparation', version: '1' })
@UseGuards(GardeDroit)
export class OrdreReparationTransitionsController {
  constructor(
    private readonly transitions: ServiceTransitions,
    private readonly facturation: ServiceFacturationOr,
    private readonly facturationEncaissement: ServiceFacturationEncaissementOr,
    private readonly creationRapide: ServiceCreationRapideOr,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @Post(':orId/receptionner')
  @HttpCode(HttpStatus.OK)
  @ExigerDroit('atelier.or.receptionner')
  @ApiOperation({
    summary: 'T-03 `planifie -> ouvert` : réception du véhicule, kilométrage d’entrée (RM-51).',
  })
  @ApiParam({ name: 'orId', format: 'uuid' })
  @ApiOkResponse({ type: EnveloppeOrdreReparationDto })
  @ApiReponseProbleme(400, 'Corps invalide.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Ordre de réparation introuvable pour ce tenant.')
  @ApiReponseProbleme(409, 'OR_TRANSITION_INTERDITE ou VEHICULE_KILOMETRAGE_REGRESSIF.')
  async receptionner(
    @Param('orId', new PipeZod(schemaIdentifiant)) orId: string,
    @CorpsZod(schemaActionReceptionner, {
      exemple: { kilometrageEntree: 84_500, unite: 'km', signatureDifferee: false },
    })
    entree: EntreeActionReceptionner,
  ) {
    const ctx = this.contexte.contexteTenant();
    const principal = this.contexte.exigerPrincipal();
    return this.transitions.receptionner(ctx, principal, orId, entree);
  }

  @Post(':orId/demarrer')
  @HttpCode(HttpStatus.OK)
  @ExigerDroit('atelier.or.demarrer')
  @ApiOperation({
    summary:
      'T-04 `ouvert -> en_cours` : démarrage des travaux (I-07 : réception requise au préalable).',
  })
  @ApiParam({ name: 'orId', format: 'uuid' })
  @ApiOkResponse({ type: EnveloppeOrdreReparationDto })
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Ordre de réparation introuvable pour ce tenant.')
  @ApiReponseProbleme(409, 'OR_TRANSITION_INTERDITE ou OR_RECEPTION_REQUISE.')
  async demarrer(
    @Param('orId', new PipeZod(schemaIdentifiant)) orId: string,
    @CorpsZod(schemaActionDemarrer, { exemple: {} }) _entree: unknown,
  ) {
    const ctx = this.contexte.contexteTenant();
    const principal = this.contexte.exigerPrincipal();
    return this.transitions.demarrer(ctx, principal, orId);
  }

  @Post(':orId/reprendre-travaux')
  @HttpCode(HttpStatus.OK)
  @ExigerDroit('atelier.or.modifier')
  @ApiOperation({
    summary:
      'T-06/T-08/T-10 : lève les blocages sur tout ou partie des lignes (A-03, pas une transition de statut).',
  })
  @ApiParam({ name: 'orId', format: 'uuid' })
  @ApiOkResponse({ type: EnveloppeOrdreReparationDto })
  @ApiReponseProbleme(400, 'Corps invalide.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Ordre de réparation introuvable pour ce tenant.')
  async reprendreTravaux(
    @Param('orId', new PipeZod(schemaIdentifiant)) orId: string,
    @CorpsZod(schemaActionReprendreTravaux, {
      exemple: {
        ligneIds: ['5a1c9e2e-2f0a-4b3a-9c1a-8e6f2d4b7a10'],
        motif: 'Pièce reçue, travaux repris.',
      },
    })
    entree: EntreeActionReprendreTravaux,
  ) {
    const ctx = this.contexte.contexteTenant();
    const principal = this.contexte.exigerPrincipal();
    return this.transitions.reprendreTravaux(ctx, principal, orId, entree);
  }

  @Post(':orId/passer-en-controle')
  @HttpCode(HttpStatus.OK)
  @ExigerDroit('atelier.or.passer_en_controle')
  @ApiOperation({
    summary:
      'T-11 `{ouvert,en_cours} -> controle` (I-08 : lignes à valider ; I-09 : pointage ouvert).',
  })
  @ApiParam({ name: 'orId', format: 'uuid' })
  @ApiOkResponse({ type: EnveloppeOrdreReparationDto })
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Ordre de réparation introuvable pour ce tenant.')
  @ApiReponseProbleme(409, 'OR_TRANSITION_INTERDITE, OR_LIGNES_A_VALIDER ou OR_POINTAGE_OUVERT.')
  async passerEnControle(
    @Param('orId', new PipeZod(schemaIdentifiant)) orId: string,
    @CorpsZod(schemaActionPasserEnControle, { exemple: {} }) _entree: unknown,
  ) {
    const ctx = this.contexte.contexteTenant();
    const principal = this.contexte.exigerPrincipal();
    return this.transitions.passerEnControle(ctx, principal, orId);
  }

  @Post(':orId/refuser-controle')
  @HttpCode(HttpStatus.OK)
  @ExigerDroit('atelier.or.controler')
  @ApiOperation({
    summary: 'T-12 `controle -> en_cours` : contrôle qualité non conforme, motif obligatoire.',
  })
  @ApiParam({ name: 'orId', format: 'uuid' })
  @ApiOkResponse({ type: EnveloppeOrdreReparationDto })
  @ApiReponseProbleme(400, 'Motif manquant.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Ordre de réparation introuvable pour ce tenant.')
  @ApiReponseProbleme(409, 'OR_TRANSITION_INTERDITE.')
  async refuserControle(
    @Param('orId', new PipeZod(schemaIdentifiant)) orId: string,
    @CorpsZod(schemaActionRefuserControle, {
      exemple: { motif: 'Fuite d’huile constatée au contrôle final, retour en atelier.' },
    })
    entree: EntreeActionRefuserControle,
  ) {
    const ctx = this.contexte.contexteTenant();
    const principal = this.contexte.exigerPrincipal();
    return this.transitions.refuserControle(ctx, principal, orId, entree);
  }

  @Post(':orId/valider-controle')
  @HttpCode(HttpStatus.OK)
  @ExigerDroit('atelier.or.controler')
  @ApiOperation({
    summary:
      'T-13 `controle -> termine` (I-09 : un contrôle qualité ne clôt pas un pointage ouvert).',
  })
  @ApiParam({ name: 'orId', format: 'uuid' })
  @ApiOkResponse({ type: EnveloppeOrdreReparationDto })
  @ApiReponseProbleme(400, 'Corps invalide.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Ordre de réparation introuvable pour ce tenant.')
  @ApiReponseProbleme(409, 'OR_TRANSITION_INTERDITE ou OR_POINTAGE_OUVERT.')
  async validerControle(
    @Param('orId', new PipeZod(schemaIdentifiant)) orId: string,
    @CorpsZod(schemaActionValiderControle, {
      exemple: {
        controleurId: '6c9e2d4b-7a10-4e2e-8f0a-1c9e2e2f0a4b',
        pointsControles: [
          { code: 'freinage', conforme: true },
          { code: 'eclairage', conforme: true },
          { code: 'niveaux', conforme: true },
        ],
      },
    })
    entree: EntreeActionValiderControle,
  ) {
    const ctx = this.contexte.contexteTenant();
    const principal = this.contexte.exigerPrincipal();
    return this.transitions.validerControle(ctx, principal, orId, entree);
  }

  @Post(':orId/terminer')
  @HttpCode(HttpStatus.OK)
  @ExigerDroit('atelier.or.terminer')
  @ApiOperation({
    summary:
      'T-14 `{ouvert,en_cours} -> termine` — REFUSÉE si le contrôle qualité est obligatoire pour ce garage (P-08).',
    description:
      'Gardes I-08 (lignes à valider), I-09 (pointage ouvert), I-10 (lignes validées non réalisées), RM-14 (PO client).',
  })
  @ApiParam({ name: 'orId', format: 'uuid' })
  @ApiOkResponse({ type: EnveloppeOrdreReparationDto })
  @ApiReponseProbleme(400, 'Corps invalide.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Ordre de réparation introuvable pour ce tenant.')
  @ApiReponseProbleme(
    409,
    'OR_TRANSITION_INTERDITE, OR_LIGNES_A_VALIDER, OR_POINTAGE_OUVERT, OR_LIGNE_NON_REALISEE ou OR_PO_MANQUANT.',
  )
  async terminer(
    @Param('orId', new PipeZod(schemaIdentifiant)) orId: string,
    @CorpsZod(schemaActionTerminer, { exemple: { kilometrageSortie: 84_560, unite: 'km' } })
    entree: EntreeActionTerminer,
  ) {
    const ctx = this.contexte.contexteTenant();
    const principal = this.contexte.exigerPrincipal();
    return this.transitions.terminer(ctx, principal, orId, entree);
  }

  @Post(':orId/rouvrir')
  @HttpCode(HttpStatus.OK)
  @ExigerDroit('atelier.or.rouvrir')
  @ApiOperation({
    summary: 'T-15 `termine -> en_cours` : réouverture avant facturation, motif obligatoire.',
    description:
      'Depuis `facture`, la base rejette (I-02) et propose `CREER_OR_RETOUCHE` — jamais une réouverture directe.',
  })
  @ApiParam({ name: 'orId', format: 'uuid' })
  @ApiOkResponse({ type: EnveloppeOrdreReparationDto })
  @ApiReponseProbleme(400, 'Motif manquant.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Ordre de réparation introuvable pour ce tenant.')
  @ApiReponseProbleme(409, 'OR_TRANSITION_INTERDITE.')
  async rouvrir(
    @Param('orId', new PipeZod(schemaIdentifiant)) orId: string,
    @CorpsZod(schemaActionRouvrir, {
      exemple: { motif: 'Le client signale que le bruit persiste après restitution.' },
    })
    entree: EntreeActionRouvrir,
  ) {
    const ctx = this.contexte.contexteTenant();
    const principal = this.contexte.exigerPrincipal();
    return this.transitions.rouvrir(ctx, principal, orId, entree);
  }

  @Post(':orId/restituer')
  @HttpCode(HttpStatus.OK)
  @ExigerDroit('atelier.or.restituer')
  @ApiOperation({
    summary:
      'T-17/T-18 `{facture,termine} -> restitue` — réserve de sécurité obligatoire si une ligne de sécurité est refusée (§6.12).',
  })
  @ApiParam({ name: 'orId', format: 'uuid' })
  @ApiOkResponse({ type: EnveloppeOrdreReparationDto })
  @ApiReponseProbleme(400, 'Corps invalide.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Ordre de réparation introuvable pour ce tenant.')
  @ApiReponseProbleme(409, 'OR_TRANSITION_INTERDITE ou OR_RESERVE_SECURITE_REQUISE.')
  async restituer(
    @Param('orId', new PipeZod(schemaIdentifiant)) orId: string,
    @CorpsZod(schemaActionRestituer, {
      exemple: {
        kilometrageSortie: 84_560,
        unite: 'km',
        piecesRestituees: ['5a1c9e2e-2f0a-4b3a-9c1a-8e6f2d4b7a10'],
        paiementRecu: true,
      },
    })
    entree: EntreeActionRestituer,
  ) {
    const ctx = this.contexte.contexteTenant();
    const principal = this.contexte.exigerPrincipal();
    return this.transitions.restituer(ctx, principal, orId, entree);
  }

  @Post(':orId/cloturer')
  @HttpCode(HttpStatus.OK)
  @ExigerDroit('atelier.or.cloturer')
  @ApiOperation({ summary: 'T-19 `restitue -> cloture` : plus rien en suspens.' })
  @ApiParam({ name: 'orId', format: 'uuid' })
  @ApiOkResponse({ type: EnveloppeOrdreReparationDto })
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Ordre de réparation introuvable pour ce tenant.')
  @ApiReponseProbleme(409, 'OR_TRANSITION_INTERDITE.')
  async cloturer(
    @Param('orId', new PipeZod(schemaIdentifiant)) orId: string,
    @CorpsZod(schemaActionCloturer, { exemple: {} }) _entree: unknown,
  ) {
    const ctx = this.contexte.contexteTenant();
    const principal = this.contexte.exigerPrincipal();
    return this.transitions.cloturer(ctx, principal, orId);
  }

  @Post(':orId/annuler')
  @HttpCode(HttpStatus.OK)
  @ExigerDroit('atelier.or.annuler')
  @ApiOperation({
    summary: 'T-20 `{planifie,ouvert} -> annule` : motif obligatoire (RM-62).',
    description:
      'Refusée s’il existe des pointages, des pièces engagées ou une facture (CT-25, CT-26).',
  })
  @ApiParam({ name: 'orId', format: 'uuid' })
  @ApiOkResponse({ type: EnveloppeOrdreReparationDto })
  @ApiReponseProbleme(400, 'Motif manquant.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Ordre de réparation introuvable pour ce tenant.')
  @ApiReponseProbleme(409, 'OR_TRANSITION_INTERDITE ou OR_ANNULATION_IMPOSSIBLE.')
  async annuler(
    @Param('orId', new PipeZod(schemaIdentifiant)) orId: string,
    @CorpsZod(schemaActionAnnuler, {
      exemple: { motif: 'Le client renonce, véhicule repris par un tiers.' },
    })
    entree: EntreeActionAnnuler,
  ) {
    const ctx = this.contexte.contexteTenant();
    const principal = this.contexte.exigerPrincipal();
    return this.transitions.annuler(ctx, principal, orId, entree);
  }

  @Post(':orId/facturer')
  @HttpCode(HttpStatus.CREATED)
  @ExigerDroit('facturation.document.creer')
  @ApiOperation({
    summary:
      "RF-81 : transforme les lignes `realisee` d'un OR `termine` en brouillon(s) de facture, un par groupe payeur choisi.",
    description:
      "Sélection par GROUPE PAYEUR `(payeur, payeurClientId)` (RF-87, MD-62), jamais ligne par ligne. Rejouable tant que l'OR reste " +
      "`termine` et qu'il reste un groupe facturable (RF-83/RF-84, facturation partielle assumée) : `ordreReparation.statut` ne passe " +
      "à `facture` que lorsque cet appel traite le DERNIER groupe encore facturable. Ne crée que des BROUILLONS — l'émission reste " +
      '`POST /documents-vente/{id}/emettre`.',
  })
  @ApiParam({ name: 'orId', format: 'uuid' })
  @ApiHeader({
    name: EN_TETE_IDEMPOTENCE,
    required: true,
    description:
      'uuid v4 — porte sur CET appel (ce sous-ensemble de groupes, ce corps exact), pas sur l’historique de facturation de l’OR.',
  })
  @ApiResponse({ status: 201, type: EnveloppeFacturationOrDto })
  @ApiReponseProbleme(
    400,
    'Corps invalide (groupe dupliqué, payeurClientId incohérent, Idempotency-Key manquante/mal formée).',
  )
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(
    404,
    'Ordre de réparation, client destinataire ou tiers payeur introuvable pour ce tenant.',
  )
  @ApiReponseProbleme(
    409,
    'OR_TRANSITION_INTERDITE, FACTURATION_LIGNES_INDECISES, OR_FACTURATION_AUCUNE_LIGNE, CONFIRMATION_REQUISE ou IDEMPOTENCE_CONFLIT.',
  )
  async facturer(
    @Param('orId', new PipeZod(schemaIdentifiant)) orId: string,
    @CorpsZod(schemaFacturationOrdreReparation, {
      exemple: { groupes: [{ payeur: 'client' }] },
    })
    entree: EntreeFacturationOrdreReparation,
    @Headers(EN_TETE_IDEMPOTENCE.toLowerCase()) cleIdempotence: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<unknown> {
    const ctx = this.contexte.contexteTenant();
    const principal = this.contexte.exigerPrincipal();
    const resultat = await this.facturation.facturer(
      ctx,
      principal,
      orId,
      entree,
      cleIdempotence ?? '',
    );

    res.status(resultat.reponse.statutHttp);
    if (resultat.rejoue) res.setHeader('Idempotency-Rejeu', 'true');
    return resultat.reponse.corps;
  }

  @Post(':orId/facturer-et-encaisser')
  @HttpCode(HttpStatus.CREATED)
  @ExigerDroit('facturation.document.creer')
  @ApiOperation({
    summary:
      'Comptoir en un appel : crée la facture du groupe client, l’ÉMET, puis encaisse son solde si `paiement` est fourni.',
    description:
      'Même logique que `POST .../facturer` (groupe `client`) suivie de l’émission, dans UNE transaction. ' +
      'L’encaissement (`especes`, `carte` ou `twint`, montant par défaut = solde) s’exécute dans un savepoint : ' +
      's’il échoue, la facture reste émise et la réponse porte l’avertissement `ENCAISSEMENT_ECHOUE` (sans `paiement`). ' +
      'Arrondi 5 ct espèces seulement, en faveur du client (1 ou 2 ct), uniquement si le solde exact est encaissé. ' +
      'Droits : `facturation.document.creer` + droit d’émettre une facture + `facturation.paiement.creer` si `paiement` est fourni.',
  })
  @ApiParam({ name: 'orId', format: 'uuid' })
  @ApiHeader({
    name: EN_TETE_IDEMPOTENCE,
    required: true,
    description:
      'uuid v4 — un rejeu à l’identique rend la même facture (en-tête `Idempotency-Rejeu`).',
  })
  @ApiResponse({ status: 201, type: EnveloppeFacturerEtEncaisserOrDto })
  @ApiReponseProbleme(400, 'Corps invalide ou Idempotency-Key manquante/mal formée.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant (créer, émettre une facture ou encaisser).')
  @ApiReponseProbleme(404, 'Ordre de réparation introuvable pour ce tenant.')
  @ApiReponseProbleme(
    409,
    'OR_TRANSITION_INTERDITE, FACTURATION_LIGNES_INDECISES, OR_FACTURATION_AUCUNE_LIGNE, CONFIRMATION_REQUISE, DOCUMENT_VERROUILLE ou IDEMPOTENCE_CONFLIT.',
  )
  async facturerEtEncaisser(
    @Param('orId', new PipeZod(schemaIdentifiant)) orId: string,
    @CorpsZod(schemaFacturerEtEncaisserOr, {
      exemple: { paiement: { mode: 'especes' } },
    })
    entree: EntreeFacturerEtEncaisserOr,
    @Headers(EN_TETE_IDEMPOTENCE.toLowerCase()) cleIdempotence: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<unknown> {
    const ctx = this.contexte.contexteTenant();
    const principal = this.contexte.exigerPrincipal();
    const resultat = await this.facturationEncaissement.facturerEtEncaisser(
      ctx,
      principal,
      orId,
      entree,
      cleIdempotence ?? '',
    );

    res.status(resultat.reponse.statutHttp);
    if (resultat.rejoue) res.setHeader('Idempotency-Rejeu', 'true');
    return resultat.reponse.corps;
  }

  @Post('creation-rapide')
  @HttpCode(HttpStatus.CREATED)
  @ExigerDroit('atelier.or.creer')
  @ApiOperation({
    summary:
      'Accueil comptoir en un appel : (client) + (véhicule) + ordre de réparation, une transaction.',
    description:
      '`client` : `{ id }` ou `{ nouveau }` ; `vehicule` : `{ id }` ou `{ nouveau }` (le détenteur est le client) ; `or` : corps de ' +
      '`POST /ordres-reparation` sans `clientId`/`vehiculeId` (`or.confirmations` pour les confirmations). Tout ou rien. ' +
      'Un doublon client probable ne bloque pas : avertissement `CLIENT_DOUBLON_PROBABLE`. ' +
      'Créer un client exige `client.creer`, créer un véhicule exige `vehicule.creer`.',
  })
  @ApiHeader({
    name: EN_TETE_IDEMPOTENCE,
    required: true,
    description: 'uuid v4 — un rejeu rend les mêmes client, véhicule et OR.',
  })
  @ApiResponse({ status: 201, type: EnveloppeCreationRapideOrDto })
  @ApiReponseProbleme(400, 'Corps invalide ou Idempotency-Key manquante/mal formée.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant (OR, client ou véhicule).')
  @ApiReponseProbleme(404, 'Client ou véhicule existant introuvable pour ce tenant.')
  @ApiReponseProbleme(
    409,
    'CONFLIT, CONFIRMATION_REQUISE, VEHICULE_PLAQUE_COLLISION, OR_KM_ENTREE_REQUIS ou IDEMPOTENCE_CONFLIT : rien n’est créé.',
  )
  async creationRapideOr(
    @CorpsZod(schemaCreationRapideOrdreReparation, {
      exemple: {
        client: { nouveau: { type: 'particulier', nom: 'Dupont', prenom: 'Marie' } },
        vehicule: { nouveau: { plaque: 'VD 123456', marque: 'Renault', modele: 'Clio' } },
        or: { siteId: '00000000-0000-0000-0000-000000000000', type: 'reparation' },
      },
    })
    entree: EntreeCreationRapideOrdreReparation,
    @Headers(EN_TETE_IDEMPOTENCE.toLowerCase()) cleIdempotence: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<unknown> {
    const ctx = this.contexte.contexteTenant();
    const principal = this.contexte.exigerPrincipal();
    const resultat = await this.creationRapide.creer(ctx, principal, entree, cleIdempotence ?? '');

    res.status(resultat.reponse.statutHttp);
    if (resultat.rejoue) res.setHeader('Idempotency-Rejeu', 'true');
    return resultat.reponse.corps;
  }
}
