import {
  Controller,
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
import {
  schemaActionAbandonnerDossierVente,
  schemaActionAnnulerDossierVente,
  schemaActionCloturerDossierVente,
  schemaActionEngager,
  schemaActionLivrer,
  schemaActionMarquerPretALivrer,
  schemaActionPreparer,
  schemaCreationDossierVente,
  schemaFiltresDossiersVente,
  schemaIdentifiant,
  schemaMarquerDocumentRequis,
  schemaModificationDossierVente,
  type EntreeActionAbandonnerDossierVente,
  type EntreeActionAnnulerDossierVente,
  type EntreeActionCloturerDossierVente,
  type EntreeActionEngager,
  type EntreeActionLivrer,
  type EntreeActionMarquerPretALivrer,
  type EntreeActionPreparer,
  type EntreeCreationDossierVente,
  type EntreeMarquerDocumentRequis,
  type EntreeModificationDossierVente,
  type FiltresDossiersVente,
} from '@dfa/shared';

import { ServiceContexteRequete } from '../common/contexte';
import { CorpsZod } from '../common/documentation';
import { ExigerDroit, GardeDroit } from '../common/droits';
import { ApiReponseProbleme } from '../common/erreurs';
import { PipeZod } from '../common/validation';

import {
  DossierVenteAvecAvertissementsDto,
  PageDossierVenteDto,
  ReponseDossierVenteDto,
} from './dto';
import { ServiceDossierVente } from './service-dossier-vente';
import { ExigerModule } from '../common/droits/garde-module';

/**
 * Le dossier de vente (RV-29→RV-38, RV-52→RV-58, §6.2) — objet CENTRAL du module. Ressource,
 * transitions (§6.2) et check-list de livraison partagent ce contrôleur (comparable, en volume, à
 * `vehicule-detention.controller.ts` plutôt qu'aux 11 transitions de l'OR réparties sur deux
 * fichiers) : 8 gestes de transition seulement, pas de découpage supplémentaire justifié.
 */
@ApiTags('Dossiers de vente')
@ApiCookieAuth()
@ExigerModule('ventes')
@Controller({ path: 'dossiers-vente', version: '1' })
@UseGuards(GardeDroit)
export class DossierVenteController {
  constructor(
    private readonly service: ServiceDossierVente,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @Get()
  @ExigerDroit('ventes.dossier.lire')
  @ApiOperation({ summary: 'Liste paginée des dossiers de vente du tenant courant.' })
  @ApiOkResponse({ type: PageDossierVenteDto })
  @ApiReponseProbleme(400, 'Filtres, tri ou curseur invalides.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  async lister(
    @Query(new PipeZod(schemaFiltresDossiersVente)) filtres: FiltresDossiersVente,
  ): Promise<PageDossierVenteDto> {
    const ctx = this.contexte.contexteTenant();
    const { role } = this.contexte.exigerPrincipal();
    return this.service.lister(ctx, role, filtres);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ExigerDroit('ventes.dossier.creer')
  @ApiOperation({
    summary: "Création d'un dossier de vente, toujours en `prospection`.",
    description:
      '`Idempotency-Key` obligatoire (uuid v4) : un double-clic comptoir ne doit jamais ouvrir deux dossiers.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'uuid v4, identité de la requête.',
  })
  @ApiResponse({ status: 201, type: DossierVenteAvecAvertissementsDto })
  @ApiReponseProbleme(400, 'Corps invalide ou Idempotency-Key manquante/mal formée.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Client ou véhicule en stock introuvable pour ce tenant.')
  @ApiReponseProbleme(409, 'IDEMPOTENCE_CONFLIT.')
  async creer(
    @CorpsZod(schemaCreationDossierVente, {
      exemple: {
        siteId: '2f6c9e1a-8b3d-4e7a-9c2b-1a5d6e8f9012',
        clientAcheteurId: '4b8e1f3c-0d5f-4a9c-1e4d-3c7f80a11234',
      },
    })
    entree: EntreeCreationDossierVente,
    @Headers('idempotency-key') cleIdempotence: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<unknown> {
    const ctx = this.contexte.contexteTenant();
    const principal = this.contexte.exigerPrincipal();
    const resultat = await this.service.creer(ctx, principal, entree, cleIdempotence ?? '');

    res.status(resultat.reponse.statutHttp);
    if (resultat.rejoue) res.setHeader('Idempotency-Rejeu', 'true');
    return resultat.reponse.corps;
  }

  @Get(':dossierVenteId')
  @ExigerDroit('ventes.dossier.lire')
  @ApiOperation({ summary: "Fiche complète d'un dossier de vente — le document entier (§8.2)." })
  @ApiParam({ name: 'dossierVenteId', format: 'uuid' })
  @ApiOkResponse({ type: ReponseDossierVenteDto })
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Dossier de vente introuvable pour ce tenant.')
  async parId(
    @Param('dossierVenteId', new PipeZod(schemaIdentifiant)) dossierVenteId: string,
  ): Promise<ReponseDossierVenteDto> {
    const ctx = this.contexte.contexteTenant();
    const { role } = this.contexte.exigerPrincipal();
    return this.service.obtenirComplet(ctx, role, dossierVenteId);
  }

  @Patch(':dossierVenteId')
  @ExigerDroit('ventes.dossier.modifier')
  @ApiOperation({
    summary: 'Modification des champs libres du dossier.',
    description:
      '`If-Match: W/"<version>"` obligatoire. Réassignation du véhicule refusée au-delà de `prospection` (RV-30).',
  })
  @ApiParam({ name: 'dossierVenteId', format: 'uuid' })
  @ApiHeader({
    name: 'If-Match',
    required: true,
    description: 'W/"<version>" lu sur la dernière lecture (ETag).',
  })
  @ApiOkResponse({ type: DossierVenteAvecAvertissementsDto })
  @ApiReponseProbleme(400, 'Corps invalide ou If-Match manquant/mal formé.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(
    404,
    'Dossier de vente, client ou véhicule en stock introuvable pour ce tenant.',
  )
  @ApiReponseProbleme(
    409,
    'CONFLIT (version périmée) ou VENTE_DOSSIER_TRANSITION_INTERDITE (réassignation du véhicule hors prospection).',
  )
  async modifier(
    @Param('dossierVenteId', new PipeZod(schemaIdentifiant)) dossierVenteId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @CorpsZod(schemaModificationDossierVente) entree: EntreeModificationDossierVente,
  ): Promise<DossierVenteAvecAvertissementsDto> {
    const ctx = this.contexte.contexteTenant();
    const { role } = this.contexte.exigerPrincipal();
    return this.service.modifier(ctx, role, dossierVenteId, ifMatch, entree);
  }

  @Post(':dossierVenteId/documents-requis/marquer')
  @ExigerDroit('ventes.dossier.modifier')
  @ApiOperation({ summary: 'Coche/décoche un item de la check-list de livraison (RV-35).' })
  @ApiParam({ name: 'dossierVenteId', format: 'uuid' })
  @ApiOkResponse({ type: DossierVenteAvecAvertissementsDto })
  @ApiReponseProbleme(400, 'Corps invalide.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(
    404,
    'Dossier de vente introuvable, ou aucun document requis de ce code (check-list non paramétrée, PV-03).',
  )
  async marquerDocumentRequis(
    @Param('dossierVenteId', new PipeZod(schemaIdentifiant)) dossierVenteId: string,
    @CorpsZod(schemaMarquerDocumentRequis, { exemple: { code: 'piece_identite', fourni: true } })
    entree: EntreeMarquerDocumentRequis,
  ): Promise<DossierVenteAvecAvertissementsDto> {
    const ctx = this.contexte.contexteTenant();
    const { role } = this.contexte.exigerPrincipal();
    return this.service.marquerDocumentRequis(ctx, role, dossierVenteId, entree);
  }

  @Post(':dossierVenteId/engager')
  @ExigerDroit('ventes.dossier.engager')
  @ApiOperation({
    summary: '`prospection -> engage` : signature du bon de commande (RV-32).',
    description:
      'Refusé si aucun véhicule associé (VENTE_VEHICULE_MANQUANT) ou véhicule indisponible ' +
      '(VENTE_VEHICULE_INDISPONIBLE, CV-01). Confirme la reprise négociée le cas échéant.',
  })
  @ApiParam({ name: 'dossierVenteId', format: 'uuid' })
  @ApiOkResponse({ type: DossierVenteAvecAvertissementsDto })
  @ApiReponseProbleme(400, 'Corps invalide.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(
    404,
    'Dossier de vente ou document de bon de commande introuvable pour ce tenant.',
  )
  @ApiReponseProbleme(
    409,
    'VENTE_DOSSIER_TRANSITION_INTERDITE, VENTE_VEHICULE_MANQUANT, VENTE_VEHICULE_INDISPONIBLE ou VENTE_REPRISE_VALEUR_NEGOCIEE_REQUISE.',
  )
  async engager(
    @Param('dossierVenteId', new PipeZod(schemaIdentifiant)) dossierVenteId: string,
    @CorpsZod(schemaActionEngager, {
      exemple: {
        bonCommandeDocumentId: '5a1c9e2e-2f0a-4b3a-9c1a-8e6f2d4b7a10',
        identitePieceType: 'carte_identite',
      },
    })
    entree: EntreeActionEngager,
  ): Promise<DossierVenteAvecAvertissementsDto> {
    const ctx = this.contexte.contexteTenant();
    const { role } = this.contexte.exigerPrincipal();
    return this.service.engager(ctx, role, dossierVenteId, entree);
  }

  @Post(':dossierVenteId/preparer')
  @ExigerDroit('ventes.dossier.preparer')
  @ApiOperation({ summary: '`engage -> en_preparation`.' })
  @ApiParam({ name: 'dossierVenteId', format: 'uuid' })
  @ApiOkResponse({ type: DossierVenteAvecAvertissementsDto })
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Dossier de vente introuvable pour ce tenant.')
  @ApiReponseProbleme(409, 'VENTE_DOSSIER_TRANSITION_INTERDITE.')
  async preparer(
    @Param('dossierVenteId', new PipeZod(schemaIdentifiant)) dossierVenteId: string,
    @CorpsZod(schemaActionPreparer, { exemple: {} }) entree: EntreeActionPreparer,
  ): Promise<DossierVenteAvecAvertissementsDto> {
    const ctx = this.contexte.contexteTenant();
    const { role } = this.contexte.exigerPrincipal();
    return this.service.preparer(ctx, role, dossierVenteId, entree);
  }

  @Post(':dossierVenteId/marquer-pret-a-livrer')
  @ExigerDroit('ventes.dossier.marquer_pret_a_livrer')
  @ApiOperation({
    summary:
      '`en_preparation -> pret_a_livrer` — refusé si le financement n’est pas confirmé (RV-37).',
  })
  @ApiParam({ name: 'dossierVenteId', format: 'uuid' })
  @ApiOkResponse({ type: DossierVenteAvecAvertissementsDto })
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Dossier de vente introuvable pour ce tenant.')
  @ApiReponseProbleme(409, 'VENTE_DOSSIER_TRANSITION_INTERDITE ou VENTE_FINANCEMENT_NON_CONFIRME.')
  async marquerPretALivrer(
    @Param('dossierVenteId', new PipeZod(schemaIdentifiant)) dossierVenteId: string,
    @CorpsZod(schemaActionMarquerPretALivrer, { exemple: {} })
    entree: EntreeActionMarquerPretALivrer,
  ): Promise<DossierVenteAvecAvertissementsDto> {
    const ctx = this.contexte.contexteTenant();
    const { role } = this.contexte.exigerPrincipal();
    return this.service.marquerPretALivrer(ctx, role, dossierVenteId, entree);
  }

  @Post(':dossierVenteId/livrer')
  @ExigerDroit('ventes.dossier.livrer')
  @ApiOperation({
    summary: '`pret_a_livrer -> livre` (RV-52/RV-53).',
    description:
      'Bascule la détention du véhicule vers le client conducteur (ou acheteur), motif `vente`. ' +
      'Exige que le véhicule soit déjà `vendu` — la facture doit avoir été émise AVANT cet appel ' +
      '(RV-37) : l’enchaînement réel du parcours est engager → préparer → prêt à livrer → ' +
      '**facturer** → livrer, pas « prêt à livrer → livrer » directement. `dateLivraisonEffective` ' +
      'accepte le jour même (cas le plus courant en concession, issue #13) : une détention déjà ' +
      'ouverte pour ce véhicule et démarrée ce même jour civil n’est pas un conflit ; seule une ' +
      'date antérieure au début d’une détention déjà enregistrée reste refusée.',
  })
  @ApiParam({ name: 'dossierVenteId', format: 'uuid' })
  @ApiOkResponse({ type: DossierVenteAvecAvertissementsDto })
  @ApiReponseProbleme(400, 'Corps invalide.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Dossier de vente introuvable pour ce tenant.')
  @ApiReponseProbleme(
    409,
    'VENTE_DOSSIER_TRANSITION_INTERDITE, VENTE_VEHICULE_MANQUANT ou VENTE_LIVRAISON_FACTURE_REQUISE ' +
      '(la facture de vente doit être émise avant la livraison — RV-37).',
  )
  async livrer(
    @Param('dossierVenteId', new PipeZod(schemaIdentifiant)) dossierVenteId: string,
    @CorpsZod(schemaActionLivrer, {
      exemple: {
        dateLivraisonEffective: '2026-08-01',
        kilometrageDepart: 12,
        uniteKilometrage: 'km',
      },
    })
    entree: EntreeActionLivrer,
  ): Promise<DossierVenteAvecAvertissementsDto> {
    const ctx = this.contexte.contexteTenant();
    const { role } = this.contexte.exigerPrincipal();
    return this.service.livrer(ctx, role, dossierVenteId, entree);
  }

  @Post(':dossierVenteId/cloturer')
  @ExigerDroit('ventes.dossier.cloturer')
  @ApiOperation({ summary: '`livre -> clos` : toute la paperasse est complète.' })
  @ApiParam({ name: 'dossierVenteId', format: 'uuid' })
  @ApiOkResponse({ type: DossierVenteAvecAvertissementsDto })
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Dossier de vente introuvable pour ce tenant.')
  @ApiReponseProbleme(409, 'VENTE_DOSSIER_TRANSITION_INTERDITE.')
  async cloturer(
    @Param('dossierVenteId', new PipeZod(schemaIdentifiant)) dossierVenteId: string,
    @CorpsZod(schemaActionCloturerDossierVente, { exemple: {} })
    entree: EntreeActionCloturerDossierVente,
  ): Promise<DossierVenteAvecAvertissementsDto> {
    const ctx = this.contexte.contexteTenant();
    const { role } = this.contexte.exigerPrincipal();
    return this.service.cloturer(ctx, role, dossierVenteId, entree);
  }

  @Post(':dossierVenteId/annuler')
  @ExigerDroit('ventes.dossier.annuler')
  @ApiOperation({
    summary: 'Rupture volontaire, motif obligatoire — uniquement avant `pret_a_livrer` (RV-38).',
  })
  @ApiParam({ name: 'dossierVenteId', format: 'uuid' })
  @ApiOkResponse({ type: DossierVenteAvecAvertissementsDto })
  @ApiReponseProbleme(400, 'Motif manquant.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Dossier de vente introuvable pour ce tenant.')
  @ApiReponseProbleme(409, 'VENTE_DOSSIER_ANNULATION_IMPOSSIBLE.')
  async annuler(
    @Param('dossierVenteId', new PipeZod(schemaIdentifiant)) dossierVenteId: string,
    @CorpsZod(schemaActionAnnulerDossierVente, {
      exemple: { motif: 'Le client renonce, financement refusé.' },
    })
    entree: EntreeActionAnnulerDossierVente,
  ): Promise<DossierVenteAvecAvertissementsDto> {
    const ctx = this.contexte.contexteTenant();
    const { role } = this.contexte.exigerPrincipal();
    return this.service.annuler(ctx, role, dossierVenteId, entree);
  }

  @Post(':dossierVenteId/abandonner')
  @ExigerDroit('ventes.dossier.abandonner')
  @ApiOperation({
    summary: 'Client qui ne répond plus, motif obligatoire — même garde que `annuler`.',
  })
  @ApiParam({ name: 'dossierVenteId', format: 'uuid' })
  @ApiOkResponse({ type: DossierVenteAvecAvertissementsDto })
  @ApiReponseProbleme(400, 'Motif manquant.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Dossier de vente introuvable pour ce tenant.')
  @ApiReponseProbleme(409, 'VENTE_DOSSIER_ANNULATION_IMPOSSIBLE.')
  async abandonner(
    @Param('dossierVenteId', new PipeZod(schemaIdentifiant)) dossierVenteId: string,
    @CorpsZod(schemaActionAbandonnerDossierVente, {
      exemple: { motif: 'Client injoignable depuis trois semaines.' },
    })
    entree: EntreeActionAbandonnerDossierVente,
  ): Promise<DossierVenteAvecAvertissementsDto> {
    const ctx = this.contexte.contexteTenant();
    const { role } = this.contexte.exigerPrincipal();
    return this.service.abandonner(ctx, role, dossierVenteId, entree);
  }
}
