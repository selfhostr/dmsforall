/**
 * Régression : perte silencieuse de lignes en pagination keyset sur une colonne `timestamptz`,
 * quand plusieurs lignes partagent la même MILLISECONDE mais pas la même MICROSECONDE.
 *
 * Constat mesuré le 2026-07-29 sur le jeu de démonstration (`GET /vehicules?tri=creeLe:desc`,
 * `limite=2`) : la page 2 revenait vide alors que 2 véhicules restaient à afficher. Les 4
 * véhicules du seed partagent exactement `2026-07-29 13:37:35.171181+00` (vérifié en base :
 * `select v.cree_le::text from public.vehicule v` rend la même valeur 4 fois) — un cas encore
 * plus sévère que « même milliseconde » puisque même microseconde, mais la cause profonde est
 * générale et frappe tout lot de lignes qui partagent seulement la même milliseconde.
 *
 * Cause : `PostgreSQL` conserve `timestamptz` à la microseconde ; `Date` de JavaScript ne peut
 * représenter que la milliseconde depuis l'epoch (limite structurelle du type, pas un détail
 * d'implémentation). L'ancien code de construction de la valeur de curseur faisait
 * `enDate(brut).toISOString()` — un aller-retour par `Date` qui tronque silencieusement toute
 * microseconde non nulle. La comparaison keyset `(cree_le, id) < (curseur.valeur, curseur.id)`
 * compare alors une valeur RÉELLE à pleine précision à une valeur de seuil TRONQUÉE : toute ligne
 * dont la microseconde réelle dépasse la valeur tronquée est exclue à tort, quel que soit `id`.
 *
 * `valeurCurseurTimestamptz` (implémentée dans `./valeur-temporelle.ts`, périmètre de ce correctif)
 * remplace cet aller-retour par `Date` par une validation + reformatage qui reste du texte de bout
 * en bout — aucune microseconde n'est jamais arrondie.
 *
 * Les deux blocs ci-dessous DOIVENT tous les deux exister dans ce fichier :
 *  - « ancienne méthode » caractérise le bug de façon autonome (aucune dépendance à cette
 *    fonction) : il documente que `enDate(...).toISOString()` perd des lignes, point qui reste
 *    vrai indépendamment de ce correctif.
 *  - « nouvelle méthode » importe `valeurCurseurTimestamptz` et prouve la pagination complète sans
 *    perte. AVANT que `./valeur-temporelle.ts` n'existe, ce fichier échoue à la compilation/import
 *    (module introuvable) — c'est le rouge exigé avant le correctif. Après création du fichier
 *    source, ce bloc doit passer au vert.
 */

import { describe, expect, it } from 'vitest';
import { valeurCurseurTimestamptz } from './valeur-temporelle';

// -------------------------------------------------------------------------------------------
// Oracle de test : microsecondes exactes depuis l'epoch, calculées SANS jamais passer par `Date`
// pour la partie fractionnaire (seule la partie « seconde entière » passe par `Date.parse`, ce
// qui est sans perte : aucune fraction n'est en jeu à cet instant du calcul).
// -------------------------------------------------------------------------------------------
const FORMAT_TEST = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}(?::?\d{2})?)$/;

/** `Date.parse` exige un décalage ISO complet ("+00:00" ou "Z") — "+00" seul n'est pas reconnu. */
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

/** Reproduit EXACTEMENT l'ancien code fautif (`enDate(x).toISOString()` de service-vehicule.ts). */
function valeurCurseurAncienneMethode(brut: string): string {
  return new Date(brut).toISOString();
}

interface LigneTest {
  readonly brut: string; // texte natif PostgreSQL, ex. "2026-07-29 13:37:35.171181+00"
  readonly id: string;
}

/**
 * Réplique la prédicat SQL réel de `construireTriEtSeuil` (vehicules/service-vehicule.ts) :
 * `(v.cree_le, v.id) < (curseur.valeur::timestamptz, curseur.id)`, tri `cree_le desc, id desc`.
 * Les lignes sont comparées à leur précision RÉELLE (oracle), jamais à une valeur arrondie —
 * exactement ce que fait PostgreSQL, qui ne perd jamais la microseconde d'une colonne stockée.
 */
function pageSuivante(
  lignesTrieesDesc: readonly LigneTest[],
  curseur: { readonly micros: bigint; readonly id: string } | null,
  limite: number,
): readonly LigneTest[] {
  const admissibles = lignesTrieesDesc.filter((ligne) => {
    if (!curseur) return true;
    const micros = microsecondesExactes(ligne.brut);
    if (micros !== curseur.micros) return micros < curseur.micros;
    return ligne.id < curseur.id;
  });
  return admissibles.slice(0, limite);
}

/** Pagine intégralement `lignes` avec `limite`, en dérivant le curseur suivant via `versValeur`. */
function paginerIntegralement(
  lignes: readonly LigneTest[],
  limite: number,
  versValeur: (brut: string) => string,
): readonly LigneTest[] {
  const lignesTrieesDesc = [...lignes].sort((a, b) => {
    const micros = microsecondesExactes(b.brut) - microsecondesExactes(a.brut);
    if (micros !== 0n) return micros < 0n ? -1 : 1;
    return b.id.localeCompare(a.id);
  });

  const rendues: LigneTest[] = [];
  let curseur: { readonly micros: bigint; readonly id: string } | null = null;
  // Garde-fou anti-boucle infinie : ne doit jamais s'approcher de ce nombre de pages ici.
  for (let page = 0; page < 100; page += 1) {
    const suite = pageSuivante(lignesTrieesDesc, curseur, limite);
    if (suite.length === 0) break;
    rendues.push(...suite);
    const derniere = suite[suite.length - 1]!;
    curseur = { micros: microsecondesExactes(versValeur(derniere.brut)), id: derniere.id };
  }
  return rendues;
}

// -------------------------------------------------------------------------------------------
// Jeu de données : 4 lignes qui partagent EXACTEMENT la même milliseconde (13:37:35.171) mais
// des microsecondes distinctes — le cas général visé par la consigne. Un cas encore plus sévère
// (microseconde identique, comme le seed de démonstration) est couvert séparément plus bas.
// -------------------------------------------------------------------------------------------
const QUATRE_LIGNES_MEME_MILLISECONDE: readonly LigneTest[] = [
  { brut: '2026-07-29 13:37:35.171050+00', id: '11111111-1111-4111-8111-111111111111' },
  { brut: '2026-07-29 13:37:35.171100+00', id: '22222222-2222-4222-8222-222222222222' },
  { brut: '2026-07-29 13:37:35.171150+00', id: '33333333-3333-4333-8333-333333333333' },
  { brut: '2026-07-29 13:37:35.171181+00', id: '44444444-4444-4444-8444-444444444444' },
];

describe('régression pagination — ancienne méthode (enDate().toISOString()) : caractérisation autonome du bug', () => {
  it('perd des lignes quand plusieurs partagent la même milliseconde (limite=2)', () => {
    const rendues = paginerIntegralement(QUATRE_LIGNES_MEME_MILLISECONDE, 2, valeurCurseurAncienneMethode);
    // C'est EXACTEMENT le symptôme mesuré en conditions réelles : la pagination s'arrête avant
    // d'avoir tout rendu, silencieusement (aucune erreur, curseur simplement épuisé trop tôt).
    expect(rendues.length).toBeLessThan(QUATRE_LIGNES_MEME_MILLISECONDE.length);
  });

  it('avec 4 lignes de microseconde IDENTIQUE (cas du seed de démonstration), la page 2 est totalement vide', () => {
    const microsecondeIdentique: readonly LigneTest[] = [
      { brut: '2026-07-29 13:37:35.171181+00', id: '98a24605-6c07-4f8c-8fad-20a75e1abb52' },
      { brut: '2026-07-29 13:37:35.171181+00', id: '4d0af285-370f-45f3-969c-b1a28e2c40e8' },
      { brut: '2026-07-29 13:37:35.171181+00', id: '33ecfe63-13a6-4d23-9b8f-408903521579' },
      { brut: '2026-07-29 13:37:35.171181+00', id: '2c6227e3-415d-4972-9718-6b45e263f10f' },
    ];
    const lignesTrieesDesc = [...microsecondeIdentique].sort((a, b) => b.id.localeCompare(a.id));
    const page1 = pageSuivante(lignesTrieesDesc, null, 2);
    const derniere = page1[page1.length - 1]!;
    const curseur = {
      micros: microsecondesExactes(valeurCurseurAncienneMethode(derniere.brut)),
      id: derniere.id,
    };
    const page2 = pageSuivante(lignesTrieesDesc, curseur, 2);
    expect(page1).toHaveLength(2);
    expect(page2).toHaveLength(0); // reproduit precisément : "page 2 revient vide" (constat initial)
  });
});

describe('valeurCurseurTimestamptz — validation et canonicalisation', () => {
  it('conserve les 6 chiffres de microseconde tels quels', () => {
    expect(valeurCurseurTimestamptz('2026-07-29 13:37:35.171181+00')).toBe('2026-07-29T13:37:35.171181+00:00');
  });

  it('complète à droite une fraction plus courte que 6 chiffres (troncature d\'affichage PostgreSQL des zéros de fin)', () => {
    expect(valeurCurseurTimestamptz('2026-07-29 13:37:35.1+00')).toBe('2026-07-29T13:37:35.100000+00:00');
    expect(valeurCurseurTimestamptz('2026-07-29 13:37:35.000001+00')).toBe('2026-07-29T13:37:35.000001+00:00');
  });

  it('ajoute une fraction nulle quand PostgreSQL omet totalement la partie fractionnaire', () => {
    expect(valeurCurseurTimestamptz('2026-07-29 13:37:35+00')).toBe('2026-07-29T13:37:35.000000+00:00');
  });

  it('normalise un décalage à deux chiffres ("+00") en forme complète ("+00:00")', () => {
    expect(valeurCurseurTimestamptz('2026-01-01 00:00:00-05')).toBe('2026-01-01T00:00:00.000000-05:00');
  });

  it('accepte un décalage déjà complet ("+05:30")', () => {
    expect(valeurCurseurTimestamptz('2026-01-01 00:00:00.5+05:30')).toBe('2026-01-01T00:00:00.500000+05:30');
  });

  it('accepte "Z" en équivalent de "+00:00"', () => {
    expect(valeurCurseurTimestamptz('2026-01-01T00:00:00.171181Z')).toBe('2026-01-01T00:00:00.171181+00:00');
  });

  it('rejette une valeur qui n\'est pas une chaîne (ex. un Date déjà tronqué) avec un message explicite', () => {
    // @ts-expect-error -- le point même du test : un appelant qui passerait un Date par erreur.
    expect(() => valeurCurseurTimestamptz(new Date())).toThrow(/Date/);
  });

  it('rejette une chaîne qui ne respecte pas le format attendu', () => {
    expect(() => valeurCurseurTimestamptz('pas-une-date')).toThrow();
    expect(() => valeurCurseurTimestamptz('')).toThrow();
    expect(() => valeurCurseurTimestamptz('2026-07-29')).toThrow(); // sans partie heure
  });

  it('lève une Error simple, PAS une ErreurMetier : ceci est un problème serveur (données/pilote), jamais une entrée cliente', () => {
    let erreurCapturee: unknown;
    try {
      valeurCurseurTimestamptz('pas-une-date');
    } catch (erreur) {
      erreurCapturee = erreur;
    }
    expect(erreurCapturee).toBeInstanceOf(Error);
    expect((erreurCapturee as { code?: unknown }).code).toBeUndefined();
  });
});

describe('régression pagination — nouvelle méthode (valeurCurseurTimestamptz) : aucune ligne perdue', () => {
  it('rend les 4 lignes qui partagent la même milliseconde, sans perte ni doublon, en suivant le curseur jusqu\'au bout (limite=2)', () => {
    const rendues = paginerIntegralement(QUATRE_LIGNES_MEME_MILLISECONDE, 2, valeurCurseurTimestamptz);
    expect(rendues).toHaveLength(QUATRE_LIGNES_MEME_MILLISECONDE.length);
    expect(new Set(rendues.map((l) => l.id)).size).toBe(QUATRE_LIGNES_MEME_MILLISECONDE.length);
  });

  it('cas le plus sévère (4 lignes de microseconde strictement identique, comme le seed de démonstration) : les 4 sont rendues', () => {
    const microsecondeIdentique: readonly LigneTest[] = [
      { brut: '2026-07-29 13:37:35.171181+00', id: '98a24605-6c07-4f8c-8fad-20a75e1abb52' },
      { brut: '2026-07-29 13:37:35.171181+00', id: '4d0af285-370f-45f3-969c-b1a28e2c40e8' },
      { brut: '2026-07-29 13:37:35.171181+00', id: '33ecfe63-13a6-4d23-9b8f-408903521579' },
      { brut: '2026-07-29 13:37:35.171181+00', id: '2c6227e3-415d-4972-9718-6b45e263f10f' },
    ];
    const rendues = paginerIntegralement(microsecondeIdentique, 2, valeurCurseurTimestamptz);
    expect(rendues).toHaveLength(4);
    expect(new Set(rendues.map((l) => l.id)).size).toBe(4);
  });

  it('fonctionne aussi avec une limite de 1 (le cas le plus exigeant pour un curseur qui avance d\'une ligne à la fois)', () => {
    const rendues = paginerIntegralement(QUATRE_LIGNES_MEME_MILLISECONDE, 1, valeurCurseurTimestamptz);
    expect(rendues).toHaveLength(QUATRE_LIGNES_MEME_MILLISECONDE.length);
  });

  it('ne régresse pas le cas nominal : des lignes à millisecondes DIFFÉRENTES restent paginées correctement', () => {
    const lignes: readonly LigneTest[] = [
      { brut: '2026-07-29 10:00:00.000000+00', id: '11111111-1111-4111-8111-111111111111' },
      { brut: '2026-07-29 11:00:00.500000+00', id: '22222222-2222-4222-8222-222222222222' },
      { brut: '2026-07-29 12:00:00.999999+00', id: '33333333-3333-4333-8333-333333333333' },
    ];
    const rendues = paginerIntegralement(lignes, 1, valeurCurseurTimestamptz);
    expect(rendues.map((l) => l.id)).toEqual([
      '33333333-3333-4333-8333-333333333333',
      '22222222-2222-4222-8222-222222222222',
      '11111111-1111-4111-8111-111111111111',
    ]);
  });
});
