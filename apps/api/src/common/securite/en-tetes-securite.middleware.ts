/**
 * En-têtes de sécurité HTTP globaux — finding H-01 (audit sécurité) : ni HSTS, ni CSP, ni
 * `X-Frame-Options` n'étaient posés. L'API est servie à des garages via navigateur ; l'absence de
 * `X-Frame-Options`/`frame-ancestors` laisse la porte ouverte au détournement de clic (une page
 * hostile qui superpose une iframe transparente sur un bouton d'action authentifiée). Câblé depuis
 * `main.ts` (étape 9), AVANT le préfixe global, pour couvrir toute réponse — y compris Swagger.
 *
 * DEUX POLITIQUES CSP DISTINCTES, choisies par chemin de requête :
 *   - `CSP_API` (`default-src 'none'`) sur toute route métier : cette API ne rend jamais de HTML
 *     elle-même, elle n'a donc besoin de charger AUCUNE sous-ressource. Poser la CSP la plus
 *     stricte possible ici est un coût nul (aucun front légitime ne dépend d'un script/style/image
 *     chargé DEPUIS cette origine par l'API) et une défense en profondeur contre le rendu accidentel
 *     d'un corps de réponse comme HTML par un navigateur qui ignorerait `X-Content-Type-Options`.
 *   - `CSP_DOCUMENTATION`, réservée à `/api/docs` (Swagger UI, document MÉTIER) et `/api/console/docs`
 *     (Swagger UI, document CONSOLE — `main.ts` étape 12bis, `exploitation/openapi/construire-
 *     document-console.ts`), qui ont RÉELLEMENT besoin de charger leurs propres scripts/styles/
 *     images (servis en `self`, jamais depuis un CDN tiers) pour s'afficher. `'unsafe-inline'` y est
 *     accepté délibérément : `SwaggerModule.setup()` embarque du script/style inline dans la page
 *     qu'il sert, et l'ajout d'un système de nonce dépasserait le périmètre de cette correction pour
 *     des routes de toute façon fermées par défaut en production (`OPENAPI_EXPOSER_DOCS` vaut
 *     `false` par défaut, finding 8 de l'audit sécurité étape 0 — voir
 *     `apps/api/src/config/charger-config.ts` ; le document console exige EN PLUS
 *     `DATABASE_URL_CONSOLE`, absente par défaut). Relâchement scopé au strict chemin `/api/docs*`
 *     ou `/api/console/docs*`, jamais au reste de l'API.
 *
 * `X-Frame-Options: DENY` accompagne `frame-ancestors 'none'` plutôt que d'en dépendre seul :
 * `frame-ancestors` (CSP niveau 2) est la directive moderne, mais `X-Frame-Options` reste le filet
 * pour les navigateurs qui ne l'implémentent pas — la même logique de double-couverture que
 * `Cache-Control`/`X-Content-Type-Options` posés juste après dans `main.ts`.
 *
 * `Referrer-Policy: no-referrer` : les URLs de cette API portent des données potentiellement
 * identifiantes en query string (`GET /recherche?q=<plaque ou VIN saisi>`) — un `Referer` transmis
 * à une ressource tierce chargée depuis une future page (image, police) fuiterait ce fragment de
 * recherche. Aucune route de cette API n'a besoin d'émettre de `Referer` sortant.
 */
import type { NextFunction, Request, Response } from 'express';
import type { Config } from '../../config/config.types';

/** Chemins EXACTS de montage Swagger (`main.ts`, étapes 12 et 12bis :
 *  `SwaggerModule.setup('api/docs', …)` et `SwaggerModule.setup('api/console/docs', …)`), hors du
 *  préfixe/versioning Nest — voir le commentaire de tête de `main.ts`. */
const PREFIXES_DOCUMENTATION_SWAGGER = ['/api/docs', '/api/console/docs'] as const;

const CSP_API = [
  "default-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "object-src 'none'",
].join('; ');

const CSP_DOCUMENTATION = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "object-src 'none'",
].join('; ');

/** Un an, avec sous-domaines et éligibilité à la préchargement navigateur — valeurs usuelles pour
 *  un déploiement HTTPS permanent (aucun repli HTTP prévu en production, cf. ARCHITECTURE.md). */
const HSTS_VALEUR = 'max-age=63072000; includeSubDomains; preload';

function estCheminDocumentation(chemin: string): boolean {
  return PREFIXES_DOCUMENTATION_SWAGGER.some(
    (prefixe) =>
      chemin === prefixe || chemin === `${prefixe}.json` || chemin.startsWith(`${prefixe}/`),
  );
}

/**
 * Construit le middleware d'en-têtes de sécurité, paramétré par la config validée.
 *
 * HSTS posé UNIQUEMENT quand LES DEUX conditions suivantes sont vraies :
 *   1. `config.NODE_ENV === 'production'` — jamais en développement/test, où l'app tourne en HTTP
 *      brut sur `localhost`. L'activer en dev épinglerait le navigateur du développeur sur HTTPS
 *      pour la durée de `max-age` (2 ans ici), rendant `http://localhost:5173`/`:3000` inutilisables
 *      jusqu'à purge manuelle des réglages HSTS du navigateur — casse durable et difficile à
 *      diagnostiquer pour quelqu'un qui ne s'y attend pas.
 *   2. `req.secure` — reflète le protocole RÉEL de la requête reçue (directement, ou via
 *      `X-Forwarded-Proto` si `TRUST_PROXY_HOPS` est réglé au nombre exact de sauts par
 *      `app.set('trust proxy', …)`, étape 5 de `main.ts`, câblée AVANT ce middleware). Se fier à
 *      `NODE_ENV` seul annoncerait HSTS sur une requête qui, pour une raison d'infrastructure
 *      (bascule de maintenance, vérification de santé interne en HTTP), n'est pas réellement
 *      arrivée en HTTPS — HSTS promettrait alors au navigateur une garantie que ce serveur ne tient
 *      pas pour CETTE réponse précise.
 */
export function construireMiddlewareEnTetesSecurite(
  config: Pick<Config, 'NODE_ENV'>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction): void => {
    const surDocumentation = estCheminDocumentation(req.path);

    res.setHeader('Content-Security-Policy', surDocumentation ? CSP_DOCUMENTATION : CSP_API);
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');

    if (config.NODE_ENV === 'production' && req.secure) {
      res.setHeader('Strict-Transport-Security', HSTS_VALEUR);
    }

    next();
  };
}
