import { afterEach, describe, expect, it, vi } from 'vitest';

import { ecrireBrouillon, effacerBrouillon, lireBrouillon } from './brouillon';

interface ValeursTest {
  readonly demandeClient: string;
  readonly kilometrage: number | null;
}

describe('brouillon — lireBrouillon/ecrireBrouillon/effacerBrouillon', () => {
  afterEach(() => {
    window.sessionStorage.clear();
    vi.useRealTimers();
  });

  it('lireBrouillon : absent tant que rien n’a été écrit', () => {
    expect(lireBrouillon<ValeursTest>('nouvel-or')).toBeUndefined();
  });

  it('ecrireBrouillon puis lireBrouillon : retrouve exactement les valeurs écrites', () => {
    const valeurs: ValeursTest = { demandeClient: 'Bruit au freinage avant', kilometrage: 84200 };
    ecrireBrouillon('nouvel-or', valeurs);

    expect(lireBrouillon<ValeursTest>('nouvel-or')?.valeurs).toEqual(valeurs);
  });

  it('horodate l’écriture (ISO 8601), lu par BandeauBrouillon via `repriseLe`', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-12T07:12:00.000Z'));

    ecrireBrouillon('nouvel-or', { demandeClient: 'x', kilometrage: null });

    expect(lireBrouillon<ValeursTest>('nouvel-or')?.enregistreLe).toBe('2026-08-12T07:12:00.000Z');
  });

  it('une écriture postérieure REMPLACE la précédente sous la même clé', () => {
    ecrireBrouillon('nouvel-or', { demandeClient: 'premier jet', kilometrage: 1 });
    ecrireBrouillon('nouvel-or', { demandeClient: 'texte corrigé', kilometrage: 2 });

    expect(lireBrouillon<ValeursTest>('nouvel-or')?.valeurs.demandeClient).toBe('texte corrigé');
  });

  it('deux clés distinctes ne se marchent jamais dessus', () => {
    ecrireBrouillon('nouvel-or', { demandeClient: 'OR', kilometrage: 1 });
    ecrireBrouillon('nouveau-client', { demandeClient: 'client', kilometrage: null });

    expect(lireBrouillon<ValeursTest>('nouvel-or')?.valeurs.demandeClient).toBe('OR');
    expect(lireBrouillon<ValeursTest>('nouveau-client')?.valeurs.demandeClient).toBe('client');
  });

  it('effacerBrouillon : le brouillon redevient absent, jamais un objet vide', () => {
    ecrireBrouillon('nouvel-or', { demandeClient: 'x', kilometrage: 1 });
    effacerBrouillon('nouvel-or');

    expect(lireBrouillon<ValeursTest>('nouvel-or')).toBeUndefined();
  });

  it('un contenu corrompu en stockage est traité comme une absence, jamais comme une erreur', () => {
    window.sessionStorage.setItem('dfa.brouillon.nouvel-or', '{ceci n’est pas du JSON');

    expect(lireBrouillon<ValeursTest>('nouvel-or')).toBeUndefined();
  });

  it('une forme inattendue (sans `enregistreLe`) est traitée comme une absence', () => {
    window.sessionStorage.setItem(
      'dfa.brouillon.nouvel-or',
      JSON.stringify({ valeurs: { demandeClient: 'x' } }),
    );

    expect(lireBrouillon<ValeursTest>('nouvel-or')).toBeUndefined();
  });

  it('survit à un rechargement de page dans le même onglet (sessionStorage, pas la mémoire React)', () => {
    // Rien à simuler explicitement : `ecrireBrouillon`/`lireBrouillon` passent exclusivement par
    // `window.sessionStorage`, jamais par une variable de module — ce test verrouille cette
    // propriété au niveau de l'API plutôt que de l'affirmer en commentaire.
    ecrireBrouillon('nouvel-or', { demandeClient: 'avant reload', kilometrage: 500 });

    expect(window.sessionStorage.getItem('dfa.brouillon.nouvel-or')).not.toBeNull();
    expect(lireBrouillon<ValeursTest>('nouvel-or')?.valeurs.demandeClient).toBe('avant reload');
  });
});
