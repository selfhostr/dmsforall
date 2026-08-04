/**
 * Génération d'UUID v4 — POURQUOI ce détour existe plutôt que d'appeler `crypto.randomUUID()`
 * directement à chaque endroit qui a besoin d'un identifiant côté client.
 *
 * `crypto.randomUUID()` est marquée `[SecureContext]` dans la spec WebCrypto : elle n'existe QUE
 * servie en HTTPS ou sur `localhost`. Ce piège est INVISIBLE en développement — un poste qui sert
 * `apps/web` sur `http://localhost:5173` a toujours `crypto.randomUUID` disponible, HTTP ou pas,
 * parce que `localhost` est un contexte sécurisé par définition. Il ne se manifeste QUE quand
 * l'app est servie en HTTP sur une adresse réseau locale — le cas courant d'une tablette d'atelier
 * qui ouvre `http://192.168.x.x:5173` (`vite --host`, sans certificat) : là, `crypto.randomUUID`
 * est `undefined`, et l'appeler lève `TypeError: crypto.randomUUID is not a function`. Personne ne
 * reproduit ça en local, donc personne ne le voit avant qu'un garagiste ne clique en atelier.
 *
 * `crypto.getRandomValues`, elle, N'EST PAS restreinte au contexte sécurisé : elle reste
 * disponible partout, y compris en HTTP sur IP locale. C'est donc elle qui sert de repli — jamais
 * `Math.random()`, qui n'offre aucune garantie cryptographique et romprait la propriété d'unicité
 * qu'exigent aussi bien un `Idempotency-Key` qu'un identifiant de ressource généré côté client.
 *
 * Si ce helper disparaît un jour au profit d'un appel direct à `crypto.randomUUID()`, le bug
 * revient — et personne ne comprendra pourquoi sans ce commentaire, puisque tous les tests et
 * toute la démo tournent sur `localhost`.
 */
export function genererUuid(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return genererUuidV4DepuisValeursAleatoires();
}

/** Repli RFC 4122 §4.4 à partir de `crypto.getRandomValues` (disponible hors contexte sécurisé,
 *  contrairement à `crypto.randomUUID`) : 16 octets aléatoires, dans lesquels on force les bits de
 *  version (`0100`) et de variante (`10xx`) pour obtenir un UUID v4 structurellement valide — pas
 *  une simple suite d'octets aléatoires qui ressemblerait à un UUID sans en respecter la forme. */
function genererUuidV4DepuisValeursAleatoires(): string {
  const octets = new Uint8Array(16);
  crypto.getRandomValues(octets);

  // `?? 0` : indexation d'un `Uint8Array` de longueur fixe connue (16), donc jamais réellement
  // `undefined` à l'exécution — seul `noUncheckedIndexedAccess` (tsconfig.base.json) l'exige pour
  // typer proprement, sans `!`.
  octets[6] = ((octets[6] ?? 0) & 0x0f) | 0x40; // Version 4.
  octets[8] = ((octets[8] ?? 0) & 0x3f) | 0x80; // Variante RFC 4122 (10xx).

  const hex = Array.from(octets, (octet) => octet.toString(16).padStart(2, '0'));
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-');
}
