import {
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
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
import { z } from 'zod';
import {
  EN_TETE_IDEMPOTENCE,
  schemaArretPointage,
  schemaCorrectionPointage,
  schemaDemarragePointage,
  schemaFiltresPointages,
  schemaIdentifiant,
  schemaParametresAgregatTempsLigne,
  type EntreeArretPointage,
  type EntreeCorrectionPointage,
  type EntreeDemarragePointage,
  type ParametresAgregatTempsLigne,
} from '@dfa/shared';

import { ServiceContexteRequete } from '../common/contexte';
import { CorpsZod } from '../common/documentation';
import { ExigerDroit, GardeDroit } from '../common/droits';
import { ApiReponseProbleme } from '../common/erreurs';
import { PipeZod } from '../common/validation';

import {
  EnveloppePointageDto,
  PagePointageDto,
  ReponseAgregatTempsLigneDto,
  ReponsePointageDto,
} from './dto';
import { ServicePointage } from './service-pointage';

const EnveloppePointageResponseDto = EnveloppePointageDto(ReponsePointageDto, 'Pointage');
const PagePointageResponseDto = PagePointageDto(ReponsePointageDto, 'Pointage');

const schemaListePointages = schemaFiltresPointages.extend({
  limite: z.coerce.number().int().min(1).max(200).default(50),
  curseur: z.string().max(512).optional(),
});
type EntreeListePointages = z.infer<typeof schemaListePointages>;

/**
 * Pointage (RM-87 → RM-99, RM-113 → RM-123, `docs/specification-pointage.md`) : démarrer, arrêter,
 * corriger, lire — racine `/pointages`, PAS nichée sous `/ordres-reparation/{orId}` (RM-87 admet une
 * cible `indirect` sans OR, voir l'en-tête de `contrats/pointage/pointage.ts`).
 *
 * DROITS — les six actions `atelier.pointage.*` que ce contrôleur consomme (`demarrer`, `arreter`,
 * `lire`, `corriger_autrui`, `verrouiller_periode`, `deverrouiller_periode`) sont posées et câblées
 * par rôle dans `apps/api/src/auth/matrice-droits.ts` (bloc `DROITS_POINTAGE_PAR_ROLE`, vérifié au
 * 2026-08-03) — CORRECTIF d'un commentaire antérieur de ce fichier qui les décrivait comme absentes
 * (elles l'étaient au moment où ce contrôleur a été écrit ; le bloc additif a été posé depuis par le
 * coordinateur). Ces routes sont donc VIVANTES, pas mortes.
 */
@ApiTags('Pointage')
@ApiCookieAuth()
@Controller({ path: 'pointages', version: '1' })
@UseGuards(GardeDroit)
export class PointageController {
  constructor(
    private readonly service: ServicePointage,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @Get()
  @ExigerDroit('atelier.pointage.lire')
  @ApiOperation({
    summary:
      'Collection paginée des pointages — `statut=en_cours` couvre « qui est pointé en ce moment » (pas de route dédiée).',
    description:
      'Un rôle sans vue équipe (`atelier.pointage.lire_equipe`) ne voit QUE ses propres pointages, quel que soit `technicienId` demandé ' +
      '(restriction appliquée côté service, voir `ServicePointage.lister`).',
  })
  @ApiOkResponse({ type: PagePointageResponseDto })
  @ApiReponseProbleme(400, 'Filtres, tri ou curseur invalides.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  async lister(@Query(new PipeZod(schemaListePointages)) query: EntreeListePointages) {
    const ctx = this.contexte.contexteTenant();
    const principal = this.contexte.exigerPrincipal();
    const { limite, curseur, ...filtres } = query;
    return this.service.lister(ctx, principal, filtres, limite, curseur);
  }

  @Get('agregats-ligne')
  @ExigerDroit('atelier.pointage.lire')
  @ApiOperation({
    summary:
      "Par ligne de l'OR : temps réellement pointé vs temps facturé (barème) — RM-99, « c'est précisément l'écart qui a de la valeur ».",
    description:
      'Déclarée AVANT `GET /pointages/{id}` dans ce contrôleur : `agregats-ligne` ne doit jamais être capturé par `:id` (ordre de ' +
      'déclaration des routes NestJS). Aucune restriction de vue équipe : cet agrégat ne nomme aucun technicien, seulement des totaux ' +
      "par ligne. Une ligne sans temps barémé ET sans aucun pointage n'apparaît pas dans la réponse.",
  })
  @ApiOkResponse({ type: ReponseAgregatTempsLigneDto })
  @ApiReponseProbleme(400, 'ordreReparationId manquant ou mal formé.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Ordre de réparation introuvable pour ce tenant.')
  async agregatsLigne(
    @Query(new PipeZod(schemaParametresAgregatTempsLigne)) query: ParametresAgregatTempsLigne,
  ) {
    const ctx = this.contexte.contexteTenant();
    return this.service.obtenirAgregatsLigne(ctx, query.ordreReparationId);
  }

  @Get(':id')
  @ExigerDroit('atelier.pointage.lire')
  @ApiOperation({
    summary:
      'Un pointage précis — le sien, ou celui d’un technicien encadré (`atelier.pointage.lire_equipe`, restriction en service).',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ReponsePointageDto })
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(
    404,
    'Pointage introuvable pour ce tenant, ou appartenant à un autre technicien sans vue équipe.',
  )
  async obtenir(@Param('id', new PipeZod(schemaIdentifiant)) id: string) {
    const ctx = this.contexte.contexteTenant();
    const principal = this.contexte.exigerPrincipal();
    return this.service.obtenir(ctx, principal, id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ExigerDroit('atelier.pointage.demarrer')
  @ApiOperation({
    summary:
      'Démarre un pointage — RM-87 (trois cibles), RM-89/90 (clôture automatique du pointage encore ouvert), RM-117 (cascade ligne_or/OR).',
    description:
      "DEUX identifiants distincts (voir `schemaDemarragePointage`) : `Idempotency-Key` (l'ÉVÉNEMENT « démarrer ») ET `id` du corps " +
      '(le POINTAGE lui-même, généré côté client, uuid v4 — idempotence hors ligne). Un rejeu avec la MÊME Idempotency-Key rejoue la ' +
      "même réponse ; un rejeu avec un `id` déjà pris mais une Idempotency-Key différente rejoue si c'est le même geste (`200`), " +
      'sinon `409 CONFLIT`.',
  })
  @ApiHeader({
    name: EN_TETE_IDEMPOTENCE,
    required: true,
    description: "uuid v4 — porte sur l'événement « démarrer », pas sur le pointage.",
  })
  @ApiResponse({ status: 201, type: EnveloppePointageResponseDto })
  @ApiResponse({
    status: 200,
    description: 'Rejeu idempotent (même `id`, même geste) — le pointage existant, inchangé.',
    type: EnveloppePointageResponseDto,
  })
  @ApiReponseProbleme(
    400,
    'Corps invalide, Idempotency-Key manquante/mal formée, ou incohérence site/OR.',
  )
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(
    404,
    'Ordre de réparation, ligne, technicien ou site introuvable pour ce tenant.',
  )
  @ApiReponseProbleme(
    409,
    'POINTAGE_OR_NON_MODIFIABLE (RM-92), POINTAGE_LIGNE_NON_POINTABLE (RM-93), CONFLIT (id déjà pris) ou IDEMPOTENCE_CONFLIT.',
  )
  async demarrer(
    @CorpsZod(schemaDemarragePointage, {
      exemple: {
        id: '9c1a8e6f-2d4b-47a1-8b0c-5a1c9e2e2f0a',
        siteId: '5a1c9e2e-2f0a-4b3a-9c1a-8e6f2d4b7a10',
        technicienId: '6c9e2d4b-7a10-4e2e-8f0a-1c9e2e2f0a4b',
        nature: 'productif_ligne',
        ordreReparationId: '1c9e2e2f-0a4b-47a1-8b0c-5a1c9e2e2f0a',
        ligneOrId: '2d4b7a10-4e2e-48f0-a1c9-e2e2f0a4b7a1',
        debutLe: '2026-07-31T08:00:00.000Z',
        source: 'ecran_atelier',
      },
    })
    entree: EntreeDemarragePointage,
    @Headers(EN_TETE_IDEMPOTENCE.toLowerCase()) cleIdempotence: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<unknown> {
    const ctx = this.contexte.contexteTenant();
    const resultat = await this.service.demarrer(ctx, entree, cleIdempotence ?? '');
    res.status(resultat.reponse.statutHttp);
    if (resultat.rejoue) res.setHeader('Idempotency-Rejeu', 'true');
    return resultat.reponse.corps;
  }

  @Post(':id/arreter')
  @ExigerDroit('atelier.pointage.arreter')
  @ApiOperation({
    summary:
      '`en_cours -> termine` (RM-116 : c’est aussi le mécanisme d’une pause — deux appels ordinaires, jamais un état intermédiaire).',
    description:
      '`Idempotency-Key` obligatoire ICI AUSSI (déviation du reste de l’API) : hors ligne, un rejeu réseau ne doit jamais produire un faux échec sur un arrêt déjà réussi.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiHeader({ name: EN_TETE_IDEMPOTENCE, required: true, description: 'uuid v4.' })
  @ApiOkResponse({ type: EnveloppePointageResponseDto })
  @ApiReponseProbleme(
    400,
    'Corps invalide, POINTAGE_HORODATAGE_INVALIDE (fin antérieure au début), ou Idempotency-Key manquante/mal formée.',
  )
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Pointage introuvable pour ce tenant.')
  @ApiReponseProbleme(409, 'POINTAGE_TRANSITION_INTERDITE (déjà arrêté) ou IDEMPOTENCE_CONFLIT.')
  async arreter(
    @Param('id', new PipeZod(schemaIdentifiant)) id: string,
    @CorpsZod(schemaArretPointage, { exemple: { finLe: '2026-07-31T09:30:00.000Z' } })
    entree: EntreeArretPointage,
    @Headers(EN_TETE_IDEMPOTENCE.toLowerCase()) cleIdempotence: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<unknown> {
    const ctx = this.contexte.contexteTenant();
    const resultat = await this.service.arreter(ctx, id, entree, cleIdempotence ?? '');
    res.status(resultat.reponse.statutHttp);
    if (resultat.rejoue) res.setHeader('Idempotency-Rejeu', 'true');
    return resultat.reponse.corps;
  }

  @Post(':id/corriger')
  @ExigerDroit('atelier.pointage.corriger_autrui')
  @ApiOperation({
    summary:
      'RM-94 : correction — motif obligatoire dès qu’un champ change, valeur d’origine conservée, journalisée.',
    description:
      'UN SEUL endpoint pour tous les cas de correction (RM-94 littéral, réaffectation RM-123, classement en improductif RM-123). ' +
      "`motif` optionnel au niveau du schéma : le serveur l'exige (`400 POINTAGE_MOTIF_REQUIS`) UNIQUEMENT si au moins un champ change réellement.",
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiHeader({ name: EN_TETE_IDEMPOTENCE, required: true, description: 'uuid v4.' })
  @ApiOkResponse({ type: EnveloppePointageResponseDto })
  @ApiReponseProbleme(
    400,
    'Corps invalide, POINTAGE_MOTIF_REQUIS, POINTAGE_HORODATAGE_INVALIDE, ou Idempotency-Key manquante/mal formée.',
  )
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Pointage introuvable pour ce tenant.')
  @ApiReponseProbleme(409, 'POINTAGE_PERIODE_VERROUILLEE (RM-95) ou IDEMPOTENCE_CONFLIT.')
  async corriger(
    @Param('id', new PipeZod(schemaIdentifiant)) id: string,
    @CorpsZod(schemaCorrectionPointage, {
      exemple: { finLe: '2026-07-31T09:30:00.000Z', motif: "Oubli d'arrêt en fin de journée." },
    })
    entree: EntreeCorrectionPointage,
    @Headers(EN_TETE_IDEMPOTENCE.toLowerCase()) cleIdempotence: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<unknown> {
    const ctx = this.contexte.contexteTenant();
    const principal = this.contexte.exigerPrincipal();
    const resultat = await this.service.corriger(ctx, principal, id, entree, cleIdempotence ?? '');
    res.status(resultat.reponse.statutHttp);
    if (resultat.rejoue) res.setHeader('Idempotency-Rejeu', 'true');
    return resultat.reponse.corps;
  }
}
