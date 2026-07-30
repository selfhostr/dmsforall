import { z } from 'zod';

import { schemaDateJour, schemaIdentifiant } from '../atelier/primitives';

/**
 * `GET /pointages/indicateurs` — RM-99 : présence, productivité, rendement, taux de retouche.
 *
 * FORMULES EN HYPOTHÈSE, PAS EN CERTITUDE — signalé plutôt que codé en silence : RM-99 NOMME les
 * quatre indicateurs sans donner leur formule exacte. Celles ci-dessous sont une PROPOSITION
 * cohérente avec le reste de la spécification (§5, §6), à valider avec expert-metier avant
 * implémentation :
 *  - `presenceCentiemes` = temps `productif` + temps `indirect` (RM-122 : l'indirect est un temps
 *    PRÉSENT et PAYÉ, pas un trou dans la présence — l'exclure sous-compterait silencieusement
 *    l'atelier, ce que RM-122 signale explicitement comme un risque réel).
 *  - `productifCentiemes` = temps `productif_ligne` + temps `productif_or`.
 *  - `productiviteMillieme` = `productifCentiemes` / `presenceCentiemes`.
 *  - `rendementMillieme` = `tempsVenduCentiemes` (barémé/forfaitaire des lignes RÉALISÉES par ce
 *    technicien sur la période, PAS le temps pointé) / temps `productif_ligne` SEUL. EXCLUT
 *    délibérément `productif_or` du dénominateur : un pointage sans ligne précise n'a aucun temps
 *    vendu auquel se comparer, l'inclure diluerait le ratio vers un chiffre qui ne mesure plus
 *    rien (§6 : « c'est précisément l'écart [pointé vs vendu] qui a de la valeur »). RM-99 ne
 *    tranche pas ce point littéralement — c'est l'inférence la moins fondée de ce fichier,
 *    prioritaire à confirmer.
 *  - `tauxRetoucheMillieme` = heures pointées sur des lignes d'`origine = 'retouche'`
 *    (`ORIGINES_LIGNE_OR`, `atelier/enums.ts`) / temps `productif` total.
 * Un champ vaut `null`, JAMAIS `0`, quand son dénominateur est nul (aucune présence/productif sur
 * la période demandée) — même logique que `capaciteHeuresJourCentiemes` (§8.2 de la spécification
 * étape 1) : un taux à zéro affirmerait une contre-performance là où il n'y a simplement aucune
 * donnée.
 */
export interface IndicateursPointageTechnicien {
  readonly technicienId: string;
  readonly periode: { readonly du: string; readonly au: string };
  readonly presenceCentiemes: number;
  readonly productifCentiemes: number;
  readonly indirectCentiemes: number;
  readonly tempsVenduCentiemes: number;
  readonly productiviteMillieme: number | null;
  readonly rendementMillieme: number | null;
  readonly tauxRetoucheMillieme: number | null;
}

/**
 * `technicienId` absent = tous les techniciens du site (vue chef d'atelier/direction) ;
 * présent = un seul technicien (vue individuelle — voir §9 de la spécification, question ouverte
 * « un technicien voit-il ses propres chiffres » : ce paramètre existe dans les deux cas, c'est
 * le DROIT `atelier.pointage.lire_indicateurs` qui doit trancher, côté serveur, qui a le droit de
 * demander les chiffres de qui — pas ce schéma).
 */
export const schemaParametresIndicateursPointage = z.object({
  technicienId: schemaIdentifiant.optional(),
  siteId: schemaIdentifiant.optional(),
  /** Bornes INCLUSES, mêmes conventions `du`/`au` que le reste de l'API. */
  du: schemaDateJour,
  au: schemaDateJour,
});
export type ParametresIndicateursPointage = z.infer<typeof schemaParametresIndicateursPointage>;

/** Pas de pagination par curseur ici : une réponse bornée par le nombre de techniciens d'un site
 *  (quelques dizaines au plus), pas une collection au sens de `PageCurseur` (`contrats/pagination.ts`). */
export interface ReponseIndicateursPointage {
  readonly indicateurs: readonly IndicateursPointageTechnicien[];
}
