import { Injectable } from '@nestjs/common';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';

import type { TransactionDfa } from '../db';
import { pointage, utilisateur } from '../db/schema';
// Import de TYPE SEUL depuis `atelier/atelier.jetons.ts` — lecture du contrat du port déjà gelé,
// jamais une dépendance d'exécution sur `atelier/` (aucun risque de cycle, aucun import de classe).
// `implements LecturePointage` fait vérifier par le compilateur que cette classe respecte
// EXACTEMENT la signature que `ServiceTransitions`/`ServiceLigneOr` attendent, plutôt que de
// espérer une correspondance structurelle jamais prouvée.
import type { LecturePointage, PointageOuvert } from '../atelier/atelier.jetons';

/**
 * Implémentation RÉELLE du port `LecturePointage` (`atelier/atelier.jetons.ts`), qui remplace
 * `LecturePointageVide` au lot 2 — voir le rapport de livraison pour la ligne de câblage à changer
 * dans `atelier/atelier.module.ts` (hors périmètre d'écriture de ce module).
 *
 * Signature IMPOSÉE par `atelier` (le consommateur du port) : ni l'une ni l'autre méthode ne reçoit
 * de `ContexteTenant` — l'isolation tenant repose ENTIÈREMENT sur le RLS actif dans `tx` (posé par
 * la transaction `enTenant()` de l'APPELANT, `ServiceTransitions`/`ServiceLigneOr` côté atelier).
 * Ce n'est pas un relâchement de la doctrine « le RLS est le filet, jamais le mécanisme » — c'est
 * une conséquence du contrat DÉJÀ GELÉ que ce fichier implémente tel quel, sans pouvoir y ajouter un
 * paramètre : le signaler plutôt que le contourner en silence.
 */
@Injectable()
export class ServiceLecturePointage implements LecturePointage {
  /** I-09 (`atelier`) : pointages `en_cours` sur cet OR — couvre `productif_ligne` ET
   *  `productif_or`, les deux portent `ordre_reparation_id` (`pointage_cible_coherente_chk`). */
  async pointagesOuvertsPourOr(
    tx: TransactionDfa,
    orId: string,
  ): Promise<readonly PointageOuvert[]> {
    // JOIN direct sur `utilisateur` pour le nom affiché : `ElementBloquant.libelle`, côté atelier
    // (`ServiceTransitions.verifierPointageOuvert`), l'affiche TEL QUEL à un humain — un id brut y
    // serait un défaut d'ergonomie, pas un simple détail. Coût borné : au plus quelques pointages
    // ouverts par OR (un par technicien actif dessus, RM-121).
    const lignes = await tx
      .select({
        pointageId: pointage.id,
        technicienId: pointage.technicienId,
        debutLe: pointage.debutLe,
        ligneOrId: pointage.ligneOrId,
        prenom: utilisateur.prenom,
        nom: utilisateur.nom,
      })
      .from(pointage)
      .innerJoin(
        utilisateur,
        and(eq(utilisateur.tenantId, pointage.tenantId), eq(utilisateur.id, pointage.technicienId)),
      )
      .where(and(eq(pointage.ordreReparationId, orId), eq(pointage.statut, 'en_cours')));

    return lignes.map((l) => ({
      pointageId: l.pointageId,
      technicienId: l.technicienId,
      technicienNomAffiche: `${l.prenom} ${l.nom}`.trim(),
      debutLe: l.debutLe,
      ligneOrId: l.ligneOrId,
    }));
  }

  /** Lignes d'OR qui portent AU MOINS un pointage (tout statut confondu) parmi `ligneIds`. */
  async lignesAvecTempsPointe(
    tx: TransactionDfa,
    ligneIds: readonly string[],
  ): Promise<ReadonlySet<string>> {
    if (ligneIds.length === 0) return new Set();
    const lignes = await tx
      .selectDistinct({ ligneOrId: pointage.ligneOrId })
      .from(pointage)
      .where(and(inArray(pointage.ligneOrId, ligneIds), isNotNull(pointage.ligneOrId)));
    return new Set(lignes.map((l) => l.ligneOrId).filter((id): id is string => id !== null));
  }
}
