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
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import {
  EN_TETE_IDEMPOTENCE,
  schemaCreationRendezVous,
  schemaFiltresCapaciteRendezVous,
  schemaFiltresRendezVous,
  schemaIdentifiant,
  schemaModificationRendezVous,
  STATUTS_RDV,
  TRIS_RENDEZ_VOUS,
  type EntreeCreationRendezVous,
  type EntreeModificationRendezVous,
  type FiltresCapaciteRendezVous,
} from '@dfa/shared';

import { ServiceContexteRequete } from '../common/contexte';
import { CorpsZod } from '../common/documentation';
import { ExigerDroit, GardeDroit } from '../common/droits';
import { ApiReponseProbleme } from '../common/erreurs';
import { PipeZod } from '../common/validation';
import { EnveloppeOrDto, PageOrDto } from '../atelier/dto';

import { ReponseCapaciteRendezVousDto, ReponseRendezVousDto } from './dto';
import { ServiceCapaciteRendezVous } from './service-capacite-rendez-vous';
import { ServiceRendezVous } from './service-rendez-vous';

const EnveloppeRendezVousDto = EnveloppeOrDto(ReponseRendezVousDto, 'RendezVous');
const PageRendezVousDto = PageOrDto(ReponseRendezVousDto, 'RendezVous');

/** `?limite=&curseur=` fusionnés au filtre domaine — même pattern que `ordre-reparation.controller.ts`. */
const schemaListeRendezVous = schemaFiltresRendezVous.extend({
  limite: z.coerce.number().int().min(1).max(200).default(50),
  curseur: z.string().max(512).optional(),
});
type EntreeListeRendezVous = z.infer<typeof schemaListeRendezVous>;

/**
 * Rendez-vous d'atelier — ressource (liste, capacité, création, fiche, déplacement). Les trois
 * actions (arrivée/absence/annulation) sont dans `rendez-vous-transitions.controller.ts` — même
 * découpage que `ordres-reparation`/`ordres-reparation-transitions`.
 *
 * ORDRE DES ROUTES : `capacite` déclaré AVANT `:id` — sinon Nest router matcherait
 * `GET /rendez-vous/capacite` comme `GET /rendez-vous/:id` avec `id = "capacite"`.
 */
@ApiTags('Rendez-vous')
@ApiCookieAuth()
@Controller({ path: 'rendez-vous', version: '1' })
@UseGuards(GardeDroit)
export class RendezVousController {
  constructor(
    private readonly service: ServiceRendezVous,
    private readonly serviceCapacite: ServiceCapaciteRendezVous,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @Get()
  @ExigerDroit('rendez_vous.lire')
  @ApiOperation({ summary: 'Rendez-vous de la période demandée, pour un site.' })
  @ApiQuery({ name: 'du', required: true, type: String, format: 'date', example: '2026-08-01' })
  @ApiQuery({ name: 'au', required: true, type: String, format: 'date', example: '2026-08-31' })
  @ApiQuery({ name: 'siteId', required: false, type: String, format: 'uuid' })
  @ApiQuery({ name: 'statut', required: false, enum: STATUTS_RDV })
  @ApiQuery({ name: 'clientId', required: false, type: String, format: 'uuid' })
  @ApiQuery({
    name: 'vehiculeId',
    required: false,
    type: String,
    format: 'uuid',
    description:
      "Rendez-vous d'un véhicule précis (fiche véhicule), indépendant du détenteur courant.",
  })
  @ApiQuery({ name: 'tri', required: false, enum: TRIS_RENDEZ_VOUS })
  @ApiQuery({ name: 'limite', required: false, type: Number, example: 50 })
  @ApiQuery({ name: 'curseur', required: false, type: String })
  @ApiOkResponse({ type: PageRendezVousDto })
  @ApiReponseProbleme(400, 'Filtres, tri ou curseur invalides.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  async lister(@Query(new PipeZod(schemaListeRendezVous)) query: EntreeListeRendezVous) {
    const ctx = this.contexte.contexteTenant();
    const { limite, curseur, ...filtres } = query;
    return this.service.lister(ctx, filtres, limite, curseur);
  }

  @Get('capacite')
  @ExigerDroit('rendez_vous.lire')
  @ApiOperation({
    summary: 'Capacité par jour et par moment (RV-06/RV-07/RV-08) — informe, ne bloque jamais.',
    description:
      "`capaciteMinutes: null` + `etat: 'non_definie'` sur un site jamais paramétré : jamais `0`, jamais `'disponible'`.",
  })
  @ApiOkResponse({ type: ReponseCapaciteRendezVousDto })
  @ApiReponseProbleme(400, 'Filtres invalides ou période trop longue.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  async capacite(
    @Query(new PipeZod(schemaFiltresCapaciteRendezVous)) filtres: FiltresCapaciteRendezVous,
  ) {
    const ctx = this.contexte.contexteTenant();
    return this.serviceCapacite.capacite(ctx, filtres);
  }

  @Get(':id')
  @ExigerDroit('rendez_vous.lire')
  @ApiOperation({ summary: 'Fiche complète du rendez-vous.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ReponseRendezVousDto })
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Rendez-vous introuvable pour ce tenant.')
  async obtenir(@Param('id', new PipeZod(schemaIdentifiant)) id: string) {
    const ctx = this.contexte.contexteTenant();
    return this.service.obtenir(ctx, id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ExigerDroit('rendez_vous.creer')
  @ApiOperation({
    summary: 'Prise de rendez-vous (§6 métier) — motif OBLIGATOIRE (choix produit #2).',
    description:
      '`Idempotency-Key` obligatoire (uuid v4). Surbooking jamais bloquant : avertit via ' +
      '`PLANNING_CAPACITE_DEPASSEE` si la capacité du (jour, moment) est déjà atteinte.',
  })
  @ApiHeader({ name: EN_TETE_IDEMPOTENCE, required: true, description: 'uuid v4.' })
  @ApiResponse({ status: 201, type: EnveloppeRendezVousDto })
  @ApiReponseProbleme(
    400,
    'Corps invalide, Idempotency-Key manquante/mal formée, ou motif sans durée par défaut sans dureeEstimeeMinutes fourni.',
  )
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Client, véhicule, motif ou site introuvable pour ce tenant.')
  @ApiReponseProbleme(409, 'IDEMPOTENCE_CONFLIT.')
  async creer(
    @CorpsZod(schemaCreationRendezVous, {
      exemple: {
        siteId: '11111111-1111-1111-1111-111111111111',
        clientId: '22222222-2222-2222-2222-222222222222',
        motifId: '33333333-3333-3333-3333-333333333333',
        type: 'service',
        dateLe: '2026-08-20',
        moment: 'matin',
      },
    })
    entree: EntreeCreationRendezVous,
    @Headers('idempotency-key') cleIdempotence: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<unknown> {
    const ctx = this.contexte.contexteTenant();
    const principal = this.contexte.exigerPrincipal();
    const resultat = await this.service.creer(ctx, principal, entree, cleIdempotence ?? '');
    res.status(resultat.statutHttp);
    return resultat.corps;
  }

  @Patch(':id')
  @ExigerDroit('rendez_vous.modifier')
  @ApiOperation({
    summary: 'Déplace ou corrige un rendez-vous encore `confirme` (RV-16).',
    description:
      "N'accepte jamais de statut — voir les actions dédiées (arrivée/absence/annulation).",
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ReponseRendezVousDto })
  @ApiReponseProbleme(400, 'Corps invalide.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Rendez-vous ou véhicule introuvable pour ce tenant.')
  @ApiReponseProbleme(409, 'RDV_TRANSITION_INTERDITE (déjà honoré/absent/annulé).')
  async modifier(
    @Param('id', new PipeZod(schemaIdentifiant)) id: string,
    @CorpsZod(schemaModificationRendezVous, {
      exemple: { dateLe: '2026-08-21', moment: 'apres_midi' },
    })
    entree: EntreeModificationRendezVous,
  ) {
    const ctx = this.contexte.contexteTenant();
    return this.service.modifier(ctx, id, entree);
  }
}
