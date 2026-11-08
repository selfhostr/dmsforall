import type { EntreeCreationLigneDocument, ReponseDossierVente } from '@dfa/shared';

/** Pourquoi on refuse de créer un bon de commande ou une facture depuis le dossier (avant tout
 *  appel réseau) : un document sans véhicule ni prix naîtrait vide, à 0.00 (recette #64). */
export type BlocageDocumentDossier = 'sansVehicule' | 'sansPrix';

type DossierPourLigne = Pick<ReponseDossierVente, 'vehicule'>;

/** Taux normal 2026 (8.1 %, en ‰) — même préréglage que `DialogueLigneDocumentVente`. */
const TAUX_NORMAL_POURMILLE = 81;

/**
 * Ligne unique « véhicule » reportée du dossier au bon de commande puis à la facture : le prix
 * TTC affiché du véhicule en stock (`prixVenteAfficheCentimes`, centimes entiers), quantité 1.
 * Rend le blocage métier plutôt qu'une ligne à 0.00 quand le dossier n'a pas de véhicule ou que
 * son prix est absent ou nul (« absence de donnée » ≠ « zéro »).
 */
export function ligneVehiculeDuDossier(
  dossier: DossierPourLigne,
  dateDuJour: string = new Date().toISOString().slice(0, 10),
):
  | { readonly ligne: EntreeCreationLigneDocument; readonly blocage: null }
  | { readonly ligne: null; readonly blocage: BlocageDocumentDossier } {
  const vehicule = dossier.vehicule;
  if (!vehicule) return { ligne: null, blocage: 'sansVehicule' };
  const prix = vehicule.prixVenteAfficheCentimes;
  if (prix === null || prix <= 0) return { ligne: null, blocage: 'sansPrix' };
  return {
    blocage: null,
    ligne: {
      type: 'forfait',
      designation: vehicule.vehicule.designation,
      quantiteMillieme: 1000,
      prixUnitaireTtcCentimes: prix,
      regimeTva: 'normal',
      tauxTvaPourmille: TAUX_NORMAL_POURMILLE,
      datePrestation: dateDuJour,
    },
  };
}
