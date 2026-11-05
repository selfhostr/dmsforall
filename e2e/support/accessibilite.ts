import AxeBuilder from '@axe-core/playwright';
import type { Page, TestInfo } from '@playwright/test';

/**
 * Contrôle axe-core d'un écran déjà rendu — objectif WCAG AA (CONTRIBUTING.md, skill
 * `web-design-guidelines`). Tags `wcag2a`/`wcag2aa`/`wcag21aa` : le périmètre réellement visé,
 * pas `best-practice` (règles d'opinion, hors du contrat WCAG lui-même) ni `experimental`.
 *
 * N'CORRIGE RIEN : ce harnais est hors périmètre applicatif (`apps/web/src` appartient à un
 * autre lot). Le rôle de cette fonction est de PROUVER et de RAPPORTER — le rapport JSON complet
 * part en pièce jointe du test (visible dans le rapport HTML même si le test passe), et le résumé
 * lisible part dans le message d'assertion pour un verdict pass/fail sans avoir à ouvrir le JSON.
 */
export async function analyserAccessibilite(
  page: Page,
  testInfo: TestInfo,
  etiquette: string,
): Promise<{ readonly violations: readonly AxeViolation[]; readonly resume: string }> {
  const resultat = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();

  await testInfo.attach(`axe-${etiquette}.json`, {
    body: JSON.stringify(resultat, null, 2),
    contentType: 'application/json',
  });

  const violations = resultat.violations as readonly AxeViolation[];
  const resume = violations
    .map(
      (v) =>
        `[${v.impact ?? 'inconnu'}] ${v.id} — ${v.help} (${v.nodes.length} élément(s))\n` +
        v.nodes.map((n) => `    ${n.target.join(' ')}`).join('\n'),
    )
    .join('\n');

  return { violations, resume };
}

interface AxeViolationNode {
  readonly target: readonly string[];
}

interface AxeViolation {
  readonly id: string;
  readonly impact?: string;
  readonly help: string;
  readonly nodes: readonly AxeViolationNode[];
}
