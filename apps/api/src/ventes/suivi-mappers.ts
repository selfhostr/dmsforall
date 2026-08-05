import type {
  ClientSuiviVente,
  LigneSuiviVente,
  RoleUtilisateur,
  StatutConfirmationFinancement,
  StatutDossierVente,
  SuiviFinancement,
  SuiviGarantie,
  TypeFinancementVente,
  VehiculeSuiviVente,
} from '@dfa/shared';

import { designationVehicule, nomAfficheClient } from '../atelier/references';
import { roleVoitLesMontants } from '../facturation/documents/mappeurs';
import { ajouterMoisIso, calculerGarantie } from '../vehicules/vehicule.mappers';

/**
 * Fonctions PURES du suivi financement/garantie (`GET /ventes/suivi`) — aucun accès base ici,
 * volontairement : c'est ce qui les rend exhaustivement testables (`suivi-mappers.spec.ts`) sans
 * fausse transaction. `service-suivi-vente.ts` construit la ligne brute (une requête SQL, une
 * jointure) et délègue tout le calcul à ce fichier.
 *
 * Voir l'en-tête de `contrats/ventes/suivi.ts` pour la doctrine complète (ce qui est honnêtement
 * calculable, ce qui ne l'est pas, la garde RF-116 transitive sur `prochaineEcheanceLe`).
 */

/** Ajoute `jours` jours civils à une date ISO (`aaaa-mm-jj`), arithmétique calendaire UTC — même
 *  doctrine que `vehicules/vehicule.mappers.ts::ajouterMoisIso`, mais en jours (le filtre
 *  `dansJours` se raisonne en jours, la garantie/le financement en mois). */
export function ajouterJoursIso(dateIso: string, jours: number): string {
  const [annee, mois, jour] = dateIso.split('-').map(Number);
  const date = new Date(Date.UTC(annee ?? 1970, (mois ?? 1) - 1, (jour ?? 1) + jours));
  return date.toISOString().slice(0, 10);
}

/**
 * `echeanceLe` du financement — UNIQUEMENT si `confirme` et que `confirmeLe`/`dureeMois` sont
 * tous deux connus. `confirmeLe` est un horodatage (`timestamptz`) : tronqué au jour avant
 * l'addition, la garantie/le financement se raisonnent en jours calendaires, pas en instant
 * précis (même granularité que `vehicule.garantieDebut`, une colonne `date`).
 */
export function calculerEcheanceFinancement(
  statutConfirmation: StatutConfirmationFinancement,
  confirmeLe: string | null,
  dureeMois: number | null,
): string | null {
  if (statutConfirmation !== 'confirme' || !confirmeLe || dureeMois == null) return null;
  return ajouterMoisIso(confirmeLe.slice(0, 10), dureeMois);
}

/** `finLe` de la garantie — `null` si `mois` est inconnu (RM-33, pas d'estimation sans durée). */
export function calculerEcheanceGarantie(
  debutLe: string | null,
  mois: number | null,
): string | null {
  if (!debutLe || mois == null) return null;
  return ajouterMoisIso(debutLe, mois);
}

/**
 * La plus proche de deux échéances (`aaaa-mm-jj`), l'une ou l'autre pouvant être inconnue —
 * `undefined` traité EXACTEMENT comme `null` (un champ omis par rôle, RF-116, ne doit jamais faire
 * planter ce calcul ni se comporter différemment d'un champ réellement absent). Comparaison
 * lexicographique = comparaison chronologique sur des dates `aaaa-mm-jj` zéro-remplies.
 */
export function calculerProchaineEcheance(
  echeanceA: string | null | undefined,
  echeanceB: string | null | undefined,
): string | null {
  const a = echeanceA ?? null;
  const b = echeanceB ?? null;
  if (a === null) return b;
  if (b === null) return a;
  return a <= b ? a : b;
}

/**
 * `true` si `echeanceLe` tombe dans les `dansJours` prochains jours calendaires, bornes incluses
 * (`[aujourdHuiIso, aujourdHuiIso + dansJours]`) — une échéance déjà dépassée (`< aujourdHuiIso`)
 * n'est jamais « dans les prochains jours ». Définition PURE de référence pour le filtre
 * `dansJours` — le prédicat SQL de `service-suivi-vente.ts` DOIT rester l'exacte contrepartie de
 * cette fonction (voir son en-tête) ; cette fonction elle-même n'est pas exécutée sur le chemin
 * base de données (la borne de pagination par curseur exige que le filtre s'applique en SQL, pas
 * après coup en mémoire — sinon une page pourrait rendre moins de lignes que `limite` alors qu'il
 * en reste, exactement le bug de troncature documenté dans CONTRIBUTING.md pour un autre filtre).
 */
export function estDansFenetre(
  echeanceLe: string | null,
  dansJours: number,
  aujourdHuiIso: string,
): boolean {
  if (!echeanceLe) return false;
  if (echeanceLe < aujourdHuiIso) return false;
  return echeanceLe <= ajouterJoursIso(aujourdHuiIso, dansJours);
}

/** Entrée brute (colonnes SQL déjà aliasées) pour construire un `SuiviFinancement` — `null`/vide
 *  quand la jointure LATERAL n'a trouvé aucun financement `credit`/`leasing` pour ce dossier. */
export interface EntreeSuiviFinancementBrut {
  readonly id: string | null;
  readonly type: string | null;
  readonly statut: string | null;
  readonly confirmeLe: string | null;
  readonly dureeMois: number | null;
  readonly organismeId: string | null;
  readonly organismeType: string | null;
  readonly organismeNom: string | null;
  readonly organismePrenom: string | null;
  readonly organismeRaisonSociale: string | null;
}

/** `null` si la jointure LATERAL n'a rendu aucune ligne (aucun financement `credit`/`leasing` sur
 *  ce dossier) — `roleVoitLesMontants(role)` gate `dureeMois`/`echeanceLe` (RF-116, omis, pas
 *  `null` — voir l'en-tête de `contrats/ventes/suivi.ts`). */
export function versSuiviFinancement(
  brut: EntreeSuiviFinancementBrut,
  role: RoleUtilisateur,
): SuiviFinancement | null {
  if (!brut.id || !brut.type || !brut.statut) return null;

  const statutConfirmation = brut.statut as StatutConfirmationFinancement;
  const voitMontants = roleVoitLesMontants(role);

  return {
    id: brut.id,
    type: brut.type as TypeFinancementVente,
    statutConfirmation,
    organisme: brut.organismeId
      ? {
          id: brut.organismeId,
          nomAffiche: nomAfficheClient({
            type: brut.organismeType === 'entreprise' ? 'entreprise' : 'particulier',
            nom: brut.organismeNom,
            prenom: brut.organismePrenom,
            raisonSociale: brut.organismeRaisonSociale,
          }),
        }
      : null,
    confirmeLe: brut.confirmeLe ? new Date(brut.confirmeLe).toISOString() : null,
    ...(voitMontants
      ? {
          dureeMois: brut.dureeMois,
          echeanceLe: calculerEcheanceFinancement(
            statutConfirmation,
            brut.confirmeLe,
            brut.dureeMois,
          ),
        }
      : {}),
  };
}

/** `null` si `debutLe` est inconnu (pas de garantie à suivre) — réutilise `calculerGarantie`
 *  (`vehicules/vehicule.mappers.ts`) TELLE QUELLE pour `finLe`/`active` : même règle métier
 *  RM-33 qu'à la fiche véhicule, jamais une seconde définition d'« encore valable ». */
export function construireSuiviGarantie(
  debutLe: string | null,
  mois: number | null,
  plafondKm: number | null,
  dernierKilometrageKm: number | null,
  maintenant: Date,
): SuiviGarantie | null {
  if (!debutLe) return null;
  const g = calculerGarantie(debutLe, mois, plafondKm, dernierKilometrageKm, maintenant);
  if (!g) return null;
  return { debutLe, mois, plafondKm, finLe: g.finLe, active: g.active };
}

/** Entrée brute (colonnes SQL déjà aliasées) pour construire une `LigneSuiviVente` complète. */
export interface EntreeLigneSuiviVenteBrut {
  readonly dossierVenteId: string;
  readonly siteId: string;
  readonly dossierStatut: string;
  readonly clientAcheteurId: string;
  readonly clientAcheteurType: string;
  readonly clientAcheteurNom: string | null;
  readonly clientAcheteurPrenom: string | null;
  readonly clientAcheteurRaisonSociale: string | null;
  readonly vehiculeId: string | null;
  readonly vehiculeMarque: string | null;
  readonly vehiculeModele: string | null;
  readonly vehiculeVersion: string | null;
  readonly vehiculeVin: string | null;
  readonly garantieDebut: string | null;
  readonly garantieMois: number | null;
  readonly garantieKm: number | null;
  readonly dernierKilometrageKm: number | null;
  readonly financement: EntreeSuiviFinancementBrut;
}

export function versLigneSuiviVente(
  brut: EntreeLigneSuiviVenteBrut,
  role: RoleUtilisateur,
  maintenant: Date,
): LigneSuiviVente {
  const clientAcheteur: ClientSuiviVente = {
    id: brut.clientAcheteurId,
    nomAffiche: nomAfficheClient({
      type: brut.clientAcheteurType === 'entreprise' ? 'entreprise' : 'particulier',
      nom: brut.clientAcheteurNom,
      prenom: brut.clientAcheteurPrenom,
      raisonSociale: brut.clientAcheteurRaisonSociale,
    }),
  };

  const vehicule: VehiculeSuiviVente | null = brut.vehiculeId
    ? {
        id: brut.vehiculeId,
        designation: designationVehicule({
          marque: brut.vehiculeMarque ?? '',
          modele: brut.vehiculeModele ?? '',
          version: brut.vehiculeVersion,
        }),
        vin: brut.vehiculeVin,
      }
    : null;

  const garantie = construireSuiviGarantie(
    brut.garantieDebut,
    brut.garantieMois,
    brut.garantieKm,
    brut.dernierKilometrageKm,
    maintenant,
  );
  const financement = versSuiviFinancement(brut.financement, role);

  return {
    dossierVenteId: brut.dossierVenteId,
    siteId: brut.siteId,
    dossierStatut: brut.dossierStatut as StatutDossierVente,
    clientAcheteur,
    vehicule,
    financement,
    garantie,
    // Dérivée des champs VISIBLES uniquement (financement.echeanceLe est déjà omis ci-dessus si
    // !roleVoitLesMontants(role)) — voir l'en-tête de `contrats/ventes/suivi.ts`.
    prochaineEcheanceLe: calculerProchaineEcheance(
      financement?.echeanceLe,
      garantie?.finLe ?? null,
    ),
  };
}
