import { describe, expect, it } from 'vitest';
import {
  decoderCurseurDefaut,
  pageDepuisLignes,
  type LigneAvecCreation,
} from './pagination-defaut';

// `decoderCurseurTrie` (common/pagination/curseur.ts) exige un `id` au format UUID — un curseur
// v2 ne peut pas encoder n'importe quelle chaîne. Les fixtures utilisent donc de vrais UUID
// plutôt que des lettres, faute de quoi le décodage échoue avec VALIDATION_ECHOUEE avant même
// d'atteindre l'assertion visée par ces tests.
const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';
const ID_C = '33333333-3333-4333-8333-333333333333';
const ID_D = '44444444-4444-4444-8444-444444444444';

interface LigneTest extends LigneAvecCreation {
  readonly id: string;
  readonly creeLeTexte: string;
}

function ligne(id: string, creeLeTexte: string): LigneTest {
  return { id, creeLeTexte };
}

describe('pageDepuisLignes', () => {
  it('moins de lignes que la limite : pas de suite, curseurSuivant null', () => {
    const lignes = [
      ligne(ID_A, '2026-01-01 00:00:00.000000+00'),
      ligne(ID_B, '2026-01-02 00:00:00.000000+00'),
    ];
    const { page, curseurSuivant } = pageDepuisLignes(lignes, 5);
    expect(page).toHaveLength(2);
    expect(curseurSuivant).toBeNull();
  });

  it('exactement limite + 1 lignes : tronque à la limite et rend un curseur', () => {
    const lignes = [
      ligne(ID_A, '2026-01-03 00:00:00.000000+00'),
      ligne(ID_B, '2026-01-02 00:00:00.000000+00'),
      ligne(ID_C, '2026-01-01 00:00:00.000000+00'),
    ];
    const { page, curseurSuivant } = pageDepuisLignes(lignes, 2);
    expect(page.map((l) => l.id)).toEqual([ID_A, ID_B]);
    expect(curseurSuivant).not.toBeNull();
  });

  it('le curseur rendu se décode vers la clé du dernier élément de la page, microseconde comprise', () => {
    // `.171181`, pas `.171` : si l'encodage ou le décodage transitait par un `Date` JS
    // (résolution milliseconde), cette valeur serait tronquée à `.171000` et cette assertion
    // échouerait — c'est précisément le défaut que ce test verrouille.
    const lignes = [
      ligne(ID_A, '2026-01-03 00:00:00.171181+00'),
      ligne(ID_B, '2026-01-02 00:00:00.000000+00'),
    ];
    const { curseurSuivant } = pageDepuisLignes(lignes, 1);
    expect(curseurSuivant).not.toBeNull();
    const decode = decoderCurseurDefaut(curseurSuivant ?? undefined);
    expect(decode?.id).toBe(ID_A);
    expect(decode?.creeLeTexte).toBe('2026-01-03T00:00:00.171181+00:00');
  });
});

describe('decoderCurseurDefaut', () => {
  it('undefined -> null (première page)', () => {
    expect(decoderCurseurDefaut(undefined)).toBeNull();
  });

  it('curseur illisible -> VALIDATION_ECHOUEE', () => {
    expect(() => decoderCurseurDefaut('!!!pas-base64url-json!!!')).toThrow(
      expect.objectContaining({ code: 'VALIDATION_ECHOUEE' }),
    );
  });
});

// -------------------------------------------------------------------------------------------
// Régression : perte silencieuse de lignes en pagination keyset sur `creeLe`, quand plusieurs
// lignes partagent la même MILLISECONDE mais pas la même MICROSECONDE. Constat identique à celui
// documenté dans common/pagination/valeur-temporelle.spec.ts, reproduit ici au niveau de
// `pagination-defaut.ts` — qui est le point d'assemblage réellement appelé par
// `ServiceTauxHoraires.lister()` et `ServicePrestations.lister()` (parametrage/referentiels/) —
// car la consigne de ce correctif est explicite : la perte a lieu À L'ENCODAGE ET AU DÉCODAGE du
// curseur, les deux devaient être corrigés ensemble, pas seulement l'un des deux.
//
// Oracle de test : microsecondes exactes depuis l'epoch, calculées SANS jamais passer par `Date`
// pour la partie fractionnaire.
// -------------------------------------------------------------------------------------------
const FORMAT_TEST =
  /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}(?::?\d{2})?)$/;

function decalageIsoComplet(brut: string): string {
  if (brut === 'Z') return 'Z';
  const signe = brut[0];
  const chiffres = brut.slice(1).replace(':', '');
  const heures = chiffres.slice(0, 2);
  const minutes = chiffres.length > 2 ? chiffres.slice(2, 4) : '00';
  return `${signe}${heures}:${minutes}`;
}

function microsecondesExactes(brut: string): bigint {
  const trouve = FORMAT_TEST.exec(brut);
  if (!trouve) throw new Error(`microsecondesExactes (aide de test) : format inattendu "${brut}"`);
  const [, date, heure, fraction, decalage] = trouve;
  const epochSecondeMs = Date.parse(`${date}T${heure}${decalageIsoComplet(decalage!)}`);
  if (Number.isNaN(epochSecondeMs)) {
    throw new Error(`microsecondesExactes (aide de test) : Date.parse a échoué sur "${brut}"`);
  }
  const fractionMicros = BigInt((fraction ?? '').padEnd(6, '0'));
  return BigInt(epochSecondeMs) * 1000n + fractionMicros;
}

/** 4 lignes qui partagent EXACTEMENT la même milliseconde (13:37:35.171) mais des microsecondes
 *  distinctes — reproduit le motif du seed de démonstration (`docs`/constat du 2026-07-29). */
const QUATRE_LIGNES_MEME_MILLISECONDE: readonly LigneTest[] = [
  ligne(ID_A, '2026-07-29 13:37:35.171050+00'),
  ligne(ID_B, '2026-07-29 13:37:35.171100+00'),
  ligne(ID_C, '2026-07-29 13:37:35.171150+00'),
  ligne(ID_D, '2026-07-29 13:37:35.171181+00'),
];

describe("régression pagination — ancienne méthode (Date.toISOString() à l'encodage, new Date() au décodage) : caractérisation autonome du bug", () => {
  // Reproduit fidèlement, en autonomie (sans dépendre de l'état courant de `pagination-defaut.ts`),
  // la paire encodage/décodage fautive qui existait avant ce correctif : `dernier.creeLe.toISOString()`
  // pour construire la valeur du curseur, `new Date(donnees.valeur)` pour la relire. Comme dans
  // common/pagination/valeur-temporelle.spec.ts, ce bloc documente que le défaut est réel et
  // général, indépendamment du fichier corrigé — il doit rester vrai même après le correctif.
  // Comme dans valeur-temporelle.spec.ts : le membre GAUCHE de la comparaison garde la précision
  // RÉELLE (c'est ce qu'une vraie colonne `timestamptz` compare, toujours à pleine précision) —
  // seul le SEUIL (membre droit, issu du curseur) est tronqué par le passage fautif via `Date`.
  // Tronquer symétriquement les DEUX membres annulerait le défaut (le départage par `id` suffirait
  // alors toujours) : ce serait mesurer autre chose que le bug réel.
  function pageSuivanteAncienneMethode(
    lignesTrieesDesc: readonly LigneTest[],
    curseur: { readonly micros: bigint; readonly id: string } | null,
    limite: number,
  ): readonly LigneTest[] {
    const admissibles = lignesTrieesDesc.filter((l) => {
      if (!curseur) return true;
      const micros = microsecondesExactes(l.creeLeTexte);
      if (micros !== curseur.micros) return micros < curseur.micros;
      return l.id < curseur.id;
    });
    return admissibles.slice(0, limite);
  }

  function paginerAncienneMethode(
    lignes: readonly LigneTest[],
    limite: number,
  ): readonly LigneTest[] {
    const triees = [...lignes].sort((a, b) => {
      const d = microsecondesExactes(b.creeLeTexte) - microsecondesExactes(a.creeLeTexte);
      if (d !== 0n) return d < 0n ? -1 : 1;
      return b.id.localeCompare(a.id);
    });

    const rendues: LigneTest[] = [];
    let curseur: { readonly micros: bigint; readonly id: string } | null = null;
    for (let page = 0; page < 100; page += 1) {
      const suite = pageSuivanteAncienneMethode(triees, curseur, limite);
      if (suite.length === 0) break;
      rendues.push(...suite);
      const derniere = suite[suite.length - 1]!;
      // Encodage fautif : `new Date(brut).toISOString()` tronque toute microseconde non nulle.
      const valeurTronquee = new Date(derniere.creeLeTexte).toISOString();
      curseur = { micros: microsecondesExactes(valeurTronquee), id: derniere.id };
    }
    return rendues;
  }

  it("la page 2 revient vide alors qu'il reste des lignes à rendre (limite=1)", () => {
    const rendues = paginerAncienneMethode(QUATRE_LIGNES_MEME_MILLISECONDE, 1);
    // C'est le symptôme mesuré en conditions réelles (`GET /vehicules?...`) : la pagination
    // s'arrête avant d'avoir tout rendu, silencieusement — le seuil tronqué (`.171000`) est
    // inférieur aux trois valeurs réelles restantes (`.171050`/`.171100`/`.171150`), qui sont
    // donc toutes exclues à tort par `micros < curseur.micros`.
    expect(rendues.length).toBeLessThan(QUATRE_LIGNES_MEME_MILLISECONDE.length);
  });
});

describe('régression pagination — nouvelle méthode (pageDepuisLignes + decoderCurseurDefaut réels) : aucune ligne perdue', () => {
  /**
   * Pagine intégralement via les VRAIES fonctions de production (`decoderCurseurDefaut`,
   * `pageDepuisLignes`) exactement comme le font `ServiceTauxHoraires.lister()` et
   * `ServicePrestations.lister()` : construit le lot `limite + 1` attendu par le prédicat SQL
   * keyset simulé, encode/décode le curseur en base64url à chaque tour — le chemin complet, pas
   * une fonction isolée.
   */
  function paginerIntegralement(
    lignes: readonly LigneTest[],
    limite: number,
  ): readonly LigneTest[] {
    const triees = [...lignes].sort((a, b) => {
      const d = microsecondesExactes(b.creeLeTexte) - microsecondesExactes(a.creeLeTexte);
      if (d !== 0n) return d < 0n ? -1 : 1;
      return b.id.localeCompare(a.id);
    });

    const rendues: LigneTest[] = [];
    let curseurEncode: string | undefined;
    for (let page = 0; page < 100; page += 1) {
      const curseurDecode = decoderCurseurDefaut(curseurEncode);
      const seuil = curseurDecode
        ? { micros: microsecondesExactes(curseurDecode.creeLeTexte), id: curseurDecode.id }
        : null;
      const admissibles = triees.filter((l) => {
        if (!seuil) return true;
        const micros = microsecondesExactes(l.creeLeTexte);
        if (micros !== seuil.micros) return micros < seuil.micros;
        return l.id < seuil.id;
      });
      const lot = admissibles.slice(0, limite + 1);
      if (lot.length === 0) break;
      const { page: pageRendue, curseurSuivant } = pageDepuisLignes(lot, limite);
      rendues.push(...pageRendue);
      if (!curseurSuivant) break;
      curseurEncode = curseurSuivant;
    }
    return rendues;
  }

  it('rend les 4 lignes qui partagent la même milliseconde, sans perte ni doublon, une par une (limite=1)', () => {
    const rendues = paginerIntegralement(QUATRE_LIGNES_MEME_MILLISECONDE, 1);
    expect(rendues.map((l) => l.id)).toEqual([ID_D, ID_C, ID_B, ID_A]);
    expect(new Set(rendues.map((l) => l.id)).size).toBe(QUATRE_LIGNES_MEME_MILLISECONDE.length);
  });

  it('cas le plus sévère : 4 lignes de microseconde strictement identique (comme le seed de démonstration)', () => {
    const microsecondeIdentique: readonly LigneTest[] = [
      ligne(ID_A, '2026-07-29 13:37:35.171181+00'),
      ligne(ID_B, '2026-07-29 13:37:35.171181+00'),
      ligne(ID_C, '2026-07-29 13:37:35.171181+00'),
      ligne(ID_D, '2026-07-29 13:37:35.171181+00'),
    ];
    const rendues = paginerIntegralement(microsecondeIdentique, 2);
    expect(rendues).toHaveLength(4);
    expect(new Set(rendues.map((l) => l.id)).size).toBe(4);
  });

  it('ne régresse pas le cas nominal : des lignes à millisecondes différentes restent paginées correctement', () => {
    const lignes: readonly LigneTest[] = [
      ligne(ID_A, '2026-07-29 10:00:00.000000+00'),
      ligne(ID_B, '2026-07-29 11:00:00.500000+00'),
      ligne(ID_C, '2026-07-29 12:00:00.999999+00'),
    ];
    const rendues = paginerIntegralement(lignes, 1);
    expect(rendues.map((l) => l.id)).toEqual([ID_C, ID_B, ID_A]);
  });
});
