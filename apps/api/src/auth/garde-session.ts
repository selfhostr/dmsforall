/**
 * `GardeSession` (contrat gelé étape 0, §2.10) — guard global (`APP_GUARD`, fourni par
 * `AuthModule`).
 *
 * Séquence, dans l'ordre :
 *  1. méthode ≠ GET/HEAD → vérifie `Origin` contre `WEB_URL_PUBLIQUE`, sinon
 *     `403 AUTH_ORIGINE_REFUSEE`. Appliquée SANS EXCEPTION, y compris aux routes `@Public()` —
 *     voir la note de sécurité ci-dessous, elle diverge délibérément d'une lecture littérale du
 *     tableau des erreurs de l'endpoint `POST /auth/connexion` au §4.
 *  2. `@Public()` → laisse passer sans résoudre ni attacher de principal.
 *  3. lit le cookie `SESSION_COOKIE_NOM` (jamais un header, jamais un query param).
 *  4. `serviceSession.resoudre(token)`.
 *  5. `contexte.attacherPrincipal(principal)`.
 *
 * **Ne prend AUCUNE connexion Postgres et ne pose AUCUN paramètre de session PG** : le tenant est
 * posé par `AccesBase.enTenant` à la portée transaction, jamais ici (voir contrats-etape-0.md §3,
 * « le piège du pooling »). Ce guard ne fait que résoudre un cookie en `PrincipalAuthentifie`.
 *
 * --- Note de sécurité à valider (reviewer-securite / orchestrateur) --------------------------
 * Le contrat liste l'ordre « 1. @Public → laisse passer ; 2. vérifie Origin ». Une lecture stricte
 * ferait que `POST /auth/connexion` (publique) ne serait JAMAIS soumise à la vérification Origin.
 * Mais la consigne de la tâche est explicite et sans exception : « vérification Origin sur TOUTE
 * méthode ≠ GET/HEAD ». Les deux ne peuvent pas être simultanément vraies au sens strict. Ce guard
 * résout la tension en appliquant la vérification Origin à TOUTE méthode mutante, publique ou non
 * — un déni supplémentaire (403 au lieu d'un 200 sur `/auth/connexion` depuis une origine
 * inattendue) n'est jamais un risque de sécurité, seulement un risque de sur-blocage si un jour un
 * client légitime hors navigateur (intégration serveur-à-serveur) doit appeler cet endpoint sans
 * `Origin` — hors périmètre étape 0 (§0 : "aucun endpoint n'accepte de tenantId", les intégrations
 * futures passeront par des tokens API dédiés, pas par ce cookie-session). C'est ce qui permet
 * aussi à `POST /auth/deconnexion` ("tolérante" : ne lève jamais 401) de rester protégée contre un
 * POST cross-site forgé, alors même qu'elle est déclarée `@Public()` (elle n'exige pas de session
 * valide, mais si un cookie est présent le contrôleur tente quand même de fermer la session — voir
 * `auth.controller.ts`).
 * ------------------------------------------------------------------------------------------------
 */
import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import type { Config } from '../config/config.types';
import { JETON_CONFIG } from '../config/config.jetons';
import { ServiceContexteRequete } from '../common/contexte/contexte-requete.service';
import type { PrincipalAuthentifie } from '../common/contexte/contexte-requete.types';
import { CLE_META_PUBLIC } from './decorateurs/public.decorator';
import { ErreurOrigineRefusee, ErreurSessionAbsente, ErreurSessionExpiree } from './erreurs-auth';
import { JETON_SERVICE_SESSION } from './jetons';
import type { ServiceSession } from './auth.types';

const METHODES_SANS_VERIFICATION_ORIGINE = new Set(['GET', 'HEAD']);

declare module 'express' {
  interface Request {
    /**
     * Doublon volontaire du principal attaché à `ServiceContexteRequete` (AsyncLocalStorage),
     * posé pour que le décorateur de paramètre `@Principal()` puisse le lire de façon synchrone
     * sans dépendre de l'injection de dépendances (impossible dans un `createParamDecorator`).
     * La source de vérité pour tout le reste du code métier reste `ServiceContexteRequete`.
     */
    dfaPrincipal?: PrincipalAuthentifie;
  }
}

@Injectable()
export class GardeSession implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(JETON_CONFIG) private readonly config: Config,
    @Inject(JETON_SERVICE_SESSION) private readonly serviceSession: ServiceSession,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();

    if (!METHODES_SANS_VERIFICATION_ORIGINE.has(req.method)) {
      this.verifierOrigine(req);
    }

    const estPublic = this.reflector.getAllAndOverride<boolean>(CLE_META_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (estPublic) return true;

    const token = this.lireCookieSession(req);
    if (!token) throw new ErreurSessionAbsente();

    // `resoudre()` lève déjà `ErreurSessionAbsente`/`ErreurSessionExpiree` en pratique (voir son
    // commentaire dans `services/session.service.ts`) ; ce garde-fou couvre uniquement le cas
    // défensif où une implémentation future respecterait le `| null` littéral du type de retour.
    const principal = await this.serviceSession.resoudre(token);
    if (!principal) throw new ErreurSessionExpiree();

    this.contexte.attacherPrincipal(principal);
    req.dfaPrincipal = principal;

    return true;
  }

  private verifierOrigine(req: Request): void {
    const origine = req.headers.origin;
    if (!origine) throw new ErreurOrigineRefusee();

    try {
      const origineAttendue = new URL(this.config.WEB_URL_PUBLIQUE).origin;
      const origineRecue = new URL(origine).origin;
      if (origineRecue === origineAttendue) return;
      if (
        this.config.NODE_ENV !== 'production' &&
        this.originesLoopbackEquivalentes(origineRecue, origineAttendue)
      ) {
        return;
      }
      throw new ErreurOrigineRefusee();
    } catch (erreur) {
      if (erreur instanceof ErreurOrigineRefusee) throw erreur;
      // `Origin` malformé (n'est même pas une URL valide) : traité comme un refus, jamais comme
      // une erreur serveur (500) — l'entrée est hostile ou cassée, pas notre bug.
      throw new ErreurOrigineRefusee();
    }
  }

  /**
   * Tolérance de développement, EXCLUE en production (`NODE_ENV === 'production'` la
   * court-circuite avant même d'appeler cette méthode) : `localhost` et `127.0.0.1` désignent la
   * même machine loopback, donc la même frontière de confiance qu'un navigateur — un attaquant
   * distant ne peut usurper ni l'un ni l'autre (l'en-tête `Origin` n'est pas falsifiable
   * cross-site). Cause racine du bug reproduit : `vite.config.ts` écoute sur `0.0.0.0`
   * (`server.host: true`, nécessaire pour l'accès depuis un conteneur Docker), ce qui rend le
   * front joignable aussi bien via `http://localhost:5173` que `http://127.0.0.1:5173` — mais
   * `WEB_URL_PUBLIQUE` ne fixe qu'une seule valeur. Un navigateur ouvert sur la variante non
   * configurée obtenait `403 AUTH_ORIGINE_REFUSEE` sur CHAQUE requête mutante, dont le login.
   * Portée volontairement étroite : seuls `localhost`/`127.0.0.1` (jamais un autre hôte) avec le
   * même schéma et le même port sont équivalents — ni un hôte LAN, ni un domaine tiers.
   */
  private originesLoopbackEquivalentes(a: string, b: string): boolean {
    const HOTES_LOOPBACK = new Set(['localhost', '127.0.0.1']);
    const urlA = new URL(a);
    const urlB = new URL(b);
    return (
      HOTES_LOOPBACK.has(urlA.hostname) &&
      HOTES_LOOPBACK.has(urlB.hostname) &&
      urlA.protocol === urlB.protocol &&
      urlA.port === urlB.port
    );
  }

  private lireCookieSession(req: Request): string | null {
    const valeur = req.cookies?.[this.config.SESSION_COOKIE_NOM];
    return typeof valeur === 'string' && valeur.length > 0 ? valeur : null;
  }
}
