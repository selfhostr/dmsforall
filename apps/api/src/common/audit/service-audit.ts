import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { JETON_DB, type AccesBase, type ContexteTenant, type TransactionDfa } from '../../db';
import type { ActionAuditee, EntiteAuditee, EntreeAudit, ServiceAudit } from './audit.types';

/**
 * Colonnes lues brutes (snake_case, telles que le driver `pg` les rend hors mapping Drizzle).
 * Alias de type et non `interface` : Drizzle contraint le paramètre de `execute<T>` à
 * `Record<string, unknown>`, contrainte qu'un alias satisfait par signature d'index implicite,
 * mais qu'une interface ne satisfait pas (même convention que `PostureTable`,
 * `db/acces-base.service.ts`).
 */
type LigneAuditBrute = {
  readonly id: string;
  readonly entite: EntiteAuditee;
  readonly entite_id: string;
  readonly action: ActionAuditee;
  readonly champ: string | null;
  readonly valeur_avant: unknown;
  readonly valeur_apres: unknown;
  readonly utilisateur_id: string | null;
  readonly requete_id: string | null;
  readonly cree_le: Date;
};

function versEntreeAudit(ligne: LigneAuditBrute): EntreeAudit {
  return {
    id: ligne.id,
    entite: ligne.entite,
    entiteId: ligne.entite_id,
    action: ligne.action,
    champ: ligne.champ,
    valeurAvant: ligne.valeur_avant,
    valeurApres: ligne.valeur_apres,
    utilisateurId: ligne.utilisateur_id,
    requeteId: ligne.requete_id,
    creeLe: ligne.cree_le,
  };
}

/**
 * Implémentation SQL directe — pas de schéma Drizzle `audit_atelier` : la table (partitionnée par
 * mois) est créée par la migration `0004` (L1-04, en parallèle de cet agent). Colonnes conformes à
 * `plan-lot1-execution.md` §L1-04 / `plan-etape-1-backend.md` §2.4 : `audit_atelier(id, tenant_id,
 * entite entite_auditee, entite_id, action action_auditee, champ, valeur_avant jsonb,
 * valeur_apres jsonb, utilisateur_id, requete_id, cree_le)`. Toujours interrogée via la table
 * PARENTE (`public.audit_atelier`), jamais une partition nommément — voir le piège B documenté en
 * §5.3 du plan : une partition interrogée directement ne passe par AUCUNE politique RLS.
 */
@Injectable()
export class ServiceAuditImpl implements ServiceAudit {
  constructor(@Inject(JETON_DB) private readonly acces: AccesBase) {}

  async pourEntite(
    ctx: ContexteTenant,
    entite: EntiteAuditee,
    entiteId: string,
  ): Promise<readonly EntreeAudit[]> {
    return this.acces.enTenant(ctx, (tx) => this.pourEntiteTx(tx, ctx, entite, entiteId));
  }

  async pourEntiteTx(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    entite: EntiteAuditee,
    entiteId: string,
  ): Promise<readonly EntreeAudit[]> {
    return this.pourEntitesTx(tx, ctx, [{ entite, entiteId }]);
  }

  async pourEntitesTx(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    entites: readonly { readonly entite: EntiteAuditee; readonly entiteId: string }[],
  ): Promise<readonly EntreeAudit[]> {
    if (entites.length === 0) return [];

    // `unnest(tableau1, tableau2)` apparie les deux tableaux position par position (Postgres ≥
    // 9.4) : produit les COUPLES (entite, entite_id) demandés en une seule requête, là où une
    // boucle appelante en aurait fait une par entité. `sql.param(...)::type[]` — jamais
    // l'interpolation directe d'un tableau JS dans `sql\`\``, qui produit un constructeur
    // d'enregistrement au lieu d'un tableau SQL et fait échouer la requête à l'exécution (même
    // motif que `recherche/service-recherche.ts` et `vehicules/service-vehicule.ts`).
    const entiteNoms = entites.map((e) => e.entite);
    const entiteIds = entites.map((e) => e.entiteId);

    // Rescope explicite sur tenant_id, même si le RLS filtre déjà via le GUC posé par
    // enTenant() : le RLS est le filet, jamais le mécanisme (doctrine du projet).
    const lignes = await tx.execute<LigneAuditBrute>(sql`
      select id, entite, entite_id, action, champ, valeur_avant, valeur_apres, utilisateur_id, requete_id, cree_le
        from public.audit_atelier
       where tenant_id = ${ctx.tenantId}
         and (entite, entite_id) in (
           select * from unnest(
             ${sql.param(entiteNoms)}::public.entite_auditee[],
             ${sql.param(entiteIds)}::uuid[]
           )
         )
       order by cree_le asc
    `);
    return lignes.rows.map(versEntreeAudit);
  }
}
