import type {
  EntreeCreationPretCourtoisie,
  EntreeCreationVehiculeCourtoisie,
  EntreeModificationVehiculeCourtoisie,
  EntreeRetourPretCourtoisie,
  PageCurseur,
  ReponseListeVehiculesCourtoisie,
  ReponsePretCourtoisie,
  ReponseVehiculeCourtoisie,
} from '@dfa/shared';

import { requeteApi } from '@/api/client';

async function exiger<T>(promesse: Promise<T | undefined>, ressource: string): Promise<T> {
  const reponse = await promesse;
  if (reponse === undefined) throw new Error(`Réponse ${ressource} inattendue : corps vide.`);
  return reponse;
}

/** Parc + disponibilité sur la période (`du`/`au` ISO) — `GET /courtoisie/vehicules`. */
export function listerVehiculesCourtoisie(
  du: string,
  au: string,
): Promise<ReponseListeVehiculesCourtoisie> {
  const params = new URLSearchParams({ du, au });
  return exiger(
    requeteApi<ReponseListeVehiculesCourtoisie>(`/courtoisie/vehicules?${params.toString()}`),
    'courtoisie',
  );
}

export function creerVehiculeCourtoisie(
  entree: EntreeCreationVehiculeCourtoisie,
): Promise<ReponseVehiculeCourtoisie> {
  return exiger(
    requeteApi<ReponseVehiculeCourtoisie>('/courtoisie/vehicules', {
      method: 'POST',
      body: JSON.stringify(entree),
    }),
    'véhicule de courtoisie',
  );
}

export function modifierVehiculeCourtoisie(
  id: string,
  entree: EntreeModificationVehiculeCourtoisie,
): Promise<ReponseVehiculeCourtoisie> {
  return exiger(
    requeteApi<ReponseVehiculeCourtoisie>(`/courtoisie/vehicules/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(entree),
    }),
    'véhicule de courtoisie',
  );
}

/** Prêts les plus récents d'un client ou d'un OR — `GET /courtoisie/prets`. */
export function listerPretsCourtoisie(filtres: {
  readonly clientId?: string;
  readonly ordreReparationId?: string;
  readonly statut?: string;
}): Promise<PageCurseur<ReponsePretCourtoisie>> {
  const params = new URLSearchParams();
  for (const [cle, valeur] of Object.entries(filtres)) {
    if (valeur !== undefined) params.set(cle, valeur);
  }
  const requete = params.toString();
  return exiger(
    requeteApi<PageCurseur<ReponsePretCourtoisie>>(
      `/courtoisie/prets${requete ? `?${requete}` : ''}`,
    ),
    'prêts',
  );
}

export function creerPretCourtoisie(
  entree: EntreeCreationPretCourtoisie,
): Promise<ReponsePretCourtoisie> {
  return exiger(
    requeteApi<ReponsePretCourtoisie>('/courtoisie/prets', {
      method: 'POST',
      body: JSON.stringify(entree),
    }),
    'prêt',
  );
}

export function rendrePretCourtoisie(
  id: string,
  entree: EntreeRetourPretCourtoisie,
): Promise<ReponsePretCourtoisie> {
  return exiger(
    requeteApi<ReponsePretCourtoisie>(`/courtoisie/prets/${id}/rendre`, {
      method: 'POST',
      body: JSON.stringify(entree),
    }),
    'retour de prêt',
  );
}

export function remettrePretCourtoisie(
  id: string,
  kmDepart?: number,
): Promise<ReponsePretCourtoisie> {
  return exiger(
    requeteApi<ReponsePretCourtoisie>(`/courtoisie/prets/${id}/remettre`, {
      method: 'POST',
      body: JSON.stringify(kmDepart === undefined ? {} : { kmDepart }),
    }),
    'remise de prêt',
  );
}

export function annulerPretCourtoisie(id: string): Promise<ReponsePretCourtoisie> {
  return exiger(
    requeteApi<ReponsePretCourtoisie>(`/courtoisie/prets/${id}/annuler`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
    'annulation de prêt',
  );
}
