/**
 * Petits utilitaires internes aux hooks du domaine clients — jamais exportés hors de
 * `hooks/clients/**`, jamais de logique métier ici (elle vit dans chaque hook).
 */

/** Un `GET` de ressource unitaire (pas une collection) ne renvoie jamais un corps vide côté
 *  contrat (`contrats-api-etape-1.md` §7) : seuls un `204` (aucune écriture de ce domaine n'en
 *  produit) ou une erreur réseau/HTTP (déjà levée par `requeteApi` avant d'arriver ici) peuvent
 *  produire `undefined`. Un `undefined` qui arrive quand même est donc un défaut serveur, pas un
 *  état à absorber silencieusement côté écran — d'où l'échec explicite plutôt qu'un `?? valeur
 *  par défaut` qui masquerait la régression. */
export function exigerCorps<T>(valeur: T | undefined, contexte: string): T {
  if (valeur === undefined) {
    throw new Error(`Réponse vide inattendue : ${contexte}.`);
  }
  return valeur;
}

/** Construit une querystring en omettant les valeurs absentes/vides — évite à chaque hook de
 *  domaine de réécrire la même garde `if (valeur) params.set(...)`. Un tableau se RÉPÈTE
 *  (`params.append`), jamais une liste séparée par virgules (contrats-api-etape-1.md §6.2). */
export function construireRequete(
  base: Record<string, string | number | boolean | undefined>,
  multivalues: Record<string, readonly string[] | undefined> = {},
): URLSearchParams {
  const params = new URLSearchParams();
  for (const [cle, valeur] of Object.entries(base)) {
    if (valeur === undefined || valeur === '') continue;
    params.set(cle, String(valeur));
  }
  for (const [cle, valeurs] of Object.entries(multivalues)) {
    for (const valeur of valeurs ?? []) {
      params.append(cle, valeur);
    }
  }
  return params;
}
