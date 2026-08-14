import { and, desc, eq, gte, inArray, isNotNull, lte } from 'drizzle-orm';

import type { ContexteTenant, TransactionDfa } from '../db';
import { ligneOr, ordreReparation, pointage, type LignePointage } from '../db/schema';
import { ErreurMetier } from '../common/erreurs/erreur-metier';
import type { PointagePourAgregat, PointageProductifDuJour } from './regles-pointage';

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

export async function chargerPointageOuNull(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  id: string,
): Promise<LignePointage | null> {
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
    .where(
      and(
        eq(pointage.tenantId, ctx.tenantId),
        eq(pointage.technicienId, technicienId),
        eq(pointage.statut, 'en_cours'),
      ),
    )
    .limit(1)
    .for('update');
  return ligne ?? null;
}

/**
 * `GET /pointages/agregats-ligne` — tous les pointages `nature = 'productif_ligne'` de l'OR
 * (`ligne_or_id is not null` suffit à les isoler : c'est la seule nature qui porte ce champ,
 * `pointage_cible_coherente_chk`). Borné par OR (au plus quelques dizaines de pointages), lecture
 * NON verrouillée — même patron que `ServiceLecturePointage.pointagesOuvertsPourOr`.
 */
export async function chargerPointagesPourAgregatLigne(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  ordreReparationId: string,
): Promise<readonly PointagePourAgregat[]> {
  return tx
    .select({
      ligneOrId: pointage.ligneOrId,
      statut: pointage.statut,
      dureeArrondieCentiemes: pointage.dureeArrondieCentiemes,
    })
    .from(pointage)
    .where(
      and(
        eq(pointage.tenantId, ctx.tenantId),
        eq(pointage.ordreReparationId, ordreReparationId),
        isNotNull(pointage.ligneOrId),
      ),
    );
}

/**
 * `GET /pointages/dernier-du-jour` — tous les pointages PRODUCTIFS (`productif_ligne`/
 * `productif_or`, JAMAIS `indirect` — RM-87, voir `regles-pointage.ts::resoudreCibleReprise`) du
 * technicien démarrés dans la journée de travail courante (`[debutJournee, finJournee]` inclus, UTC
 * pur — `regles-pointage.ts::journeeTravailCourante`), avec le statut de l'OR et, le cas échéant, de
 * la ligne ciblée : JOINTS ici (pas résolus par un second aller-retour) pour que la fonction pure
 * appelante puisse trancher « encore pointable » sans requête supplémentaire — même doctrine que le
 * `leftJoin` direct de `service-pointage.ts::lister` sur `ordre_reparation`/`ligne_or`.
 *
 * `innerJoin` sur `ordre_reparation` (toujours renseigné pour un pointage productif, FK non
 * annulable) ; `leftJoin` sur `ligne_or` (nul quand `nature = 'productif_or'`). Borné à UN
 * technicien sur UNE journée : jamais plus qu'une poignée de lignes, lecture NON verrouillée (rapport
 * de consultation, même patron que `chargerPointagesPourAgregatLigne`). Rescoping explicite sur
 * `tenant_id` pour les DEUX jointures, pas seulement sur `pointage` — le RLS est le filet, jamais le
 * mécanisme (doctrine du projet).
 */
export async function chargerPointagesProductifsDuJour(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  technicienId: string,
  debutJournee: Date,
  finJournee: Date,
): Promise<readonly PointageProductifDuJour[]> {
  return tx
    .select({
      id: pointage.id,
      ordreReparationId: pointage.ordreReparationId,
      ligneOrId: pointage.ligneOrId,
      siteId: pointage.siteId,
      debutLe: pointage.debutLe,
      finLe: pointage.finLe,
      statutOr: ordreReparation.statut,
      statutLigne: ligneOr.statut,
      numeroOr: ordreReparation.numero,
      designationLigne: ligneOr.designation,
    })
    .from(pointage)
    .innerJoin(
      ordreReparation,
      and(
        eq(ordreReparation.tenantId, ctx.tenantId),
        eq(ordreReparation.id, pointage.ordreReparationId),
      ),
    )
    .leftJoin(ligneOr, and(eq(ligneOr.tenantId, ctx.tenantId), eq(ligneOr.id, pointage.ligneOrId)))
    .where(
      and(
        eq(pointage.tenantId, ctx.tenantId),
        eq(pointage.technicienId, technicienId),
        inArray(pointage.nature, ['productif_ligne', 'productif_or']),
        gte(pointage.debutLe, debutJournee),
        lte(pointage.debutLe, finJournee),
      ),
    )
    .orderBy(desc(pointage.debutLe));
}
