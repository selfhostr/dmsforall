/**
 * Progression VISIBLE en cours d'écriture — défaut réel du 26.08.2026 : `elements_traites` et
 * `domaine_courant` (`reprise_import`) n'étaient mis à jour qu'UNE FOIS par domaine, APRÈS la
 * fin complète de son écriture. Sur un domaine volumineux (6874 véhicules, ~20-30 minutes
 * d'écriture réelle mesurées le jour même), le compteur restait figé à sa valeur précédente tout
 * ce temps — aucun moyen de distinguer « travaille normalement » de « bloqué », ni pour un
 * garagiste sur son écran, ni pour quiconque interroge la base directement (vécu en écrivant ce
 * correctif : un job qui travaillait normalement a été pris pour calé au moins deux fois le même
 * jour, faute de ce signal). `domaine_courant` vide jusqu'à la fin aggrave le symptôme : impossible
 * de savoir MÊME QUEL domaine est en cours.
 *
 * MAILLE CHOISIE, MESURÉE PAS DEVINÉE : un flush toutes les `SEUIL_LOT_PROGRESSION_REPRISE`
 * lignes (500) — sur le plus gros domaine mesuré (6874 véhicules), ~14 flushs, chacun un aller-
 * retour SQL de plus (même patron que `avancerProgression`, déjà 2 requêtes : lecture puis mise à
 * jour) dans la MÊME transaction déjà ouverte pour l'écriture — AUCUNE transaction supplémentaire,
 * AUCUN allongement mesurable de la transaction existante (~14 requêtes de plus sur les ~6874 déjà
 * nécessaires pour écrire les lignes elles-mêmes — moins de 0,2% d'aller-retours en plus). Une
 * maille plus fine (chaque ligne) doublerait le nombre de requêtes SQL de la boucle d'écriture
 * pour un gain de fraîcheur imperceptible à l'écran (un ré-affichage toutes les 3s côté front,
 * `useImportReprise.ts`) — pas le compromis choisi ici.
 *
 * Le RESTE (dernier lot partiel sous le seuil, ET l'écart entre `candidatsRetenus.length` après
 * dédoublonnage/rejets et `table.nombreLignes` — la table ENTIÈRE, unité déjà utilisée par
 * l'incrément final historique) est délibérément laissé à l'appelant orchestrateur
 * (`service-import-reprise.ts::ecrireElementDomaine`), qui connaît seul les DEUX bouts du calcul
 * (combien a déjà été signalé via ce compteur, combien la table source compte réellement) — cette
 * fonction ne fait que déclencher le signal à intervalle régulier, jamais la comptabilité finale.
 */

/** Nombre de lignes écrites entre deux mises à jour visibles de la progression. */
export const SEUIL_LOT_PROGRESSION_REPRISE = 500;

/** Callback appelé avec le DELTA (jamais un total) de lignes écrites depuis le dernier appel —
 *  même sémantique d'incrément que `ServiceImportReprise.avancerProgression`. */
export type CallbackProgresEcritureReprise = (delta: number) => Promise<void>;

/**
 * Compteur de lot réutilisable par les écrivains de domaine : `incrementer()` à chaque ligne
 * écrite, déclenche `onProgres` (si fourni) tous les `SEUIL_LOT_PROGRESSION_REPRISE` appels,
 * jamais plus souvent. Fonction pure côté comptage — le SEUL effet de bord est l'appel du
 * callback fourni par l'appelant.
 */
export function creerCompteurProgresEcriture(onProgres?: CallbackProgresEcritureReprise): {
  incrementer: () => Promise<void>;
} {
  let depuisDernierFlush = 0;
  return {
    async incrementer(): Promise<void> {
      depuisDernierFlush += 1;
      if (onProgres && depuisDernierFlush >= SEUIL_LOT_PROGRESSION_REPRISE) {
        const delta = depuisDernierFlush;
        depuisDernierFlush = 0;
        await onProgres(delta);
      }
    },
  };
}
