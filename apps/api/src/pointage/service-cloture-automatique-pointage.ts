import { Inject, Injectable } from '@nestjs/common';

import { JETON_DB, type AccesBase, type ContexteTenant } from '../db';
import { Horloge } from '../common/horloge/horloge';

import {
  appliquerClotureAutomatique,
  chargerCandidatsClotureAutomatique,
} from './pointage-requetes';
import { determinerDecisionClotureAutomatique } from './regles-pointage';

/**
 * RM-91/RM-119 : clôture automatique de fin de journée. Un technicien qui part sans arrêter son
 * pointage laisse un compteur courir indéfiniment ; ce service l'arrête à l'heure de fermeture DE
 * SON SITE (P-31, `parametre_site.heure_cloture_pointage`) et le marque en anomalie
 * (`cloture_fin_journee`) pour que le chef d'atelier le voie et corrige la durée réelle — ni un
 * arrêt silencieux à minuit (qui facturerait des heures fantômes sans que personne ne le sache), ni
 * un abandon pur (compteur qui court des jours entiers).
 *
 * CT-57 (« absence prolongée ») : un pointage oublié deux semaines se clôture, une fois ce service
 * enfin exécuté, à l'heure de fermeture DU JOUR OÙ IL A DÉMARRÉ — pas à la date de détection. Voir
 * `regles-pointage.ts::determinerDecisionClotureAutomatique` pour la raison (fonction PURE, seule
 * responsable de CE calcul) : ce service-ci ne fait qu'orchestrer l'I/O autour d'elle.
 *
 * DÉCLENCHÉ DEPUIS LE 17.08.2026 (chantier « socle d'ordonnancement ») — `executerPourTenant`
 * ci-dessous reste inchangé (fonction I/O pure sur UN tenant, aucune connaissance de BullMQ ni des
 * autres tenants), mais n'est plus un service orphelin : `OrdonnanceurClotureAutomatiquePointage`
 * programme un job quotidien BullMQ (`Queue.upsertJobScheduler`, socle posé par
 * `ordonnancement/ordonnancement.module.ts`) qui appelle `ServiceJobClotureAutomatiquePointage`,
 * lequel énumère les tenants actifs et appelle CETTE méthode une fois par tenant — voir
 * `orchestration-job-cloture-automatique-pointage.ts` pour l'orchestration multi-tenant complète.
 * Les trois points ci-dessous, laissés ouverts par la version précédente de cet en-tête, sont
 * TRANCHÉS par ce chantier (justification complète dans le fichier cité pour chacun) :
 *  1. déclencheur périodique : BullMQ (`@Processor` + `Queue.upsertJobScheduler`), même socle que
 *     le job quotidien ASTRA (`vehicules/referentiel/`) — un seul déclenchement par tick même avec
 *     plusieurs instances d'API, garanti par BullMQ/Redis, sans verrou applicatif redondant ;
 *  2. énumération des tenants actifs : `enumerer-tenants-actifs-pointage.ts` — canal `dfa_migrator`
 *     (`DATABASE_URL_MIGRATION`), politique RLS `tenant_migrator` DÉJÀ posée par la migration 0001
 *     pour exactement ce besoin (« future migration de reprise de données »), jamais une 7ᵉ
 *     fonction `amorcage.*`. Cette méthode-ci continue de recevoir un `ContexteTenant` DÉJÀ résolu,
 *     un tenant à la fois, jamais un balayage cross-tenant en une seule requête — inchangé ;
 *  3. identité d'appel : `ContexteTenant.utilisateurId = null`, convention DÉJÀ documentée par
 *     `db/db.types.ts` (« tâche système ») — jamais un faux compte utilisateur inventé. Distingué
 *     d'une correction humaine dans l'audit trail (`audit_atelier`, trigger générique existant,
 *     AUCUNE écriture applicative ajoutée) par la combinaison `cloture_automatique = true` +
 *     `utilisateur_id NULL` + `requete_id` préfixé `job:pointage-cloture-automatique:`.
 */
@Injectable()
export class ServiceClotureAutomatiquePointage {
  /** Pointages examinés par appel — même doctrine « lot borné, jamais un balayage complet sans
   *  limite » que `ServiceRelancesFacture.LOT_PLANIFICATION`/`LOT_ENVOI`. */
  private static readonly LOT = 200;

  constructor(
    @Inject(JETON_DB) private readonly acces: AccesBase,
    private readonly horloge: Horloge,
  ) {}

  /**
   * Traite UN tenant, dans SA PROPRE transaction `enTenant` — jamais deux tenants dans le même
   * appel. C'est ce qui rend l'isolation tenant STRUCTURELLE plutôt qu'une discipline de code :
   * `chargerCandidatsClotureAutomatique`/`appliquerClotureAutomatique` reçoivent `ctx` explicitement
   * et re-scopent `tenant_id = ctx.tenantId` en plus du RLS positionné par `enTenant` (RLS = filet,
   * jamais le mécanisme — doctrine du dépôt). Idempotent : un second appel, sans intervention entre
   * les deux, trouve zéro candidat `en_cours` restant à clore (voir `appliquerClotureAutomatique`
   * pour la réclamation conditionnelle qui porte cette garantie).
   */
  async executerPourTenant(ctx: ContexteTenant): Promise<ResultatClotureAutomatiquePointage> {
    const maintenant = this.horloge.maintenant();
    const limite = ServiceClotureAutomatiquePointage.LOT;

    return this.acces.enTenant(ctx, async (tx) => {
      const candidats = await chargerCandidatsClotureAutomatique(tx, ctx, limite + 1);
      const encoreATraiter = candidats.length > limite;
      const lot = candidats.slice(0, limite);

      let clotures = 0;
      let ignores = 0;

      for (const candidat of lot) {
        const decision = determinerDecisionClotureAutomatique(candidat, maintenant);
        if (!decision) continue; // heure de clôture du jour d'ouverture pas encore atteinte.

        const appliquee = await appliquerClotureAutomatique(tx, ctx, decision);
        if (appliquee) {
          clotures += 1;
        } else {
          // Réclamé entre-temps (autre passage concurrent) ou déjà corrigé manuellement — ne
          // compte pas comme une clôture DE CET APPEL, ce n'est pas une erreur.
          ignores += 1;
        }
      }

      return { clotures, examines: lot.length, ignores, encoreATraiter };
    });
  }
}

export interface ResultatClotureAutomatiquePointage {
  readonly clotures: number;
  readonly examines: number;
  readonly ignores: number;
  readonly encoreATraiter: boolean;
}
