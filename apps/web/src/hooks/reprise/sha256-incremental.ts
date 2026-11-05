/**
 * SHA-256 incrémental, pur JS, sans dépendance.
 *
 * POURQUOI CE FICHIER EXISTE (plutôt qu'un `crypto.subtle.digest` direct) : le contrat de reprise
 * (`packages/shared/src/contrats/reprise.ts`) exige `empreinteSha256Annoncee` dès
 * `POST /reprise/dossiers`, donc AVANT le premier octet envoyé — il faut donc pouvoir hacher un
 * fichier de plusieurs dizaines de Go (jusqu'à 43 Go mesurés en réel) SANS le charger entièrement
 * en mémoire. `crypto.subtle.digest()` du navigateur ne prend qu'un buffer complet en une seule
 * fois : aucune API `update()` incrémentale n'existe côté WebCrypto. Aucune librairie de hash
 * (hash-wasm, js-sha256, crypto-js…) n'est présente dans le workspace — en ajouter une pour ce
 * seul besoin aurait exigé une modification de `package.json`/lockfile pendant que d'autres
 * lots installent en parallèle sur le même arbre, un risque évitable. D'où cette implémentation
 * directe, minimale, testée contre des vecteurs connus ET contre `crypto.subtle.digest` (voir le
 * fichier de test) pour preuve d'équivalence.
 *
 * Algorithme : FIPS 180-4, traitement par blocs de 64 octets, état sur 8 mots de 32 bits.
 */

const CONSTANTES_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const H_INITIAL = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

function rotr(valeur: number, decalage: number): number {
  return (valeur >>> decalage) | (valeur << (32 - decalage));
}

/** Hasher SHA-256 incrémental. `update()` peut être appelé autant de fois que nécessaire (un
 *  appel par tranche lue du fichier, sans jamais garder le fichier entier en mémoire) ; `digest()`
 *  clôt le calcul (empreinte hexadécimale) et ne doit être appelé qu'une seule fois. */
export class Sha256Incremental {
  private readonly h = H_INITIAL.slice();
  /** Tampon des octets non encore traités (< 64 octets entre deux appels `update`). */
  private tampon = new Uint8Array(0);
  /** Nombre TOTAL d'octets absorbés depuis le début — nécessaire pour le bourrage final
   *  (longueur du message, sur 64 bits, en bits). `bigint` : un fichier de 43 Go dépasse
   *  `Number.MAX_SAFE_INTEGER` une fois convertit en BITS (43e9 octets * 8 ≈ 3.44e11, encore
   *  largement sous 2^53 en octets, mais la marge de sécurité d'un `bigint` coûte rien ici et
   *  évite toute question d'arrondi sur une archive future plus grosse que la plus grosse
   *  mesurée). */
  private longueurTotaleOctets = 0n;
  private cloture = false;

  update(donnees: Uint8Array): void {
    if (this.cloture) {
      throw new Error('Sha256Incremental.update() appelé après digest().');
    }
    this.longueurTotaleOctets += BigInt(donnees.length);

    const concatene = new Uint8Array(this.tampon.length + donnees.length);
    concatene.set(this.tampon, 0);
    concatene.set(donnees, this.tampon.length);

    const blocsComplets = Math.floor(concatene.length / 64);
    for (let bloc = 0; bloc < blocsComplets; bloc++) {
      this.traiterBloc(concatene, bloc * 64);
    }
    this.tampon = concatene.slice(blocsComplets * 64);
  }

  /** Empreinte finale, hexadécimale minuscule (même forme que `schemaEmpreinteSha256Reprise`
   *  côté contrat). Applique le bourrage FIPS 180-4 sur ce qui reste en tampon, puis traite le ou
   *  les derniers blocs. */
  digest(): string {
    if (this.cloture) {
      throw new Error('Sha256Incremental.digest() déjà appelé.');
    }
    this.cloture = true;

    const longueurBits = this.longueurTotaleOctets * 8n;
    // Bourrage : un octet 0x80, puis des zéros jusqu'à ce qu'il reste exactement 8 octets pour la
    // longueur (56 mod 64), puis la longueur sur 8 octets big-endian.
    const octetsRestants = this.tampon.length;
    const tailleBourree = octetsRestants + 1 <= 56 ? 64 : 128;
    const bloc = new Uint8Array(tailleBourree);
    bloc.set(this.tampon, 0);
    bloc[octetsRestants] = 0x80;

    const vueLongueur = new DataView(bloc.buffer);
    vueLongueur.setBigUint64(tailleBourree - 8, longueurBits, false);

    for (let decalage = 0; decalage < tailleBourree; decalage += 64) {
      this.traiterBloc(bloc, decalage);
    }

    return Array.from(this.h, (mot) => mot.toString(16).padStart(8, '0')).join('');
  }

  private traiterBloc(donnees: Uint8Array, decalageOctet: number): void {
    const w = new Uint32Array(64);
    const vue = new DataView(donnees.buffer, donnees.byteOffset + decalageOctet, 64);
    for (let t = 0; t < 16; t++) {
      w[t] = vue.getUint32(t * 4, false);
    }
    for (let t = 16; t < 64; t++) {
      const w15 = w[t - 15] ?? 0;
      const w2 = w[t - 2] ?? 0;
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      w[t] = ((w[t - 16] ?? 0) + s0 + (w[t - 7] ?? 0) + s1) | 0;
    }

    let a = this.h[0] ?? 0;
    let b = this.h[1] ?? 0;
    let c = this.h[2] ?? 0;
    let d = this.h[3] ?? 0;
    let e = this.h[4] ?? 0;
    let f = this.h[5] ?? 0;
    let g = this.h[6] ?? 0;
    let h = this.h[7] ?? 0;

    for (let t = 0; t < 64; t++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + (CONSTANTES_K[t] ?? 0) + (w[t] ?? 0)) | 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) | 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }

    this.h[0] = (this.h[0] ?? 0) + a;
    this.h[1] = (this.h[1] ?? 0) + b;
    this.h[2] = (this.h[2] ?? 0) + c;
    this.h[3] = (this.h[3] ?? 0) + d;
    this.h[4] = (this.h[4] ?? 0) + e;
    this.h[5] = (this.h[5] ?? 0) + f;
    this.h[6] = (this.h[6] ?? 0) + g;
    this.h[7] = (this.h[7] ?? 0) + h;
  }
}

/** Lit un `Blob` en `Uint8Array`. `Blob.arrayBuffer()` est la voie normale (tout navigateur réel),
 *  mais le `Blob` rendu par `Blob.slice()` sous jsdom (environnement de test, voir
 *  `vitest.config.ts`) n'expose PAS cette méthode — un défaut connu de jsdom, pas de ce code.
 *  Repli sur `FileReader`, universellement supporté (navigateurs ET jsdom), pour que ce module se
 *  comporte IDENTIQUEMENT en test et en production plutôt que de mocker `arrayBuffer` seulement
 *  pour faire passer le test. */
function lireBlobEnOctets(bloc: Blob): Promise<Uint8Array> {
  if (typeof bloc.arrayBuffer === 'function') {
    return bloc.arrayBuffer().then((tampon) => new Uint8Array(tampon));
  }
  return new Promise((resolve, reject) => {
    const lecteur = new FileReader();
    lecteur.onload = () => resolve(new Uint8Array(lecteur.result as ArrayBuffer));
    lecteur.onerror = () =>
      reject(lecteur.error ?? new Error('Lecture du fichier impossible (FileReader).'));
    lecteur.readAsArrayBuffer(bloc);
  });
}

/** Empreinte SHA-256 d'un `Blob`/`File`, calculée par tranches (`tailleLectureOctets`) pour ne
 *  jamais charger le fichier entier en mémoire — c'est le point d'entrée que
 *  `useTeleversementArchive` appelle, une fois pour la déclaration initiale, une fois de plus
 *  seulement en cas de reprise après rechargement de page (voir sa documentation de tête).
 *  `surProgression` reçoit le nombre d'octets déjà lus, pour une barre de progression honnête. */
export async function hacherFichierSha256(
  fichier: Blob,
  options: {
    readonly tailleLectureOctets?: number;
    readonly surProgression?: (octetsLus: number) => void;
  } = {},
): Promise<string> {
  const tailleLecture = options.tailleLectureOctets ?? 16 * 1024 * 1024;
  const hasher = new Sha256Incremental();
  let position = 0;
  while (position < fichier.size) {
    const fin = Math.min(position + tailleLecture, fichier.size);
    const octets = await lireBlobEnOctets(fichier.slice(position, fin));
    hasher.update(octets);
    position = fin;
    options.surProgression?.(position);
  }
  return hasher.digest();
}
