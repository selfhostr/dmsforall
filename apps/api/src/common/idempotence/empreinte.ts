import { createHash } from 'node:crypto';

/**
 * Empreinte SHA-256 du corps CANONICALISÉ (clés triées récursivement, sans espace) — c'est ce qui
 * distingue un rejeu légitime (même corps, même clé) d'une réutilisation fautive de la même clé
 * pour une requête différente (`409 IDEMPOTENCE_CONFLIT`). Deux objets JS avec les mêmes paires
 * clé/valeur mais un ordre de clé différent produisent donc la MÊME empreinte — un client qui
 * sérialise `{a,b}` puis `{b,a}` pour le même appel logique ne doit pas déclencher un faux conflit.
 */
export function calculerEmpreinte(corps: unknown): Buffer {
  const canonique = JSON.stringify(canonicaliser(corps ?? null));
  return createHash('sha256').update(canonique, 'utf8').digest();
}

/**
 * Trie récursivement les clés de tout objet rencontré. Les tableaux gardent leur ordre (l'ordre y
 * est significatif) ; les valeurs `undefined` d'un objet sont supprimées, exactement comme le
 * ferait `JSON.stringify` nativement — le rendre explicite ici documente l'intention plutôt que
 * de compter sur un comportement implicite de la sérialisation.
 */
function canonicaliser(valeur: unknown): unknown {
  if (Array.isArray(valeur)) {
    return valeur.map(canonicaliser);
  }
  if (valeur !== null && typeof valeur === 'object') {
    const objet = valeur as Record<string, unknown>;
    const resultat: Record<string, unknown> = {};
    for (const cle of Object.keys(objet).sort()) {
      const v = objet[cle];
      if (v !== undefined) {
        resultat[cle] = canonicaliser(v);
      }
    }
    return resultat;
  }
  return valeur;
}
