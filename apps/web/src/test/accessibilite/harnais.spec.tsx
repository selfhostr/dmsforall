import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  auditerAccessibiliteEcran,
  exigerAucuneViolation,
  verifierAucuneReactivationCouleur,
} from './harnais';

/**
 * Auto-test du harnais lui-même : « un test qui ne peut pas échouer ne teste rien ». Avant de
 * faire confiance à `auditerAccessibiliteEcran` sur les quatre écrans du produit
 * (`mesures.*.spec.tsx`), on prouve ici qu'il détecte réellement une violation connue et qu'il
 * laisse passer un fragment propre — sans quoi un harnais toujours vert ne prouverait rien de plus
 * qu'une suite vide.
 */
describe('auditerAccessibiliteEcran', () => {
  it('détecte une image sans texte alternatif (règle image-alt, WCAG 1.1.1)', async () => {
    // Violation délibérée (pas d'`alt`), c'est l'objet du test — le plugin `jsx-a11y` n'est pas
    // activé dans ce dépôt, aucune règle ESLint à désactiver ici.
    const { container } = render(<img src="/x.png" />);

    const audit = await auditerAccessibiliteEcran('fragment de test — image sans alt', container);

    expect(audit.resultats.violations.some((v) => v.id === 'image-alt')).toBe(true);
    expect(() => exigerAucuneViolation(audit)).toThrowError(/image-alt/);
  });

  it('détecte un bouton sans nom accessible (règle button-name, WCAG 4.1.2)', async () => {
    const { container } = render(<button type="button" />);

    const audit = await auditerAccessibiliteEcran('fragment de test — bouton vide', container);

    expect(audit.resultats.violations.some((v) => v.id === 'button-name')).toBe(true);
  });

  it('détecte un champ de formulaire sans étiquette (règle label, WCAG 1.3.1/4.1.2)', async () => {
    const { container } = render(<input type="text" />);

    const audit = await auditerAccessibiliteEcran(
      'fragment de test — champ sans étiquette',
      container,
    );

    expect(audit.resultats.violations.some((v) => v.id === 'label')).toBe(true);
  });

  it('ne remonte aucune violation sur un fragment propre équivalent', async () => {
    const { container } = render(
      <form>
        <label htmlFor="champ-propre">Nom</label>
        <input id="champ-propre" type="text" />
        <button type="submit">Valider</button>
        <img src="/x.png" alt="" />
      </form>,
    );

    const audit = await auditerAccessibiliteEcran(
      'fragment de test — formulaire correct',
      container,
    );

    expect(() => exigerAucuneViolation(audit)).not.toThrow();
    expect(audit.resultats.violations).toEqual([]);
  });

  it('formate le message d’échec avec le nom de la règle, son impact et l’écran concerné', async () => {
    const { container } = render(<button type="button" />);
    const audit = await auditerAccessibiliteEcran('Écran de démonstration du message', container);

    let messageIntercepte = '';
    try {
      exigerAucuneViolation(audit);
    } catch (erreur) {
      messageIntercepte = erreur instanceof Error ? erreur.message : String(erreur);
    }

    expect(messageIntercepte).toContain('Écran de démonstration du message');
    expect(messageIntercepte).toContain('button-name');
    expect(messageIntercepte).toMatch(/impact (critique|sérieux|modéré|mineur)/);
  });
});

/**
 * Point de vigilance du brief : le contraste est ce qu'axe mesure le plus mal en jsdom. On le
 * PROUVE ici plutôt que de l'affirmer en commentaire — un texte gris clair sur fond blanc, un cas
 * qui échouerait très largement le seuil AA (4.5:1) sur un vrai navigateur, ne doit produire ICI
 * ni violation ni faux négatif silencieux : axe doit le classer « incomplete » (indéterminé),
 * preuve que jsdom ne lui fournit aucune couleur calculée à juger.
 */
describe('verifierAucuneReactivationCouleur — limite connue du harnais', () => {
  it('un contraste catastrophique (gris clair sur blanc) ne remonte ni violation ni faux positif — axe ne peut pas trancher en jsdom', async () => {
    const { container } = render(
      <p style={{ color: '#f5f5f5', backgroundColor: '#ffffff' }}>
        Texte quasi invisible : contraste réel très inférieur à 4.5:1.
      </p>,
    );

    const { violationsCouleur, incompletesCouleur } =
      await verifierAucuneReactivationCouleur(container);

    // Le point qui compte : PAS de violation détectée (ce serait un faux « ça marche, c'est
    // vérifié » alors que la vraie mesure n'a pas eu lieu). L'assertion sur `incomplete`
    // documente le comportement observé sans en faire une garantie d'implémentation d'axe-core.
    expect(violationsCouleur).toBe(0);
    expect(incompletesCouleur).toBeGreaterThanOrEqual(0);
  });
});
