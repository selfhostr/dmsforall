import { useEffect, useRef } from 'react';

import { ecrireBrouillon } from './brouillon';

/**
 * Sauvegarde AUTOMATIQUEMENT `valeurs` sous le brouillon `cle` à chaque changement — la saisie
 * d'un formulaire de création survit ainsi à un démontage inattendu de l'écran (panne réseau
 * traitée par `RouteProtegee`, crash de rendu capté par une limite d'erreur) sans que l'écran
 * appelant ait à orchestrer la moindre sauvegarde lui-même.
 *
 * `cle` à `undefined` DÉSACTIVE la sauvegarde — utile tant qu'un identifiant nécessaire à une clé
 * stable n'est pas encore connu, ou pour un écran qui édite une ressource déjà persistée (un
 * brouillon local n'a de sens que pour une création, jamais pour remplacer la réponse serveur qui
 * fait foi sur une fiche existante).
 *
 * Alimenter `valeurs` avec `form.watch()` (react-hook-form, sans nom de champ) : cet appel
 * resouscrit à la totalité du formulaire et redéclenche un rendu à chaque frappe — exactement le
 * signal voulu ici. La comparaison JSON interne évite une écriture `sessionStorage` à chaque rendu
 * non pertinent (nouvelle référence d'objet sans changement de contenu).
 */
export function useSauvegardeBrouillon<T>(cle: string | undefined, valeurs: T): void {
  const dernierJsonEcrit = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!cle) return;
    const json = JSON.stringify(valeurs);
    if (json === dernierJsonEcrit.current) return;
    dernierJsonEcrit.current = json;
    ecrireBrouillon(cle, valeurs);
  }, [cle, valeurs]);
}
