import { Controller, Get, Headers, HttpCode, HttpStatus, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiHeader, ApiOkResponse, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  schemaAbandonnerAvance,
  schemaCreationImputation,
  schemaCreationPaiement,
  schemaRembourserAvance,
  type EntreeAbandonnerAvance,
  type EntreeCreationImputation,
  type EntreeCreationPaiement,
  type EntreeRembourserAvance,
} from '@dfa/shared';

import { ServiceContexteRequete } from '../../common/contexte';
import { CorpsZod } from '../../common/documentation';
import { ExigerDroit, GardeDroit } from '../../common/droits';
import { ApiReponseProbleme } from '../../common/erreurs';
import { PipeZod } from '../../common/validation';

import { PageReponsePaiementDto, PaiementAvecAvertissementsDto, ReponsePaiementDto } from './dto';
import { schemaListePaiements, schemaUuidPaiement, type ParametresListePaiements } from './schemas';
import { ServicePaiement } from './service-paiement';

/**
 * Encaissement et lettrage (`RF-65` → `RF-80`, `MD-50` → `MD-57`). Aucun `PATCH`, aucun `DELETE` :
 * un `paiement` et une `imputation_paiement` sont immuables — une saisie erronée se corrige par un
 * mouvement de sens opposé (`contrePasseId`), jamais par une modification en place (`MD-52`).
 *
 * Ce contrôleur ne suppose JAMAIS qu'un document doit être soldé avant une autre action (un
 * véhicule se restitue sans encaissement, décision de @laupernoe — `RF-83`, `docs/specification-etape-2-
 * facturation.md` §7 tableau ligne 1) : rien ici ne bloque quoi que ce soit côté atelier.
 */
@ApiTags('Facturation — paiements')
@ApiCookieAuth()
@Controller({ path: 'paiements', version: '1' })
@UseGuards(GardeDroit)
export class PaiementController {
  constructor(
    private readonly servicePaiement: ServicePaiement,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @Get()
  @ExigerDroit('facturation.paiement.lire')
  @ApiOperation({
    summary: 'Liste paginée des paiements du tenant courant.',
    description:
      "`nonImputeUniquement=true` sert l'écran « encaissements à affecter » (RF-72), qui doit être vide en fin de journée.",
  })
  @ApiOkResponse({ type: PageReponsePaiementDto })
  @ApiReponseProbleme(400, 'Filtres, tri ou curseur invalides.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant (rôle sans facturation.paiement.lire).')
  async lister(@Query(new PipeZod(schemaListePaiements)) query: ParametresListePaiements): Promise<PageReponsePaiementDto> {
    const ctx = this.contexte.contexteTenant();
    return this.servicePaiement.lister(ctx, query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ExigerDroit('facturation.paiement.creer')
  @ApiOperation({
    summary: "Enregistrement d'un encaissement, avec lettrage optionnel dans le même geste.",
    description:
      "`Idempotency-Key` obligatoire (uuid v4) : un rejeu réseau au comptoir ne doit jamais faire encaisser deux fois le même geste. " +
      "`imputations[]` est optionnel — un paiement sans imputation reste valide (acompte avant tout document, RF-65) et apparaît " +
      'dans `GET /paiements?nonImputeUniquement=true` jusqu\'à affectation explicite. Le lettrage est TOUJOURS explicite : aucune ' +
      "règle n'impute automatiquement une facture à la place de l'appelant. " +
      "Arrondi espèces (RF-49 → RF-52) : soumis comme une imputation `nature: 'arrondi'` explicite dans `imputations[]`, " +
      "revalidée intégralement côté serveur (moyen 'especes' uniquement, ±2 centimes, et seulement si elle solde exactement le document).",
  })
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'uuid v4, identité de la requête.' })
  @ApiResponse({ status: 201, type: PaiementAvecAvertissementsDto })
  @ApiReponseProbleme(400, 'Corps invalide ou Idempotency-Key manquante/mal formée.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant (rôle sans facturation.paiement.creer).')
  @ApiReponseProbleme(404, "Client payeur ou document ciblé par une imputation introuvable pour ce tenant.")
  @ApiReponseProbleme(409, "IDEMPOTENCE_CONFLIT, IMPUTATION_MONTANT_EXCEDENTAIRE (MD-51), ou CONFLIT (transaction bancaire déjà enregistrée).")
  async creer(
    @CorpsZod(schemaCreationPaiement, {
      exemple: {
        siteId: '00000000-0000-0000-0000-000000000000',
        dateValeur: '2026-07-29',
        moyen: 'especes',
        montantCentimes: 20430,
        devise: 'CHF',
        payeurLibelle: 'Client comptoir',
        imputations: [
          { documentId: '00000000-0000-0000-0000-000000000000', montantCentimes: 20430, nature: 'reglement' },
          { documentId: '00000000-0000-0000-0000-000000000000', montantCentimes: 1, nature: 'arrondi' },
        ],
      },
    })
    entree: EntreeCreationPaiement,
    @Headers('idempotency-key') cleIdempotence: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<unknown> {
    const ctx = this.contexte.contexteTenant();
    const resultat = await this.servicePaiement.creer(ctx, entree, cleIdempotence ?? '');

    res.status(resultat.reponse.statutHttp);
    if (resultat.rejoue) res.setHeader('Idempotency-Rejeu', 'true');
    return resultat.reponse.corps;
  }

  @Get(':paiementId')
  @ExigerDroit('facturation.paiement.lire')
  @ApiOperation({ summary: "Détail d'un paiement, avec ses imputations." })
  @ApiParam({ name: 'paiementId', format: 'uuid' })
  @ApiOkResponse({ type: ReponsePaiementDto })
  @ApiReponseProbleme(400, 'Identifiant mal formé.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Paiement introuvable pour ce tenant.')
  async parId(@Param('paiementId', new PipeZod(schemaUuidPaiement)) paiementId: string): Promise<ReponsePaiementDto> {
    const ctx = this.contexte.contexteTenant();
    return this.servicePaiement.parId(ctx, paiementId);
  }

  @Post(':paiementId/imputations')
  @HttpCode(HttpStatus.CREATED)
  @ExigerDroit('facturation.paiement.imputer')
  @ApiOperation({
    summary: "Affecte un paiement déjà enregistré à un document (lettrage a posteriori).",
    description:
      "`Idempotency-Key` obligatoire (uuid v4) — décision de sécurité de cet agent (voir le rapport de livraison) : " +
      'une imputation rejouée deux fois lettrerait deux fois le même encaissement. Natures acceptées ici : `reglement`, `arrondi` ' +
      "uniquement — `escompte`/`perte`/`compensation` passent par leurs actions dédiées.",
  })
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'uuid v4, identité de la requête.' })
  @ApiParam({ name: 'paiementId', format: 'uuid' })
  @ApiResponse({ status: 201, type: PaiementAvecAvertissementsDto })
  @ApiReponseProbleme(400, "Corps invalide, Idempotency-Key manquante/mal formée, ou nature d'imputation non autorisée sur cet endpoint.")
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant (rôle sans facturation.paiement.imputer).')
  @ApiReponseProbleme(404, 'Paiement ou document introuvable pour ce tenant.')
  @ApiReponseProbleme(409, "IDEMPOTENCE_CONFLIT ou IMPUTATION_MONTANT_EXCEDENTAIRE (MD-51).")
  async ajouterImputation(
    @Param('paiementId', new PipeZod(schemaUuidPaiement)) paiementId: string,
    @CorpsZod(schemaCreationImputation, {
      exemple: { documentId: '00000000-0000-0000-0000-000000000000', montantCentimes: 15000, nature: 'reglement' },
    })
    entree: EntreeCreationImputation,
    @Headers('idempotency-key') cleIdempotence: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<unknown> {
    const ctx = this.contexte.contexteTenant();
    const resultat = await this.servicePaiement.ajouterImputation(ctx, paiementId, entree, cleIdempotence ?? '');

    res.status(resultat.reponse.statutHttp);
    if (resultat.rejoue) res.setHeader('Idempotency-Rejeu', 'true');
    return resultat.reponse.corps;
  }

  @Post(':paiementId/rembourser')
  @HttpCode(HttpStatus.CREATED)
  @ExigerDroit('facturation.paiement.rembourser')
  @ApiOperation({
    summary: "Rembourse tout ou partie d'une avance client non imputée (RF-79, issue 1/3).",
    description:
      "`Idempotency-Key` obligatoire (uuid v4) : crée un NOUVEAU paiement de montant négatif, moyen `virement`, lié par " +
      '`contrePasseId` — jamais une correction en place (MD-52, MD-57).',
  })
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'uuid v4, identité de la requête.' })
  @ApiParam({ name: 'paiementId', format: 'uuid' })
  @ApiResponse({ status: 201, type: PaiementAvecAvertissementsDto, description: 'Le paiement de remboursement créé (montant négatif).' })
  @ApiReponseProbleme(400, 'Corps invalide ou Idempotency-Key manquante/mal formée.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant (rôle sans facturation.paiement.rembourser).')
  @ApiReponseProbleme(404, 'Paiement introuvable pour ce tenant.')
  @ApiReponseProbleme(409, "IDEMPOTENCE_CONFLIT ou IMPUTATION_MONTANT_EXCEDENTAIRE (montant demandé supérieur à l'avance disponible).")
  async rembourser(
    @Param('paiementId', new PipeZod(schemaUuidPaiement)) paiementId: string,
    @CorpsZod(schemaRembourserAvance, { exemple: { montantCentimes: 1900, referenceVirement: 'Remboursement trop-perçu CF-11' } })
    entree: EntreeRembourserAvance,
    @Headers('idempotency-key') cleIdempotence: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<unknown> {
    const ctx = this.contexte.contexteTenant();
    const resultat = await this.servicePaiement.rembourser(ctx, paiementId, entree, cleIdempotence ?? '');

    res.status(resultat.reponse.statutHttp);
    if (resultat.rejoue) res.setHeader('Idempotency-Rejeu', 'true');
    return resultat.reponse.corps;
  }

  @Post(':paiementId/abandonner')
  @HttpCode(HttpStatus.OK)
  @ExigerDroit('facturation.paiement.abandonner')
  @ApiOperation({
    summary: "Abandonne une avance client non imputée en faveur du garage (RF-79, issue 3/3).",
    description:
      "`Idempotency-Key` obligatoire (uuid v4) — décision de sécurité de cet agent (voir le rapport de livraison) : un geste qui " +
      "renonce à rendre de l'argent au client ne doit jamais s'exécuter deux fois sur un retry. Crée une imputation de nature " +
      "`compensation` sur le document de régularisation désigné, rattachée au paiement d'avance.",
  })
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'uuid v4, identité de la requête.' })
  @ApiParam({ name: 'paiementId', format: 'uuid' })
  @ApiOkResponse({ type: PaiementAvecAvertissementsDto })
  @ApiReponseProbleme(400, 'Corps invalide ou Idempotency-Key manquante/mal formée.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant (rôle sans facturation.paiement.abandonner).')
  @ApiReponseProbleme(404, 'Paiement ou document de régularisation introuvable pour ce tenant.')
  @ApiReponseProbleme(409, "IDEMPOTENCE_CONFLIT ou IMPUTATION_MONTANT_EXCEDENTAIRE (MD-51).")
  async abandonner(
    @Param('paiementId', new PipeZod(schemaUuidPaiement)) paiementId: string,
    @CorpsZod(schemaAbandonnerAvance, {
      exemple: {
        documentRegularisationId: '00000000-0000-0000-0000-000000000000',
        montantCentimes: 200,
        motif: 'Trop-perçu résiduel de 2 ct, abandonné en accord avec le client au comptoir',
      },
    })
    entree: EntreeAbandonnerAvance,
    @Headers('idempotency-key') cleIdempotence: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<unknown> {
    const ctx = this.contexte.contexteTenant();
    const resultat = await this.servicePaiement.abandonner(ctx, paiementId, entree, cleIdempotence ?? '');

    res.status(resultat.reponse.statutHttp);
    if (resultat.rejoue) res.setHeader('Idempotency-Rejeu', 'true');
    return resultat.reponse.corps;
  }
}
