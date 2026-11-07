import { describe, expect, it } from 'vitest';

import { ServicePolitiqueMotDePasse } from './politique-mot-de-passe';

describe('ServicePolitiqueMotDePasse.verifier', () => {
  const service = new ServicePolitiqueMotDePasse();
  const INDICES = { email: 'julie.rey@garage-martin.ch' };

  it('accepte un mot de passe long, non commun, sans lien avec l’email', () => {
    expect(() => service.verifier('cheval-montagne-brouillard-42', INDICES)).not.toThrow();
  });

  it('refuse un mot de passe de la liste des plus communs, peu importe la casse (comparaison normalisée)', () => {
    expect(() => service.verifier('Password1234', INDICES)).toThrow(); // 'password1234'
    expect(() => service.verifier('PASSWORD1234', INDICES)).toThrow(); // même normalisation
  });

  it('refuse un caractère unique répété sur toute la longueur', () => {
    expect(() => service.verifier('aaaaaaaaaaaa', INDICES)).toThrow();
  });

  it('refuse une séquence alphabétique strictement croissante', () => {
    expect(() => service.verifier('abcdefghijkl', INDICES)).toThrow();
  });

  it('refuse une séquence strictement décroissante (alphabet — les chiffres seuls ne comptent que 10 valeurs, insuffisant pour un cas ≥ 12 caractères)', () => {
    expect(() => service.verifier('zyxwvutsrqpo', INDICES)).toThrow();
  });

  it('refuse un mot de passe contenant la partie locale de l’email du compte', () => {
    expect(() => service.verifier('julie.rey-est-super', INDICES)).toThrow();
  });

  it('accepte un mot de passe qui contient une sous-chaîne courte non significative de l’email (partie locale < 4 caractères ignorée)', () => {
    expect(() =>
      service.verifier('un-mot-de-passe-tres-solide', { email: 'jr@garage-martin.ch' }),
    ).not.toThrow();
  });

  it('lève VALIDATION_ECHOUEE avec un champ dédié quand le mot de passe est trop commun', () => {
    expect.assertions(2);
    try {
      service.verifier('11111111111', INDICES);
    } catch (erreur) {
      expect((erreur as { code?: string }).code).toBe('VALIDATION_ECHOUEE');
      expect((erreur as { erreurs?: unknown[] }).erreurs?.[0]).toMatchObject({
        champ: 'nouveauMotDePasse',
      });
    }
  });

  describe('nomme le motif exact du refus (detail + code)', () => {
    function capter(motDePasse: string): { message: string; code: string | undefined } {
      try {
        service.verifier(motDePasse, INDICES);
      } catch (erreur) {
        const e = erreur as { message: string; erreurs?: Array<{ code?: string }> };
        return { message: e.message, code: e.erreurs?.[0]?.code };
      }
      throw new Error('aucun refus');
    }

    it('liste des plus courants : « trop courant »', () => {
      const r = capter('password1234');
      expect(r.code).toBe('mot_de_passe_trop_commun');
      expect(r.message).toContain('trop courant');
    });

    it('motif structurel : « trop prévisible »', () => {
      const r = capter('abcdefghijkl');
      expect(r.code).toBe('mot_de_passe_trop_previsible');
      expect(r.message).toContain('trop prévisible');
    });

    it('contient le courriel : le dit', () => {
      const r = capter('julie.rey-est-super');
      expect(r.code).toBe('mot_de_passe_contient_email');
      expect(r.message).toContain('adresse courriel');
    });
  });
});
