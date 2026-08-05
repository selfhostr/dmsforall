import { Inject, Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import type { EntreeUpsertRegleRelance, ReponseRegleRelance, TypeRelance } from '@dfa/shared';

import type { AccesBase, ContexteTenant } from '../db';
import { JETON_DB } from '../db';
import { regleRelance } from '../db/schema';
import { ErreurMetier } from '../common/erreurs';

import { versReponseRegleRelance } from './mappers';

/**
 * Configuration `regle_relance` (§5, §4 de la spec) — une ligne par `(tenant, type_relance)`,
 * jamais supprimée (désactiver via `actif = false`).
 *
 * Droits posés définitivement dans `auth/matrice-droits.ts` (`relances.facturation.regle.lire`/
 * `.ecrire`) : l'autorisation est portée EXCLUSIVEMENT par `@ExigerDroit(...)` + `GardeDroit` sur
 * `relances.controller.ts`, qui refuse `403 DROIT_INSUFFISANT` avant même que les méthodes
 * ci-dessous ne s'exécutent — un rôle non autorisé n'atteint donc jamais ce service, encore moins
 * la base. Ce service ne prend PLUS de rôle en paramètre (retiré avec le palliatif
 * `relances/droits-provisoires.ts` : une double vérification romprait la doctrine du dépôt, « un
 * seul mécanisme d'autorisation », `auth/matrice-droits.ts`, tête de fichier) — même patron que
 * `pneus/service-depot-pneus.ts`.
 */
@Injectable()
export class ServiceRegleRelance {
  constructor(@Inject(JETON_DB) private readonly acces: AccesBase) {}

  /** `GET /relances/regles` — au plus 9 lignes (une par `TypeRelance`) : aucune pagination n'est
   *  nécessaire, le domaine est borné par construction (voir `contrats/relances/enums.ts`). */
  async lister(ctx: ContexteTenant): Promise<readonly ReponseRegleRelance[]> {
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
    typeRelance: TypeRelance,
    entree: EntreeUpsertRegleRelance,
  ): Promise<ReponseRegleRelance> {
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
