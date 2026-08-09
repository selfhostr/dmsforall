import { useEffect, useState } from 'react';

export type GranulariteTempsConsole = 'minute' | 'heure' | 'jour';

export interface DureeEcouleeConsole {
  readonly granularite: GranulariteTempsConsole;
  readonly valeur: number;
}

/**
 * Durée écoulée depuis `iso`, décomposée en une seule granularité (minute/heure/jour) — même
 * doctrine que `formaterDureeMoyenneTableauBord` (`hooks/tableau-bord/formats-tableau-bord.ts`) :
 * la fonction rend des NOMBRES bruts, la traduction (pluriel ICU, unité localisée) est composée
 * par le composant appelant via `t()`, jamais ici. `maintenant` est un paramètre plutôt que
 * `Date.now()` en dur : rend la fonction testable sans mock de l'horloge globale.
 */
export function calculerDureeEcouleeConsole(
  iso: string,
  maintenant: Date = new Date(),
): DureeEcouleeConsole {
  const debutMs = new Date(iso).getTime();
  const minutesEcoulees = Math.max(0, Math.floor((maintenant.getTime() - debutMs) / 60_000));

  if (minutesEcoulees < 60) {
    return { granularite: 'minute', valeur: minutesEcoulees };
  }
  const heuresEcoulees = Math.floor(minutesEcoulees / 60);
  if (heuresEcoulees < 24) {
    return { granularite: 'heure', valeur: heuresEcoulees };
  }
  return { granularite: 'jour', valeur: Math.floor(heuresEcoulees / 24) };
}

function calculerSecondesEcoulees(depuisIso: string, maintenant: Date = new Date()): number {
  return Math.max(0, Math.floor((maintenant.getTime() - new Date(depuisIso).getTime()) / 1000));
}

/**
 * Compteur de secondes qui tourne réellement (bandeau de contexte inter-tenant, §6 de la
 * conception : « un chiffre qui tourne se remarque plus qu'un texte fixe qu'on cesse de lire après
 * trois secondes »). Réservé à l'AFFICHAGE VISUEL — voir `texteAccessibleDureeConsole` ci-dessous
 * pour l'équivalent lecteur d'écran, volontairement statique (§9 : ne pas forcer une re-annonce
 * chaque seconde).
 */
export function useSecondesEcouleesConsole(depuisIso: string): number {
  const [secondes, setSecondes] = useState(() => calculerSecondesEcoulees(depuisIso));

  useEffect(() => {
    setSecondes(calculerSecondesEcoulees(depuisIso));
    const identifiant = window.setInterval(() => {
      setSecondes(calculerSecondesEcoulees(depuisIso));
    }, 1000);
    return () => window.clearInterval(identifiant);
  }, [depuisIso]);

  return secondes;
}

export type PalierAccessibleDureeConsole = 'moins5Min' | 'moins30Min' | 'moins1h' | 'plus1h';

/** Regroupement grossier en paliers stables — traduit par le composant via
 *  `console:bandeauContexte.duree.<palier>` (ex. « depuis moins de 5 minutes »). Un texte qui ne
 *  change pas à chaque seconde, contrairement au chiffre visuel. */
export function palierAccessibleDureeConsole(secondes: number): PalierAccessibleDureeConsole {
  if (secondes < 5 * 60) return 'moins5Min';
  if (secondes < 30 * 60) return 'moins30Min';
  if (secondes < 60 * 60) return 'moins1h';
  return 'plus1h';
}
