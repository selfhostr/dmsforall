import { and, eq } from 'drizzle-orm';

import type { ContexteTenant, TransactionDfa } from '../db';
import {
  ligneOr,
  ordreReparation,
  parametreAtelier,
  utilisateur,
  type LigneLigneOr,
  type LigneOrdreReparation,
  type LigneParametreAtelier,
} from '../db/schema';
import { ErreurMetier } from '../common/erreurs/erreur-metier';

/**
 * Lectures PARTAGÉES par les services `pointage/` sur les entités d'un AUTRE domaine
 * (`ordre_reparation`, `ligne_or`, `parametre_atelier`, `utilisateur`) — copie locale volontaire,
 * MÊME DOCTRINE que `atelier/or-requetes.ts` vis-à-vis de `vehicules`/`clients` (« pas de
 * dépendance de compilation entre modules d'experts parallèles ») : ce module lit directement le
 * SCHÉMA PARTAGÉ (`../db/schema`, surface publique), jamais les fichiers internes de `atelier/`
 * (`or-requetes.ts`, `references.ts` n'y sont pas exportés par un barrel et ne sont pas destinés à
 * être importés depuis l'extérieur du module). Rescoping explicite sur `tenant_id` en plus du RLS
 * (le RLS est le filet, jamais le mécanisme — doctrine du projet).
 */

/** Verrouille et rend l'OR ciblé par un pointage, ou lève `RESSOURCE_INTROUVABLE`. */
export async function chargerOrPourPointage(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  orId: string,
): Promise<LigneOrdreReparation> {
  const [ligne] = await tx
    .select()
    .from(ordreReparation)
    .where(and(eq(ordreReparation.tenantId, ctx.tenantId), eq(ordreReparation.id, orId)))
    .limit(1)
    .for('update');
  if (!ligne) {
    throw new ErreurMetier('RESSOURCE_INTROUVABLE', `Ordre de réparation ${orId} introuvable.`);
  }
  return ligne;
}

/** Verrouille et rend la ligne ciblée par un pointage (scopée à son OR), ou lève `RESSOURCE_INTROUVABLE`. */
export async function chargerLignePourPointage(
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

/** Lecture NON verrouillée d'une ligne — pour la détection différée RM-123 sans bloquer d'autres lecteurs. */
export async function chargerLigneOuNull(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  ligneId: string,
): Promise<LigneLigneOr | null> {
  const [ligne] = await tx
    .select()
    .from(ligneOr)
    .where(and(eq(ligneOr.tenantId, ctx.tenantId), eq(ligneOr.id, ligneId)))
    .limit(1);
  return ligne ?? null;
}

export async function chargerOrOuNull(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  orId: string,
): Promise<LigneOrdreReparation | null> {
  const [ligne] = await tx
    .select()
    .from(ordreReparation)
    .where(and(eq(ordreReparation.tenantId, ctx.tenantId), eq(ordreReparation.id, orId)))
    .limit(1);
  return ligne ?? null;
}

/**
 * Réglages d'atelier consommés par le pointage : `chevauchementPointageAutorise` (P-06),
 * `pointageDureeMaxHeures` (RM-96), `arrondiPointage` (P-19). Copie locale des valeurs de repli de
 * `migrations/0005_parametrage.sql`, même doctrine que `atelier/references.ts` (le cas défensif
 * d'un tenant sans ligne `parametre_atelier` — fixture de test, tenant créé hors du chemin normal).
 */
const PARAMETRES_ATELIER_PAR_DEFAUT_POINTAGE: Pick<
  LigneParametreAtelier,
  'chevauchementPointageAutorise' | 'pointageDureeMaxHeures' | 'arrondiPointage'
> = {
  chevauchementPointageAutorise: false,
  pointageDureeMaxHeures: 12,
  arrondiPointage: 'quart',
};

export async function chargerParametresPointage(
  tx: TransactionDfa,
  ctx: ContexteTenant,
): Promise<Pick<LigneParametreAtelier, 'chevauchementPointageAutorise' | 'pointageDureeMaxHeures' | 'arrondiPointage'>> {
  const [ligne] = await tx
    .select({
      chevauchementPointageAutorise: parametreAtelier.chevauchementPointageAutorise,
      pointageDureeMaxHeures: parametreAtelier.pointageDureeMaxHeures,
      arrondiPointage: parametreAtelier.arrondiPointage,
    })
    .from(parametreAtelier)
    .where(eq(parametreAtelier.tenantId, ctx.tenantId))
    .limit(1);
  return ligne ?? PARAMETRES_ATELIER_PAR_DEFAUT_POINTAGE;
}

/** `GET /pointages/agregats-ligne` — toutes les lignes de l'OR, triées `numeroOrdre` (voir
 *  `regles-pointage.ts::calculerAgregatsTempsLigne`, qui filtre ensuite celles à rendre). Lecture
 *  NON verrouillée : un rapport de consultation, pas une écriture. */
export async function chargerLignesOrPourAgregat(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  ordreReparationId: string,
): Promise<readonly Pick<LigneLigneOr, 'id' | 'ordreReparationId' | 'numeroOrdre' | 'tempsBaremeCentiemes'>[]> {
  return tx
    .select({
      id: ligneOr.id,
      ordreReparationId: ligneOr.ordreReparationId,
      numeroOrdre: ligneOr.numeroOrdre,
      tempsBaremeCentiemes: ligneOr.tempsBaremeCentiemes,
    })
    .from(ligneOr)
    .where(and(eq(ligneOr.tenantId, ctx.tenantId), eq(ligneOr.ordreReparationId, ordreReparationId)));
}

export interface ResumeTechnicien {
  readonly technicienId: string;
  readonly nomAffiche: string;
}

export async function chargerResumeTechnicien(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  technicienId: string,
): Promise<ResumeTechnicien> {
  const [ligne] = await tx
    .select({ id: utilisateur.id, prenom: utilisateur.prenom, nom: utilisateur.nom })
    .from(utilisateur)
    .where(and(eq(utilisateur.tenantId, ctx.tenantId), eq(utilisateur.id, technicienId)))
    .limit(1);
  if (!ligne) {
    throw new ErreurMetier('RESSOURCE_INTROUVABLE', `Technicien ${technicienId} introuvable.`);
  }
  return { technicienId: ligne.id, nomAffiche: `${ligne.prenom} ${ligne.nom}`.trim() };
}
