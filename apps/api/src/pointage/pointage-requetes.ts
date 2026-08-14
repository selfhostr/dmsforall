import { and, eq, isNotNull } from 'drizzle-orm';
import type { ArrondiPointage } from '@dfa/shared';

import type { ContexteTenant, TransactionDfa } from '../db';
import { parametreAtelier, parametreSite, pointage, type LignePointage } from '../db/schema';
import { ErreurMetier } from '../common/erreurs/erreur-metier';
import type {
  CandidatClotureAutomatique,
  DecisionClotureAutomatique,
  PointagePourAgregat,
} from './regles-pointage';

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

/* ------------------------------------------------------------------ */
/* RM-91 / RM-119 : clôture automatique de fin de journée                                           */
/* ------------------------------------------------------------------ */

/** Même défaut que `references.ts::PARAMETRES_ATELIER_PAR_DEFAUT_POINTAGE` (non exporté par ce
 *  fichier-là — voir son en-tête) : un tenant sans ligne `parametre_atelier` reste un cas
 *  défensif (fixture de test, tenant créé hors du chemin normal), jamais attendu en production
 *  (`parametre_atelier` : « une ligne par tenant », posée à la création du tenant). */
const ARRONDI_POINTAGE_PAR_DEFAUT: ArrondiPointage = 'quart';

/**
 * Candidats à la clôture automatique (RM-91/RM-119) — tout pointage `en_cours` d'un site qui a
 * configuré une heure de clôture (`parametre_site.heure_cloture_pointage`, P-31). Un site SANS
 * cette heure configurée n'a AUCUN candidat (fail-closed, même doctrine que
 * `ServiceRelancesFacture.planifier` : « sans config, rien ne se planifie, jamais un défaut actif
 * implicite ») — RM-91 ne peut rien clore sans savoir QUAND fermer.
 *
 * `arrondiPointage` vient d'un LEFT JOIN sur `parametre_atelier` (une ligne par TENANT, pas par
 * site) plutôt qu'un INNER JOIN : un tenant sans cette ligne (cas défensif ci-dessus) ne doit pas
 * faire disparaître silencieusement ses candidats à la clôture, seulement retomber sur le défaut.
 *
 * Trié `debutLe asc` et borné par `limite` (même doctrine « lot borné, jamais un balayage complet
 * sans limite » que `ServiceRelancesFacture` — `service-relances-facture.ts`, en-tête) : appeler
 * avec `limite + 1` permet à l'appelant de savoir s'il reste des candidats au-delà du lot traité
 * (voir `ServiceClotureAutomatiquePointage`).
 */
export async function chargerCandidatsClotureAutomatique(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  limite: number,
): Promise<readonly CandidatClotureAutomatique[]> {
  const lignes = await tx
    .select({
      id: pointage.id,
      debutLe: pointage.debutLe,
      heureCloturePointage: parametreSite.heureCloturePointage,
      arrondiPointage: parametreAtelier.arrondiPointage,
      anomalieMotif: pointage.anomalieMotif,
      anomalieDetecteeLe: pointage.anomalieDetecteeLe,
    })
    .from(pointage)
    .innerJoin(
      parametreSite,
      and(eq(parametreSite.tenantId, pointage.tenantId), eq(parametreSite.siteId, pointage.siteId)),
    )
    .leftJoin(parametreAtelier, eq(parametreAtelier.tenantId, pointage.tenantId))
    .where(
      and(
        eq(pointage.tenantId, ctx.tenantId),
        eq(pointage.statut, 'en_cours'),
        isNotNull(parametreSite.heureCloturePointage),
      ),
    )
    .orderBy(pointage.debutLe)
    .limit(limite);

  return lignes
    .filter(
      (l): l is typeof l & { heureCloturePointage: string } => l.heureCloturePointage !== null,
    )
    .map((l) => ({
      id: l.id,
      debutLe: l.debutLe,
      heureCloturePointage: l.heureCloturePointage,
      arrondiPointage: l.arrondiPointage ?? ARRONDI_POINTAGE_PAR_DEFAUT,
      anomalieMotif: l.anomalieMotif,
      anomalieDetecteeLe: l.anomalieDetecteeLe,
    }));
}

/**
 * Applique UNE décision de clôture automatique (`regles-pointage.ts::determinerDecisionCloture-
 * Automatique`) — RÉCLAMATION CONDITIONNELLE (`WHERE statut = 'en_cours'`), même patron que
 * `ServiceRelancesFacture.traiterUneRelance` (`service-relances-facture.ts`) : c'est CE `WHERE`,
 * pas un verrou applicatif, qui rend l'opération IDEMPOTENTE — un second passage du job ne trouve
 * plus la ligne `en_cours` (déjà `termine`, par ce job ou par une correction manuelle du chef
 * d'atelier qui ne repasse JAMAIS un pointage à `en_cours` — voir `ServicePointage.corriger`,
 * `service-pointage.ts`) et rend `false` sans rien réécrire.
 *
 * `clotureAutomatique: true` inconditionnellement (même si une anomalie PRÉEXISTANTE est
 * préservée par la décision, voir `determinerDecisionClotureAutomatique`) : ce champ enregistre
 * QUE ce pointage a été refermé automatiquement, indépendamment de la raison affichée dans
 * `anomalieMotif` — même sémantique que RM-89 sur ce même champ (`db/schema/pointage/pointage.ts`).
 */
export async function appliquerClotureAutomatique(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  decision: DecisionClotureAutomatique,
): Promise<boolean> {
  const misAJour = await tx
    .update(pointage)
    .set({
      statut: 'termine',
      finLe: decision.finLe,
      dureeArrondieCentiemes: decision.dureeArrondieCentiemes,
      clotureAutomatique: true,
      anomalieMotif: decision.anomalieMotif,
      anomalieDetecteeLe: decision.anomalieDetecteeLe,
    })
    .where(
      and(
        eq(pointage.tenantId, ctx.tenantId),
        eq(pointage.id, decision.pointageId),
        eq(pointage.statut, 'en_cours'),
      ),
    )
    .returning({ id: pointage.id });
  return misAJour.length > 0;
}
