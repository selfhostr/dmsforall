import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { eq } from 'drizzle-orm';
import { modulesActifsDepuis, type ModuleApp } from '@dfa/shared';

import { JETON_DB, schema, type AccesBase } from '../../db';
import { ServiceContexteRequete } from '../contexte/contexte-requete.service';
import { ErreurMetier } from '../erreurs/erreur-metier';

export const CLE_META_MODULE = 'dfa:module';

/**
 * Rattache un contrôleur (ou une route) à un module activable du garage :
 * `@ExigerModule('pneus')`. Si le garage a retiré ce module — ou une de ses dépendances —, les
 * ÉCRITURES (toute méthode autre que GET/HEAD/OPTIONS) répondent `403 MODULE_DESACTIVE`. Les
 * lectures restent permises : l'historique et les documents liés (factures) doivent rester lisibles.
 *
 * Complète `@ExigerDroit`, ne le remplace pas : le droit dit « cette personne peut-elle ? », le
 * module dit « ce garage utilise-t-il cette partie du produit ? ».
 */
export const ExigerModule = (module: ModuleApp): MethodDecorator & ClassDecorator =>
  SetMetadata(CLE_META_MODULE, module);

const METHODES_LECTURE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Garde GLOBALE (`APP_GUARD`, `parametrage/modules/`), exécutée après `GardeSession` : lit le
 * module déclaré par `@ExigerModule` et, pour une écriture, relit en base les modules retirés par le
 * garage de la session (une requête, uniquement sur les routes décorées).
 */
@Injectable()
export class GardeModule implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly contexte: ServiceContexteRequete,
    @Inject(JETON_DB) private readonly acces: AccesBase,
  ) {}

  async canActivate(contexteExecution: ExecutionContext): Promise<boolean> {
    const module = this.reflector.getAllAndOverride<ModuleApp | undefined>(CLE_META_MODULE, [
      contexteExecution.getHandler(),
      contexteExecution.getClass(),
    ]);
    if (!module) return true;

    const requete = contexteExecution.switchToHttp().getRequest<{ method?: string }>();
    if (METHODES_LECTURE.has((requete.method ?? 'GET').toUpperCase())) return true;

    // Route publique (aucun principal) : le module ne s'applique qu'à un garage identifié.
    const principal = this.contexte.actuelOuNull()?.principal ?? null;
    if (!principal) return true;

    const ctx = this.contexte.contexteTenant();
    const desactives = await this.acces.enTenant(ctx, async (tx) => {
      const [ligne] = await tx
        .select({ modulesDesactives: schema.tenant.modulesDesactives })
        .from(schema.tenant)
        .where(eq(schema.tenant.id, ctx.tenantId));
      return ligne?.modulesDesactives ?? [];
    });

    if (!modulesActifsDepuis(desactives).includes(module)) {
      throw new ErreurMetier(
        'MODULE_DESACTIVE',
        `Le module « ${module} » est désactivé pour ce garage (Réglages > Modules).`,
      );
    }
    return true;
  }
}
