/**
 * Chemins du sous-module « véhicules en stock » — PROVISOIRES, tenus ICI plutôt que dans
 * `routes/chemins.ts` (hors périmètre de cet agent, voir le brief de livraison). Même mécanique
 * `?site=` que `chemins.vehicules`/`chemins.pieces` (le site sélectionné est un paramètre de
 * requête, jamais un état global — deux onglets sur deux sites différents ne doivent pas se
 * contredire) : à FUSIONNER dans `routes/chemins.ts` (bloc `ventes.stock`) par la session
 * principale lors du câblage des routes — voir la table des routes du rapport de livraison.
 */

function construireChemin(
  base: string,
  parametres: Record<string, string | undefined> = {},
): string {
  const recherche = new URLSearchParams();
  for (const [cle, valeur] of Object.entries(parametres)) {
    if (valeur !== undefined && valeur !== '') {
      recherche.set(cle, valeur);
    }
  }
  const chaineRecherche = recherche.toString();
  return chaineRecherche === '' ? base : `${base}?${chaineRecherche}`;
}

export const cheminsStockVentes = {
  liste: (site?: string) => construireChemin('/ventes/stock', { site }),
  nouveau: (site?: string) => construireChemin('/ventes/stock/nouveau', { site }),
  detail: (id: string, site?: string) => construireChemin(`/ventes/stock/${id}`, { site }),
} as const;
