import { describe, expect, it } from 'vitest';

import {
  analyserHsl,
  ratioContraste,
  SEUIL_AA_COMPOSANT_UI,
  SEUIL_AA_TEXTE_NORMAL,
} from './contraste';
import { type Theme, valeurHslJeton } from './jetons-css';

/**
 * Verdict chiffré et EXÉCUTABLE sur les jetons de couleur (`src/index.css`), seule mesure de
 * contraste possible dans ce dépôt — voir l'en-tête de `contraste.ts` pour pourquoi axe-core/jsdom
 * ne peuvent pas s'en charger. Les paires ci-dessous et leurs seuils reprennent exactement la
 * méthode documentée dans `DESIGN.md` (tableaux « jetons clairs »/« jetons sombres »/« statuts »)
 * et les commentaires de `index.css` : ce fichier la rend vérifiable à chaque exécution de
 * `pnpm test`, plutôt que vraie seulement au jour où quelqu'un l'a calculée à la main.
 *
 * DEUX THÈMES DEPUIS LA REFONTE VISUELLE (mode sombre). La quasi-totalité des paires ci-dessous sont
 * mesurées dans LES DEUX thèmes via `describe.each(THEMES)` : la structure de la paire (quels jetons
 * comparer, quel seuil) est identique clair/sombre, seule la VALEUR RÉSOLUE change — c'est
 * exactement ce que `jetons-css.ts` (corrigé pour cette refonte, voir sa doc de tête) rend possible
 * sans dupliquer la liste des paires à la main. Les tests qui NE sont PAS dans cette boucle sont
 * ceux dont l'assertion elle-même diffère par thème (une régression light-only sur une luminosité
 * précise, une exception écrite par @laupernoe qui n'a pas d'équivalent symétrique) — chacun porte un
 * commentaire qui dit pourquoi il reste seul.
 *
 * Portée assumée : ceci vérifie les JETONS eux-mêmes (les valeurs HSL déclarées), pas qu'un
 * composant donné les applique à pleine opacité — un `bg-statut-x/NN` (fond éclairci par une
 * classe d'opacité Tailwind) réintroduit dans un écran change le ratio réel et N'EST PAS mesuré
 * ici. Un jeton faux se répare une fois ; un mésusage d'opacité se répare par écran, hors périmètre
 * de ce fichier.
 */

function ratio(nomA: string, nomB: string, theme: Theme = 'clair'): number {
  return ratioContraste(
    analyserHsl(valeurHslJeton(nomA, theme)),
    analyserHsl(valeurHslJeton(nomB, theme)),
  );
}

const THEMES: ReadonlyArray<{ readonly cle: Theme; readonly nom: string }> = [
  { cle: 'clair', nom: 'clair' },
  { cle: 'sombre', nom: 'sombre' },
];

describe.each(THEMES)(
  'jetons de base ($nom) — texte sur fond, seuil AA texte normal (4.5:1)',
  ({ cle }) => {
    const paires: ReadonlyArray<readonly [string, string, string]> = [
      ['foreground', 'background', 'texte principal sur fond de page'],
      ['card-foreground', 'card', 'texte sur une carte'],
      ['popover-foreground', 'popover', 'texte dans un popover/menu'],
      ['muted-foreground', 'background', 'texte atténué sur fond de page'],
      [
        'muted-foreground',
        'muted',
        'texte atténué sur fond atténué (.texte-libelle en zone secondaire)',
      ],
      ['primary-foreground', 'primary', 'texte sur un bouton plein (couleur de marque)'],
      ['secondary-foreground', 'secondary', 'texte sur un bouton secondaire'],
      ['accent-foreground', 'accent', 'texte sur une surface de survol'],
      ['destructive-foreground', 'destructive', 'texte sur un bouton « Supprimer »'],
      [
        'marque-doux-foreground',
        'marque-doux',
        'texte sur surlignage de marque (élément de menu actif)',
      ],
      // Orange de marque posé directement sur `--background` et `--muted` à de nombreux
      // endroits réels du produit (`text-primary`), pas seulement à travers `--primary-foreground`/
      // `--primary` (le bouton plein) déjà couvert ci-dessus.
      ['marque', 'background', 'texte de marque directement sur fond de page (text-primary)'],
      ['marque', 'muted', 'texte de marque directement sur fond atténué (text-primary)'],
      [
        'primary-foreground',
        'primary-fort',
        'texte sur un bouton plein au survol/appui (bg-primary-fort)',
      ],
    ];

    it.each(paires)('%s sur %s (%s) atteint 4.5:1', (nomA, nomB) => {
      expect(ratio(nomA, nomB, cle)).toBeGreaterThanOrEqual(SEUIL_AA_TEXTE_NORMAL);
    });
  },
);

describe.each(THEMES)('statuts ($nom) — six tokens, trois usages chacun (DESIGN.md)', ({ cle }) => {
  const statuts = [
    'statut-neutre',
    'statut-info',
    'statut-attention',
    'statut-succes',
    'statut-danger',
    'statut-terminal',
  ];

  it.each(statuts)('%s sur background atteint 4.5:1 (badge « contour »)', (statut) => {
    expect(ratio(statut, 'background', cle)).toBeGreaterThanOrEqual(SEUIL_AA_TEXTE_NORMAL);
  });

  it.each(statuts)(
    '%s sur muted atteint 4.5:1 (badge « contour » en zone secondaire)',
    (statut) => {
      expect(ratio(statut, 'muted', cle)).toBeGreaterThanOrEqual(SEUIL_AA_TEXTE_NORMAL);
    },
  );

  it.each(statuts)(
    'primary-foreground sur %s (fond plein) atteint 4.5:1 (badge « plein »)',
    (statut) => {
      expect(ratio('primary-foreground', statut, cle)).toBeGreaterThanOrEqual(
        SEUIL_AA_TEXTE_NORMAL,
      );
    },
  );
});

// Sentinelles LIGHT-ONLY : régressions historiques du Lot K sur des luminosités précises (46 %→44 %,
// 34 %→30 %). Sans équivalent en sombre — les valeurs sombres de ces deux tokens (`--statut-neutre`
// 71 % L, `--statut-attention` 54 % L, voir DESIGN.md) sont d'une autre nature, choisies pour cette
// refonte, pas héritées d'un bug corrigé. Doubler ce test en sombre testerait un seuil qui n'a jamais
// existé pour ce thème.
describe('statuts (clair) — sentinelles de régression Lot K', () => {
  it('statut-neutre reste sous 46 % de luminosité (régression connue : 46 % échouait à 4.42:1 sur muted)', () => {
    expect(analyserHsl(valeurHslJeton('statut-neutre')).l).toBeLessThanOrEqual(44);
  });

  it('statut-attention reste sous 34 % de luminosité (régression connue : 34 % échouait à 3.93:1)', () => {
    expect(analyserHsl(valeurHslJeton('statut-attention')).l).toBeLessThanOrEqual(30);
  });
});

describe.each(THEMES)(
  'statuts ($nom) — variantes « fond » (fond clair + texte foncé en clair, fond profond + texte clair en sombre)',
  ({ cle }) => {
    const paires: ReadonlyArray<readonly [string, string]> = [
      ['statut-neutre', 'statut-neutre-fond'],
      ['statut-info', 'statut-info-fond'],
      ['statut-attention', 'statut-attention-fond'],
      ['statut-succes', 'statut-succes-fond'],
      ['statut-danger', 'statut-danger-fond'],
      ['statut-terminal', 'statut-terminal-fond'],
    ];

    it.each(paires)('%s (texte) sur %s atteint 4.5:1', (texte, fond) => {
      expect(ratio(texte, fond, cle)).toBeGreaterThanOrEqual(SEUIL_AA_TEXTE_NORMAL);
    });
  },
);

// Sentinelle daltonisme/proximité LIGHT-ONLY : `--statut-neutre-fond` est plus clair que
// `--statut-terminal-fond` en clair (97 % vs 91 % L, tous deux quasi blancs) — direction précise que
// cette assertion signée vérifie. En sombre, `--statut-neutre-fond` (= `--popover`, 14 % L) et
// `--statut-terminal-fond` (= `--border`, 23 % L) sont dans la RELATION INVERSE (le fond terminal est
// plus clair que le fond neutre) : une même assertion signée n'a pas de sens des deux côtés. La
// distinguabilité réelle des deux statuts en sombre est vérifiée séparément ci-dessous, sur le ratio
// de contraste plutôt que sur un delta de luminosité signé — mesure plus directement liée à ce qu'un
// œil perçoit.
describe('statuts (clair) — sentinelle daltonisme neutre/terminal', () => {
  it("statut-neutre-fond et statut-terminal-fond restent écartés d'au moins 4 points de luminosité", () => {
    const neutre = analyserHsl(valeurHslJeton('statut-neutre-fond')).l;
    const terminal = analyserHsl(valeurHslJeton('statut-terminal-fond')).l;
    expect(neutre - terminal).toBeGreaterThanOrEqual(4);
  });
});

/**
 * Réserve mesurée du plan de refonte (DESIGN.md, section « Statuts d'OR ») : `--statut-neutre` et
 * `--statut-terminal` sont les deux seuls tokens achromatiques de la famille, donc les deux qui
 * risquent de devenir des gris indiscernables. En SOMBRE, l'écart qui les sépare SE RESSERRE plutôt
 * que de s'élargir (1.81:1 entre les deux textes, 1.37:1 entre les deux fonds — valeurs mesurées sur
 * les jetons HSL RÉELLEMENT déclarés dans `index.css`, à ne pas confondre avec les chiffres à hex
 * exact du plan de refonte : arrondir un triplet HSL à l'entier, comme le fait toute déclaration de
 * ce fichier, déplace légèrement le ratio final — c'est la valeur issue de CE calcul, pas celle du
 * plan, qui fait foi). Ces deux tests figent ces ratios comme PLANCHERS de régression : si un futur
 * changement de jeton les fait descendre, la distinction entre « planifié » et « clôturé » en sombre
 * devient encore plus dépendante de la forme/icône/mot — ce test doit rougir avant que quelqu'un ne
 * le découvre à l'œil sur un écran réel.
 */
describe('statuts (sombre) — écart neutre/terminal, réserve mesurée du plan (DESIGN.md)', () => {
  it('le ratio de contraste entre le texte statut-neutre et le texte statut-terminal reste ≥ 1.79:1', () => {
    expect(ratio('statut-neutre', 'statut-terminal', 'sombre')).toBeGreaterThanOrEqual(1.79);
  });

  it('le ratio de contraste entre le fond statut-neutre et le fond statut-terminal reste ≥ 1.35:1', () => {
    expect(ratio('statut-neutre-fond', 'statut-terminal-fond', 'sombre')).toBeGreaterThanOrEqual(
      1.35,
    );
  });
});

describe.each(THEMES)(
  'statuts ($nom) — texte générique (foreground/muted-foreground) sur fond « fond »',
  ({ cle }) => {
    // Plusieurs bandeaux migrés posent le texte générique de l'app (pas le token de couleur du
    // statut lui-même) sur un fond `statut-X-fond` — ex. EncartAlertesVehicule.tsx,
    // RefusBloquant.tsx, BandeauBrouillon.tsx, et les bandeaux de facturation. Cette paire n'est
    // mesurée nulle part ailleurs dans ce fichier.
    const statuts = [
      'statut-neutre',
      'statut-info',
      'statut-attention',
      'statut-succes',
      'statut-danger',
      'statut-terminal',
    ];

    it.each(statuts)('foreground sur %s-fond atteint 4.5:1', (statut) => {
      expect(ratio('foreground', `${statut}-fond`, cle)).toBeGreaterThanOrEqual(
        SEUIL_AA_TEXTE_NORMAL,
      );
    });

    it.each(statuts)('muted-foreground sur %s-fond atteint 4.5:1', (statut) => {
      expect(ratio('muted-foreground', `${statut}-fond`, cle)).toBeGreaterThanOrEqual(
        SEUIL_AA_TEXTE_NORMAL,
      );
    });
  },
);

describe.each(THEMES)(
  'composants non textuels ($nom) — seuil AA 3:1 (WCAG 1.4.11, contours de contrôle)',
  ({ cle }) => {
    it('input (contour de champ/case à cocher) sur background atteint 3:1', () => {
      expect(ratio('input', 'background', cle)).toBeGreaterThanOrEqual(SEUIL_AA_COMPOSANT_UI);
    });

    it('input sur muted atteint 3:1', () => {
      expect(ratio('input', 'muted', cle)).toBeGreaterThanOrEqual(SEUIL_AA_COMPOSANT_UI);
    });

    it('ring (anneau de focus) sur background atteint 3:1', () => {
      expect(ratio('ring', 'background', cle)).toBeGreaterThanOrEqual(SEUIL_AA_COMPOSANT_UI);
    });

    it('avertissement-bordure sur background atteint 3:1', () => {
      expect(ratio('avertissement-bordure', 'background', cle)).toBeGreaterThanOrEqual(
        SEUIL_AA_COMPOSANT_UI,
      );
    });
  },
);

// `--border` est un trait DÉCORATIF (séparateur, filet de tableau) — explicitement exempté du
// seuil 3:1 dans les deux thèmes (voir le commentaire `index.css` juste au-dessus de chaque
// déclaration). On ne l'assertit donc PAS contre 3:1 (ce serait affaiblir le test en visant une
// cible qui ne s'applique pas) ; on documente seulement qu'il reste sous ce seuil dans CHAQUE
// thème, pour qu'un futur usage erroné de `--border` comme contour de contrôle (au lieu de
// `--input`) se voie dans ce test s'il change de valeur. Valeur attendue différente par thème
// (1.24 clair, 1.65 sombre) : pas de boucle `describe.each` ici, la constante elle-même diffère.
// Le 1.24 clair reflète le `--background` `#f0f0f3` de cette refonte (l'ancien 1.40:1, documenté
// dans `index.css`, datait d'un fond blanc pur — voir le commentaire juste au-dessus de
// `--border` dans `index.css` pour l'historique).
describe('border (décoratif, EXEMPTÉ de 3:1) — ratio documenté, pas une porte de conformité', () => {
  it('clair : border sur background', () => {
    expect(ratio('border', 'background', 'clair')).toBeCloseTo(1.24, 1);
  });

  it('sombre : border sur background', () => {
    expect(ratio('border', 'background', 'sombre')).toBeCloseTo(1.65, 1);
  });
});

describe.each(THEMES)(
  'famille avertissement ($nom) — bandeaux/encarts, distincte des statuts et de la marque',
  ({ cle }) => {
    it('avertissement sur avertissement-fond atteint 4.5:1', () => {
      expect(ratio('avertissement', 'avertissement-fond', cle)).toBeGreaterThanOrEqual(
        SEUIL_AA_TEXTE_NORMAL,
      );
    });
  },
);

/**
 * Marque orange (`#F07E17` en sombre, orange profond 26° en clair) : écarts de teinte avec les
 * statuts. Le bleu `info` et le vert `succes` restent à >= 30° ; `attention` (ambre) et `danger`
 * (rouge) sont PROCHES de l'orange — exception écrite (index.css, DESIGN.md), compensée par forme +
 * icône + mot obligatoires sur tout badge. Ces tests verrouillent les écarts réellement mesurés
 * pour qu'une dérive accidentelle rougisse.
 */
describe.each([
  { cle: 'clair' as const, minAttention: 10, minDanger: 20, plageMin: 24, plageMax: 30 },
  { cle: 'sombre' as const, minAttention: 15, minDanger: 20, plageMin: 26, plageMax: 30 },
])(
  'marque orange ($cle) — écart de teinte avec les statuts d’OR',
  ({ cle, minAttention, minDanger, plageMin, plageMax }) => {
    function ecartTeinte(h1: number, h2: number): number {
      const d = Math.abs(h1 - h2) % 360;
      return d > 180 ? 360 - d : d;
    }
    const teinte = (jeton: string) => analyserHsl(valeurHslJeton(jeton, cle)).h;

    it.each(['statut-info', 'statut-succes'])('--marque reste à >= 30° de --%s', (statut) => {
      expect(ecartTeinte(teinte('marque'), teinte(statut))).toBeGreaterThanOrEqual(30);
    });

    it("l'écart marque/statut-attention ne descend pas sous le seuil mesuré (exception écrite)", () => {
      expect(ecartTeinte(teinte('marque'), teinte('statut-attention'))).toBeGreaterThanOrEqual(
        minAttention,
      );
    });

    it("l'écart marque/statut-danger ne descend pas sous le seuil mesuré (exception écrite)", () => {
      expect(ecartTeinte(teinte('marque'), teinte('statut-danger'))).toBeGreaterThanOrEqual(
        minDanger,
      );
    });

    it('la teinte de --marque reste dans la famille orange', () => {
      expect(teinte('marque')).toBeGreaterThanOrEqual(plageMin);
      expect(teinte('marque')).toBeLessThanOrEqual(plageMax);
    });
  },
);
