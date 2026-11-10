/**
 * Installation d'une instance neuve : deux routes PUBLIQUES (aucune session n'existe encore).
 *
 * `POST /installation/premier-garage` ouvre la session du compte créé, exactement comme
 * `POST /auth/connexion` (même cookie). La vérification `Origin` anti-CSRF des méthodes mutantes
 * s'applique ici comme partout (`GardeSession`), `@Public()` ne la désactive pas.
 */
import { Controller, Get, HttpCode, HttpStatus, Inject, Post, Req, Res } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  schemaPremierGarage,
  type EntreePremierGarage,
  type EtatInstallation,
  type SessionCourante,
} from '@dfa/shared';

import { SessionCouranteDto } from '../auth/dto/auth.dto';
import { poserCookieSession } from '../auth/cookie';
import { Public } from '../auth/decorateurs/public.decorator';
import { ServiceAuthentificationImpl } from '../auth/services/authentification.service';
import { CorpsZod } from '../common/documentation';
import { ApiReponseProbleme } from '../common/erreurs';
import { JETON_CONFIG } from '../config/config.jetons';
import type { Config } from '../config/config.types';
import { ServiceInstallation } from './service-installation';

export class EtatInstallationDto implements EtatInstallation {
  @ApiProperty({
    description:
      'true tant que la base ne contient aucun garage : l’écran « Créer votre garage » s’impose.',
  })
  readonly premierGarageRequis!: boolean;
}

@ApiTags('Installation')
@Controller('installation')
export class InstallationController {
  constructor(
    private readonly installation: ServiceInstallation,
    private readonly authentification: ServiceAuthentificationImpl,
    @Inject(JETON_CONFIG) private readonly config: Config,
  ) {}

  @Public()
  @Get('etat')
  @ApiOperation({
    summary: 'Cette instance attend-elle son premier garage ?',
    description:
      'Public, sans session. Ne révèle rien d’autre que ce booléen : `true` tant qu’aucun garage n’existe.',
  })
  @ApiOkResponse({ type: EtatInstallationDto })
  async etat(): Promise<EtatInstallation> {
    return { premierGarageRequis: await this.installation.premierGarageRequis() };
  }

  @Public()
  @Post('premier-garage')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Crée le premier garage de l’instance et ouvre la session de son responsable.',
    description:
      'Public, protégé par le code d’installation à usage unique affiché dans les journaux de ' +
      'l’API au démarrage (`docker compose logs api`) ; il change à chaque démarrage tant ' +
      'qu’aucun garage n’existe. Mêmes valeurs par défaut que le CLI `creer-garage` (site ' +
      'principal, taux « ATELIER », motifs de rendez-vous). Le compte créé est de rôle ' +
      '`direction`. Limitation de débit stricte par adresse IP et globale. La session est ' +
      'ouverte dans la réponse (cookie), comme `POST /auth/connexion`.',
  })
  @ApiCreatedResponse({ description: 'Garage créé, session ouverte.', type: SessionCouranteDto })
  @ApiReponseProbleme(
    400,
    'VALIDATION_ECHOUEE — corps invalide, ou saisie refusée (MOT_DE_PASSE_FAIBLE, COURRIEL_INVALIDE, GARAGE_INVALIDE dans `erreurs[].code`).',
  )
  @ApiReponseProbleme(403, 'INSTALLATION_CODE_INVALIDE — code absent, faux ou périmé.')
  @ApiReponseProbleme(409, 'INSTALLATION_DEJA_FAITE — un garage existe déjà.')
  @ApiReponseProbleme(429, 'AUTH_TROP_DE_TENTATIVES — limitation de débit (en-tête Retry-After).')
  async premierGarage(
    @CorpsZod(schemaPremierGarage, {
      exemple: {
        codeInstallation: 'K7QM-3XRB-9TNA',
        garage: 'Garage Exemple SA',
        prenom: 'Claire',
        nom: 'Martin',
        email: 'direction@garage-exemple.ch',
        motDePasse: 'une phrase de passe assez longue',
      },
    })
    corps: EntreePremierGarage,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionCourante> {
    const ip = req.ip ?? req.socket?.remoteAddress ?? null;
    const ua = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null;
    const { email } = await this.installation.creerPremierGarage(corps, ip);
    const { session, corps: sessionCourante } =
      await this.authentification.ouvrirSessionPourPremierCompte(email, ip, ua);
    poserCookieSession(res, this.config, session.tokenClair, session.expireLe);
    return sessionCourante;
  }
}
