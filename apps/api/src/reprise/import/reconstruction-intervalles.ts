/**
 * Reconstruction d'intervalles temporels SANS CHEVAUCHEMENT, PAR CLÉ — pur, sans accès base.
 *
 * LE POINT DUR (brief) : `vehicule_plaque`/`vehicule_detention` portent une contrainte `EXCLUDE
 * USING GIST` sur `daterange(du, au, '[)')` (migration 0007) — une plaque réattribuée d'un
 * véhicule à un autre, ou un véhicule qui change de détenteur, DOIT avoir son intervalle PRÉCÉDENT
 * refermé (`au` posé) exactement là où le SUIVANT commence. Un import ligne à ligne qui se
 * contente d'écrire chaque snapshot source tel quel (souvent `au = null` partout, la source ne
 * portant que l'état courant à chaque export) produit N intervalles `[du, +∞)` qui se chevauchent
 * tous — l'`INSERT` de la deuxième ligne échoue sur l'`EXCLUDE`, l'import entier cale.
 *
 * Ce module trie les enregistrements PAR CLÉ (valeur de plaque normalisée, ou vehicule_id — le
 * choix de la clé est la responsabilité de l'appelant, voir les écrivains), puis referme chaque
 * intervalle à la date de début du suivant. Deux enregistrements de MÊME clé ET MÊME date de début
 * (doublon source pur) sont fusionnés — sinon l'intervalle refermé serait de longueur nulle,
 * rejeté par la contrainte `au > du` (0007).
 */

export interface EnregistrementIntervalle<T> {
  readonly cle: string;
  /** `aaaa-mm-jj`, déjà normalisée (le format source variable — jj.mm.aaaa, aaaa.mm.jj — est
   *  résolu EN AMONT, hors de ce module). */
  readonly du: string;
  readonly donnees: T;
}

export interface IntervalleReconstruit<T> {
  readonly cle: string;
  readonly du: string;
  /** `null` = intervalle encore ouvert (dernier enregistrement connu pour cette clé). */
  readonly au: string | null;
  readonly donnees: T;
}

export function reconstituerIntervallesSansChevauchement<T>(
  enregistrements: readonly EnregistrementIntervalle<T>[],
): readonly IntervalleReconstruit<T>[] {
  const parCle = new Map<string, EnregistrementIntervalle<T>[]>();
  for (const enregistrement of enregistrements) {
    const liste = parCle.get(enregistrement.cle) ?? [];
    liste.push(enregistrement);
    parCle.set(enregistrement.cle, liste);
  }

  const resultat: IntervalleReconstruit<T>[] = [];
  for (const [cle, liste] of parCle) {
    const tries = [...liste].sort((a, b) => a.du.localeCompare(b.du));
    // Fusion des doublons stricts (même cle, même du) : ne garder que le PREMIER rencontré (ordre
    // d'arrivée dans le lot source) — un doublon source pur n'apporte aucune information
    // temporelle supplémentaire.
    const dedupliques: EnregistrementIntervalle<T>[] = [];
    for (const enregistrement of tries) {
      const precedent = dedupliques.at(-1);
      if (precedent && precedent.du === enregistrement.du) continue;
      dedupliques.push(enregistrement);
    }

    for (let i = 0; i < dedupliques.length; i += 1) {
      const courant = dedupliques[i]!;
      const suivant = dedupliques[i + 1];
      resultat.push({
        cle,
        du: courant.du,
        au: suivant ? suivant.du : null,
        donnees: courant.donnees,
      });
    }
  }
  return resultat;
}
