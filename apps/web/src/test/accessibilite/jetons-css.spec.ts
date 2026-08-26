import { describe, expect, it } from 'vitest';

import { reinitialiserCacheJetons, valeurHslJeton } from './jetons-css';

/**
 * Test DÉDIÉ au correctif d'infrastructure de la refonte visuelle (mode sombre) — voir la doc de
 * tête de `jetons-css.ts` et DESIGN.md, section « Méthode de mesure ». `contraste-jetons.spec.ts`
 * exerce déjà ce module indirectement (des centaines d'assertions), mais AUCUNE d'entre elles ne
 * peut, à elle seule, prouver que le module distingue correctement `:root` et `.dark` : une
 * régression qui ferait à nouveau tout retomber dans une seule table plate resterait indétectable
 * si, par coïncidence, les valeurs claires et sombres d'un jeton donné se ressemblaient. Ce fichier
 * vérifie le MÉCANISME lui-même, sur des jetons dont on sait par construction qu'ils diffèrent
 * radicalement entre les deux thèmes (`--background` : blanc cassé en clair, quasi noir en sombre).
 */
describe('jetons-css — cascade clair/sombre', () => {
  it('valeurHslJeton sans thème explicite se comporte comme avant ce lot (défaut « clair »)', () => {
    expect(valeurHslJeton('background')).toBe(valeurHslJeton('background', 'clair'));
  });

  it('un jeton redéclaré dans .dark renvoie une valeur DIFFÉRENTE en sombre qu’en clair', () => {
    const clair = valeurHslJeton('background', 'clair');
    const sombre = valeurHslJeton('background', 'sombre');
    expect(sombre).not.toBe(clair);
    // Régression exacte du piège documenté : un scan à plat qui laisserait la déclaration la PLUS
    // BASSE du fichier écraser l'autre ferait remonter la valeur sombre même en thème clair (le
    // bloc `.dark` est placé APRÈS le `:root` couleurs dans `index.css`). Ce test échouerait dans
    // ce cas précis, avec ces jetons précis.
    expect(clair).not.toBe(sombre);
  });

  it('un jeton NON redéclaré dans .dark hérite de sa valeur :root, dans les deux thèmes (cascade CSS réelle)', () => {
    // `--destructive` n'a volontairement aucune entrée dans le bloc `.dark` (voir index.css et
    // DESIGN.md : son contraste ne dépend pas du fond de page). Un thème « sombre » qui ne
    // retomberait pas sur `:root` pour ce jeton absent lèverait une erreur « jeton introuvable » —
    // ce test échouerait alors avant même la comparaison ci-dessous.
    const clair = valeurHslJeton('destructive', 'clair');
    const sombre = valeurHslJeton('destructive', 'sombre');
    expect(sombre).toBe(clair);
  });

  it('la résolution d’alias reste dans le MÊME thème à chaque saut (--ring: var(--marque))', () => {
    // `--ring: var(--marque);` n'est déclaré qu'UNE FOIS, dans `:root` — jamais redéclaré dans
    // `.dark`. Pourtant sa valeur RÉSOLUE doit différer par thème, parce que `--marque`, LUI, est
    // redéclaré dans `.dark` : c'est exactement le comportement d'un navigateur, où `:root` et
    // `.dark` ciblent le même élément et où la substitution de `var()` se fait à la valeur
    // utilisée, jamais à la ligne où l'alias a été écrit.
    const marqueClair = valeurHslJeton('marque', 'clair');
    const marqueSombre = valeurHslJeton('marque', 'sombre');
    expect(marqueSombre).not.toBe(marqueClair);
    expect(valeurHslJeton('ring', 'clair')).toBe(marqueClair);
    expect(valeurHslJeton('ring', 'sombre')).toBe(marqueSombre);
  });

  it('primary (alias de marque) suit aussi le thème demandé', () => {
    expect(valeurHslJeton('primary', 'sombre')).toBe(valeurHslJeton('marque', 'sombre'));
    expect(valeurHslJeton('primary', 'clair')).toBe(valeurHslJeton('marque', 'clair'));
  });

  it('un jeton introuvable dans aucun thème lève une erreur nommée, jamais un undefined silencieux', () => {
    expect(() => valeurHslJeton('ce-jeton-n-existe-pas', 'sombre')).toThrow(
      /Jeton « --ce-jeton-n-existe-pas » introuvable \(thème sombre\)/,
    );
  });

  it('reinitialiserCacheJetons() ne casse pas une lecture suivante', () => {
    const avant = valeurHslJeton('background', 'sombre');
    reinitialiserCacheJetons();
    const apres = valeurHslJeton('background', 'sombre');
    expect(apres).toBe(avant);
  });
});
