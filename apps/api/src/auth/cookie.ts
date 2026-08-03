/**
 * Pose et effacement du cookie de session (contrat gelé étape 0, §2.10 et §4).
 *
 * Attributs non négociables : `HttpOnly` (illisible en JS — une XSS ne peut pas exfiltrer le
 * jeton), `Secure` selon `COOKIE_SECURE`, `SameSite=Lax` (protection CSRF de base, complétée par
 * la vérification `Origin` de `GardeSession` — voir §0 : « pas de jeton CSRF »), `Path=/`.
 *
 * `construireAttributsCookie` est une fonction PURE (aucune dépendance à Express) : c'est ce qui
 * la rend testable sans faux `Response`, et c'est elle qui garantit que la pose et l'effacement du
 * cookie utilisent EXACTEMENT les mêmes attributs (seuls `maxAge` et la valeur diffèrent) — un
 * cookie effacé avec des attributs différents de ceux avec lesquels il a été posé n'est tout
 * simplement pas effacé par le navigateur.
 */
import type { Response } from 'express';

import type { Config } from '../config/config.types';

export interface AttributsCookieSession {
  readonly httpOnly: true;
  readonly secure: boolean;
  readonly sameSite: 'lax';
  readonly path: '/';
  /** Millisecondes (convention `res.cookie()` d'Express), pas des secondes. */
  readonly maxAge: number;
  readonly domain?: string;
}

export function construireAttributsCookie(
  config: Pick<Config, 'COOKIE_SECURE' | 'COOKIE_DOMAINE'>,
  dureeSecondes: number,
): AttributsCookieSession {
  const base = {
    httpOnly: true as const,
    secure: config.COOKIE_SECURE,
    sameSite: 'lax' as const,
    path: '/' as const,
    maxAge: Math.max(dureeSecondes, 0) * 1_000,
  };
  return config.COOKIE_DOMAINE ? { ...base, domain: config.COOKIE_DOMAINE } : base;
}

/** Pose le cookie de session avec le jeton en clair. Ce jeton n'est JAMAIS journalisé. */
export function poserCookieSession(
  res: Response,
  config: Pick<Config, 'SESSION_COOKIE_NOM' | 'COOKIE_SECURE' | 'COOKIE_DOMAINE'>,
  tokenClair: string,
  expireLe: Date,
): void {
  const dureeSecondes = Math.max(0, Math.round((expireLe.getTime() - Date.now()) / 1_000));
  res.cookie(
    config.SESSION_COOKIE_NOM,
    tokenClair,
    construireAttributsCookie(config, dureeSecondes),
  );
}

/**
 * Efface le cookie de session. `Max-Age=0` avec les MÊMES attributs que la pose (voir commentaire
 * d'en-tête) — c'est la seule différence avec `poserCookieSession`.
 */
export function effacerCookieSession(
  res: Response,
  config: Pick<Config, 'SESSION_COOKIE_NOM' | 'COOKIE_SECURE' | 'COOKIE_DOMAINE'>,
): void {
  res.cookie(config.SESSION_COOKIE_NOM, '', construireAttributsCookie(config, 0));
}
