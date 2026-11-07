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
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { z } from 'zod';
import {
  schemaCreationPretCourtoisie,
  schemaCreationVehiculeCourtoisie,
  schemaFiltresPretsCourtoisie,
  schemaFiltresVehiculesCourtoisie,
  schemaIdentifiant,
  schemaKilometrage,
  schemaModificationVehiculeCourtoisie,
  schemaRetourPretCourtoisie,
  STATUTS_PRET_COURTOISIE_UTILISES,
  type EntreeCreationPretCourtoisie,
  type EntreeCreationVehiculeCourtoisie,
  type EntreeModificationVehiculeCourtoisie,
  type EntreeRetourPretCourtoisie,
  type FiltresVehiculesCourtoisie,
} from '@dfa/shared';

import { ServiceContexteRequete } from '../../common/contexte';
import { CorpsZod } from '../../common/documentation';
import { ExigerDroit, GardeDroit } from '../../common/droits';
import { ApiReponseProbleme } from '../../common/erreurs';
import { Horloge } from '../../common/horloge/horloge';
import { PipeZod } from '../../common/validation';
import { PageOrDto } from '../dto';

import {
  ReponseListeVehiculesCourtoisieDto,
  ReponsePretCourtoisieDto,
  ReponseVehiculeCourtoisieDto,
} from './dto';
import { ServiceCourtoisie } from './service-courtoisie';

const PagePretCourtoisieDto = PageOrDto(ReponsePretCourtoisieDto, 'PretCourtoisie');

const schemaListePrets = schemaFiltresPretsCourtoisie.extend({
  limite: z.coerce.number().int().min(1).max(200).default(50),
  curseur: z.string().max(512).optional(),
});
type EntreeListePrets = z.infer<typeof schemaListePrets>;

const schemaRemise = z.object({ kmDepart: schemaKilometrage.optional() }).strict();

/**
 * Véhicules de courtoisie : parc du garage, disponibilité par période, prêts aux clients.
 * Le tenant vient de la session. `GET /courtoisie/vehicules` répond « avez-vous une voiture libre
 * jeudi ? » avec `?du=&au=`.
 */
@ApiTags('Courtoisie')
@ApiCookieAuth()
@Controller({ path: 'courtoisie', version: '1' })
@UseGuards(GardeDroit)
export class CourtoisieController {
  constructor(
    private readonly service: ServiceCourtoisie,
    private readonly contexte: ServiceContexteRequete,
    private readonly horloge: Horloge,
  ) {}

  @Get('vehicules')
  @ExigerDroit('courtoisie.lire')
  @ApiOperation({
    summary: 'Parc de courtoisie et disponibilité sur une période.',
    description:
      "Sans `du`/`au` : disponibilité à l'instant. Un prêt en cours non rendu occupe la voiture " +
      'au-delà de sa fin prévue. `disponibilite` : `libre`, `occupe` ou `indisponible` (entretien, hors service).',
  })
  @ApiQuery({ name: 'du', required: false, type: String, format: 'date-time' })
  @ApiQuery({ name: 'au', required: false, type: String, format: 'date-time' })
  @ApiOkResponse({ type: ReponseListeVehiculesCourtoisieDto })
  @ApiReponseProbleme(400, 'Période invalide.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  async listerVehicules(
    @Query(new PipeZod(schemaFiltresVehiculesCourtoisie)) filtres: FiltresVehiculesCourtoisie,
  ) {
    return this.service.listerVehicules(
      this.contexte.contexteTenant(),
      filtres,
      this.horloge.maintenant(),
    );
  }

  @Post('vehicules')
  @HttpCode(HttpStatus.CREATED)
  @ExigerDroit('courtoisie.parc.gerer')
  @ApiOperation({ summary: 'Ajouter un véhicule au parc de courtoisie.' })
  @ApiCreatedResponse({ type: ReponseVehiculeCourtoisieDto })
  @ApiReponseProbleme(400, 'Corps invalide.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  async creerVehicule(
    @CorpsZod(schemaCreationVehiculeCourtoisie, {
      exemple: { designation: 'VW Polo', plaque: 'VD 123 456' },
    })
    entree: EntreeCreationVehiculeCourtoisie,
  ) {
    return this.service.creerVehicule(this.contexte.contexteTenant(), entree);
  }

  @Patch('vehicules/:id')
  @ExigerDroit('courtoisie.parc.gerer')
  @ApiOperation({
    summary: 'Corriger un véhicule du parc ou le mettre en entretien / hors service.',
    description: 'Aucun `DELETE` : un véhicule retiré du parc passe `hors_service`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ReponseVehiculeCourtoisieDto })
  @ApiReponseProbleme(400, 'Corps invalide.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Véhicule de courtoisie introuvable pour ce tenant.')
  async modifierVehicule(
    @Param('id', new PipeZod(schemaIdentifiant)) id: string,
    @CorpsZod(schemaModificationVehiculeCourtoisie, { exemple: { etat: 'en_entretien' } })
    entree: EntreeModificationVehiculeCourtoisie,
  ) {
    return this.service.modifierVehicule(this.contexte.contexteTenant(), id, entree);
  }

  @Get('prets')
  @ExigerDroit('courtoisie.lire')
  @ApiOperation({
    summary: "Prêts, filtrables par client, OR, véhicule ou statut (le plus récent d'abord).",
  })
  @ApiQuery({ name: 'clientId', required: false, type: String, format: 'uuid' })
  @ApiQuery({ name: 'ordreReparationId', required: false, type: String, format: 'uuid' })
  @ApiQuery({ name: 'vehiculeCourtoisieId', required: false, type: String, format: 'uuid' })
  @ApiQuery({ name: 'statut', required: false, enum: STATUTS_PRET_COURTOISIE_UTILISES })
  @ApiQuery({ name: 'limite', required: false, type: Number, example: 50 })
  @ApiQuery({ name: 'curseur', required: false, type: String })
  @ApiOkResponse({ type: PagePretCourtoisieDto })
  @ApiReponseProbleme(400, 'Filtres ou curseur invalides.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  async listerPrets(@Query(new PipeZod(schemaListePrets)) query: EntreeListePrets) {
    const { limite, curseur, ...filtres } = query;
    return this.service.listerPrets(
      this.contexte.contexteTenant(),
      filtres,
      limite,
      curseur,
      this.horloge.maintenant(),
    );
  }

  @Post('prets')
  @HttpCode(HttpStatus.CREATED)
  @ExigerDroit('courtoisie.preter')
  @ApiOperation({
    summary: 'Prêter (ou réserver) un véhicule de courtoisie à un client.',
    description:
      'Début atteint : prêt `en_cours` ; début futur : `reserve`. `409 CONFLIT` si le véhicule est ' +
      'déjà prêté sur la période ou hors du parc prêtable. `ordreReparationId` / `rendezVousId` facultatifs.',
  })
  @ApiCreatedResponse({ type: ReponsePretCourtoisieDto })
  @ApiReponseProbleme(400, 'Corps invalide.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Véhicule, client, OR ou rendez-vous introuvable pour ce tenant.')
  @ApiReponseProbleme(409, 'Véhicule indisponible sur la période.')
  async creerPret(
    @CorpsZod(schemaCreationPretCourtoisie, {
      exemple: {
        vehiculeCourtoisieId: '00000000-0000-4000-8000-000000000001',
        clientId: '00000000-0000-4000-8000-000000000002',
        debutLe: '2026-11-12T07:30:00.000Z',
        finPrevueLe: '2026-11-12T16:00:00.000Z',
      },
    })
    entree: EntreeCreationPretCourtoisie,
  ) {
    const principal = this.contexte.exigerPrincipal();
    return this.service.creerPret(
      this.contexte.contexteTenant(),
      principal.utilisateurId,
      entree,
      this.horloge.maintenant(),
    );
  }

  @Post('prets/:id/remettre')
  @HttpCode(HttpStatus.OK)
  @ExigerDroit('courtoisie.preter')
  @ApiOperation({ summary: 'Remettre les clés : un prêt réservé devient en cours.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ReponsePretCourtoisieDto })
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Prêt introuvable pour ce tenant.')
  @ApiReponseProbleme(409, "Le prêt n'est pas réservé.")
  async remettre(
    @Param('id', new PipeZod(schemaIdentifiant)) id: string,
    @CorpsZod(schemaRemise, { exemple: { kmDepart: 48000 } }) corps: z.infer<typeof schemaRemise>,
  ) {
    return this.service.remettre(
      this.contexte.contexteTenant(),
      id,
      corps.kmDepart,
      this.horloge.maintenant(),
    );
  }

  @Post('prets/:id/rendre')
  @HttpCode(HttpStatus.OK)
  @ExigerDroit('courtoisie.preter')
  @ApiOperation({ summary: 'Enregistrer le retour du véhicule (km retour facultatif).' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ReponsePretCourtoisieDto })
  @ApiReponseProbleme(400, 'Corps invalide ou km retour inférieur au départ.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Prêt introuvable pour ce tenant.')
  @ApiReponseProbleme(409, "Le prêt n'est pas en cours.")
  async rendre(
    @Param('id', new PipeZod(schemaIdentifiant)) id: string,
    @CorpsZod(schemaRetourPretCourtoisie, { exemple: { kmRetour: 48210 } })
    entree: EntreeRetourPretCourtoisie,
  ) {
    return this.service.rendre(
      this.contexte.contexteTenant(),
      id,
      entree,
      this.horloge.maintenant(),
    );
  }

  @Post('prets/:id/annuler')
  @HttpCode(HttpStatus.OK)
  @ExigerDroit('courtoisie.preter')
  @ApiOperation({ summary: 'Annuler un prêt réservé ou saisi par erreur.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ReponsePretCourtoisieDto })
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Prêt introuvable pour ce tenant.')
  @ApiReponseProbleme(409, 'Prêt déjà terminé ou annulé.')
  async annuler(@Param('id', new PipeZod(schemaIdentifiant)) id: string) {
    return this.service.annuler(this.contexte.contexteTenant(), id, this.horloge.maintenant());
  }
}
