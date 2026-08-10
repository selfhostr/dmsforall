/**
 * Harnais d'audit d'accessibilité — rend un écran et le fait passer à axe-core, jeu de règles
 * WCAG 2.1 niveau AA.
 *
 * Choix d'outillage : `jest-axe` (11.0.0, maintenu — dernière publication 2026-07-26) plutôt que
 * `vitest-axe` (bloqué en pré-version depuis 2023, dernière publication 2025-01-22, dist-tag
 * `latest` toujours à `0.1.0` de 2022 — un fork non entretenu de `jest-axe`). `jest-axe` s'appuie
 * sur `expect.extend`, une API que Vitest reproduit à l'identique : aucune dépendance réelle à
 * Jest, seulement à `jest-matcher-utils` pour le formatage — testé et fonctionnel ici. `axe-core`
 * est aussi installé en dépendance directe : `jest-axe` embarque sa propre copie
 * (`axe-core@4.12.1`, figée par son `package.json`) pour `configureAxe`/l'exécution ; la dépendance
 * directe documente le moteur réellement utilisé dans ce dépôt et donne accès aux types
 * (`AxeResults`, `Result`) sans détour par les internes de `jest-axe`.
 *
 * LIMITE MESURÉE, PAS SUPPOSÉE : le contraste de couleur n'est PAS auditable par ce harnais.
 * `jest-axe` désactive lui-même toute la catégorie `cat.color` par défaut (voir
 * `node_modules/jest-axe/index.js`, commentaire « Color contrast checking doesnt work in a jsdom
 * environment ») — et `apps/web/vitest.config.ts` déclare `css: false`, donc même en réactivant la
 * règle de force, aucune classe Tailwind n'aurait de couleur calculée à lire : voir
 * `verifierAucuneReactivationCouleur` ci-dessous, qui PROUVE ce point plutôt que de l'affirmer. Le
 * contraste réel des jetons est mesuré ailleurs, par calcul direct sur les valeurs HSL de
 * `index.css` : voir `contraste-jetons.spec.ts`.
 */
import { configureAxe } from 'jest-axe';
import type { AxeResults, ImpactValue, Result } from 'axe-core';
import { expect } from 'vitest';

/** Balises axe-core couvrant WCAG 2.1 niveau AA dans son ensemble (2A + 2AA hérités + les critères
 *  propres à la 2.1). Référence : https://github.com/dequelabs/axe-core/blob/master/doc/API.md#axe-core-tags */
const BALISES_WCAG21_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] as const;

const auditerWcagAA = configureAxe({
  runOnly: { type: 'tag', values: [...BALISES_WCAG21_AA] },
});

export interface ResultatAudit {
  readonly nomEcran: string;
  readonly resultats: AxeResults;
}

/** Fait passer le conteneur DOM rendu à axe-core, jeu de règles WCAG 2.1 AA. N'affirme rien : le
 *  verdict se lit avec `exigerAucuneViolation` ou en inspectant `resultats.violations` directement
 *  (utile pour le rapport chiffré, où on veut compter/classer les violations sans faire échouer la
 *  suite au premier écran fautif).
 *
 * PIÈGE VÉRIFIÉ, PAS SEULEMENT DOCUMENTÉ : `Dialog`, `Sheet`, `Select`, `Popover`, `DropdownMenu`
 * et `Tooltip` (`components/ui/*.tsx`) portent tous un `<...Primitive.Portal>` Radix — leur contenu
 * est rendu comme ENFANT DE `document.body`, PAS comme descendant du `container` que
 * `@testing-library/react` retourne. Un `render(<DialogueX />)` puis
 * `auditerAccessibiliteEcran(nom, container)` audite alors un sous-arbre quasi vide (juste le
 * déclencheur) : zéro violation, mais pas parce que l'écran est propre — parce qu'il n'a jamais été
 * regardé. Mesuré directement sur ce dépôt : un `<Dialog>` ouvert laisse un `container` de 484
 * caractères contre 9339 pour `document.body`, et `container.querySelector('[role="dialog"]')`
 * renvoie `null`. RÈGLE : pour tout écran dont un état audité ouvre un composant portalé, passer
 * `document.body` à cette fonction, jamais le `container` de `render()`. Les quatre écrans mesurés
 * de ce dépôt (`mesures.*.spec.tsx`) suivent déjà cette règle. */
export async function auditerAccessibiliteEcran(
  nomEcran: string,
  conteneur: Element,
): Promise<ResultatAudit> {
  const resultats = await auditerWcagAA(conteneur);
  return { nomEcran, resultats };
}

// `ImpactValue` (axe-core) inclut `null` ('impact non déterminé') : pas une clé d'objet valide,
// donc un `Map` plutôt qu'un `Record<ImpactValue, string>`.
const LIBELLES_IMPACT = new Map<Exclude<ImpactValue, null>, string>([
  ['critical', 'critique'],
  ['serious', 'sérieux'],
  ['moderate', 'modéré'],
  ['minor', 'mineur'],
]);

function formaterViolation(violation: Result): string {
  const impact = violation.impact
    ? (LIBELLES_IMPACT.get(violation.impact) ?? violation.impact)
    : 'inconnu';
  const cibles = violation.nodes.map((noeud) => `    - ${noeud.target.join(' ')}`).join('\n');
  return [
    `  Règle « ${violation.id} » (impact ${impact}) — ${violation.help}`,
    `    ${violation.helpUrl}`,
    `  Élément(s) concerné(s) :`,
    cibles,
  ].join('\n');
}

/** Assertion lisible : nomme l'écran, puis pour chaque violation la règle, son impact, et le ou
 *  les éléments concernés (sélecteur axe). Échoue avec un message qui suffit à corriger sans
 *  rouvrir axe-core — c'est le format attendu par le verdict du Lot K (voir le rapport de mesure). */
export function exigerAucuneViolation({ nomEcran, resultats }: ResultatAudit): void {
  if (resultats.violations.length === 0) return;
  const detail = resultats.violations.map(formaterViolation).join('\n\n');
  expect.fail(
    `${resultats.violations.length} violation(s) WCAG 2.1 AA sur l'écran « ${nomEcran} » :\n\n${detail}`,
  );
}

/** Preuve exécutable (pas une affirmation en commentaire) que la règle `color-contrast`, même
 *  réactivée explicitement et même sur un élément dont le contraste réel serait insuffisant, ne
 *  produit ICI qu'un résultat « incomplete » (indéterminé) plutôt qu'une violation — parce que
 *  `css: false` (vitest.config.ts) prive jsdom de toute couleur calculée. Appelé par
 *  `harnais.spec.ts` : si un jour `css: false` change ou si axe/jsdom apprennent à calculer un
 *  style rendu, ce test se met à échouer et documente qu'on peut enfin compter sur le contraste
 *  dans ce harnais — signal qu'on veut, pas un oubli. */
export async function verifierAucuneReactivationCouleur(conteneur: Element): Promise<{
  readonly violationsCouleur: number;
  readonly incompletesCouleur: number;
}> {
  const axeAvecCouleur = configureAxe({
    runOnly: { type: 'tag', values: ['cat.color'] },
    rules: { 'color-contrast': { enabled: true } },
  });
  const resultats = await axeAvecCouleur(conteneur);
  return {
    violationsCouleur: resultats.violations.length,
    incompletesCouleur: resultats.incomplete.length,
  };
}
