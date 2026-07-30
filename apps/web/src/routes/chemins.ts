/**
 * Constructeurs de chemins typés pour le lot 1 (Clients + Véhicules). Le site sélectionné est
 * **un paramètre de requête** (`?site=`), jamais un état global : deux onglets ouverts sur deux
 * sites différents ne doivent pas se contredire (plan frontend §9.3). Un chemin construit ici
 * conserve donc le site courant plutôt que de le perdre à la navigation.
 */

function construireChemin(base: string, parametres: Record<string, string | undefined> = {}): string {
  const recherche = new URLSearchParams();
  for (const [cle, valeur] of Object.entries(parametres)) {
    if (valeur !== undefined && valeur !== '') {
      recherche.set(cle, valeur);
    }
  }
  const chaineRecherche = recherche.toString();
  return chaineRecherche === '' ? base : `${base}?${chaineRecherche}`;
}

export const chemins = {
  /** Absent avant cet ajout alors que `GET /recherche` existe déjà côté API et que l'écran est en
   *  cours d'écriture (agent dédié) — même forme que `clients`/`vehicules` ci-dessous. */
  recherche: {
    globale: (site?: string) => construireChemin('/recherche', { site }),
  },
  clients: {
    liste: (site?: string) => construireChemin('/clients', { site }),
    nouveau: (site?: string) => construireChemin('/clients/nouveau', { site }),
    detail: (id: string, site?: string) => construireChemin(`/clients/${id}`, { site }),
    fusion: (id: string, site?: string) => construireChemin(`/clients/${id}/fusion`, { site }),
  },
  vehicules: {
    liste: (site?: string) => construireChemin('/vehicules', { site }),
    nouveau: (site?: string) => construireChemin('/vehicules/nouveau', { site }),
    detail: (id: string, site?: string) => construireChemin(`/vehicules/${id}`, { site }),
  },
  /** Paramétrage — singletons par TENANT, jamais par site (contrairement à `clients`/
   *  `vehicules` ci-dessus) : pas de `?site=` à conserver ici. */
  parametrage: {
    facturation: () => '/parametrage/facturation',
  },
} as const;
