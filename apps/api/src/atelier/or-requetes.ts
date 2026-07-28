import { and, asc, eq, inArray } from 'drizzle-orm';

import type { ContexteTenant, TransactionDfa } from '../db';
import {
  devisComplementaire,
  devisComplementaireLigne,
  ligneOr,
  orControleQualite,
  ordreReparation,
  ordreReparationDemande,
  type LigneDevisComplementaire,
  type LigneDevisComplementaireLigne,
  type LigneLigneOr,
  type LigneOrControleQualite,
  type LigneOrdreReparation,
  type LigneOrdreReparationDemande,
} from '../db/schema';
import { ErreurMetier } from '../common/erreurs/erreur-metier';

/**
 * Lectures/verrous PARTAGÉS par tous les services `atelier` sur l'agrégat OR. Rescoping explicite
 * sur `tenant_id` en plus du RLS (le RLS est le filet, jamais le mécanisme — doctrine du projet).
 */

export async function chargerOrOuNull(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  orId: string,
  pourEcriture = false,
): Promise<LigneOrdreReparation | null> {
  const condition = and(eq(ordreReparation.tenantId, ctx.tenantId), eq(ordreReparation.id, orId));
  // `select … for update` (§ « couche 4 » du plan backend) : verrouille la ligne pour toute la
  // durée de la transaction, faisant en sorte que deux transitions concurrentes sur le même OR ne
  // puissent jamais évaluer leurs gardes contre le même état de départ. Deux chaînes complètes
  // (plutôt qu'une réaffectation conditionnelle de la requête) : le type du builder Drizzle change
  // à chaque maillon, une réaffectation ne type-check pas d'une branche à l'autre.
  const [ligne] = pourEcriture
    ? await tx.select().from(ordreReparation).where(condition).limit(1).for('update')
    : await tx.select().from(ordreReparation).where(condition).limit(1);
  return ligne ?? null;
}

/**
 * Verrouille et rend l'OR, ou lève `RESSOURCE_INTROUVABLE`. C'est le point d'entrée de TOUTE
 * transition (§3.3 couche 4 du plan backend) : gardes conditionnelles ET écriture du statut dans
 * la MÊME transaction, avec ce verrou.
 */
export async function chargerOrPourEcriture(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  orId: string,
): Promise<LigneOrdreReparation> {
  const ligne = await chargerOrOuNull(tx, ctx, orId, true);
  if (!ligne) {
    throw new ErreurMetier('RESSOURCE_INTROUVABLE', `Ordre de réparation ${orId} introuvable.`);
  }
  return ligne;
}

export async function chargerOr(tx: TransactionDfa, ctx: ContexteTenant, orId: string): Promise<LigneOrdreReparation> {
  const ligne = await chargerOrOuNull(tx, ctx, orId, false);
  if (!ligne) {
    throw new ErreurMetier('RESSOURCE_INTROUVABLE', `Ordre de réparation ${orId} introuvable.`);
  }
  return ligne;
}

export async function listerLignesOr(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  orId: string,
): Promise<readonly LigneLigneOr[]> {
  return tx
    .select()
    .from(ligneOr)
    .where(and(eq(ligneOr.tenantId, ctx.tenantId), eq(ligneOr.ordreReparationId, orId)))
    .orderBy(asc(ligneOr.numeroOrdre));
}

/** Verrouille les lignes ciblées par une action GROUPÉE (§7.7) — tout ou rien, dans la
 *  transaction de l'action. Ne lève PAS si une ligne demandée est absente : l'appelant décide
 *  (l'absence peut être un id périmé, distinct d'un statut incompatible). */
export async function chargerLignesPourEcriture(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  orId: string,
  ligneIds: readonly string[],
): Promise<readonly LigneLigneOr[]> {
  if (ligneIds.length === 0) return [];
  return tx
    .select()
    .from(ligneOr)
    .where(and(eq(ligneOr.tenantId, ctx.tenantId), eq(ligneOr.ordreReparationId, orId), inArray(ligneOr.id, ligneIds)))
    .for('update');
}

export async function chargerLigneOrPourEcriture(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  orId: string,
  ligneId: string,
): Promise<LigneLigneOr> {
  const [ligne] = await tx
    .select()
    .from(ligneOr)
    .where(and(eq(ligneOr.tenantId, ctx.tenantId), eq(ligneOr.ordreReparationId, orId), eq(ligneOr.id, ligneId)))
    .for('update');
  if (!ligne) {
    throw new ErreurMetier('RESSOURCE_INTROUVABLE', `Ligne ${ligneId} introuvable sur l'OR ${orId}.`);
  }
  return ligne;
}

export async function listerDemandesOr(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  orId: string,
): Promise<readonly LigneOrdreReparationDemande[]> {
  return tx
    .select()
    .from(ordreReparationDemande)
    .where(and(eq(ordreReparationDemande.tenantId, ctx.tenantId), eq(ordreReparationDemande.ordreReparationId, orId)))
    .orderBy(asc(ordreReparationDemande.ordre));
}

export async function listerDevisOr(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  orId: string,
): Promise<readonly LigneDevisComplementaire[]> {
  return tx
    .select()
    .from(devisComplementaire)
    .where(and(eq(devisComplementaire.tenantId, ctx.tenantId), eq(devisComplementaire.ordreReparationId, orId)))
    .orderBy(asc(devisComplementaire.numeroOrdre));
}

export async function listerLignesDevis(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  devisId: string,
): Promise<readonly LigneDevisComplementaireLigne[]> {
  return tx
    .select()
    .from(devisComplementaireLigne)
    .where(and(eq(devisComplementaireLigne.tenantId, ctx.tenantId), eq(devisComplementaireLigne.devisComplementaireId, devisId)));
}

/** Verrouille et rend un devis complémentaire, ou lève `RESSOURCE_INTROUVABLE` — point d'entrée
 *  de `ServiceDevis.repondre` (RM-79 : un devis répondu est immuable, la garde doit voir l'état
 *  final sous verrou pour ne jamais accepter une double réponse concurrente). */
export async function chargerDevisPourEcriture(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  orId: string,
  devisId: string,
): Promise<LigneDevisComplementaire> {
  const [ligne] = await tx
    .select()
    .from(devisComplementaire)
    .where(
      and(
        eq(devisComplementaire.tenantId, ctx.tenantId),
        eq(devisComplementaire.ordreReparationId, orId),
        eq(devisComplementaire.id, devisId),
      ),
    )
    .for('update');
  if (!ligne) {
    throw new ErreurMetier('RESSOURCE_INTROUVABLE', `Devis complémentaire ${devisId} introuvable sur l'OR ${orId}.`);
  }
  return ligne;
}

export async function chargerControleQualite(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  orId: string,
): Promise<LigneOrControleQualite | null> {
  const lignes = await tx
    .select()
    .from(orControleQualite)
    .where(and(eq(orControleQualite.tenantId, ctx.tenantId), eq(orControleQualite.ordreReparationId, orId)));
  return lignes.at(-1) ?? null;
}
