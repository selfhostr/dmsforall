import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Temporise une valeur qui change à chaque frappe (recherche, filtre, aperçu de doublon…) —
 * déplacé depuis `hooks/vehicules/` (où il était né pour l'autocomplétion marque/modèle) : le
 * motif n'a jamais eu de spécificité véhicule, et une vingtaine d'écrans en réimplémentaient une
 * copie manuelle au fil des chantiers (recherche comptoir, listes atelier/clients/pièces/
 * pointage/ventes, sélecteurs de véhicule/client…) — chacune une divergence potentielle du même
 * patron `useState` + `useEffect` + `setTimeout`/`clearTimeout`.
 *
 * Générique (`T`) plutôt que figé sur `string` : la quasi-totalité des appelants passent une
 * chaîne de saisie, mais `EcranDoublonsClients.tsx` construit un OBJET de critères à partir de
 * plusieurs champs et temporise cet objet — mémoïser sa construction (`useMemo`, deps = les
 * champs primitifs) donne une référence stable et cette même fonction fonctionne sans
 * modification. Un appelant qui passerait un objet reconstruit à CHAQUE rendu sans `useMemo`
 * casserait la temporisation (nouvelle référence à chaque rendu = le délai ne se stabilise
 * jamais) — c'est un piège d'appel, pas une raison de complexifier ce hook avec une comparaison
 * profonde qu'aucun appelant `string` ne demande.
 *
 * `delaiMs` par défaut à 300 ms : compromis standard entre réactivité perçue et volume de
 * requêtes, mesuré au comptoir (D-08, RM-112). Certains appelants gardent un délai différent
 * (400 ms sur l'aperçu de doublon client, volontairement plus lent qu'une recherche — un
 * avertissement de doublon qui clignote à chaque frappe serait plus gênant qu'utile) : ce hook ne
 * l'impose jamais, `delaiMs` reste au choix de l'appelant.
 *
 * RETOUR : `[valeurTemporisee, reinitialiserImmediat]`. Le second élément est le LEVIER DE RESET
 * (choix produit, ticket « effacerFiltres() ») : un bouton « Effacer les filtres » est un geste de
 * reprise en main, pas une frappe — le faire attendre le même délai qu'une recherche donne
 * l'impression que le clic n'a pas été pris en compte, et le réflexe est de recliquer (friction
 * mesurée au comptoir, client en face). `reinitialiserImmediat()` demande au PROCHAIN changement
 * de `valeur` de s'appliquer sans passer par le minuteur — appelé en même temps que le
 * `setState('')` qui vide la saisie (même geste), il rend le prochain rendu de la valeur
 * temporisée instantané, sans toucher au délai pour la frappe normale juste après.
 *
 * Implémentation : un simple booléen d'état (« applique tout de suite ») redeviendrait piégeux —
 * il resterait vrai pour CHAQUE changement suivant tant que rien ne le repasse à `false`, cassant
 * le anti-rebond pour toute frappe après un reset. `flushDemande` est donc une RÉFÉRENCE (jamais
 * lue pendant le rendu, donc jamais de re-rendu inutile) : l'effet qui répond au changement de
 * `valeur` la consulte UNE FOIS puis la réarme immédiatement à `false` — un drapeau qui se
 * consomme lui-même, jamais un état qui doit être remis à `false` explicitement par l'appelant.
 */
export function useValeurDebouncee<T>(valeur: T, delaiMs = 300): readonly [T, () => void] {
  const [valeurTemporisee, setValeurTemporisee] = useState(valeur);
  const flushDemande = useRef(false);

  useEffect(() => {
    if (flushDemande.current) {
      flushDemande.current = false;
      setValeurTemporisee(valeur);
      return undefined;
    }
    const identifiant = window.setTimeout(() => setValeurTemporisee(valeur), delaiMs);
    return () => window.clearTimeout(identifiant);
  }, [valeur, delaiMs]);

  // Référence stable (jamais recréée) : sûr à omettre d'un tableau de dépendances `useEffect`
  // appelant, comme n'importe quel setter `useState`.
  const reinitialiserImmediat = useCallback(() => {
    flushDemande.current = true;
  }, []);

  return [valeurTemporisee, reinitialiserImmediat] as const;
}
