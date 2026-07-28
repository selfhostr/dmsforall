import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { JETON_DB, type AccesBase, type ContexteTenant } from '../../db';
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

  async pourEntite(ctx: ContexteTenant, entite: EntiteAuditee, entiteId: string): Promise<readonly EntreeAudit[]> {
    return this.acces.enTenant(ctx, async (tx) => {
      // Rescope explicite sur tenant_id, même si le RLS filtre déjà via le GUC posé par
      // enTenant() : le RLS est le filet, jamais le mécanisme (doctrine du projet).
      const lignes = await tx.execute<LigneAuditBrute>(sql`
        select id, entite, entite_id, action, champ, valeur_avant, valeur_apres, utilisateur_id, requete_id, cree_le
          from public.audit_atelier
         where tenant_id = ${ctx.tenantId} and entite = ${entite} and entite_id = ${entiteId}
         order by cree_le asc
      `);
      return lignes.rows.map(versEntreeAudit);
    });
  }
}
