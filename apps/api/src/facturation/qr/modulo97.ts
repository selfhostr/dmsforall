/**
 * Reste ISO 7064 mod 97-10, partagé par l'IBAN (ISO 13616) et la référence SCOR (ISO 11649) —
 * c'est rigoureusement le même calcul dans les deux normes.
 *
 * Le reste est accumulé caractère par caractère, jamais en construisant l'entier complet : un
 * IBAN de 21 caractères converti en nombre dépasse `Number.MAX_SAFE_INTEGER`, et l'arrondi qui
 * s'ensuit produit une clé fausse **sans aucune erreur visible**. C'est exactement le genre de
 * bug qui ne se manifeste que sur certains IBAN, en production.
 *
 * L'appelant valide le jeu de caractères en amont ; toute entrée non alphanumérique majuscule
 * est ici une erreur de programmation, pas une erreur métier.
 */
export function resteModulo97(chaine: string): number {
  let reste = 0;

  for (let i = 0; i < chaine.length; i += 1) {
    const code = chaine.charCodeAt(i);
    let valeur: number;

    if (code >= 48 && code <= 57) {
      valeur = code - 48; // 0-9
    } else if (code >= 65 && code <= 90) {
      valeur = code - 55; // A = 10 … Z = 35
    } else {
      throw new RangeError(
        `resteModulo97 : caractère non alphanumérique majuscule « ${chaine.charAt(i)} » ` +
          `en position ${i + 1}.`,
      );
    }

    // Un chiffre décale d'un rang décimal, une lettre de deux (sa valeur en compte deux).
    // `reste` < 97, donc au pire 96 × 100 + 35 = 9635 : très en deçà de MAX_SAFE_INTEGER.
    reste = valeur < 10 ? (reste * 10 + valeur) % 97 : (reste * 100 + valeur) % 97;
  }

  return reste;
}
