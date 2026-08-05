import { Inject, Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import type {
  EntreeUpsertRegleRelance,
  ReponseRegleRelance,
  RoleUtilisateur,
  TypeRelance,
} from '@dfa/shared';

import type { AccesBase, ContexteTenant } from '../db';
import { JETON_DB } from '../db';
import { regleRelance } from '../db/schema';
import { ErreurMetier } from '../common/erreurs';

import { ROLES_RELANCES_FACTURATION, verifierRoleAutorise } from './droits-provisoires';
import { versReponseRegleRelance } from './mappers';

/**
 * Configuration `regle_relance` (§5, §4 de la spec) — une ligne par `(tenant, type_relance)`,
 * jamais supprimée (désactiver via `actif = false`). Voir `droits-provisoires.ts` pour l'état
 * PROVISOIRE de l'autorisation.
 */
@Injectable()
export class ServiceRegleRelance {
  constructor(@Inject(JETON_DB) private readonly acces: AccesBase) {}

  /** `GET /relances/regles` — au plus 9 lignes (une par `TypeRelance`) : aucune pagination n'est
   *  nécessaire, le domaine est borné par construction (voir `contrats/relances/enums.ts`). */
  async lister(
    ctx: ContexteTenant,
    role: RoleUtilisateur,
  ): Promise<readonly ReponseRegleRelance[]> {
    verifierRoleAutorise(role, ROLES_RELANCES_FACTURATION, 'relances.facturation.regle.lire');

    return this.acces.enTenant(ctx, async (tx) => {
      const lignes = await tx
        .select()
        .from(regleRelance)
        .where(eq(regleRelance.tenantId, ctx.tenantId))
        .orderBy(asc(regleRelance.typeRelance));
      return lignes.map(versReponseRegleRelance);
    });
  }

  /**
   * `PUT /relances/regles/{typeRelance}` — upsert idempotent sur la contrainte unique
   * `(tenant_id, type_relance)`. Rejouer la même requête produit la même ligne, jamais un
   * doublon ni une erreur — c'est un PUT, pas un POST de création.
   */
  async upserter(
    ctx: ContexteTenant,
    role: RoleUtilisateur,
    typeRelance: TypeRelance,
    entree: EntreeUpsertRegleRelance,
  ): Promise<ReponseRegleRelance> {
    verifierRoleAutorise(role, ROLES_RELANCES_FACTURATION, 'relances.facturation.regle.ecrire');

    return this.acces.enTenant(ctx, async (tx) => {
      const colonnes = {
        actif: entree.actif,
        delaisJours: entree.delaisJours,
        canaux: entree.canaux,
      };

      const [ligne] = await tx
        .insert(regleRelance)
        .values({ tenantId: ctx.tenantId, typeRelance, ...colonnes })
        .onConflictDoUpdate({
          target: [regleRelance.tenantId, regleRelance.typeRelance],
          set: colonnes,
        })
        .returning();

      /* c8 ignore next 6 -- garde-fou : `insert ... returning` renvoie toujours exactement une
       * ligne sur un upsert réussi (insert ou update), il n'existe pas de chemin où `ligne` est
       * `undefined` sans qu'une exception SQL n'ait déjà été levée avant d'atteindre cette ligne
       * (même garde que `service-bloc-creancier.ts`). */
      if (!ligne) {
        throw new ErreurMetier(
          'RESSOURCE_INTROUVABLE',
          'Écriture de la règle de relance : aucune ligne renvoyée par l’upsert.',
        );
      }
      return versReponseRegleRelance(ligne);
    });
  }
}
