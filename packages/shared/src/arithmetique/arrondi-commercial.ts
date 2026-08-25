/**
 * SEULE fonction d'arrondi financier du dépôt (`docs/modele-documentaire-facturation.md` §3.2,
 * `RF-33`, `MD-40`). Avant ce module, deux implémentations coexistaient sur la même règle métier :
 * `atelier/calcul-ligne.ts` (`CalculLigneSimple`) arrondissait en flottant avec `Math.round`, et
 * `facturation/documents/calcul-document.ts` (`arrondiCommercial`) arrondissait en `bigint` avec
 * un « demi éloigné de zéro ». `Math.round` arrondit les demis vers **+∞**, donc de façon
 * ASYMÉTRIQUE : sur un montant négatif (avoir, correction), il ne s'éloigne pas de zéro comme la
 * règle commerciale suisse l'exige — `Math.round(-6.5) === -6`, alors que -6.5 doit s'arrondir à
 * -7. Exemple mesuré (`taux 2.6 %`, `ht = -250` centimes) : `Math.round` rendait une TVA de -6
 * centimes là où l'arrondi commercial en rend -7, un écart d'un centime sur un montant qui doit
 * pourtant équilibrer une facture au centime près.
 *
 * Toute autre implémentation d'arrondi sur un montant en centimes (flottant, `Math.round`,
 * réimplémentation locale) est un défaut, pas une variante acceptable — importer CETTE fonction
 * depuis `@dfa/shared` partout où un montant est arrondi.
 */

/**
 * Arrondit `num / den` au plus proche entier ; à égalité, s'éloigne de zéro (« demi éloigné de
 * zéro », `MD-40`). Arithmétique entière exclusivement (`bigint`) — jamais de flottant. `den` DOIT
 * être strictement positif (le signe porté par `num` seul, cohérent avec l'usage : les
 * dénominateurs courants sont `1000`, `100` ou `1000 + taux`).
 */
export function arrondiCommercial(num: bigint, den: bigint): bigint {
  if (den <= 0n) {
    throw new Error('arrondiCommercial : le dénominateur doit être strictement positif.');
  }
  return num >= 0n ? (num + den / 2n) / den : -((-num + den / 2n) / den);
}

/** `arrondiCommercial(a × b, den)`, en `bigint` de bout en bout — évite toute perte de précision
 *  d'un produit intermédiaire en `number` (`quantite_millieme × prix_unitaire_centimes` peut
 *  atteindre 10¹⁴ sur une ligne extrême). Rend un `number` : les montants de ligne restent
 *  plafonnés à des grandeurs très en-deçà de 2⁵³ par les contraintes `*_montant_*_chk` en base. */
export function foisArrondiCommercial(a: number, b: number, den: number): number {
  return Number(arrondiCommercial(BigInt(a) * BigInt(b), BigInt(den)));
}
