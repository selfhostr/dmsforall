import type { OrdreReparationResume } from '@dfa/shared';

/**
 * « OR précédent » d'un véhicule : celui qui a été OUVERT juste avant l'OR affiché — jamais « le
 * plus récent autre que celui-ci », qui désignait un OR POSTÉRIEUR dès qu'un OR plus récent
 * existait. `candidats` vient d'une liste triée `ouvertLe:desc` ; l'ordre est refait ici pour ne
 * pas dépendre du tri serveur. Un OR sans `ouvertLe` (planifié, pas encore reçu) n'a pas de
 * « précédent » au sens du temps : il ne peut être précédé que d'OR déjà ouverts.
 */
export function trouverOrPrecedent(
  candidats: readonly OrdreReparationResume[],
  courant: { readonly id: string; readonly ouvertLe: string | null },
): OrdreReparationResume | null {
  const reference =
    courant.ouvertLe === null ? Number.POSITIVE_INFINITY : Date.parse(courant.ouvertLe);
  const anterieurs = candidats
    .filter((candidat) => candidat.id !== courant.id && candidat.ouvertLe !== null)
    .map((candidat) => ({ candidat, ouvertA: Date.parse(candidat.ouvertLe as string) }))
    .filter(({ ouvertA }) => ouvertA < reference)
    .sort((a, b) => b.ouvertA - a.ouvertA);
  return anterieurs[0]?.candidat ?? null;
}
