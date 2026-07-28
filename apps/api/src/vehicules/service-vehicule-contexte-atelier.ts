import { Inject, Injectable } from '@nestjs/common';
import { MAX_TRAVAUX_REPORTES_CONTEXTE, type ReponseContexteAtelier, type RoleUtilisateur } from '@dfa/shared';
import { JETON_DB, type AccesBase, type ContexteTenant } from '../db';
import { CollecteurAvertissements } from '../common/avertissements';
import { Horloge } from '../common/horloge';
import { calculerNomAffiche } from '../common/identite-client';
import { convertirEnKm } from './kilometrage.regles';
import { versReponseTravailReporte } from './service-vehicule-travail-reporte';
import {
  compterTravauxReportesOuverts,
  construireReponseVehicule,
  lireDernierKilometrage,
  lireDetentionCouranteAvecClient,
  lireExpertiseReference,
  listerAlertesClient,
  listerCampagnesOuvertes,
  listerOrOuverts,
  listerTravauxReportesOuverts,
} from './vehicule-requetes';

/**
 * `GET /vehicules/{vehiculeId}/contexte-atelier` (RM-36, D-01, CT-13, §8.1) — tout ce qu'un
 * réceptionnaire doit voir D'UN COUP quand un véhicule se présente : travaux déjà refusés,
 * campagne ouverte, expertise (MFK) sur le point d'expirer, garantie en cours, alerte client, OR
 * déjà ouverts. Manquer une de ces sections, c'est refacturer un travail déjà refusé le mois
 * dernier ou rendre un véhicule dont l'expertise expire la semaine suivante.
 *
 * RÈGLE ANTI-DIVERGENCE (vehicule-requetes.ts:84-91) : chaque section appelle EXACTEMENT la même
 * fonction de requête — jamais une requête parallèle qui pourrait diverger — que la ressource
 * accessible seule :
 *  - `vehicule`/`garantie` : `construireReponseVehicule`, IDENTIQUE à `GET /vehicules/{id}`
 *    (`ServiceVehicule.parId`) — mêmes valeurs, garanties par construction, pas par coïncidence ;
 *  - `dernierKilometrage` : `lireDernierKilometrage`, la même fonction que consulte
 *    `ServiceVehiculeKilometrage.lister` (premier élément, tri `releveLe:desc`) ;
 *  - `detenteurCourant`/`alertesClient` : `lireDetentionCouranteAvecClient`, la même fonction que
 *    `ServiceVehiculeDetention.changerDetenteur` utilise pour retrouver l'ancien détenteur ;
 *  - `expertise` : `lireExpertiseReference` ;
 *  - `campagnesOuvertes` : `listerCampagnesOuvertes` ;
 *  - `travauxReportes` : `listerTravauxReportesOuverts` + `compterTravauxReportesOuverts` pour les
 *    requêtes, et `versReponseTravailReporte` (exporté par `ServiceVehiculeTravailReporte`) pour la
 *    projection — y compris le filtrage serveur de `montantEstimeCentimes` pour `ROLES_SANS_MONTANT` ;
 *  - `ordresReparationOuverts` : `listerOrOuverts`, la même fonction que `ServiceVehicule.archiver`
 *    utilise pour ses blocages.
 *
 * 404 `RESSOURCE_INTROUVABLE` hérité de `construireReponseVehicule` → `chargerLigneVehicule`
 * (rescopée sur `tenant_id`) : un véhicule d'un autre tenant ne laisse jamais deviner qu'il existe.
 */
@Injectable()
export class ServiceVehiculeContexteAtelier {
  constructor(
    @Inject(JETON_DB) private readonly acces: AccesBase,
    private readonly horloge: Horloge,
  ) {}

  async obtenir(ctx: ContexteTenant, vehiculeId: string, role: RoleUtilisateur): Promise<ReponseContexteAtelier> {
    return this.acces.enTenant(ctx, async (tx) => {
      const maintenant = this.horloge.maintenant();
      const aujourdHui = jourIso(maintenant);

      // `construireReponseVehicule` lève RESSOURCE_INTROUVABLE si le véhicule n'existe pas pour ce
      // tenant — c'est ce qui rend le 404 IDENTIQUE à celui de `GET /vehicules/{id}`, exécuté EN
      // PREMIER pour ne jamais laisser une section suivante fuiter une info avant le contrôle 404.
      const reponseVehicule = await construireReponseVehicule(tx, ctx, vehiculeId, maintenant);

      const [detentionCourante, dernierKm, expertiseRef, campagnesOuvertes, totalTravauxOuverts, travauxOuverts, orOuverts] =
        await Promise.all([
          lireDetentionCouranteAvecClient(tx, ctx, vehiculeId),
          lireDernierKilometrage(tx, ctx, vehiculeId),
          lireExpertiseReference(tx, ctx, vehiculeId),
          listerCampagnesOuvertes(tx, ctx, vehiculeId),
          compterTravauxReportesOuverts(tx, ctx, vehiculeId),
          listerTravauxReportesOuverts(tx, ctx, vehiculeId, MAX_TRAVAUX_REPORTES_CONTEXTE),
          listerOrOuverts(tx, ctx, vehiculeId),
        ]);

      // Alertes client : dépendent du détenteur courant tout juste résolu ci-dessus — impossible à
      // paralléliser avec le `Promise.all` précédent, mais toujours `listerAlertesClient`, la MÊME
      // fonction qui servirait `GET /clients/{id}/notes?nature=alerte`.
      const alertesClient = detentionCourante ? await listerAlertesClient(tx, ctx, detentionCourante.client.id) : [];

      const echue = expertiseRef?.prochaineEcheance != null && expertiseRef.prochaineEcheance < aujourdHui;

      return {
        vehicule: {
          id: reponseVehicule.id,
          plaque: reponseVehicule.plaque,
          canton: reponseVehicule.canton,
          designation: reponseVehicule.designation,
          premiereMiseEnCirculationLe: reponseVehicule.premiereMiseEnCirculationLe,
          vin: reponseVehicule.vin,
          codeTypeCh: reponseVehicule.codeTypeCh,
          importe: reponseVehicule.importe,
          identificationIncomplete: reponseVehicule.identificationIncomplete,
        },
        detenteurCourant: detentionCourante
          ? {
              clientId: detentionCourante.client.id,
              numeroClient: detentionCourante.client.numero,
              nom: calculerNomAffiche(detentionCourante.client),
              langueCorrespondance: detentionCourante.client.langue,
              statut: detentionCourante.client.statut,
              depuisLe: detentionCourante.detention.du,
              poObligatoire: detentionCourante.client.poObligatoire,
            }
          : null,
        dernierKilometrage: dernierKm
          ? {
              valeurKm: dernierKm.valeurKm ?? convertirEnKm(dernierKm.valeur, dernierKm.unite),
              unite: dernierKm.unite,
              releveLe: dernierKm.releveLe.toISOString(),
              source: dernierKm.source,
            }
          : null,
        expertise: expertiseRef
          ? {
              derniereLe: expertiseRef.dateExpertise,
              prochaineLe: expertiseRef.prochaineEcheance,
              // Même défaut que `ServiceVehiculeExpertise` (colonne nullable, contrat non nullable) :
              // `calculee` quand rien n'est renseigné — RM-28, aucune convocation connue ne prime.
              source: expertiseRef.sourceEcheance ?? 'calculee',
              echue,
              // Nombre de jours ENTIERS écoulés depuis l'échéance — `null` tant qu'elle n'est pas
              // dépassée (une échéance due aujourd'hui même n'est pas encore « échue »).
              joursDepuisEcheance: echue ? joursEntre(expertiseRef.prochaineEcheance as string, aujourdHui) : null,
            }
          : null,
        garantie: {
          constructeur: reponseVehicule.garantieConstructeur,
          garage: reponseVehicule.garantieGarage,
        },
        campagnesOuvertes: campagnesOuvertes.map((ligne) => ({
          id: ligne.id,
          code: ligne.code,
          description: ligne.description ?? '',
          obligatoire: ligne.obligatoire,
        })),
        travauxReportes: {
          total: totalTravauxOuverts,
          elements: travauxOuverts.map((ligne) => versReponseTravailReporte(ligne, role)),
        },
        alertesClient: alertesClient.map((note) => ({ id: note.id, nature: 'alerte' as const, texte: note.texte })),
        ordresReparationOuverts: orOuverts.map((or) => ({ id: or.id, numero: or.numero, statut: or.statut })),
        // Réserve la place de l'hôtel à pneus sans engager d'implémentation (§8.1) — voir le
        // commentaire du contrat `ReponseContexteAtelier.depotPneus` dans `@dfa/shared`.
        depotPneus: null,
        // `GET`, sans effet de bord : aucune règle métier n'émet d'avertissement à la lecture au
        // lot 1. Le champ reste PRÉSENT (jamais absent) pour ne jamais devoir transformer plus
        // tard un contexte-atelier « nu » en contexte enveloppé — même doctrine que
        // `CollecteurAvertissements` pour les commandes d'écriture.
        avertissements: new CollecteurAvertissements().liste(),
      };
    });
  }
}

function jourIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Nombre de jours ENTIERS entre deux dates ISO (`aaaa-mm-jj`), en arithmétique calendaire UTC. */
function joursEntre(depuisIso: string, jusquauIso: string): number {
  const [anneeDepuis, moisDepuis, jourDepuis] = depuisIso.split('-').map(Number);
  const [anneeJusquau, moisJusquau, jourJusquau] = jusquauIso.split('-').map(Number);
  const debut = Date.UTC(anneeDepuis ?? 1970, (moisDepuis ?? 1) - 1, jourDepuis ?? 1);
  const fin = Date.UTC(anneeJusquau ?? 1970, (moisJusquau ?? 1) - 1, jourJusquau ?? 1);
  return Math.round((fin - debut) / 86_400_000);
}
