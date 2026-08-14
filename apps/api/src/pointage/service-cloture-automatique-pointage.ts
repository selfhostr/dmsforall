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
 * AUCUN ORDONNANCEUR NE DÉCLENCHE ENCORE CE SERVICE — mesuré, pas supposé (voir le rapport de
 * livraison de ce chantier) : ni `@nestjs/schedule`, ni BullMQ/Redis ne sont des dépendances
 * installées dans ce dépôt à ce jour (`apps/api/package.json`), malgré la mention « Redis/BullMQ »
 * du stack en tête de `CONTRIBUTING.md` — le seul module de ce dépôt qui documente un besoin de
 * planification périodique équivalent (`relances/service-relances-facture.ts`, RM-1) le dit
 * explicitement dans son en-tête : « aucun ordonnanceur n'existe dans ce dépôt (§6 de la spec :
 * "zéro usage de BullMQ vérifié") ». MÊME MOTIF REPRIS ICI, DÉLIBÉRÉMENT : une opération
 * IDEMPOTENTE, PAR TENANT, appelable à la demande — jamais un `@Cron`/`@Processor` qui n'aurait
 * rien à quoi s'accrocher dans ce dépôt aujourd'hui. Ce qui reste à poser, HORS PÉRIMÈTRE de ce
 * chantier (signalé, pas fait) :
 *  1. un déclencheur périodique réel (`@nestjs/schedule`, ou BullMQ+Redis une fois ces dépendances
 *     effectivement installées — décision d'infrastructure transverse, pas une décision du module
 *     `pointage/`) ;
 *  2. l'énumération des tenants actifs à traiter à chaque passage — `db/acces-amorcage.service.ts`
 *     (§ en-tête : « les 6 SEULES opérations hors contexte tenant », toutes `SECURITY DEFINER`)
 *     est DÉLIBÉRÉMENT une surface minuscule et figée ; y ajouter une 7ᵉ opération d'énumération
 *     cross-tenant est une décision de sécurité qui dépasse le périmètre `pointage/` de ce
 *     chantier. `executerPourTenant` ci-dessous prend donc un `ContexteTenant` déjà résolu — au
 *     futur appelant (le déclencheur du point 1) de le fournir pour chaque tenant à traiter, un
 *     par un, jamais un balayage cross-tenant en une seule requête ;
 *  3. l'identité d'appel du déclencheur — même trou déjà signalé par `relances/relances.controller.
 *     ts` (« aucun des rôles autorisés ne désigne un compte de service ») : un job système n'a pas
 *     de session utilisateur, `ContexteTenant.utilisateurId` vaut `null` pour lui par convention
 *     (`db/db.types.ts`, commentaire du champ : « tâche système »).
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
