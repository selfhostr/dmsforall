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
 * --- Note de sécurité à valider (revue sécurité / mainteneur) --------------------------
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
import {
  ErreurChangementMotDePasseRequis,
  ErreurOrigineRefusee,
  ErreurSessionAbsente,
  ErreurSessionExpiree,
} from './erreurs-auth';
import { CLE_META_AVANT_CHANGEMENT_MDP } from './decorateurs/autorise-avant-changement-mot-de-passe.decorator';
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

    // Issue #58 : mot de passe temporaire jamais remplacé -> seules les routes explicitement
    // marquées passent. Appliqué ICI, sur chaque requête, depuis l'état relu en base par
    // `resoudre()` : l'interface n'est qu'un confort, jamais le mécanisme.
    if (principal.motDePasseAChanger === true) {
      const autorisee = this.reflector.getAllAndOverride<boolean>(CLE_META_AVANT_CHANGEMENT_MDP, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (!autorisee) throw new ErreurChangementMotDePasseRequis();
    }

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
        this.originesReseauLocalEquivalentes(origineRecue, origineAttendue)
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
   * court-circuite avant même d'appeler cette méthode) : deux hôtes qui désignent chacun soit la
   * machine loopback, soit une adresse de réseau local privé (RFC 1918), sont traités comme la
   * même frontière de confiance qu'un navigateur — un attaquant distant ne peut usurper ni l'un ni
   * l'autre (l'en-tête `Origin` n'est pas falsifiable cross-site ; seul un poste déjà sur le réseau
   * local ou la machine elle-même peut émettre cette origine).
   *
   * Cause racine du premier bug reproduit : `vite.config.ts` écoute sur `0.0.0.0`
   * (`server.host: true`, nécessaire pour l'accès depuis un conteneur Docker), ce qui rend le
   * front joignable aussi bien via `http://localhost:5173` que `http://127.0.0.1:5173` — mais
   * `WEB_URL_PUBLIQUE` ne fixe qu'une seule valeur.
   *
   * Cause racine du second bug reproduit (celui-ci) : le même serveur de dev, joint depuis une
   * AUTRE machine du réseau local (ex. un téléphone via `http://192.168.1.42:5173`), envoie un
   * `Origin` qui n'est ni `localhost` ni `127.0.0.1` — la tolérance initiale, bornée aux deux seuls
   * hôtes loopback, ne le couvrait pas. Un navigateur ouvert sur cette variante obtenait
   * `403 AUTH_ORIGINE_REFUSEE` sur CHAQUE requête mutante, dont le login.
   *
   * Portée volontairement étroite :
   *  - chaque hôte (reçu ET configuré) doit être loopback OU une IPv4 privée RFC 1918
   *    (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`) — jamais un domaine public ni une IP
   *    publique, même en dev ;
   *  - même schéma et même port des deux côtés ;
   *  - vérifier que l'hôte CONFIGURÉ (`WEB_URL_PUBLIQUE`) est lui aussi loopback/privé est ce qui
   *    empêche cette tolérance de s'appliquer en production même si `NODE_ENV` était mal
   *    positionné : une vraie URL publique de production est un nom de domaine, jamais une IP
   *    privée ni `localhost`.
   */
  private originesReseauLocalEquivalentes(a: string, b: string): boolean {
    const urlA = new URL(a);
    const urlB = new URL(b);
    return (
      this.hoteEstLoopbackOuPrive(urlA.hostname) &&
      this.hoteEstLoopbackOuPrive(urlB.hostname) &&
      urlA.protocol === urlB.protocol &&
      urlA.port === urlB.port
    );
  }

  private hoteEstLoopbackOuPrive(hostname: string): boolean {
    if (hostname === 'localhost' || hostname === '127.0.0.1') return true;
    return this.estIpv4Privee(hostname);
  }

  /**
   * IPv4 uniquement (l'IPv6 n'est pas dans le périmètre de ce bug — le serveur de dev n'y écoute
   * pas). Plages RFC 1918 : `10.0.0.0/8`, `172.16.0.0/12` (2e octet 16 à 31 INCLUS, piège classique
   * : `172.32.0.1` n'en fait PAS partie), `192.168.0.0/16`.
   */
  private estIpv4Privee(hostname: string): boolean {
    const correspondance = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
    if (!correspondance) return false;

    const octets = correspondance.slice(1).map(Number);
    if (octets.some((octet) => octet < 0 || octet > 255)) return false;

    const [premier, second] = octets as [number, number, number, number];
    if (premier === 10) return true;
    if (premier === 172 && second >= 16 && second <= 31) return true;
    if (premier === 192 && second === 168) return true;
    return false;
  }

  private lireCookieSession(req: Request): string | null {
    const valeur = req.cookies?.[this.config.SESSION_COOKIE_NOM];
    return typeof valeur === 'string' && valeur.length > 0 ? valeur : null;
  }
}
