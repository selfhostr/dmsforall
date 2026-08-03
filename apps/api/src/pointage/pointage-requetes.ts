import { and, eq } from 'drizzle-orm';

import type { ContexteTenant, TransactionDfa } from '../db';
import { pointage, type LignePointage } from '../db/schema';
import { ErreurMetier } from '../common/erreurs/erreur-metier';

/**
 * Lectures/verrous PARTAGÉS sur la table `pointage` elle-même. Rescoping explicite sur `tenant_id`
 * en plus du RLS (le RLS est le filet, jamais le mécanisme — doctrine du projet), même patron que
 * `atelier/or-requetes.ts`.
 */

export async function chargerPointagePourEcriture(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  id: string,
): Promise<LignePointage> {
  const [ligne] = await tx
    .select()
    .from(pointage)
    .where(and(eq(pointage.tenantId, ctx.tenantId), eq(pointage.id, id)))
    .for('update');
  if (!ligne) {
    throw new ErreurMetier('RESSOURCE_INTROUVABLE', `Pointage ${id} introuvable.`);
  }
  return ligne;
}

export async function chargerPointageOuNull(tx: TransactionDfa, ctx: ContexteTenant, id: string): Promise<LignePointage | null> {
  const [ligne] = await tx
    .select()
    .from(pointage)
    .where(and(eq(pointage.tenantId, ctx.tenantId), eq(pointage.id, id)))
    .limit(1);
  return ligne ?? null;
}

/**
 * RM-89 : le pointage `en_cours` du technicien, s'il existe — verrouillé, car la clôture
 * automatique (mise à jour) doit se faire dans la même transaction que la création du nouveau
 * pointage, sous peine de violer `pointage_technicien_un_seul_en_cours_uk` (voir l'en-tête de
 * `db/schema/pointage/pointage.ts`).
 */
export async function chargerPointageOuvertTechnicien(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  technicienId: string,
): Promise<LignePointage | null> {
  const [ligne] = await tx
    .select()
    .from(pointage)
    .where(and(eq(pointage.tenantId, ctx.tenantId), eq(pointage.technicienId, technicienId), eq(pointage.statut, 'en_cours')))
    .limit(1)
    .for('update');
  return ligne ?? null;
}
