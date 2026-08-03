import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import {
  JETON_DB,
  schema,
  type AccesBase,
  type ContexteTenant,
  type TransactionDfa,
} from '../../db';
import { ErreurMetier } from '../../common/erreurs';
import {
  versColonnesEcriture,
  versDtoBlocCreancier,
  type DtoBlocCreancier,
} from './mappeur-bloc-creancier';
import type { EntreeModificationBlocCreancier } from './schema-bloc-creancier';

/**
 * Contrôle d'accès (`direction`/`comptable` seulement, `RF-115`) porté par
 * `@ExigerDroit('facturation.parametrage.creancier.lire'|'.modifier')` sur
 * `BlocCreancierController`, vérifié par `GardeDroit` (`APP_GUARD` global, refus par défaut) AVANT
 * que ce service ne soit atteint — voir `auth/matrice-droits.ts`. Ce service ne revérifie pas le
 * rôle : un second contrôle ici referait, en moins visible, ce que le garde fait déjà, avec le
 * risque que les deux divergent avec le temps.
 */
@Injectable()
export class ServiceBlocCreancier {
  constructor(@Inject(JETON_DB) private readonly acces: AccesBase) {}

  async obtenir(ctx: ContexteTenant): Promise<DtoBlocCreancier> {
    return this.acces.enTenant(ctx, async (tx) => {
      const ligne = await this.chargerLigne(tx, ctx.tenantId);
      return versDtoBlocCreancier(ligne);
    });
  }

  /**
   * Validation métier (`versColonnesEcriture`, VALIDATION_ECHOUEE le cas échéant) AVANT tout
   * accès base — même discipline que `ServiceParametresAtelier.modifier` pour
   * `controleQualite` : un corps qui échoue la validation ne doit ouvrir aucune transaction.
   *
   * Écriture en UPSERT (`insert ... on conflict (tenant_id) do update`), pas en `UPDATE` simple :
   * la ligne n'existe pour AUCUN tenant après la migration 0014 (voir son commentaire de tête,
   * qui anticipe explicitement « éditée par un service applicatif via UPDATE (ou upsert) »).
   * `dfa_app` a `INSERT` en plus de `SELECT`/`UPDATE` sur cette table précisément pour ça. Seules
   * les colonnes PRÉSENTES dans le corps entrent dans `set` : une colonne absente du corps garde
   * sa valeur actuelle sur un conflit, exactement le comportement `PATCH` attendu — et sur un
   * premier INSERT, les colonnes absentes prennent leurs défauts de table (`pays = 'CH'`,
   * le reste `null`), jamais une valeur inventée par ce service.
   */
  async modifier(
    ctx: ContexteTenant,
    entree: EntreeModificationBlocCreancier,
  ): Promise<DtoBlocCreancier> {
    const colonnes = versColonnesEcriture(entree);

    return this.acces.enTenant(ctx, async (tx) => {
      if (Object.keys(colonnes).length === 0) {
        // Corps vide (`{}`) ou entièrement composé de champs absents après validation : rien à
        // écrire, on relit l'état courant plutôt que d'exécuter un upsert sans colonne.
        const ligne = await this.chargerLigne(tx, ctx.tenantId);
        return versDtoBlocCreancier(ligne);
      }

      const [ligne] = await tx
        .insert(schema.tenantBlocCreancier)
        .values({ tenantId: ctx.tenantId, ...colonnes })
        .onConflictDoUpdate({ target: schema.tenantBlocCreancier.tenantId, set: colonnes })
        .returning();

      /* c8 ignore next 6 -- garde-fou : `insert ... returning` renvoie toujours exactement une
       * ligne sur un upsert réussi (insert ou update), il n'existe pas de chemin où `ligne` est
       * `undefined` sans qu'une exception SQL n'ait déjà été levée avant d'atteindre cette ligne. */
      if (!ligne) {
        throw new ErreurMetier(
          'RESSOURCE_INTROUVABLE',
          'Écriture du bloc créancier : aucune ligne renvoyée par l’upsert.',
        );
      }
      return versDtoBlocCreancier(ligne);
    });
  }

  private async chargerLigne(
    tx: TransactionDfa,
    tenantId: string,
  ): Promise<schema.LigneTenantBlocCreancier | undefined> {
    const [ligne] = await tx
      .select()
      .from(schema.tenantBlocCreancier)
      .where(eq(schema.tenantBlocCreancier.tenantId, tenantId));
    return ligne;
  }
}
