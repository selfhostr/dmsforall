/**
 * Preuve, SANS Postgres, que la formule SQL de
 * `0069_correction_arrondi_negatif_ligne_or.sql` (fonction PL/pgSQL
 * `dfa_0069_recalculer_ligne_or`, elle-même bâtie sur `dfa_0069_arrondi_commercial`) N'EST PAS
 * une réinvention divergente du pipeline réel de `CalculLigneSimple.calculer`
 * (`atelier/calcul-ligne.ts`) et de `arrondiCommercial`/`foisArrondiCommercial` (`@dfa/shared`,
 * MD-40).
 *
 * Deux implémentations INDÉPENDANTES du même calcul, comparées ici :
 *   - `arrondiCommercialSql`/`recalculerLigneOrSql` ci-dessous : transcription LITTÉRALE, en
 *     TypeScript bigint, du texte SQL de la migration — n'appelle JAMAIS `@dfa/shared` ;
 *   - `calculerAttenduDepuisSharedPipeline` : reconstruit le MÊME pipeline (brut -> rabais ->
 *     arrondi -> TVA -> arrondi) en appelant RÉELLEMENT `arrondiCommercial`/
 *     `foisArrondiCommercial` importés de `@dfa/shared` — c'est la référence.
 *
 * Si les deux s'accordent sur tous les cas ci-dessous (notamment les deux cas négatifs du plan de
 * cette tâche), la formule SQL est fidèle au pipeline réel — sans dépendre de Postgres pour ce
 * point précis (la preuve QUE la migration applique correctement cette formule EN BASE, elle,
 * reste `migrations-0069-correction-arrondi-ligne-or.spec.ts`, test d'intégration Docker).
 *
 * Placé sous `test/integration/` : le projet vitest "unitaire" (`pnpm test`) exclut tout
 * `test/**` (voir `apps/api/vitest.config.ts`, hors périmètre d'écriture de cette tâche) — seul
 * le projet "integration" collecte `test/integration/**`. Ce fichier ne se connecte à AUCUNE
 * base : il tourne en quelques millisecondes, mais n'est exécuté que par
 * `pnpm test:integration` faute d'un emplacement `test/**` couvert par le projet "unitaire" —
 * signalé au rapport de tâche, pas un défaut de ce fichier.
 */

import { describe, expect, it } from 'vitest';
import { arrondiCommercial, foisArrondiCommercial } from '@dfa/shared';

// -------------------------------------------------------------------------------------------
// 1. Transcription LITTÉRALE de la formule SQL (voir 0069_correction_arrondi_negatif_ligne_or.sql
//    §"2. Fonctions JETABLES") — n'importe RIEN de @dfa/shared.
// -------------------------------------------------------------------------------------------

/** Réplique de `public.dfa_0069_arrondi_commercial(num bigint, den bigint)`. */
function arrondiCommercialSql(num: bigint, den: bigint): bigint {
  if (den <= 0n) {
    throw new Error('arrondiCommercialSql : dénominateur non strictement positif.');
  }
  return num >= 0n ? (num + den / 2n) / den : -((-num + den / 2n) / den);
}

type TypeLigneOr =
  | 'main_oeuvre_bareme'
  | 'main_oeuvre_temps_reel'
  | 'forfait'
  | 'piece'
  | 'fourniture'
  | 'sous_traitance'
  | 'produit_atelier'
  | 'taxe'
  | 'remise'
  | 'texte';

type PayeurLigneOr = 'client' | 'constructeur' | 'assurance' | 'tiers' | 'garage';

interface EntreeLigneOrSql {
  readonly type: TypeLigneOr;
  readonly payeur: PayeurLigneOr;
  readonly tempsBaremeCentiemes: number | null;
  readonly tauxHoraireCentimes: number | null;
  readonly prixUnitaireCentimes: number | null;
  readonly quantiteMillieme: number | null;
  readonly rabaisPourmille: number | null;
  readonly tauxTvaPourmille: number;
}

interface MontantsLigneOrSql {
  readonly htCentimes: number;
  readonly tvaCentimes: number;
  readonly ttcCentimes: number;
}

/** Réplique de `public.dfa_0069_recalculer_ligne_or(...)`. */
function recalculerLigneOrSql(e: EntreeLigneOrSql): MontantsLigneOrSql {
  if (e.payeur === 'garage') {
    return { htCentimes: 0, tvaCentimes: 0, ttcCentimes: 0 };
  }

  const mainOeuvre = e.type === 'main_oeuvre_bareme' || e.type === 'main_oeuvre_temps_reel';

  const brut = mainOeuvre
    ? arrondiCommercialSql(
        BigInt(e.tempsBaremeCentiemes ?? 0) * BigInt(e.tauxHoraireCentimes ?? 0),
        100n,
      )
    : arrondiCommercialSql(
        BigInt(e.prixUnitaireCentimes ?? 0) * BigInt(e.quantiteMillieme ?? 1000),
        1000n,
      );

  const htCentimes = Number(
    arrondiCommercialSql(brut * BigInt(1000 - (e.rabaisPourmille ?? 0)), 1000n),
  );
  const tvaCentimes = Number(
    arrondiCommercialSql(BigInt(htCentimes) * BigInt(e.tauxTvaPourmille), 1000n),
  );
  return { htCentimes, tvaCentimes, ttcCentimes: htCentimes + tvaCentimes };
}

// -------------------------------------------------------------------------------------------
// 2. Référence : MÊME pipeline, mais construit en appelant RÉELLEMENT `@dfa/shared`
//    (`arrondiCommercial`/`foisArrondiCommercial`) — c'est ce que `CalculLigneSimple.calculer`
//    (`atelier/calcul-ligne.ts`) fait déjà en production, depuis `fix/arrondi-unique` (2358f2e).
// -------------------------------------------------------------------------------------------

function calculerAttenduDepuisSharedPipeline(e: EntreeLigneOrSql): MontantsLigneOrSql {
  if (e.payeur === 'garage') {
    return { htCentimes: 0, tvaCentimes: 0, ttcCentimes: 0 };
  }

  const mainOeuvre = e.type === 'main_oeuvre_bareme' || e.type === 'main_oeuvre_temps_reel';

  const brut = mainOeuvre
    ? foisArrondiCommercial(e.tempsBaremeCentiemes ?? 0, e.tauxHoraireCentimes ?? 0, 100)
    : foisArrondiCommercial(e.prixUnitaireCentimes ?? 0, e.quantiteMillieme ?? 1000, 1000);

  const htCentimes = foisArrondiCommercial(brut, 1000 - (e.rabaisPourmille ?? 0), 1000);
  const tvaCentimes = foisArrondiCommercial(htCentimes, e.tauxTvaPourmille, 1000);
  return { htCentimes, tvaCentimes, ttcCentimes: htCentimes + tvaCentimes };
}

// -------------------------------------------------------------------------------------------
// 3. Cas — les deux négatifs sont LITTÉRALEMENT ceux du plan de cette tâche.
// -------------------------------------------------------------------------------------------

const CAS: ReadonlyArray<{ readonly nom: string; readonly entree: EntreeLigneOrSql }> = [
  {
    nom: "remise -500 c. @ 8.1 % (brief : tva -41 aujourd'hui, -40 avant fix/arrondi-unique)",
    entree: {
      type: 'remise',
      payeur: 'client',
      tempsBaremeCentiemes: null,
      tauxHoraireCentimes: null,
      prixUnitaireCentimes: -500,
      quantiteMillieme: 1000,
      rabaisPourmille: 0,
      tauxTvaPourmille: 81,
    },
  },
  {
    nom: 'remise -250 c. @ 2.6 % (arrondi-commercial.spec.ts : arrondiCommercial(-6500n,1000n) -> -7n)',
    entree: {
      type: 'remise',
      payeur: 'client',
      tempsBaremeCentiemes: null,
      tauxHoraireCentimes: null,
      prixUnitaireCentimes: -250,
      quantiteMillieme: 1000,
      rabaisPourmille: 0,
      tauxTvaPourmille: 26,
    },
  },
  {
    nom: 'forfait positif 10000 c. @ 8.1 % — division exacte, identique sous les deux anciennes/nouvelles règles',
    entree: {
      type: 'forfait',
      payeur: 'client',
      tempsBaremeCentiemes: null,
      tauxHoraireCentimes: null,
      prixUnitaireCentimes: 10000,
      quantiteMillieme: 1000,
      rabaisPourmille: 0,
      tauxTvaPourmille: 81,
    },
  },
  {
    nom: 'payeur = garage : spécial-casé 0/0/0 quelles que soient les colonnes sources (RM-70)',
    entree: {
      type: 'piece',
      payeur: 'garage',
      tempsBaremeCentiemes: null,
      tauxHoraireCentimes: null,
      prixUnitaireCentimes: -999,
      quantiteMillieme: 1000,
      rabaisPourmille: 500,
      tauxTvaPourmille: 81,
    },
  },
  {
    nom: "main d'œuvre bareme (temps_bareme_centiemes * taux_horaire_centimes / 100)",
    entree: {
      type: 'main_oeuvre_bareme',
      payeur: 'client',
      tempsBaremeCentiemes: 150,
      tauxHoraireCentimes: 9500,
      prixUnitaireCentimes: null,
      quantiteMillieme: null,
      rabaisPourmille: 0,
      tauxTvaPourmille: 81,
    },
  },
  {
    nom: "rabais non nul (338 c. @ 8.1 %, rabais 10.5 %) — teste l'arrondi intermédiaire brut -> ht",
    entree: {
      type: 'piece',
      payeur: 'client',
      tempsBaremeCentiemes: null,
      tauxHoraireCentimes: null,
      prixUnitaireCentimes: 338,
      quantiteMillieme: 1000,
      rabaisPourmille: 105,
      tauxTvaPourmille: 81,
    },
  },
  {
    nom: 'taux réduit hébergement 3.8 % sur un montant négatif',
    entree: {
      type: 'remise',
      payeur: 'client',
      tempsBaremeCentiemes: null,
      tauxHoraireCentimes: null,
      prixUnitaireCentimes: -150,
      quantiteMillieme: 1000,
      rabaisPourmille: 0,
      tauxTvaPourmille: 38,
    },
  },
];

describe('0069 — formule SQL vs pipeline réel @dfa/shared (sans Postgres)', () => {
  it.each(CAS)('$nom', ({ entree }) => {
    const attendu = calculerAttenduDepuisSharedPipeline(entree);
    const obtenu = recalculerLigneOrSql(entree);
    expect(obtenu).toEqual(attendu);
  });

  // Valeurs exactes en dur (pas seulement une égalité entre les deux implémentations) — la
  // consigne « l'arithmétique se prouve, elle ne se relit pas » exige un chiffre attendu écrit
  // AVANT le calcul, pas seulement une comparaison croisée qui pourrait masquer une erreur
  // partagée par les deux implémentations.
  it('valeurs exactes : remise -500 c. @ 8.1 % -> ht=-500 tva=-41 ttc=-541', () => {
    expect(
      recalculerLigneOrSql({
        type: 'remise',
        payeur: 'client',
        tempsBaremeCentiemes: null,
        tauxHoraireCentimes: null,
        prixUnitaireCentimes: -500,
        quantiteMillieme: 1000,
        rabaisPourmille: 0,
        tauxTvaPourmille: 81,
      }),
    ).toEqual({ htCentimes: -500, tvaCentimes: -41, ttcCentimes: -541 });
  });

  it('valeurs exactes : remise -250 c. @ 2.6 % -> ht=-250 tva=-7 ttc=-257', () => {
    expect(
      recalculerLigneOrSql({
        type: 'remise',
        payeur: 'client',
        tempsBaremeCentiemes: null,
        tauxHoraireCentimes: null,
        prixUnitaireCentimes: -250,
        quantiteMillieme: 1000,
        rabaisPourmille: 0,
        tauxTvaPourmille: 26,
      }),
    ).toEqual({ htCentimes: -250, tvaCentimes: -7, ttcCentimes: -257 });
  });

  it("arrondiCommercialSql lève si le dénominateur n'est pas strictement positif (miroir du garde-fou SQL)", () => {
    expect(() => arrondiCommercialSql(10n, 0n)).toThrow();
    expect(() => arrondiCommercialSql(10n, -1n)).toThrow();
  });

  // Comparaison bas niveau, bigint à bigint, directement contre `arrondiCommercial` (pas
  // seulement via le pipeline complet ci-dessus) — inclut les deux cas emblématiques de
  // `arrondi-commercial.spec.ts` (`-5n/2n -> -3n`, `-6500n/1000n -> -7n`).
  it.each([
    [10n, 3n],
    [11n, 3n],
    [5n, 2n],
    [-5n, 2n],
    [-6500n, 1000n],
    [6500n, 1000n],
    [-40500n, 1000n],
    [-6200n, 1000n],
  ])('arrondiCommercialSql(%s, %s) === arrondiCommercial(%s, %s)', (num, den) => {
    expect(arrondiCommercialSql(num, den)).toBe(arrondiCommercial(num, den));
  });
});
