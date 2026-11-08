import { Controller, Headers, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import {
  EN_TETE_IDEMPOTENCE,
  schemaActionAbsenceRendezVous,
  schemaActionAnnulerRendezVous,
  schemaActionArriveeRendezVous,
  schemaIdentifiant,
  type EntreeActionAnnulerRendezVous,
  type EntreeActionArriveeRendezVous,
} from '@dfa/shared';

import { ServiceContexteRequete } from '../common/contexte';
import { CorpsZod } from '../common/documentation';
import { ExigerDroit, GardeDroit } from '../common/droits';
import { ApiReponseProbleme } from '../common/erreurs';
import { PipeZod } from '../common/validation';
import { EnveloppeOrDto } from '../atelier/dto';

import { ReponseRendezVousDto } from './dto';
import { ServiceRendezVous } from './service-rendez-vous';
import { ExigerModule } from '../common/droits/garde-module';

const EnveloppeRendezVousDto = EnveloppeOrDto(ReponseRendezVousDto, 'RendezVousTransition');

/**
 * Les trois actions du cycle de vie du rendez-vous (§7 métier) : chacune porte son geste, son
 * droit et ses codes d'erreur propres — jamais un `PATCH {"statut": ...}` générique, même
 * doctrine que `ordre-reparation-transitions.controller.ts`.
 */
@ApiTags('Rendez-vous — transitions')
@ApiCookieAuth()
@ExigerModule('planning')
@Controller({ path: 'rendez-vous', version: '1' })
@UseGuards(GardeDroit)
export class RendezVousTransitionsController {
  constructor(
    private readonly service: ServiceRendezVous,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @Post(':id/arrivee')
  @HttpCode(HttpStatus.OK)
  @ExigerDroit('rendez_vous.arrivee')
  @ApiOperation({
    summary:
      "Le véhicule arrive : réutilise T-03 (`planifie -> ouvert`) si un OR est déjà lié, sinon crée l'OR directement `ouvert` — jamais une seconde machine à états.",
    description:
      "`honore` n'est jamais déclaré manuellement (RV-18), c'est un effet de bord de cette action. " +
      'Amorce `restitutionPromiseLe` depuis la durée estimée du rendez-vous (le cœur du chantier).',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiHeader({
    name: EN_TETE_IDEMPOTENCE,
    required: true,
    description:
      "uuid v4 — porte sur la création de l'OR si aucun n'est encore lié à ce rendez-vous.",
  })
  @ApiOkResponse({ type: EnveloppeRendezVousDto })
  @ApiReponseProbleme(400, 'Corps invalide, ou Idempotency-Key manquante/mal formée.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Rendez-vous introuvable pour ce tenant.')
  @ApiReponseProbleme(
    409,
    'RDV_TRANSITION_INTERDITE ou RDV_IDENTIFICATION_INCOMPLETE (aucun véhicule connu).',
  )
  async arrivee(
    @Param('id', new PipeZod(schemaIdentifiant)) id: string,
    @CorpsZod(schemaActionArriveeRendezVous, {
      exemple: { kilometrageEntree: 84_500, unite: 'km' },
    })
    entree: EntreeActionArriveeRendezVous,
    @Headers('idempotency-key') cleIdempotence: string | undefined,
  ) {
    const ctx = this.contexte.contexteTenant();
    const principal = this.contexte.exigerPrincipal();
    return this.service.arrivee(ctx, principal, id, entree, cleIdempotence ?? '');
  }

  @Post(':id/absence')
  @HttpCode(HttpStatus.OK)
  @ExigerDroit('rendez_vous.absence')
  @ApiOperation({
    summary: 'Le véhicule ne s’est pas présenté (RV-24) — constat manuel, sans motif.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ReponseRendezVousDto })
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Rendez-vous introuvable pour ce tenant.')
  @ApiReponseProbleme(409, 'RDV_TRANSITION_INTERDITE (déjà honoré/absent/annulé).')
  async absence(
    @Param('id', new PipeZod(schemaIdentifiant)) id: string,
    @CorpsZod(schemaActionAbsenceRendezVous, { exemple: {} }) _entree: unknown,
  ) {
    const ctx = this.contexte.contexteTenant();
    return this.service.absence(ctx, id);
  }

  @Post(':id/annuler')
  @HttpCode(HttpStatus.OK)
  @ExigerDroit('rendez_vous.annuler')
  @ApiOperation({ summary: 'Annulation — motif obligatoire, jamais silencieuse.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ReponseRendezVousDto })
  @ApiReponseProbleme(400, 'Motif manquant.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Rendez-vous introuvable pour ce tenant.')
  @ApiReponseProbleme(409, 'RDV_ANNULATION_IMPOSSIBLE (déjà honoré/absent/annulé).')
  async annuler(
    @Param('id', new PipeZod(schemaIdentifiant)) id: string,
    @CorpsZod(schemaActionAnnulerRendezVous, {
      exemple: { motif: 'Client reporte, véhicule pas encore prêt.' },
    })
    entree: EntreeActionAnnulerRendezVous,
  ) {
    const ctx = this.contexte.contexteTenant();
    return this.service.annuler(ctx, id, entree);
  }
}
