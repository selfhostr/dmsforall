import { useEffect, useState } from 'react';

/**
 * Temporise une valeur qui change à chaque frappe — même patron que celui déjà inline dans
 * `SelecteurClientVehicule.tsx` (`DELAI_DEBOUNCE_MS = 300`), factorisé ici parce que
 * l'autocomplétion marque/modèle en a besoin sur DEUX champs à la fois (le champ modèle
 * retemporise en plus sa dépendance à la marque tapée) : une copie de plus aurait fini par
 * diverger silencieusement de l'original.
 *
 * `delaiMs` par défaut à 300 ms : contrainte explicite du besoin (« pas de requête à chaque
 * frappe ») sans paraître figé au comptoir sur tablette.
 */
export function useValeurDebouncee(valeur: string, delaiMs = 300): string {
  const [valeurTemporisee, setValeurTemporisee] = useState(valeur);

  useEffect(() => {
    const identifiant = window.setTimeout(() => setValeurTemporisee(valeur), delaiMs);
    return () => window.clearTimeout(identifiant);
  }, [valeur, delaiMs]);

  return valeurTemporisee;
}
