import { Controller, HttpCode, HttpStatus, Post, Put, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { schemaIdentificationPin, type EntreeIdentificationPin } from '@dfa/shared';

import { ServiceContexteRequete } from '../common/contexte';
import { CorpsZod } from '../common/documentation';
import { ExigerDroit, GardeDroit } from '../common/droits';
import { ApiReponseProbleme } from '../common/erreurs';

import { ReponseIdentificationPinDto, ReponsePinPointageDto } from './dto';
import {
  schemaAttributionPin,
  schemaRevocationPin,
  type EntreeAttributionPin,
  type EntreeRevocationPin,
} from './pin-contrats';
import { ServiceIdentificationPin } from './service-identification-pin';
import { ExigerModule } from '../common/droits/garde-module';

/**
 * Mode « borne partagée » du pointage (`docs/specification-pointage-borne.md`). Deux surfaces, deux
 * droits distincts, sur le même préfixe `/pointages` que `PointageController` (routes disjointes) :
 *
 *  - `POST /pointages/identification` — la BORNE seule (`atelier.pointage.identifier`, rôle
 *    `poste_atelier`) : reconnaît un technicien par PIN. N'ouvre AUCUNE session, ne pose aucun
 *    cookie/jeton — la réponse dit seulement « voici qui c'est » (contrat `identification.ts`). Le
 *    site vient de la SESSION de la borne, jamais de la requête.
 *  - `PUT /pointages/pins` et `POST /pointages/pins/revocation` — l'ENCADREMENT
 *    (`atelier.pointage.gerer_pin`, chef_atelier/direction/admin) : attribuer/réinitialiser/révoquer
 *    le PIN d'un technicien sur un site. Le PIN est haché en Argon2id, jamais stocké ni renvoyé en
 *    clair (RM-126).
 *
 * `@ExigerDroit` est posé sur CHAQUE route (les deux actions étaient jusqu'ici « inertes anticipées »
 * dans `common/droits/allowlist-actions-non-decorees.ts` — leurs entrées y ont été retirées puisque
 * ces routes les exercent désormais réellement).
 */
@ApiTags('Pointage')
@ApiCookieAuth()
@ExigerModule('tablettes')
@Controller({ path: 'pointages', version: '1' })
@UseGuards(GardeDroit)
export class PinController {
  constructor(
    private readonly service: ServiceIdentificationPin,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @Post('identification')
  @HttpCode(HttpStatus.OK)
  @ExigerDroit('atelier.pointage.identifier')
  @ApiOperation({
    summary:
      'Reconnaît un technicien par son code PIN sur la borne — N’OUVRE AUCUNE SESSION (RM-113/RM-115).',
    description:
      'Réservé au compte de service de la borne (`poste_atelier`). Le site est résolu depuis la SESSION de la borne, ' +
      'jamais de la requête. Anti-balayage RM-129 : verrouillage progressif scopé sur l’identité de la borne.',
  })
  @ApiOkResponse({ type: ReponseIdentificationPinDto })
  @ApiReponseProbleme(400, 'Code PIN mal formé (attendu : 4 chiffres).')
  @ApiReponseProbleme(
    401,
    'Session absente/expirée, ou POINTAGE_PIN_INVALIDE (aucun technicien actif ne porte ce PIN).',
  )
  @ApiReponseProbleme(403, 'Droit insuffisant (route réservée à la borne).')
  @ApiReponseProbleme(
    423,
    'POINTAGE_PIN_VERROUILLE — trop de tentatives ; `Retry-After` porte la durée restante.',
  )
  async identifier(
    @CorpsZod(schemaIdentificationPin, { exemple: { codePin: '4071' } })
    entree: EntreeIdentificationPin,
  ): Promise<ReponseIdentificationPinDto> {
    const ctx = this.contexte.contexteTenant();
    const principal = this.contexte.exigerPrincipal();
    return this.service.identifier(ctx, principal, entree.codePin);
  }

  @Put('pins')
  @HttpCode(HttpStatus.OK)
  @ExigerDroit('atelier.pointage.gerer_pin')
  @ApiOperation({
    summary: 'Attribue ou réinitialise le PIN d’un technicien sur un site (RM-128).',
    description:
      'Upsert : crée le rattachement (site, technicien) s’il n’existe pas, sinon met à jour son PIN et le réactive. ' +
      'PIN haché en Argon2id (RM-126). Unicité du PIN par site vérifiée à l’écriture (RM-127).',
  })
  @ApiOkResponse({ type: ReponsePinPointageDto })
  @ApiReponseProbleme(
    400,
    'Corps invalide (siteId/utilisateurId mal formés, codePin ≠ 4 chiffres, cible = compte de service).',
  )
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant, ou site hors de la portée du principal.')
  @ApiReponseProbleme(404, 'Site ou utilisateur introuvable pour ce tenant.')
  @ApiReponseProbleme(
    409,
    'CONFLIT — ce code PIN est déjà utilisé par un autre technicien du site (RM-127).',
  )
  async attribuer(
    @CorpsZod(schemaAttributionPin, {
      exemple: {
        siteId: '5a1c9e2e-2f0a-4b3a-9c1a-8e6f2d4b7a10',
        utilisateurId: '6c9e2d4b-7a10-4e2e-8f0a-1c9e2e2f0a4b',
        codePin: '4071',
      },
    })
    entree: EntreeAttributionPin,
  ): Promise<ReponsePinPointageDto> {
    const ctx = this.contexte.contexteTenant();
    const principal = this.contexte.exigerPrincipal();
    return this.service.attribuer(ctx, principal, entree);
  }

  @Post('pins/revocation')
  @HttpCode(HttpStatus.OK)
  @ExigerDroit('atelier.pointage.gerer_pin')
  @ApiOperation({
    summary: 'Retire un technicien de la borne d’un site (`actif=false`, jamais un DELETE).',
    description:
      'La ligne inactive garde l’historique du rattachement (migration 0036 §E). 404 si aucun rattachement actif à révoquer.',
  })
  @ApiOkResponse({ type: ReponsePinPointageDto })
  @ApiReponseProbleme(400, 'Corps invalide (siteId/utilisateurId mal formés).')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant, ou site hors de la portée du principal.')
  @ApiReponseProbleme(
    404,
    'Aucun rattachement PIN actif à révoquer pour ce technicien sur ce site.',
  )
  async revoquer(
    @CorpsZod(schemaRevocationPin, {
      exemple: {
        siteId: '5a1c9e2e-2f0a-4b3a-9c1a-8e6f2d4b7a10',
        utilisateurId: '6c9e2d4b-7a10-4e2e-8f0a-1c9e2e2f0a4b',
      },
    })
    entree: EntreeRevocationPin,
  ): Promise<ReponsePinPointageDto> {
    const ctx = this.contexte.contexteTenant();
    const principal = this.contexte.exigerPrincipal();
    return this.service.revoquer(ctx, principal, entree);
  }
}
