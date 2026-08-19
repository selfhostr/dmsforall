/**
 * STABILITÉ AVANT DÉCLENCHEMENT AUTOMATIQUE — brief de @laupernoe (18.08.2026) pour la prise de vue en
 * direct : « le déclenchement automatique ne doit pas surprendre : il faut une stabilité tenue
 * pendant un court instant, pas un déclenchement au premier cadrage correct ». Cette machine est
 * PURE (aucune horloge interne, aucun DOM) — l'appelant (`CaptureLiveCadrage.tsx`) fournit
 * l'horodatage courant à chaque analyse, ce qui la rend testable sans timers réels ni `vi.useFakeTimers`
 * fragile. Un seul état à la fois (jamais des booléens indépendants qui pourraient décrire une
 * combinaison impossible — même discipline que `EtapeScan` dans `EcranScan.tsx`) : le cadrage
 * VIENT de devenir mauvais (`stable: false`), OU il est bon depuis `progressionMs` (plafonné à
 * `DUREE_STABILITE_MS`), avec `declenche` qui devient vrai au palier.
 */

/** Durée pendant laquelle le cadrage doit rester bon EN CONTINU avant le déclenchement automatique.
 *  NON CALIBRÉE sur un usage réel (aucun téléphone dans cet environnement) : 1.2 s est un choix de
 *  départ raisonnable (assez long pour ne jamais surprendre sur un cadrage instable qui oscille,
 *  assez court pour ne pas sembler cassé) — à ajuster en test terrain. */
export const DUREE_STABILITE_MS = 1200;

export interface EtatStabiliteCadrage {
  /** `false` = cadrage mauvais ou pas encore évalué. `true` = bon depuis au moins un cycle. */
  readonly stable: boolean;
  /** Millisecondes écoulées depuis que le cadrage est devenu bon EN CONTINU, plafonnées à
   *  `DUREE_STABILITE_MS`. Toujours `0` quand `stable` est `false`. */
  readonly progressionMs: number;
  /** `true` UNE FOIS que `progressionMs` atteint `DUREE_STABILITE_MS` — le signal qui déclenche la
   *  capture, jamais recalculé après (voir `CaptureLiveCadrage.tsx`, qui verrouille sur le premier
   *  passage à `true` pour ne jamais déclencher deux fois). */
  readonly declenche: boolean;
}

export const ETAT_STABILITE_INITIAL: EtatStabiliteCadrage = {
  stable: false,
  progressionMs: 0,
  declenche: false,
};

export interface ResultatStabilite {
  readonly etat: EtatStabiliteCadrage;
  /** À reporter par l'appelant comme `debutStabiliteMs` du prochain appel — voir
   *  `CaptureLiveCadrage.tsx`, qui le garde dans une `ref` (jamais un état React : il change à
   *  chaque analyse, bien plus souvent qu'un re-rendu n'est utile). */
  readonly debutStabiliteMs: number | null;
}

/**
 * Un pas de la machine : `cadrageBon` est le verdict de l'analyse la PLUS RÉCENTE (un booléen, pas
 * un historique — c'est `debutStabiliteMs`, reporté d'un appel à l'autre, qui porte la mémoire).
 * `cadrageBon` redevenu faux à N'IMPORTE QUEL moment réinitialise tout : aucune moyenne glissante,
 * aucune tolérance à un « presque bon » — la stabilité DOIT être continue, exactement ce que @laupernoe a
 * demandé.
 */
export function calculerEtatStabilite(
  cadrageBon: boolean,
  maintenant: number,
  debutStabiliteMs: number | null,
): ResultatStabilite {
  if (!cadrageBon) {
    return { etat: ETAT_STABILITE_INITIAL, debutStabiliteMs: null };
  }

  const debut = debutStabiliteMs ?? maintenant;
  const ecouleMs = Math.max(0, maintenant - debut);
  const progressionMs = Math.min(DUREE_STABILITE_MS, ecouleMs);

  return {
    etat: { stable: true, progressionMs, declenche: ecouleMs >= DUREE_STABILITE_MS },
    debutStabiliteMs: debut,
  };
}
