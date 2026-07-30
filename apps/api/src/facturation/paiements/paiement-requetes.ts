import { and, eq, inArray } from 'drizzle-orm';
import { sql } from 'drizzle-orm';

import type { ContexteTenant, TransactionDfa } from '../../db';
import { ErreurMetier } from '../../common/erreurs';
import {
  client,
  documentVente,
  paiement,
  utilisateur,
  type LigneDocumentVente,
  type LignePaiement,
} from '../../db/schema';

/** Même forme que `atelier/references.ts::ResumeUtilisateur` — dupliquée volontairement plutôt
 *  qu'importée : `atelier/` et `facturation/` sont deux périmètres d'agents distincts, et aucun
 *  des deux modules ne s'importe l'un l'autre dans ce dépôt (voir le rapport de livraison). */
export interface ResumeUtilisateurPaiement {
  readonly utilisateurId: string;
  readonly nomAffiche: string;
}

export async function chargerResumeUtilisateurPaiement(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  utilisateurId: string | null,
): Promise<ResumeUtilisateurPaiement | null> {
  if (!utilisateurId) return null;
  const [ligne] = await tx
    .select({ id: utilisateur.id, prenom: utilisateur.prenom, nom: utilisateur.nom })
    .from(utilisateur)
    .where(and(eq(utilisateur.tenantId, ctx.tenantId), eq(utilisateur.id, utilisateurId)))
    .limit(1);
  if (!ligne) return null;
  return { utilisateurId: ligne.id, nomAffiche: `${ligne.prenom} ${ligne.nom}` };
}

/** Résout un lot d'identifiants utilisateur EN UNE SEULE requête — évite le N+1 sur une page de
 *  paiements (chacun avec un `creePar` et plusieurs `imputePar`). */
export async function chargerResumesUtilisateurs(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  utilisateurIds: ReadonlySet<string>,
): Promise<ReadonlyMap<string, ResumeUtilisateurPaiement>> {
  if (utilisateurIds.size === 0) return new Map();
  const lignes = await tx
    .select({ id: utilisateur.id, prenom: utilisateur.prenom, nom: utilisateur.nom })
    .from(utilisateur)
    .where(and(eq(utilisateur.tenantId, ctx.tenantId), inArray(utilisateur.id, [...utilisateurIds])));
  return new Map(lignes.map((l) => [l.id, { utilisateurId: l.id, nomAffiche: `${l.prenom} ${l.nom}` }]));
}

export async function verifierClientExiste(tx: TransactionDfa, ctx: ContexteTenant, clientId: string): Promise<void> {
  const [ligne] = await tx
    .select({ id: client.id })
    .from(client)
    .where(and(eq(client.tenantId, ctx.tenantId), eq(client.id, clientId)))
    .limit(1);
  if (!ligne) {
    throw new ErreurMetier('RESSOURCE_INTROUVABLE', `Client ${clientId} introuvable.`);
  }
}

/**
 * Charge un document de vente pour ÉCRITURE (`for update`) : verrouille la ligne pour toute la
 * durée de la transaction — même patron que `chargerOrPourEcriture` (`atelier/or-requetes.ts`),
 * nécessaire ici parce que ce même appel recalcule ensuite `montant_regle_centimes`/
 * `solde_centimes`/`statut_reglement` (MD-53, dérivés maintenus par le SERVICE — voir le
 * commentaire de `document_vente` dans `0010_facturation.sql` §7, PAS par un trigger malgré ce
 * qu'affirme `modele-documentaire-facturation.md` MD-53 : la migration RÉELLEMENT appliquée n'en
 * pose aucun sur `imputation_paiement` au-delà des deux invariants MD-51 — vérifié ligne à ligne).
 */
export async function chargerDocumentPourEcriture(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  documentId: string,
): Promise<LigneDocumentVente> {
  const [ligne] = await tx
    .select()
    .from(documentVente)
    .where(and(eq(documentVente.tenantId, ctx.tenantId), eq(documentVente.id, documentId)))
    .limit(1)
    .for('update');
  if (!ligne) {
    throw new ErreurMetier('RESSOURCE_INTROUVABLE', `Document de vente ${documentId} introuvable.`);
  }
  return ligne;
}

async function chargerPaiementOuNull(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  paiementId: string,
  pourEcriture: boolean,
): Promise<LignePaiement | null> {
  const condition = and(eq(paiement.tenantId, ctx.tenantId), eq(paiement.id, paiementId));
  const [ligne] = pourEcriture
    ? await tx.select().from(paiement).where(condition).limit(1).for('update')
    : await tx.select().from(paiement).where(condition).limit(1);
  return ligne ?? null;
}

export async function chargerPaiement(tx: TransactionDfa, ctx: ContexteTenant, paiementId: string): Promise<LignePaiement> {
  const ligne = await chargerPaiementOuNull(tx, ctx, paiementId, false);
  if (!ligne) {
    throw new ErreurMetier('RESSOURCE_INTROUVABLE', `Paiement ${paiementId} introuvable.`);
  }
  return ligne;
}

/** Verrouille le paiement (`for update`) — nécessaire avant toute action qui en dérive un second
 *  (imputation, remboursement, abandon) : `montantNonImputeCentimes` doit être calculé sur un état
 *  stable pour toute la transaction, sous peine d'imputer/rembourser deux fois le même reliquat en
 *  cas de double-clic concurrent. */
export async function chargerPaiementPourEcriture(tx: TransactionDfa, ctx: ContexteTenant, paiementId: string): Promise<LignePaiement> {
  const ligne = await chargerPaiementOuNull(tx, ctx, paiementId, true);
  if (!ligne) {
    throw new ErreurMetier('RESSOURCE_INTROUVABLE', `Paiement ${paiementId} introuvable.`);
  }
  return ligne;
}

/**
 * `parametre_atelier.arrondi_especes_actif` (migration `0010_facturation.sql` §4, PF-05/AC-20) —
 * lu en SQL brut, VOLONTAIREMENT hors du query-builder Drizzle : la colonne existe bien en base
 * mais n'a pas encore été ajoutée à `apps/api/src/db/schema/atelier/parametrage.ts` au moment où
 * ce module est écrit (ce fichier appartient à un autre périmètre — voir le rapport de livraison,
 * §gaps). Défaut `true` si aucune ligne de paramètres n'existe encore pour ce tenant, exactement
 * comme le `DEFAULT true` de la colonne en base.
 */
export async function chargerArrondiEspecesActif(tx: TransactionDfa, ctx: ContexteTenant): Promise<boolean> {
  const resultat = await tx.execute<{ arrondi_especes_actif: boolean }>(sql`
    select arrondi_especes_actif
      from public.parametre_atelier
     where tenant_id = ${ctx.tenantId}
  `);
  return resultat.rows[0]?.arrondi_especes_actif ?? true;
}
