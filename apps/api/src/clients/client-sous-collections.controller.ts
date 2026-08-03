import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  schemaAdresseClient,
  schemaConditionClient,
  schemaConsentementClient,
  schemaContactClient,
  schemaModificationAdresseClient,
  schemaModificationContactClient,
  schemaNoteClient,
  type EntreeAdresseClient,
  type EntreeConditionClient,
  type EntreeConsentementClient,
  type EntreeContactClient,
  type EntreeNoteClient,
} from '@dfa/shared';

import { ServiceContexteRequete } from '../common/contexte';
import { CorpsZod } from '../common/documentation';
import { ExigerDroit, GardeDroit } from '../common/droits';
import { ApiReponseProbleme } from '../common/erreurs';
import { PipeZod } from '../common/validation';
import {
  ClientAdresseAvecAvertissementsDto,
  ClientConditionAvecAvertissementsDto,
  ClientConsentementAvecAvertissementsDto,
  ClientContactAvecAvertissementsDto,
  ClientNoteAvecAvertissementsDto,
  PageClientAdresseDto,
  PageClientConditionDto,
  PageClientConsentementDto,
  PageClientContactDto,
  PageClientNoteDto,
} from './dto';
import { schemaPageSousCollection, schemaUuid, type ParametresPageSousCollection } from './schemas';
import { ServiceClientSousCollections } from './service-client-sous-collections';

type EntreeModificationAdresse = Partial<EntreeAdresseClient> & { readonly actif?: boolean };
type EntreeModificationContact = Partial<EntreeContactClient> & { readonly actif?: boolean };

/**
 * Sous-collections de la fiche client (RM-03, RM-04, RM-07, RM-09, RM-13). Un contrôleur par
 * sous-collection (même granularité que `vehicules/vehicule-plaque.controller.ts` et consorts) :
 * chacune a son propre droit d'écriture, pas de bénéfice à les fusionner en un seul contrôleur.
 *
 * Conditions, consentements et notes n'ont AUCUN `PATCH` — voir `ServiceClientSousCollections` :
 * conditions sont DATÉES (une correction ouvre une nouvelle période, RM-07), consentements et
 * notes sont APPEND-ONLY (RM-09, RM-13).
 */

@ApiTags('Clients')
@ApiCookieAuth()
@Controller({ path: 'clients/:clientId/adresses', version: '1' })
@UseGuards(GardeDroit)
export class ClientAdresseController {
  constructor(
    private readonly service: ServiceClientSousCollections,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @Get()
  @ExigerDroit('client.lire')
  @ApiOperation({ summary: 'Adresses du client (RM-03).' })
  @ApiParam({ name: 'clientId', format: 'uuid' })
  @ApiOkResponse({ type: PageClientAdresseDto })
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Client introuvable pour ce tenant.')
  async lister(
    @Param('clientId', new PipeZod(schemaUuid)) clientId: string,
    @Query(new PipeZod(schemaPageSousCollection)) params: ParametresPageSousCollection,
  ): Promise<PageClientAdresseDto> {
    const ctx = this.contexte.contexteTenant();
    return this.service.listerAdresses(ctx, clientId, params);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ExigerDroit('client.modifier')
  @ApiOperation({ summary: "Ajout d'une adresse (RM-03)." })
  @ApiParam({ name: 'clientId', format: 'uuid' })
  @ApiResponse({ status: 201, type: ClientAdresseAvecAvertissementsDto })
  @ApiReponseProbleme(400, 'Corps invalide ou une adresse active de ce type existe déjà.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Client introuvable pour ce tenant.')
  async creer(
    @Param('clientId', new PipeZod(schemaUuid)) clientId: string,
    @CorpsZod(schemaAdresseClient, {
      exemple: {
        type: 'facturation',
        rue: 'Avenue de la Gare 5',
        npa: '1950',
        localite: 'Sion',
        pays: 'CH',
      },
    })
    entree: EntreeAdresseClient,
  ): Promise<ClientAdresseAvecAvertissementsDto> {
    const ctx = this.contexte.contexteTenant();
    return this.service.creerAdresse(ctx, clientId, entree);
  }

  @Patch(':adresseId')
  @ExigerDroit('client.modifier')
  @ApiOperation({ summary: "Modification d'une adresse (RM-03)." })
  @ApiParam({ name: 'clientId', format: 'uuid' })
  @ApiParam({ name: 'adresseId', format: 'uuid' })
  @ApiOkResponse({ type: ClientAdresseAvecAvertissementsDto })
  @ApiReponseProbleme(400, 'Corps invalide ou une adresse active de ce type existe déjà.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Client ou adresse introuvable pour ce tenant.')
  async modifier(
    @Param('clientId', new PipeZod(schemaUuid)) clientId: string,
    @Param('adresseId', new PipeZod(schemaUuid)) adresseId: string,
    @CorpsZod(schemaModificationAdresseClient, {
      exemple: { complement: 'Bâtiment B, 2e étage', actif: true },
    })
    entree: EntreeModificationAdresse,
  ): Promise<ClientAdresseAvecAvertissementsDto> {
    const ctx = this.contexte.contexteTenant();
    return this.service.modifierAdresse(ctx, clientId, adresseId, entree);
  }
}

@ApiTags('Clients')
@ApiCookieAuth()
@Controller({ path: 'clients/:clientId/contacts', version: '1' })
@UseGuards(GardeDroit)
export class ClientContactController {
  constructor(
    private readonly service: ServiceClientSousCollections,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @Get()
  @ExigerDroit('client.lire')
  @ApiOperation({ summary: 'Contacts du client (RM-04) — rôles CUMULABLES.' })
  @ApiParam({ name: 'clientId', format: 'uuid' })
  @ApiOkResponse({ type: PageClientContactDto })
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Client introuvable pour ce tenant.')
  async lister(
    @Param('clientId', new PipeZod(schemaUuid)) clientId: string,
    @Query(new PipeZod(schemaPageSousCollection)) params: ParametresPageSousCollection,
  ): Promise<PageClientContactDto> {
    const ctx = this.contexte.contexteTenant();
    return this.service.listerContacts(ctx, clientId, params);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ExigerDroit('client.modifier')
  @ApiOperation({ summary: "Ajout d'un contact (RM-04)." })
  @ApiParam({ name: 'clientId', format: 'uuid' })
  @ApiResponse({ status: 201, type: ClientContactAvecAvertissementsDto })
  @ApiReponseProbleme(400, 'Corps invalide (au moins un rôle requis).')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Client introuvable pour ce tenant.')
  async creer(
    @Param('clientId', new PipeZod(schemaUuid)) clientId: string,
    @CorpsZod(schemaContactClient, {
      exemple: {
        nom: 'Moret',
        prenom: 'Julien',
        fonction: 'Responsable flotte',
        telephone: '+41 78 234 56 78',
        email: 'j.moret@transports-moret.ch',
        langue: 'fr',
        roles: ['gestionnaire_flotte', 'signataire'],
      },
    })
    entree: EntreeContactClient,
  ): Promise<ClientContactAvecAvertissementsDto> {
    const ctx = this.contexte.contexteTenant();
    return this.service.creerContact(ctx, clientId, entree);
  }

  @Patch(':contactId')
  @ExigerDroit('client.modifier')
  @ApiOperation({ summary: "Modification d'un contact (RM-04)." })
  @ApiParam({ name: 'clientId', format: 'uuid' })
  @ApiParam({ name: 'contactId', format: 'uuid' })
  @ApiOkResponse({ type: ClientContactAvecAvertissementsDto })
  @ApiReponseProbleme(400, 'Corps invalide.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Client ou contact introuvable pour ce tenant.')
  async modifier(
    @Param('clientId', new PipeZod(schemaUuid)) clientId: string,
    @Param('contactId', new PipeZod(schemaUuid)) contactId: string,
    @CorpsZod(schemaModificationContactClient, {
      exemple: { telephone: '+41 78 234 56 79', actif: true },
    })
    entree: EntreeModificationContact,
  ): Promise<ClientContactAvecAvertissementsDto> {
    const ctx = this.contexte.contexteTenant();
    return this.service.modifierContact(ctx, clientId, contactId, entree);
  }
}

@ApiTags('Clients')
@ApiCookieAuth()
@Controller({ path: 'clients/:clientId/conditions', version: '1' })
@UseGuards(GardeDroit)
export class ClientConditionController {
  constructor(
    private readonly service: ServiceClientSousCollections,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @Get()
  @ExigerDroit('client.lire')
  @ApiOperation({ summary: 'Conditions commerciales DATÉES du client (RM-07).' })
  @ApiParam({ name: 'clientId', format: 'uuid' })
  @ApiOkResponse({ type: PageClientConditionDto })
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Client introuvable pour ce tenant.')
  async lister(
    @Param('clientId', new PipeZod(schemaUuid)) clientId: string,
    @Query(new PipeZod(schemaPageSousCollection)) params: ParametresPageSousCollection,
  ): Promise<PageClientConditionDto> {
    const ctx = this.contexte.contexteTenant();
    return this.service.listerConditions(ctx, clientId, params);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ExigerDroit('client.condition.modifier')
  @ApiOperation({
    summary: 'Ouverture d’une nouvelle période de conditions commerciales (RM-07, CT-03).',
    description:
      'Aucun `PATCH` : une correction ouvre une NOUVELLE période. Un chevauchement de dates ' +
      "produit `400 VALIDATION_ECHOUEE`, jamais un `409` — c'est une erreur de saisie, pas un " +
      'conflit de ressource. Figées sur l’OR à sa création (RM-50).',
  })
  @ApiParam({ name: 'clientId', format: 'uuid' })
  @ApiResponse({ status: 201, type: ClientConditionAvecAvertissementsDto })
  @ApiReponseProbleme(400, 'Corps invalide ou période chevauchant une condition existante.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant (réservé à la direction).')
  @ApiReponseProbleme(404, 'Client introuvable pour ce tenant.')
  async creer(
    @Param('clientId', new PipeZod(schemaUuid)) clientId: string,
    @CorpsZod(schemaConditionClient, {
      exemple: {
        rabaisMoPourmille: 100,
        rabaisPiecesPourmille: 50,
        rabaisPneusPourmille: 0,
        tauxHoraireCode: 'FLOTTE',
        delaiPaiementJours: 30,
        modePaiement: 'virement',
        plafondCentimes: 500000,
        valideDuLe: '2026-01-01',
        valideAuLe: null,
      },
    })
    entree: EntreeConditionClient,
  ): Promise<ClientConditionAvecAvertissementsDto> {
    const ctx = this.contexte.contexteTenant();
    return this.service.creerCondition(ctx, clientId, entree);
  }
}

@ApiTags('Clients')
@ApiCookieAuth()
@Controller({ path: 'clients/:clientId/consentements', version: '1' })
@UseGuards(GardeDroit)
export class ClientConsentementController {
  constructor(
    private readonly service: ServiceClientSousCollections,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @Get()
  @ExigerDroit('client.lire')
  @ApiOperation({ summary: 'Consentements APPEND-ONLY du client (RM-09, nLPD).' })
  @ApiParam({ name: 'clientId', format: 'uuid' })
  @ApiOkResponse({ type: PageClientConsentementDto })
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Client introuvable pour ce tenant.')
  async lister(
    @Param('clientId', new PipeZod(schemaUuid)) clientId: string,
    @Query(new PipeZod(schemaPageSousCollection)) params: ParametresPageSousCollection,
  ): Promise<PageClientConsentementDto> {
    const ctx = this.contexte.contexteTenant();
    return this.service.listerConsentements(ctx, clientId, params);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ExigerDroit('client.consentement.enregistrer')
  @ApiOperation({
    summary: 'Enregistrement (ou révocation) d’un consentement (RM-09, nLPD).',
    description:
      'Aucun `PATCH` ni `DELETE` : une révocation est une NOUVELLE ligne `accorde: false`, ' +
      "jamais une mise à jour — c'est ce qui donne sa valeur de preuve.",
  })
  @ApiParam({ name: 'clientId', format: 'uuid' })
  @ApiResponse({ status: 201, type: ClientConsentementAvecAvertissementsDto })
  @ApiReponseProbleme(400, 'Corps invalide.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Client introuvable pour ce tenant.')
  async creer(
    @Param('clientId', new PipeZod(schemaUuid)) clientId: string,
    @CorpsZod(schemaConsentementClient, {
      exemple: {
        type: 'marketing_email',
        accorde: true,
        recueilliLe: '2026-07-28T09:15:00Z',
        canal: 'formulaire_reception',
      },
    })
    entree: EntreeConsentementClient,
  ): Promise<ClientConsentementAvecAvertissementsDto> {
    const ctx = this.contexte.contexteTenant();
    return this.service.creerConsentement(ctx, clientId, entree);
  }
}

@ApiTags('Clients')
@ApiCookieAuth()
@Controller({ path: 'clients/:clientId/notes', version: '1' })
@UseGuards(GardeDroit)
export class ClientNoteController {
  constructor(
    private readonly service: ServiceClientSousCollections,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @Get()
  @ExigerDroit('client.lire')
  @ApiOperation({
    summary: 'Notes du client (RM-13) — `alerte` remonte au contexte-atelier (RM-36).',
  })
  @ApiParam({ name: 'clientId', format: 'uuid' })
  @ApiOkResponse({ type: PageClientNoteDto })
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Client introuvable pour ce tenant.')
  async lister(
    @Param('clientId', new PipeZod(schemaUuid)) clientId: string,
    @Query(new PipeZod(schemaPageSousCollection)) params: ParametresPageSousCollection,
  ): Promise<PageClientNoteDto> {
    const ctx = this.contexte.contexteTenant();
    return this.service.listerNotes(ctx, clientId, params);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ExigerDroit('client.note.ecrire')
  @ApiOperation({ summary: "Ajout d'une note (RM-13)." })
  @ApiParam({ name: 'clientId', format: 'uuid' })
  @ApiResponse({ status: 201, type: ClientNoteAvecAvertissementsDto })
  @ApiReponseProbleme(400, 'Corps invalide.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Client introuvable pour ce tenant.')
  async creer(
    @Param('clientId', new PipeZod(schemaUuid)) clientId: string,
    @CorpsZod(schemaNoteClient, {
      exemple: {
        nature: 'alerte',
        texte: 'Client difficile — exiger un acompte de 50% avant toute intervention.',
      },
    })
    entree: EntreeNoteClient,
  ): Promise<ClientNoteAvecAvertissementsDto> {
    const ctx = this.contexte.contexteTenant();
    return this.service.creerNote(ctx, clientId, entree);
  }
}
