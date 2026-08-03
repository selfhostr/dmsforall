import { Injectable } from '@nestjs/common';

import type { CalculLigne, EntreeCalculLigne, MontantsLigne } from './atelier.jetons';

/**
 * Implémentation INTÉRIMAIRE de `JETON_CALCUL_LIGNE` (voir `atelier.jetons.ts`), fournie par
 * `AtelierModule` lui-même au lot 1 — EXACTEMENT la même doctrine que `LecturePointageVide` pour
 * `JETON_LECTURE_POINTAGE` : le port est déclaré par `atelier` (le consommateur), et
 * `atelier/montants/**` (propriété expert-facturation, L1-14, plan-lot1-execution.md §6.3)
 * n'existe pas encore dans ce dépôt. Sans lui, `ServiceLigneOr` ne peut ni créer ni modifier une
 * ligne (les colonnes `montant_{ht,tva,ttc}_centimes` sont `NOT NULL` en base). Cette classe
 * comble le vide avec l'ORDRE DE CALCUL GELÉ documenté par le contrat (`packages/shared`,
 * `ligne.ts` : « brut -> rabais -> arrondi centime -> TVA sur le HT arrondi -> arrondi -> agrégation »).
 *
 * À RETIRER le jour où `MontantsModule` (L1-14) est livré : `AtelierModule` importera ce module et
 * fournira le VRAI `CalculLigne` sous le même jeton — aucun autre fichier n'aura à changer, c'est
 * précisément ce que le port protège.
 */
const TYPES_MAIN_OEUVRE: ReadonlySet<string> = new Set([
  'main_oeuvre_bareme',
  'main_oeuvre_temps_reel',
]);

@Injectable()
export class CalculLigneSimple implements CalculLigne {
  /**
   * Pure, sans I/O (contrat de `CalculLigne`).
   *
   * Montant BRUT :
   *  - main d'œuvre (`temps_bareme_centiemes` = centièmes d'heure) : `temps * tauxHoraire / 100` ;
   *  - toute autre ligne : `prixUnitaire * quantiteMillieme / 1000`.
   *
   * Puis, DANS CET ORDRE (gelé) : rabais -> arrondi au centime (HT de la ligne) -> TVA sur ce HT
   * arrondi -> arrondi au centime -> `montantTtc = montantHt + montantTva` (invariant de base,
   * `ligne_or_montant_coherent_chk`). Aucun arrondi au 5 centimes ici : c'est une règle de paiement
   * en ESPÈCES (CONTRIBUTING.md), donc étape 2, appliquée à l'agrégat de la facture, jamais à la ligne.
   */
  calculer(e: EntreeCalculLigne): MontantsLigne {
    const brut = TYPES_MAIN_OEUVRE.has(e.type)
      ? Math.round(((e.tempsBaremeCentiemes ?? 0) * (e.tauxHoraireCentimes ?? 0)) / 100)
      : Math.round(((e.prixUnitaireCentimes ?? 0) * e.quantiteMillieme) / 1000);

    const montantHtCentimes = Math.round((brut * (1000 - e.rabaisPourmille)) / 1000);
    const montantTvaCentimes = Math.round((montantHtCentimes * e.tauxTvaPourmille) / 1000);

    return {
      montantHtCentimes,
      montantTvaCentimes,
      montantTtcCentimes: montantHtCentimes + montantTvaCentimes,
    };
  }

  totaliser(l: readonly MontantsLigne[]): MontantsLigne {
    return l.reduce(
      (acc, m) => ({
        montantHtCentimes: acc.montantHtCentimes + m.montantHtCentimes,
        montantTvaCentimes: acc.montantTvaCentimes + m.montantTvaCentimes,
        montantTtcCentimes: acc.montantTtcCentimes + m.montantTtcCentimes,
      }),
      { montantHtCentimes: 0, montantTvaCentimes: 0, montantTtcCentimes: 0 },
    );
  }
}
