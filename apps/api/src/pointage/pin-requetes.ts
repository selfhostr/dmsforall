import { and, eq, ne } from 'drizzle-orm';
import type { RoleUtilisateur } from '@dfa/shared';

import type { ContexteTenant, TransactionDfa } from '../db';
import {
  pinPointage,
  site,
  utilisateur,
  type LignePinPointage,
  type NouveauPinPointage,
} from '../db/schema';
import { ErreurMetier } from '../common/erreurs/erreur-metier';

/**
 * Lectures/écritures sur `pin_pointage` (RM-125 → RM-128) — copie locale au module, MÊME DOCTRINE
 * que `references.ts` / `pointage-requetes.ts` : ce fichier lit le SCHÉMA PARTAGÉ (`../db/schema`,
 * surface publique) et rescoped explicitement sur `tenant_id` en plus du RLS (le RLS est le filet,
 * jamais le mécanisme). Aucune de ces requêtes n'expose jamais `pin_hash` au-delà de ce module :
 * la valeur hachée sert uniquement à `argon2.verify()` en service, elle ne remonte à aucun DTO.
 */

/** Un PIN actif du site + le nom du technicien à afficher (RM-126 : accueil nominatif). */
export interface PinActifAvecTechnicien {
  readonly utilisateurId: string;
  readonly pinHash: string;
  readonly prenom: string;
  readonly nom: string;
}

/**
 * Techniciens ACTIFS de la borne d'un site, avec leur PIN haché et leur nom. Portée par le préfixe
 * `(tenant_id, site_id)` de `pin_pointage_tenant_site_utilisateur_uk` (migration 0036 §2.1 : N par
 * site est petit par construction, un scan du préfixe suffit). `actif` filtré côté requête.
 */
export async function chargerPinsActifsDuSite(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  siteId: string,
): Promise<readonly PinActifAvecTechnicien[]> {
  return tx
    .select({
      utilisateurId: pinPointage.utilisateurId,
      pinHash: pinPointage.pinHash,
      prenom: utilisateur.prenom,
      nom: utilisateur.nom,
    })
    .from(pinPointage)
    .innerJoin(
      utilisateur,
      and(
        eq(utilisateur.tenantId, pinPointage.tenantId),
        eq(utilisateur.id, pinPointage.utilisateurId),
      ),
    )
    .where(
      and(
        eq(pinPointage.tenantId, ctx.tenantId),
        eq(pinPointage.siteId, siteId),
        eq(pinPointage.actif, true),
      ),
    );
}

/**
 * PIN hachés des AUTRES techniciens actifs du même site (RM-127 : unicité du PIN par site vérifiée
 * à l'écriture). Exclut `exclureUtilisateurId` : réattribuer à un technicien le même PIN qu'il a
 * déjà n'est pas un conflit avec lui-même. Seules les lignes ACTIVES comptent — une ligne inactive
 * ne participe à aucune identification, donc aucune collision possible.
 */
export async function chargerPinsActifsAutresTechniciens(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  siteId: string,
  exclureUtilisateurId: string,
): Promise<readonly Pick<LignePinPointage, 'utilisateurId' | 'pinHash'>[]> {
  return tx
    .select({ utilisateurId: pinPointage.utilisateurId, pinHash: pinPointage.pinHash })
    .from(pinPointage)
    .where(
      and(
        eq(pinPointage.tenantId, ctx.tenantId),
        eq(pinPointage.siteId, siteId),
        eq(pinPointage.actif, true),
        ne(pinPointage.utilisateurId, exclureUtilisateurId),
      ),
    );
}

/** Ligne de rattachement (site, technicien), active OU inactive — pour décider insert vs update. */
export async function chargerLignePin(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  siteId: string,
  utilisateurId: string,
): Promise<LignePinPointage | null> {
  const [ligne] = await tx
    .select()
    .from(pinPointage)
    .where(
      and(
        eq(pinPointage.tenantId, ctx.tenantId),
        eq(pinPointage.siteId, siteId),
        eq(pinPointage.utilisateurId, utilisateurId),
      ),
    )
    .limit(1)
    .for('update');
  return ligne ?? null;
}

/** Existence du site dans le tenant (404 net avant tout hachage, plutôt qu'une violation de FK). */
export async function verifierSiteExiste(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  siteId: string,
): Promise<void> {
  const [ligne] = await tx
    .select({ id: site.id })
    .from(site)
    .where(and(eq(site.tenantId, ctx.tenantId), eq(site.id, siteId)))
    .limit(1);
  if (!ligne) {
    throw new ErreurMetier('RESSOURCE_INTROUVABLE', `Site ${siteId} introuvable pour ce tenant.`);
  }
}

/** Le technicien cible d'une attribution : rôle + statut, pour valider avant d'écrire. */
export interface UtilisateurCiblePin {
  readonly id: string;
  readonly role: RoleUtilisateur;
  readonly statut: string;
}

export async function chargerUtilisateurCible(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  utilisateurId: string,
): Promise<UtilisateurCiblePin> {
  const [ligne] = await tx
    .select({ id: utilisateur.id, role: utilisateur.role, statut: utilisateur.statut })
    .from(utilisateur)
    .where(and(eq(utilisateur.tenantId, ctx.tenantId), eq(utilisateur.id, utilisateurId)))
    .limit(1);
  if (!ligne) {
    throw new ErreurMetier(
      'RESSOURCE_INTROUVABLE',
      `Utilisateur ${utilisateurId} introuvable pour ce tenant.`,
    );
  }
  return ligne;
}

/** Insère une nouvelle ligne de rattachement (site, technicien) avec son PIN haché. */
export async function insererPin(tx: TransactionDfa, valeurs: NouveauPinPointage): Promise<void> {
  await tx.insert(pinPointage).values(valeurs);
}

/**
 * Met à jour le PIN haché et réactive la ligne (attribution/réinitialisation). Le trigger
 * `pin_pointage_touche_modifie_le` (migration 0036) pose `modifie_le` — inutile de le fixer ici.
 */
export async function majPinHash(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  siteId: string,
  utilisateurId: string,
  pinHash: string,
  modifieParUtilisateurId: string,
): Promise<void> {
  await tx
    .update(pinPointage)
    .set({ pinHash, actif: true, modifieParUtilisateurId })
    .where(
      and(
        eq(pinPointage.tenantId, ctx.tenantId),
        eq(pinPointage.siteId, siteId),
        eq(pinPointage.utilisateurId, utilisateurId),
      ),
    );
}

/** Révoque un rattachement (RM : `actif=false`, jamais un DELETE — non accordé à `dfa_app`). */
export async function desactiverPin(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  siteId: string,
  utilisateurId: string,
  modifieParUtilisateurId: string,
): Promise<void> {
  await tx
    .update(pinPointage)
    .set({ actif: false, modifieParUtilisateurId })
    .where(
      and(
        eq(pinPointage.tenantId, ctx.tenantId),
        eq(pinPointage.siteId, siteId),
        eq(pinPointage.utilisateurId, utilisateurId),
      ),
    );
}
