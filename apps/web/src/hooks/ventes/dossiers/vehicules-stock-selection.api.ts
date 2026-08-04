import type {
  PageCurseur,
  ReponseVehiculeStock,
  StatutCommercialVehicule,
  VehiculeStockResume,
} from '@dfa/shared';

import { requeteApi } from '@/api/client';
import { ErreurApi } from '@/api/erreurs';

/**
 * Couche transport MINIMALE de `GET /vehicules-stock` (`vehicules-stock.controller.ts`),
 * limitée au besoin du sélecteur de véhicule à la création d'un dossier de vente (RV-30) : chercher
 * un véhicule `disponible`/`en_commande` par plaque/VIN/désignation. Le module « parc en stock »
 * complet (fiche, actions, filtres avancés) appartient à un autre agent
 * (`ecrans/ventes/stock/**`, hors périmètre de celui-ci) — ce fichier ne construit AUCUN écran, il
 * ne fait qu'exposer la requête dont `SelecteurVehiculeStockDossier` a besoin, dans le périmètre
 * `hooks/ventes/dossiers/**` qui m'est propre.
 *
 * ÉCART SIGNALÉ, même nature que `dossiers-vente.api.ts` : `types.gen.ts` pas encore régénéré pour
 * ce module.
 */
export interface FiltresVehiculesStockSelection {
  readonly q?: string;
  readonly statutCommercial: readonly StatutCommercialVehicule[];
}

function construireParametres(
  filtres: FiltresVehiculesStockSelection,
  curseur: string | undefined,
): string {
  const parametres = new URLSearchParams();
  if (filtres.q && filtres.q.trim() !== '') parametres.set('q', filtres.q.trim());
  for (const valeur of filtres.statutCommercial) parametres.append('statutCommercial', valeur);
  parametres.set('limite', '20');
  if (curseur) parametres.set('curseur', curseur);
  return parametres.toString();
}

/** `GET /vehicules-stock?statutCommercial=disponible&statutCommercial=en_commande&q=...` —
 *  résultat borné à une page (20), pas de pagination dans ce sélecteur : au-delà, affiner la
 *  recherche texte est la sortie normale (même doctrine que `rechercheComptoirArticles`). */
export async function rechercherVehiculesStockSelection(
  filtres: FiltresVehiculesStockSelection,
): Promise<readonly VehiculeStockResume[]> {
  const reponse = await requeteApi<PageCurseur<VehiculeStockResume>>(
    `/vehicules-stock?${construireParametres(filtres, undefined)}`,
    { method: 'GET' },
  );
  return reponse?.donnees ?? [];
}

/** `GET /vehicules/{vehiculeId}/stock` — fiche stock SINGULIÈRE, utilisée uniquement pour
 *  afficher l'identité d'un véhicule pré-rempli via `?vehiculeId=` (design §5.4 : venir du bouton
 *  « Vendre » de `BlocVente`, écran d'un autre agent). `null` si jamais mis en stock (404) — pas
 *  une exception : l'écran de création retombe alors sur le sélecteur de recherche normal. */
export async function recupererVehiculeStock(
  vehiculeId: string,
): Promise<ReponseVehiculeStock | null> {
  try {
    const reponse = await requeteApi<ReponseVehiculeStock>(`/vehicules/${vehiculeId}/stock`, {
      method: 'GET',
    });
    return reponse ?? null;
  } catch (erreur) {
    // 404 = jamais mis en stock (cas normal, RV-01) -> repli silencieux sur le sélecteur de
    // recherche. Toute autre erreur (réseau, 401, 403...) doit remonter normalement, pas être
    // avalée : un vendeur privé de session ne doit pas croire que le véhicule est simplement
    // introuvable.
    if (erreur instanceof ErreurApi && erreur.probleme.code === 'RESSOURCE_INTROUVABLE') {
      return null;
    }
    throw erreur;
  }
}
