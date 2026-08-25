import { describe, expect, it } from 'vitest';

import { Sha256Incremental, hacherFichierSha256 } from './sha256-incremental';

const ENCODEUR = new TextEncoder();

function hacherChaineEnUnAppel(texte: string): string {
  const hasher = new Sha256Incremental();
  hasher.update(ENCODEUR.encode(texte));
  return hasher.digest();
}

/** Empreinte de référence via l'API navigateur — jamais utilisée pour PRODUIRE l'empreinte
 *  envoyée au serveur (voir la doc de tête du module : `crypto.subtle.digest` ne supporte pas la
 *  mise à jour incrémentale nécessaire à un fichier de plusieurs dizaines de Go), mais un bon
 *  oracle indépendant pour prouver que l'implémentation maison est correcte. */
async function hacherAvecWebCrypto(octets: Uint8Array): Promise<string> {
  // Cast : `Uint8Array<ArrayBufferLike>` vs `BufferSource` (`ArrayBufferView<ArrayBuffer>`) est
  // une friction de typage lib.dom pure — un `Uint8Array` satisfait `BufferSource` à
  // l'exécution quelle que soit la variance de son paramètre de type générique de buffer.
  const buffer = await crypto.subtle.digest('SHA-256', octets as BufferSource);
  return Array.from(new Uint8Array(buffer), (o) => o.toString(16).padStart(2, '0')).join('');
}

describe('Sha256Incremental', () => {
  it('vecteur connu : chaîne vide', () => {
    expect(hacherChaineEnUnAppel('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('vecteur connu : "abc"', () => {
    expect(hacherChaineEnUnAppel('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('vecteur connu : chaîne de 56 caractères (bourrage à cheval sur deux blocs, cas limite)', () => {
    const texte = 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq';
    expect(hacherChaineEnUnAppel(texte)).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('update() appelé en plusieurs morceaux produit la MÊME empreinte que en un seul appel', () => {
    const texte = 'a'.repeat(200) + 'b'.repeat(137) + 'c'.repeat(65);
    const octets = ENCODEUR.encode(texte);

    const enUnSeulAppel = new Sha256Incremental();
    enUnSeulAppel.update(octets);
    const empreinteUnique = enUnSeulAppel.digest();

    const parMorceaux = new Sha256Incremental();
    // Découpage volontairement IRRÉGULIER (ni multiple de 64, ni identique entre appels) — c'est
    // exactement le cas réel : chaque appel `update()` reçoit une tranche de fichier de taille
    // fixe, mais le tampon interne accumule des restes de tailles variables entre deux blocs de
    // 64 octets.
    let position = 0;
    const tailles = [7, 64, 1, 130, 41, 300];
    for (const taille of tailles) {
      const fin = Math.min(position + taille, octets.length);
      parMorceaux.update(octets.slice(position, fin));
      position = fin;
    }
    parMorceaux.update(octets.slice(position));
    const empreinteMorceaux = parMorceaux.digest();

    expect(empreinteMorceaux).toBe(empreinteUnique);
  });

  it('digest() ne peut être appelé qu’une seule fois', () => {
    const hasher = new Sha256Incremental();
    hasher.update(ENCODEUR.encode('x'));
    hasher.digest();
    expect(() => hasher.digest()).toThrow();
  });

  it('update() après digest() est refusé', () => {
    const hasher = new Sha256Incremental();
    hasher.digest();
    expect(() => hasher.update(ENCODEUR.encode('x'))).toThrow();
  });

  it('équivaut à crypto.subtle.digest sur un buffer aléatoire de taille non alignée', async () => {
    const octets = new Uint8Array(5_000);
    crypto.getRandomValues(octets);

    const hasher = new Sha256Incremental();
    // Trois `update()` de tailles différentes, non multiples de 64 — même intention que le test
    // ci-dessus, mais confronté à l'oracle externe plutôt qu'à l'implémentation elle-même.
    hasher.update(octets.slice(0, 1234));
    hasher.update(octets.slice(1234, 4999));
    hasher.update(octets.slice(4999));

    expect(hasher.digest()).toBe(await hacherAvecWebCrypto(octets));
  });
});

describe('hacherFichierSha256', () => {
  it('hache un Blob par tranches et rapporte une progression croissante jusqu’à la taille totale', async () => {
    const octets = new Uint8Array(10_000);
    crypto.getRandomValues(octets);
    const blob = new Blob([octets]);

    const progressions: number[] = [];
    const empreinte = await hacherFichierSha256(blob, {
      tailleLectureOctets: 4_000,
      surProgression: (octetsLus) => progressions.push(octetsLus),
    });

    expect(empreinte).toBe(await hacherAvecWebCrypto(octets));
    expect(progressions).toEqual([4_000, 8_000, 10_000]);
  });

  it('hache un Blob vide sans erreur', async () => {
    const empreinte = await hacherFichierSha256(new Blob([]));
    expect(empreinte).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});
