import { lazy, Suspense, type ComponentType } from 'react';

import { EtatChargement } from '@/composants/commun/EtatChargement';

/**
 * Écrans chargés à la demande (un chunk par écran) : le premier affichage ne télécharge que la
 * coque, la connexion et le routeur. Chaque écran est enveloppé dans son propre `Suspense` avec le
 * squelette de chargement standard (`EtatChargement`), de sorte que la coque (menu, en-tête) reste
 * affichée pendant le téléchargement du chunk.
 */
function paresseux(charger: () => Promise<ComponentType>): ComponentType {
  const Composant = lazy(() => charger().then((composant) => ({ default: composant })));
  return function EcranParesseux() {
    return (
      <Suspense fallback={<EtatChargement />}>
        <Composant />
      </Suspense>
    );
  };
}

export const EcranFicheOrdreReparation = paresseux(() =>
  import('@/ecrans/atelier/EcranFicheOrdreReparation').then((m) => m.EcranFicheOrdreReparation),
);
export const EcranListeOrdresReparation = paresseux(() =>
  import('@/ecrans/atelier/EcranListeOrdresReparation').then((m) => m.EcranListeOrdresReparation),
);
export const EcranNouvelOrdreReparation = paresseux(() =>
  import('@/ecrans/atelier/EcranNouvelOrdreReparation').then((m) => m.EcranNouvelOrdreReparation),
);
export const EcranOrdreDepuisPlaque = paresseux(() =>
  import('@/ecrans/atelier/creation-rapide/EcranOrdreDepuisPlaque').then(
    (m) => m.EcranOrdreDepuisPlaque,
  ),
);
export const EcranFicheClient = paresseux(() =>
  import('@/ecrans/clients/EcranFicheClient').then((m) => m.EcranFicheClient),
);
export const EcranListeClients = paresseux(() =>
  import('@/ecrans/clients/EcranListeClients').then((m) => m.EcranListeClients),
);
export const EcranAvoir = paresseux(() =>
  import('@/ecrans/facturation/EcranAvoir').then((m) => m.EcranAvoir),
);
export const EcranFacturerOrdreReparation = paresseux(() =>
  import('@/ecrans/facturation/EcranFacturerOrdreReparation').then(
    (m) => m.EcranFacturerOrdreReparation,
  ),
);
export const EcranFicheFacture = paresseux(() =>
  import('@/ecrans/facturation/EcranFicheFacture').then((m) => m.EcranFicheFacture),
);
export const EcranChiffres = paresseux(() =>
  import('@/ecrans/facturation/chiffres/EcranChiffres').then((m) => m.EcranChiffres),
);
export const EcranExportFiduciaire = paresseux(() =>
  import('@/ecrans/facturation/export/EcranExportFiduciaire').then((m) => m.EcranExportFiduciaire),
);
export const EcranListeFactures = paresseux(() =>
  import('@/ecrans/facturation/EcranListeFactures').then((m) => m.EcranListeFactures),
);
export const EcranDoublonsClients = paresseux(() =>
  import('@/ecrans/clients/EcranDoublonsClients').then((m) => m.EcranDoublonsClients),
);
export const EcranConsolePlateforme = paresseux(() =>
  import('@/ecrans/console/EcranConsolePlateforme').then((m) => m.EcranConsolePlateforme),
);
export const EcranParametragePieces = paresseux(() =>
  import('@/ecrans/parametrage/EcranParametragePieces').then((m) => m.EcranParametragePieces),
);
export const EcranModules = paresseux(() =>
  import('@/ecrans/parametrage/EcranModules').then((m) => m.EcranModules),
);

export const EcranEnvoiCourriel = paresseux(() =>
  import('@/ecrans/parametrage/EcranEnvoiCourriel').then((m) => m.EcranEnvoiCourriel),
);

export const EcranParametrageAtelier = paresseux(() =>
  import('@/ecrans/parametrage/EcranParametrageAtelier').then((m) => m.EcranParametrageAtelier),
);
export const EcranMonGarage = paresseux(() =>
  import('@/ecrans/parametrage/EcranMonGarage').then((m) => m.EcranMonGarage),
);
export const EcranParametresFacturation = paresseux(() =>
  import('@/ecrans/parametrage/EcranParametresFacturation').then(
    (m) => m.EcranParametresFacturation,
  ),
);
export const EcranReferentiels = paresseux(() =>
  import('@/ecrans/parametrage/EcranReferentiels').then((m) => m.EcranReferentiels),
);
export const EcranSites = paresseux(() =>
  import('@/ecrans/parametrage/EcranSites').then((m) => m.EcranSites),
);
export const EcranUtilisateurs = paresseux(() =>
  import('@/ecrans/parametrage/EcranUtilisateurs').then((m) => m.EcranUtilisateurs),
);
export const EcranConsignesPieces = paresseux(() =>
  import('@/ecrans/pieces/EcranConsignesPieces').then((m) => m.EcranConsignesPieces),
);
export const EcranDepotFactureFournisseur = paresseux(() =>
  import('@/ecrans/pieces/EcranDepotFactureFournisseur').then(
    (m) => m.EcranDepotFactureFournisseur,
  ),
);
export const EcranFactureFournisseur = paresseux(() =>
  import('@/ecrans/pieces/EcranFactureFournisseur').then((m) => m.EcranFactureFournisseur),
);
export const EcranFicheArticle = paresseux(() =>
  import('@/ecrans/pieces/EcranFicheArticle').then((m) => m.EcranFicheArticle),
);
export const EcranFicheCommandeFournisseur = paresseux(() =>
  import('@/ecrans/pieces/EcranFicheCommandeFournisseur').then(
    (m) => m.EcranFicheCommandeFournisseur,
  ),
);
export const EcranFicheFournisseur = paresseux(() =>
  import('@/ecrans/pieces/EcranFicheFournisseur').then((m) => m.EcranFicheFournisseur),
);
export const EcranListeArticles = paresseux(() =>
  import('@/ecrans/pieces/EcranListeArticles').then((m) => m.EcranListeArticles),
);
export const EcranListeCommandesFournisseur = paresseux(() =>
  import('@/ecrans/pieces/EcranListeCommandesFournisseur').then(
    (m) => m.EcranListeCommandesFournisseur,
  ),
);
export const EcranListeFacturesFournisseur = paresseux(() =>
  import('@/ecrans/pieces/EcranListeFacturesFournisseur').then(
    (m) => m.EcranListeFacturesFournisseur,
  ),
);
export const EcranListeFournisseurs = paresseux(() =>
  import('@/ecrans/pieces/EcranListeFournisseurs').then((m) => m.EcranListeFournisseurs),
);
export const EcranNouvelleCommandeFournisseur = paresseux(() =>
  import('@/ecrans/pieces/EcranNouvelleCommandeFournisseur').then(
    (m) => m.EcranNouvelleCommandeFournisseur,
  ),
);
export const EcranReapprovisionnement = paresseux(() =>
  import('@/ecrans/pieces/EcranReapprovisionnement').then((m) => m.EcranReapprovisionnement),
);
export const EcranRechercheComptoirPieces = paresseux(() =>
  import('@/ecrans/pieces/EcranRechercheComptoirPieces').then(
    (m) => m.EcranRechercheComptoirPieces,
  ),
);
export const EcranReservationsPieces = paresseux(() =>
  import('@/ecrans/pieces/EcranReservationsPieces').then((m) => m.EcranReservationsPieces),
);
export const EcranHangarPneus = paresseux(() =>
  import('@/ecrans/pneus/EcranHangarPneus').then((m) => m.EcranHangarPneus),
);
export const EcranBornePointage = paresseux(() =>
  import('@/ecrans/pointage/EcranBornePointage').then((m) => m.EcranBornePointage),
);
export const EcranPointage = paresseux(() =>
  import('@/ecrans/pointage/EcranPointage').then((m) => m.EcranPointage),
);
export const EcranPointageTechnicien = paresseux(() =>
  import('@/ecrans/pointage/EcranPointageTechnicien').then((m) => m.EcranPointageTechnicien),
);
export const EcranRecherche = paresseux(() =>
  import('@/ecrans/recherche/EcranRecherche').then((m) => m.EcranRecherche),
);
export const EcranReglagesRelances = paresseux(() =>
  import('@/ecrans/relances/EcranReglagesRelances').then((m) => m.EcranReglagesRelances),
);
export const EcranRelances = paresseux(() =>
  import('@/ecrans/relances/EcranRelances').then((m) => m.EcranRelances),
);
export const EcranReprise = paresseux(() =>
  import('@/ecrans/reprise/EcranReprise').then((m) => m.EcranReprise),
);
export const EcranScan = paresseux(() =>
  import('@/ecrans/scan/EcranScan').then((m) => m.EcranScan),
);
export const EcranRendezVous = paresseux(() =>
  import('@/ecrans/rendez-vous/EcranRendezVous').then((m) => m.EcranRendezVous),
);
export const EcranCourtoisie = paresseux(() =>
  import('@/ecrans/courtoisie/EcranCourtoisie').then((m) => m.EcranCourtoisie),
);
export const EcranTableauBord = paresseux(() =>
  import('@/ecrans/tableau-bord/EcranTableauBord').then((m) => m.EcranTableauBord),
);
export const EcranFicheVehicule = paresseux(() =>
  import('@/ecrans/vehicules/EcranFicheVehicule').then((m) => m.EcranFicheVehicule),
);
export const EcranListeVehicules = paresseux(() =>
  import('@/ecrans/vehicules/EcranListeVehicules').then((m) => m.EcranListeVehicules),
);
export const EcranNouveauVehicule = paresseux(() =>
  import('@/ecrans/vehicules/EcranNouveauVehicule').then((m) => m.EcranNouveauVehicule),
);
export const EcranFicheDossierVente = paresseux(() =>
  import('@/ecrans/ventes/dossiers/EcranFicheDossierVente').then((m) => m.EcranFicheDossierVente),
);
export const EcranListeDossiersVente = paresseux(() =>
  import('@/ecrans/ventes/dossiers/EcranListeDossiersVente').then((m) => m.EcranListeDossiersVente),
);
export const EcranNouveauDossierVente = paresseux(() =>
  import('@/ecrans/ventes/dossiers/EcranNouveauDossierVente').then(
    (m) => m.EcranNouveauDossierVente,
  ),
);
export const EcranEntreeEnStock = paresseux(() =>
  import('@/ecrans/ventes/stock/EcranEntreeEnStock').then((m) => m.EcranEntreeEnStock),
);
export const EcranFicheVehiculeStock = paresseux(() =>
  import('@/ecrans/ventes/stock/EcranFicheVehiculeStock').then((m) => m.EcranFicheVehiculeStock),
);
export const EcranListeVehiculesStock = paresseux(() =>
  import('@/ecrans/ventes/stock/EcranListeVehiculesStock').then((m) => m.EcranListeVehiculesStock),
);
export const EcranSuiviVentes = paresseux(() =>
  import('@/ecrans/ventes/suivi/EcranSuiviVentes').then((m) => m.EcranSuiviVentes),
);
