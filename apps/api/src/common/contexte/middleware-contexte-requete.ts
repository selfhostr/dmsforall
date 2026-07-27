import { randomUUID } from 'node:crypto';
import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { LANGUES, type Langue } from '@dfa/shared';
import { ServiceContexteRequete } from './contexte-requete.service';

const LANGUE_DEFAUT: Langue = 'fr';
const EN_TETE_REQUETE_ID = 'X-Requete-Id';

function negocierLangue(acceptLanguage: string | undefined): Langue {
  if (!acceptLanguage) {
    return LANGUE_DEFAUT;
  }
  // Négociation volontairement simple pour l'étape 0 : on prend les langues déclarées par
  // ordre de préférence du client et on retient la première supportée par DFA (fr/de/it).
  const preferences = acceptLanguage
    .split(',')
    .map((jeton) => jeton.split(';')[0]?.trim().toLowerCase().slice(0, 2))
    .filter((code): code is string => Boolean(code));

  for (const code of preferences) {
    if ((LANGUES as readonly string[]).includes(code)) {
      return code as Langue;
    }
  }
  return LANGUE_DEFAUT;
}

function extraireIp(requete: Request): string | null {
  return requete.ip ?? requete.socket.remoteAddress ?? null;
}

/**
 * Enregistré en premier sur `*` dans `AppModule` : les middlewares tournent avant les
 * guards, donc `ContexteRequete` existe déjà quand `GardeSession` (apps/api/src/auth/)
 * s'exécute et peut y attacher le principal authentifié.
 */
@Injectable()
export class MiddlewareContexteRequete implements NestMiddleware {
  constructor(private readonly contexte: ServiceContexteRequete) {}

  use(requete: Request, reponse: Response, suite: NextFunction): void {
    const requeteId = randomUUID();
    reponse.setHeader(EN_TETE_REQUETE_ID, requeteId);

    this.contexte.demarrer(
      {
        requeteId,
        debutLe: new Date(),
        ip: extraireIp(requete),
        userAgent: requete.get('user-agent') ?? null,
        langue: negocierLangue(requete.get('accept-language')),
      },
      () => suite(),
    );
  }
}
