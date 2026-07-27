/**
 * `@Principal()` (contrat gelé étape 0, §2.10).
 *
 * Décorateur de paramètre : injecte le `PrincipalAuthentifie` attaché par `GardeSession` dans un
 * handler de contrôleur. Un `createParamDecorator` ne peut pas recevoir de dépendance injectée
 * (pas de DI Nest à cet endroit) : il lit donc `req.dfaPrincipal`, posé par `GardeSession` au
 * moment de `attacherPrincipal()` (voir l'augmentation de type dans `../garde-session.ts`).
 *
 * N'est utilisable QUE sur une route déjà protégée par `GardeSession` (donc jamais `@Public()`
 * sauf si le contrôleur résout lui-même la session, comme `POST /auth/deconnexion` — dans ce cas
 * précis, ce décorateur ne doit pas être utilisé).
 */
import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

import type { PrincipalAuthentifie } from '../../common/contexte/contexte-requete.types';
import { ErreurSessionAbsente } from '../erreurs-auth';

export const Principal = createParamDecorator(
  (_donnee: unknown, ctx: ExecutionContext): PrincipalAuthentifie => {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (!req.dfaPrincipal) {
      // Ne devrait jamais arriver sur une route protégée : `GardeSession` aurait déjà levé
      // `ErreurSessionAbsente`/`ErreurSessionExpiree` avant que le handler ne s'exécute.
      throw new ErreurSessionAbsente();
    }
    return req.dfaPrincipal;
  },
);
