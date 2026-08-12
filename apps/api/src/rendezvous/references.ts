import { and, eq } from 'drizzle-orm';

import type { ContexteTenant, TransactionDfa } from '../db';
import {
  motifRendezVous,
  ordreReparation,
  parametreSite,
  rendezVous,
  type LigneMotifRendezVous,
  type LigneRendezVous,
} from '../db/schema';
import { ErreurMetier } from '../common/erreurs/erreur-metier';

/**
 * Lectures partagées entre les services `rendezvous/` — même doctrine que
 * `atelier/references.ts` : rescoping explicite sur `tenant_id` en plus du RLS (le RLS est le
 * filet, jamais le mécanisme).
 */

export async function chargerMotifLigne(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  motifId: string,
): Promise<LigneMotifRendezVous> {
  const [ligne] = await tx
    .select()
    .from(motifRendezVous)
    .where(and(eq(motifRendezVous.tenantId, ctx.tenantId), eq(motifRendezVous.id, motifId)))
    .limit(1);
  if (!ligne) {
    throw new ErreurMetier('RESSOURCE_INTROUVABLE', `Motif de rendez-vous ${motifId} introuvable.`);
  }
  return ligne;
}

export async function chargerRendezVousOuNull(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  rdvId: string,
  pourEcriture = false,
): Promise<LigneRendezVous | null> {
  const condition = and(eq(rendezVous.tenantId, ctx.tenantId), eq(rendezVous.id, rdvId));
  const [ligne] = pourEcriture
    ? await tx.select().from(rendezVous).where(condition).limit(1).for('update')
    : await tx.select().from(rendezVous).where(condition).limit(1);
  return ligne ?? null;
}

export async function chargerRendezVous(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  rdvId: string,
): Promise<LigneRendezVous> {
  const ligne = await chargerRendezVousOuNull(tx, ctx, rdvId, false);
  if (!ligne) {
    throw new ErreurMetier('RESSOURCE_INTROUVABLE', `Rendez-vous ${rdvId} introuvable.`);
  }
  return ligne;
}

/** Verrouille la ligne pour toute transition (arrivée, absence, annulation, déplacement) — même
 *  patron que `atelier/or-requetes.ts::chargerOrPourEcriture` (§3.3 couche 4). */
export async function chargerRendezVousPourEcriture(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  rdvId: string,
): Promise<LigneRendezVous> {
  const ligne = await chargerRendezVousOuNull(tx, ctx, rdvId, true);
  if (!ligne) {
    throw new ErreurMetier('RESSOURCE_INTROUVABLE', `Rendez-vous ${rdvId} introuvable.`);
  }
  return ligne;
}

/**
 * L'OR déjà créé par CE rendez-vous, s'il existe — `ordre_reparation.rendez_vous_id` est le SEUL
 * sens de la relation (`docs/conception-rendez-vous-donnees.md` §0 : « l'OR référence le RDV,
 * jamais l'inverse »), donc résolu par une requête inverse plutôt qu'une colonne stockée sur
 * `rendez_vous`. Sert `arrivee()` (idempotence d'un rejeu de l'action) et l'assemblage de
 * `ReponseRendezVous.ordreReparationId`.
 */
export async function chargerOrLieOuNull(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  rdvId: string,
): Promise<{ readonly id: string; readonly statut: string } | null> {
  const [ligne] = await tx
    .select({ id: ordreReparation.id, statut: ordreReparation.statut })
    .from(ordreReparation)
    .where(and(eq(ordreReparation.tenantId, ctx.tenantId), eq(ordreReparation.rendezVousId, rdvId)))
    .limit(1);
  return ligne ?? null;
}

/** `parametre_site.capacite_heures_jour_centiemes` — `null` si le site n'a jamais paramétré sa
 *  capacité (RV-08, défaut réel : pas de ligne, ou ligne avec la colonne NULL). */
export async function chargerCapaciteHeuresJourCentiemes(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  siteId: string,
): Promise<number | null> {
  const [ligne] = await tx
    .select({ capacite: parametreSite.capaciteHeuresJourCentiemes })
    .from(parametreSite)
    .where(and(eq(parametreSite.tenantId, ctx.tenantId), eq(parametreSite.siteId, siteId)))
    .limit(1);
  return ligne?.capacite ?? null;
}
