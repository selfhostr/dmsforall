/** Petits utilitaires internes aux hooks `hooks/parametrage/utilisateurs*` — jamais exportés
 *  hors de ce dossier, même patron que `hooks/clients/support.ts`. */

/** Voir `hooks/clients/support.ts::exigerCorps` — même garde, dupliquée ici plutôt
 *  qu'importée depuis un domaine hors périmètre. */
export function exigerCorps<T>(valeur: T | undefined, contexte: string): T {
  if (valeur === undefined) {
    throw new Error(`Réponse vide inattendue : ${contexte}.`);
  }
  return valeur;
}
