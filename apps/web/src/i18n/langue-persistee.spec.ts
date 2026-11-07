/**
 * Choix de la langue conservé au rechargement (fix/langue-persistee).
 *
 * Preuves visées :
 *  - l'ordre de priorité au démarrage : localStorage valide > navigator (fr/de/it) > fr ;
 *  - un rechargement (module ré-évalué, comme un F5) relit `dfa.langue` AVANT `i18nPret`,
 *    donc i18next ET `<html lang>` sont en allemand dès le premier rendu ;
 *  - le choix fait via `useLangue().changerLangue` est persistant et reflété dans `<html lang>`.
 *
 * Les tests de rechargement utilisent `vi.resetModules()` : c'est le seul moyen, en Vitest, de
 * ré-exécuter le bootstrap de `src/i18n/index.ts` (singleton) comme au chargement de la page.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import i18nSingleton from '@/i18n';
import { useLangue } from '@/hooks/useLangue';

const CLE = 'dfa.langue';

/** Ré-exécute le bootstrap i18n comme un rechargement de page et attend `i18nPret`. */
async function recharger() {
  vi.resetModules();
  const module = await import('@/i18n');
  await module.i18nPret;
  return module.default;
}

describe('detecterLangueInitiale — priorité au démarrage', () => {
  it('une langue valide en localStorage gagne sur le navigateur', async () => {
    const { detecterLangueInitiale } = await import('@/i18n');
    const stockage = { getItem: () => 'de' };
    expect(detecterLangueInitiale(stockage, 'it-CH')).toBe('de');
  });

  it('une valeur invalide en localStorage est ignorée au profit du navigateur', async () => {
    const { detecterLangueInitiale } = await import('@/i18n');
    const stockage = { getItem: () => 'en' };
    expect(detecterLangueInitiale(stockage, 'de-CH')).toBe('de');
  });

  it('sans préférence, la langue du navigateur fr/de/it est retenue', async () => {
    const { detecterLangueInitiale } = await import('@/i18n');
    const vide = { getItem: () => null };
    expect(detecterLangueInitiale(vide, 'it-CH')).toBe('it');
    expect(detecterLangueInitiale(vide, 'de-CH')).toBe('de');
  });

  it('repli sur fr pour une langue non supportée et sans préférence', async () => {
    const { detecterLangueInitiale } = await import('@/i18n');
    const vide = { getItem: () => null };
    expect(detecterLangueInitiale(vide, 'en-US')).toBe('fr');
  });
});

describe('rechargement — la langue choisie survit au F5', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.lang = 'fr';
  });

  afterEach(async () => {
    window.localStorage.clear();
    await i18nSingleton.changeLanguage('fr');
    document.documentElement.lang = 'fr';
  });

  it('localStorage = de : i18n en de et <html lang="de"> après init', async () => {
    window.localStorage.setItem(CLE, 'de');
    const i18n = await recharger();

    expect(i18n.language).toBe('de');
    expect(document.documentElement.lang).toBe('de');
    expect(i18n.t('commun:langue.libelle')).toBe('Sprache');
  });

  it('localStorage = it : i18n en it et <html lang="it"> après init', async () => {
    window.localStorage.setItem(CLE, 'it');
    const i18n = await recharger();

    expect(i18n.language).toBe('it');
    expect(document.documentElement.lang).toBe('it');
    expect(i18n.t('commun:langue.libelle')).toBe('Lingua');
  });
});

describe('useLangue().changerLangue — persistance et <html lang>', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.lang = 'fr';
  });

  afterEach(async () => {
    window.localStorage.clear();
    await i18nSingleton.changeLanguage('fr');
    document.documentElement.lang = 'fr';
  });

  it('un choix en DE est écrit en localStorage, appliqué et reflété dans <html lang>', async () => {
    const { result, unmount } = renderHook(() => useLangue());

    await act(async () => {
      result.current.changerLangue('de');
      await i18nSingleton.changeLanguage('de');
    });

    expect(window.localStorage.getItem(CLE)).toBe('de');
    expect(result.current.langue).toBe('de');
    expect(document.documentElement.lang).toBe('de');
    unmount();
  });

  it('le choix survit à un rechargement simulé', async () => {
    const { result, unmount } = renderHook(() => useLangue());
    await act(async () => {
      result.current.changerLangue('it');
      await i18nSingleton.changeLanguage('it');
    });
    expect(result.current.langue).toBe('it');
    unmount();

    document.documentElement.lang = 'fr';
    const i18n = await recharger();

    expect(i18n.language).toBe('it');
    expect(document.documentElement.lang).toBe('it');
  });
});
