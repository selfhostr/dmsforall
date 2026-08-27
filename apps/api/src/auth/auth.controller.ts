/**
 * Contrôleur auth (contrat gelé étape 0, §4, endpoints 1-3).
 *
 * Le préfixe global `api` et le versioning URI (`/api/v1/...`) sont configurés une seule fois
 * dans `main.ts` (propriété expert-nestjs) : ce contrôleur ne déclare que le chemin relatif
 * `auth`, conformément au reste du socle.
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  schemaConfirmationReinitialisationMotDePasse,
  schemaConnexion,
  schemaDemandeReinitialisationMotDePasse,
  type SessionCourante,
} from '@dfa/shared';

import { JETON_CONFIG } from '../config/config.jetons';
import type { Config } from '../config/config.types';
import type { PrincipalAuthentifie } from '../common/contexte/contexte-requete.types';
import { AucunDroitRequis } from '../common/droits';
import { ApiCorpsZod } from '../common/documentation';
import { Principal } from './decorateurs/principal.decorator';
import { Public } from './decorateurs/public.decorator';
import { construireAttributsCookie, effacerCookieSession, poserCookieSession } from './cookie';
import { ProblemeDetailDto, SessionCouranteDto } from './dto/auth.dto';
import { ErreurValidation, type CorpsErreurAuth } from './erreurs-auth';
import { JETON_SERVICE_REINITIALISATION_MOT_DE_PASSE, JETON_SERVICE_SESSION } from './jetons';
import type { ServiceReinitialisationMotDePasse, ServiceSession } from './auth.types';

// Le service d'authentification n'a pas de jeton dédié dans le contrat (§2.10 n'en définit que
// pour ServiceMotDePasse et ServiceSession) : il est fourni/injecté par référence de classe
// directement dans `auth.module.ts`, comme n'importe quel provider Nest « normal ».
import { ServiceAuthentificationImpl } from './services/authentification.service';

@ApiTags('Authentification')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: ServiceAuthentificationImpl,
    @Inject(JETON_SERVICE_SESSION) private readonly serviceSession: ServiceSession,
    @Inject(JETON_SERVICE_REINITIALISATION_MOT_DE_PASSE)
    private readonly serviceReinitialisation: ServiceReinitialisationMotDePasse,
    @Inject(JETON_CONFIG) private readonly config: Config,
  ) {}

  @Public()
  @Post('connexion')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Connexion par email et mot de passe.',
    description:
      'Email inconnu et mot de passe incorrect renvoient EXACTEMENT la même erreur ' +
      '401 AUTH_IDENTIFIANTS_INVALIDES, avec un temps de réponse égalisé — ceci est un choix de ' +
      'sécurité délibéré (anti-énumération de comptes), pas une omission.',
  })
  @ApiCorpsZod(schemaConnexion, {
    exemple: { email: 'accueil@garage-martin.ch', motDePasse: 'Demo1234!Garage' },
  })
  @ApiResponse({ status: 200, description: 'Session ouverte.', type: SessionCouranteDto })
  @ApiResponse({
    status: 400,
    description: 'VALIDATION_ECHOUEE — corps de requête invalide.',
    type: ProblemeDetailDto,
  })
  @ApiResponse({
    status: 401,
    description: 'AUTH_IDENTIFIANTS_INVALIDES.',
    type: ProblemeDetailDto,
  })
  @ApiResponse({
    status: 403,
    description: 'AUTH_COMPTE_SUSPENDU, AUTH_TENANT_SUSPENDU ou AUTH_ORIGINE_REFUSEE.',
    type: ProblemeDetailDto,
  })
  @ApiResponse({ status: 423, description: 'AUTH_COMPTE_VERROUILLE.', type: ProblemeDetailDto })
  @ApiResponse({ status: 429, description: 'AUTH_TROP_DE_TENTATIVES.', type: ProblemeDetailDto })
  async connexion(
    @Body() corpsBrut: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionCourante> {
    const resultat = schemaConnexion.safeParse(corpsBrut);
    if (!resultat.success) {
      throw new ErreurValidation(
        resultat.error.issues.map((issue) => ({
          champ: issue.path.join('.') || '(racine)',
          code: issue.code,
          message: issue.message,
        })),
      );
    }

    try {
      const { session, corps } = await this.authService.connecter(
        resultat.data,
        this.ipDe(req),
        this.userAgentDe(req),
      );
      poserCookieSession(res, this.config, session.tokenClair, session.expireLe);
      return corps;
    } catch (erreur) {
      this.appliquerRetryAfter(res, erreur);
      throw erreur;
    }
  }

  /**
   * Idempotente à dessein : une déconnexion sans session valide (cookie absent, déjà expiré,
   * déjà révoqué) rend quand même `204`. Sur une tablette d'atelier partagée, un client qui ne
   * peut jamais échouer à « se déconnecter » est plus sûr qu'un client qui insiste pour garder
   * une session dont le serveur ne veut plus (voir contrats-etape-0.md §5).
   */
  @Public()
  @Post('deconnexion')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Déconnexion. Idempotente : 204 même sans session active.' })
  @ApiResponse({
    status: 204,
    description: 'Cookie de session effacé (session fermée si elle existait).',
  })
  @ApiResponse({ status: 403, description: 'AUTH_ORIGINE_REFUSEE.', type: ProblemeDetailDto })
  async deconnexion(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const token = req.cookies?.[this.config.SESSION_COOKIE_NOM];
    if (typeof token === 'string' && token.length > 0) {
      try {
        // `resoudre()` lève `ErreurSessionAbsente`/`ErreurSessionExpiree` pour un cookie
        // inconnu/périmé — attrapé ci-dessous : sur CET endpoint « tolérant », un cookie déjà
        // invalide ne signale rien à fermer, pas une erreur à renvoyer (idempotence, voir
        // le commentaire de la méthode).
        const principal = await this.serviceSession.resoudre(token);
        if (principal) {
          // Best-effort : un problème serveur pendant la fermeture de session ne doit jamais
          // empêcher le client de considérer qu'il s'est déconnecté (cookie effacé plus bas de
          // toute façon). Ce `.catch` avale l'erreur ICI (idempotence côté client, 204
          // systématique — voir le commentaire de la méthode), mais PAS en silence côté serveur :
          // `authService.deconnecter()` journalise déjà un `error` de log ET un événement de
          // sécurité dédié avant de repropager (finding sécurité #7) — c'est cette trace-là qui
          // permet de reconstituer l'incident, pas ce `.catch`.
          await this.authService.deconnecter(principal).catch(() => undefined);
        }
      } catch {
        // Session déjà absente/expirée/révoquée : rien à fermer, c'est un succès du point de
        // vue de « se déconnecter ».
      }
    }
    effacerCookieSession(res, this.config);
  }

  /**
   * Demande de réinitialisation en libre-service (« mot de passe oublié »). RÉPONSE TOUJOURS
   * IDENTIQUE (`204`), que l'email corresponde ou non à un compte réel — anti-énumération, même
   * doctrine que `POST /auth/connexion` (voir `ServiceReinitialisationMotDePasse.demander`).
   */
  @Public()
  @Post('mot-de-passe/oubli')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Demande de réinitialisation de mot de passe (mot de passe oublié).',
    description:
      "204 systématique — que l'email corresponde ou non à un compte réel, actif, d'un tenant " +
      "actif : révéler l'existence d'un compte par la forme de la réponse est exactement ce que " +
      "cet endpoint doit éviter. Si l'email correspond à un compte utilisable, un courriel " +
      'contenant un lien à usage unique (valide 30 minutes) est envoyé.',
  })
  @ApiCorpsZod(schemaDemandeReinitialisationMotDePasse, {
    exemple: { email: 'accueil@garage-martin.ch' },
  })
  @ApiResponse({ status: 204, description: 'Traité — voir la description : ne signifie rien.' })
  @ApiResponse({
    status: 400,
    description: 'VALIDATION_ECHOUEE — corps de requête invalide.',
    type: ProblemeDetailDto,
  })
  @ApiResponse({ status: 403, description: 'AUTH_ORIGINE_REFUSEE.', type: ProblemeDetailDto })
  @ApiResponse({ status: 429, description: 'AUTH_TROP_DE_TENTATIVES.', type: ProblemeDetailDto })
  async demanderReinitialisationMotDePasse(
    @Body() corpsBrut: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const resultat = schemaDemandeReinitialisationMotDePasse.safeParse(corpsBrut);
    if (!resultat.success) {
      throw new ErreurValidation(
        resultat.error.issues.map((issue) => ({
          champ: issue.path.join('.') || '(racine)',
          code: issue.code,
          message: issue.message,
        })),
      );
    }
    try {
      await this.serviceReinitialisation.demander(
        resultat.data,
        this.ipDe(req),
        this.userAgentDe(req),
      );
    } catch (erreur) {
      this.appliquerRetryAfter(res, erreur);
      throw erreur;
    }
  }

  /**
   * Confirmation d'une réinitialisation en libre-service : jeton reçu par courriel + nouveau mot
   * de passe. Toute issue négative rend EXACTEMENT la même erreur `400
   * AUTH_JETON_REINITIALISATION_INVALIDE` (voir `ServiceReinitialisationMotDePasse.confirmer`).
   */
  @Public()
  @Post('mot-de-passe/reinitialisation')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Confirmation de réinitialisation de mot de passe (jeton + nouveau mot de passe).',
    description:
      'Email inconnu, jeton inconnu/expiré/déjà utilisé, et compte/tenant non actif renvoient ' +
      'EXACTEMENT la même erreur 400 AUTH_JETON_REINITIALISATION_INVALIDE — anti-énumération, ' +
      'même doctrine que POST /auth/connexion. Succès : toutes les sessions actives de ' +
      "l'utilisateur sont révoquées.",
  })
  @ApiCorpsZod(schemaConfirmationReinitialisationMotDePasse, {
    exemple: {
      email: 'accueil@garage-martin.ch',
      jeton: 'jeton-opaque-recu-par-courriel',
      nouveauMotDePasse: 'un-nouveau-mot-de-passe-suffisamment-long',
    },
  })
  @ApiResponse({ status: 204, description: 'Mot de passe changé, sessions révoquées.' })
  @ApiResponse({
    status: 400,
    description:
      'VALIDATION_ECHOUEE (corps invalide, dont politique de mot de passe) ou ' +
      'AUTH_JETON_REINITIALISATION_INVALIDE.',
    type: ProblemeDetailDto,
  })
  @ApiResponse({ status: 403, description: 'AUTH_ORIGINE_REFUSEE.', type: ProblemeDetailDto })
  @ApiResponse({ status: 429, description: 'AUTH_TROP_DE_TENTATIVES.', type: ProblemeDetailDto })
  async confirmerReinitialisationMotDePasse(
    @Body() corpsBrut: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const resultat = schemaConfirmationReinitialisationMotDePasse.safeParse(corpsBrut);
    if (!resultat.success) {
      throw new ErreurValidation(
        resultat.error.issues.map((issue) => ({
          champ: issue.path.join('.') || '(racine)',
          code: issue.code,
          message: issue.message,
        })),
      );
    }
    try {
      await this.serviceReinitialisation.confirmer(
        resultat.data,
        this.ipDe(req),
        this.userAgentDe(req),
      );
    } catch (erreur) {
      this.appliquerRetryAfter(res, erreur);
      throw erreur;
    }
  }

  // `GardeDroit` est en refus par défaut (voir common/droits/garde-droit.ts) : ce marqueur
  // déclare EXPLICITEMENT que « authentifié suffit » pour lire sa propre session — pas de
  // `@UseGuards(GardeDroit)` local nécessaire, la garde s'applique déjà globalement en second
  // `APP_GUARD` (voir auth.module.ts) pour toute l'application, y compris ce contrôleur.
  @AucunDroitRequis()
  @Get('moi')
  @ApiOperation({ summary: 'Session courante de l’utilisateur authentifié.' })
  @ApiResponse({ status: 200, description: 'Session courante.', type: SessionCouranteDto })
  @ApiResponse({
    status: 401,
    description: 'AUTH_SESSION_ABSENTE ou AUTH_SESSION_EXPIREE.',
    type: ProblemeDetailDto,
  })
  async moi(@Principal() principal: PrincipalAuthentifie): Promise<SessionCourante> {
    return this.authService.sessionCourante(principal);
  }

  private ipDe(req: Request): string | null {
    return req.ip ?? req.socket?.remoteAddress ?? null;
  }

  private userAgentDe(req: Request): string | null {
    const valeur = req.headers['user-agent'];
    return typeof valeur === 'string' && valeur.length > 0 ? valeur : null;
  }

  /** Pose `Retry-After` (secondes) sur les 423/429, qui le portent dans leur corps d'erreur. */
  private appliquerRetryAfter(res: Response, erreur: unknown): void {
    if (!(erreur instanceof Error) || !('getResponse' in erreur)) return;
    const corps = (erreur as { getResponse: () => unknown }).getResponse() as CorpsErreurAuth;
    if (typeof corps?.retryApresSecondes === 'number') {
      res.setHeader('Retry-After', String(corps.retryApresSecondes));
    }
  }
}

// Import de sécurité : le contrôleur pose et efface le cookie avec exactement les mêmes
// attributs — voir cookie.ts. `construireAttributsCookie` n'est pas utilisé directement ici (les
// deux fonctions de haut niveau suffisent) mais reste réexporté pour que les tests d'intégration
// du module puissent inspecter les attributs sans dupliquer leur construction.
export { construireAttributsCookie };
