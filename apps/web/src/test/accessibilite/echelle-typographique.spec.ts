import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { rolesPourTaille, taillesEchellePx } from './echelle-typographique';

/**
 * Garde-fou de l'UNIFORMITÉ TYPOGRAPHIQUE — pendant de `contraste-jetons.spec.ts` pour la couleur.
 *
 * CONSTAT (@laupernoe, mesure manuelle sur l'app en marche) : « partout les polices sont en plein de
 * tailles différentes, rien n'est de la même taille ». Vérifié : mesure du rendu RÉEL (Playwright,
 * `getComputedStyle`, six écrans + une fiche de détail, compte admin) donne SIX tailles distinctes
 * (12/14/16/18/24/30px) — pas « n'importe quoi », mais l'une de ces six, 30px (`text-3xl`), ne
 * correspond à AUCUN rôle de l'échelle posée au Lot K (voir tableau dans `index.css`), à AUCUNE
 * densité. C'est une taille inventée au clavier, pas choisie dans l'échelle.
 *
 * POURQUOI UNE ANALYSE STATIQUE DES SOURCES, PAS UN RENDU PLAYWRIGHT :
 * - `apps/web/vitest.config.ts` pose `css: false` (voir le commentaire détaillé dans `harnais.ts`) :
 *   dans CE fichier de test, jsdom ne calcule aucune taille réelle — un rendu React-Testing-Library
 *   ici ne verrait donc PAS la vraie police, contrairement à un audit de couleur qui, lui, se fait
 *   par calcul direct sur les jetons (déjà le choix de `contraste-jetons.spec.ts`).
 * - Un audit Playwright authentifié (navigateur réel, session de démo) EST plus vrai — c'est
 *   d'ailleurs celui utilisé pour établir le constat ci-dessus — mais il exige un serveur `pnpm dev` démarré,
 *   un compte de démo, et un navigateur Chromium installé avec ses bibliothèques système. Rien de
 *   tout ça n'est disponible dans `pnpm test` / CI « Vérifier » (job rapide, sans serveur). Un tel
 *   test y serait rouge en permanence pour une raison d'environnement, pas de régression — exactement
 *   le défaut qui a fait retirer `tailwindcss-animate` du produit (voir `index.css`, § animations) :
 *   du contrôle qui ment sur ce qu'il vérifie.
 * - Une analyse statique des classes Tailwind de taille (`text-lg`, `text-3xl`, `text-[15px]`…)
 *   dans les sources est RAPIDE, DÉTERMINISTE, ne dépend d'aucun serveur ni compte, et couvre TOUT
 *   le code, pas seulement les six écrans mesurés à la main. Sa limite assumée : elle ne prouve rien
 *   sur un style calculé dynamiquement (aucun cas trouvé dans ce dépôt — `grep fontSize` est vide) ni
 *   sur les primitives `components/ui/*.tsx` (périmètre exclu, voir plus bas).
 *
 * PÉRIMÈTRE : `src/ecrans/` et `src/composants/` uniquement — la couche où CONTRIBUTING.md situe le
 * contenu métier (français, six rôles typographiques). `src/components/ui/` (primitives shadcn,
 * génériques, anglais) est un contrat différent, avec ses propres tailles internes assumées
 * (bouton, badge…) : les mélanger ferait porter à ce test une responsabilité qui n'est pas la
 * sienne. Les fichiers `*.spec.tsx`/`*.stories.tsx` sont exclus : ils exercent les composants réels,
 * une classe qui y apparaîtrait serait un doublon du même défaut, pas un nouveau.
 */

const CHEMIN_MODULE = fileURLToPath(import.meta.url);
const RACINE_SRC = path.resolve(path.dirname(CHEMIN_MODULE), '../..');
const DOSSIERS_SCANNES = ['ecrans', 'composants'];

// Échelle de tailles de police par défaut de Tailwind v4 (`@tailwindcss/theme`), non modifiée dans
// ce dépôt — voir la vérification programmatique ci-dessous (« aucune surcharge du thème »). Cette
// table est nécessairement recopiée à la main (Tailwind ne l'expose pas en JSON) ; le test suivant
// la protège d'un divorce silencieux avec la réalité si `index.css` venait à la surcharger.
const ECHELLE_TAILWIND_PX: Readonly<Record<string, number>> = {
  xs: 12,
  sm: 14,
  base: 16,
  lg: 18,
  xl: 20,
  '2xl': 24,
  '3xl': 30,
  '4xl': 36,
  '5xl': 48,
  '6xl': 60,
  '7xl': 72,
  '8xl': 96,
  '9xl': 128,
};

interface OccurrenceTaille {
  readonly fichier: string;
  readonly ligne: number;
  readonly classe: string;
  readonly px: number;
}

function listerFichiersTsx(dossier: string): string[] {
  const resultats: string[] = [];
  let entrees: string[];
  try {
    entrees = readdirSync(dossier, { recursive: true }) as string[];
  } catch {
    return resultats;
  }
  for (const entree of entrees) {
    if (!entree.endsWith('.tsx')) continue;
    if (entree.endsWith('.spec.tsx') || entree.endsWith('.stories.tsx')) continue;
    resultats.push(path.join(dossier, entree));
  }
  return resultats;
}

// Classes utilitaires de taille (échelle nommée) : `text-lg`, `text-2xl`, etc. Les noms de rôle
// Tailwind ne collisionnent jamais avec un utilitaire de couleur (`text-foreground`,
// `text-destructive`…) : la liste ci-dessous est fermée et n'apparaît sous cette forme exacte que
// pour la taille de police.
const MOTIF_CLASSE_NOMMEE = new RegExp(
  `\\btext-(${Object.keys(ECHELLE_TAILWIND_PX).join('|')})\\b`,
  'g',
);
// Classe arbitraire : `text-[15px]` ou `text-[0.9rem]`.
const MOTIF_CLASSE_ARBITRAIRE = /\btext-\[([\d.]+)(px|rem)\]/g;

function pxDepuisArbitraire(valeur: string, unite: string): number {
  return unite === 'rem' ? parseFloat(valeur) * 16 : parseFloat(valeur);
}

function analyserFichier(cheminAbsolu: string, cheminAffiche: string): OccurrenceTaille[] {
  const contenu = readFileSync(cheminAbsolu, 'utf-8');
  const lignes = contenu.split('\n');
  const occurrences: OccurrenceTaille[] = [];

  lignes.forEach((ligne, index) => {
    for (const correspondance of ligne.matchAll(MOTIF_CLASSE_NOMMEE)) {
      const suffixe = correspondance[1];
      if (suffixe === undefined) continue;
      const px = ECHELLE_TAILWIND_PX[suffixe];
      if (px === undefined) continue;
      occurrences.push({
        fichier: cheminAffiche,
        ligne: index + 1,
        classe: `text-${suffixe}`,
        px,
      });
    }
    for (const correspondance of ligne.matchAll(MOTIF_CLASSE_ARBITRAIRE)) {
      const valeur = correspondance[1];
      const unite = correspondance[2];
      if (valeur === undefined || unite === undefined) continue;
      occurrences.push({
        fichier: cheminAffiche,
        ligne: index + 1,
        classe: correspondance[0],
        px: pxDepuisArbitraire(valeur, unite),
      });
    }
  });

  return occurrences;
}

function toutesLesOccurrences(): OccurrenceTaille[] {
  const occurrences: OccurrenceTaille[] = [];
  for (const nomDossier of DOSSIERS_SCANNES) {
    const dossierAbsolu = path.join(RACINE_SRC, nomDossier);
    for (const fichierAbsolu of listerFichiersTsx(dossierAbsolu)) {
      const cheminAffiche = path.relative(RACINE_SRC, fichierAbsolu);
      occurrences.push(...analyserFichier(fichierAbsolu, cheminAffiche));
    }
  }
  return occurrences;
}

describe("garde-fou de l'échelle typographique (statique, source des écrans/composants)", () => {
  it("index.css ne surcharge pas l'échelle de tailles Tailwind (`--text-*` dans un bloc @theme)", () => {
    // Si ce test rougit, la table ECHELLE_TAILWIND_PX ci-dessus est devenue fausse : la corriger
    // AVANT de faire confiance au reste de ce fichier, pas de le contourner.
    const CHEMIN_INDEX_CSS = path.resolve(RACINE_SRC, 'index.css');
    const source = readFileSync(CHEMIN_INDEX_CSS, 'utf-8');
    const motifSurcharge = /--text-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)\s*:/;
    expect(motifSurcharge.test(source)).toBe(false);
  });

  it("l'échelle posée dans index.css n'est pas vide (les blocs .densite-* existent toujours)", () => {
    expect(taillesEchellePx().size).toBeGreaterThan(0);
  });

  it('aucune classe Tailwind de taille de police, dans ecrans/ ou composants/, ne rend une taille hors échelle', () => {
    const echelle = taillesEchellePx();
    const violations = toutesLesOccurrences().filter((occ) => !echelle.has(occ.px));

    if (violations.length === 0) return;

    const detail = violations
      .map((v) => {
        const rolesValides = [...echelle]
          .sort((a, b) => a - b)
          .map((px) => `${px}px (${rolesPourTaille(px).join(', ') || 'rôle introuvable'})`)
          .join(' · ');
        return (
          `  ${v.fichier}:${v.ligne} — classe « ${v.classe} » rend ${v.px}px, hors échelle.\n` +
          `    Tailles autorisées : ${rolesValides}`
        );
      })
      .join('\n\n');

    expect.fail(
      `${violations.length} taille(s) de police hors échelle dans ecrans/ ou composants/ :\n\n${detail}\n\n` +
        'Remplacer la classe Tailwind brute par le rôle sémantique approprié ' +
        '(.texte-libelle / .texte-corps / .texte-titre-section / .texte-titre-page / ' +
        '.texte-donnee-proeminente / .texte-chiffre-geant), voir index.css.',
    );
  });
});
