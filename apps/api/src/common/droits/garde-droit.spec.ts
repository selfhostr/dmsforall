import { describe, expect, it, vi } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';

import type { ServiceContexteRequete } from '../contexte/contexte-requete.service';
import type { PrincipalAuthentifie } from '../contexte/contexte-requete.types';
import { ErreurMetier } from '../erreurs/erreur-metier';
import { CLE_META_PUBLIC } from '../../auth/decorateurs/public.decorator';
import { CLE_META_ACTION, CLE_META_AUCUN_DROIT, GardeDroit } from './garde-droit';

const PRINCIPAL_RECEPTIONNAIRE: PrincipalAuthentifie = {
  sessionId: 'session-id',
  tenantId: 'tenant-id',
  utilisateurId: 'utilisateur-id',
  role: 'receptionnaire',
  langue: 'fr',
};

const PRINCIPAL_TECHNICIEN: PrincipalAuthentifie = {
  ...PRINCIPAL_RECEPTIONNAIRE,
  role: 'technicien',
};

/** Reflète `getAllAndOverride` avec une table métadonnée → valeur, comme le ferait Nest. */
function reflectorTest(metadonnees: Record<string, unknown>): Reflector {
  return {
    getAllAndOverride: vi.fn((cle: string) => metadonnees[cle]),
  } as unknown as Reflector;
}

function contexteExecutionTest(): ExecutionContext {
  return {
    getHandler: () => (): void => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

function contexteRequeteTest(principal: PrincipalAuthentifie | null): ServiceContexteRequete {
  return {
    exigerPrincipal: vi.fn(() => {
      if (!principal) throw new Error('Aucun principal authentifié dans le contexte de la requête courante.');
      return principal;
    }),
  } as unknown as ServiceContexteRequete;
}

describe('GardeDroit — refus par défaut (route sans marqueur)', () => {
  it('refuse une route sans @Public, @ExigerDroit ni @AucunDroitRequis, même pour un principal authentifié', () => {
    const guard = new GardeDroit(reflectorTest({}), contexteRequeteTest(PRINCIPAL_RECEPTIONNAIRE));

    expect(() => guard.canActivate(contexteExecutionTest())).toThrow(ErreurMetier);
    try {
      guard.canActivate(contexteExecutionTest());
      expect.fail('devait lever');
    } catch (erreur) {
      expect(erreur).toBeInstanceOf(ErreurMetier);
      expect((erreur as ErreurMetier).code).toBe('DROIT_INSUFFISANT');
      expect((erreur as ErreurMetier).status).toBe(403);
    }
  });
});

describe('GardeDroit — @Public', () => {
  it('laisse passer sans exiger de principal, même sans contexte de requête démarré', () => {
    const contexte = {
      exigerPrincipal: vi.fn(() => {
        throw new Error('ne doit jamais être appelé sur une route @Public');
      }),
    } as unknown as ServiceContexteRequete;
    const guard = new GardeDroit(reflectorTest({ [CLE_META_PUBLIC]: true }), contexte);

    expect(guard.canActivate(contexteExecutionTest())).toBe(true);
    expect(contexte.exigerPrincipal).not.toHaveBeenCalled();
  });

  it('@Public prime même si @ExigerDroit est posé par erreur à côté', () => {
    const contexte = {
      exigerPrincipal: vi.fn(() => {
        throw new Error('ne doit jamais être appelé');
      }),
    } as unknown as ServiceContexteRequete;
    const guard = new GardeDroit(
      reflectorTest({ [CLE_META_PUBLIC]: true, [CLE_META_ACTION]: 'client.lire' }),
      contexte,
    );

    expect(guard.canActivate(contexteExecutionTest())).toBe(true);
  });
});

describe('GardeDroit — @ExigerDroit', () => {
  it('autorise un rôle qui porte le droit requis', () => {
    const guard = new GardeDroit(
      reflectorTest({ [CLE_META_ACTION]: 'client.lire' }),
      contexteRequeteTest(PRINCIPAL_RECEPTIONNAIRE),
    );

    expect(guard.canActivate(contexteExecutionTest())).toBe(true);
  });

  it('refuse un rôle qui ne porte pas le droit requis (DROIT_INSUFFISANT, 403)', () => {
    const guard = new GardeDroit(
      reflectorTest({ [CLE_META_ACTION]: 'client.condition.modifier' }),
      contexteRequeteTest(PRINCIPAL_TECHNICIEN),
    );

    try {
      guard.canActivate(contexteExecutionTest());
      expect.fail('devait lever');
    } catch (erreur) {
      expect(erreur).toBeInstanceOf(ErreurMetier);
      expect((erreur as ErreurMetier).code).toBe('DROIT_INSUFFISANT');
      expect((erreur as ErreurMetier).status).toBe(403);
    }
  });
});

describe('GardeDroit — @AucunDroitRequis', () => {
  it('autorise tout principal authentifié, sans consulter MATRICE_DROITS', () => {
    const guard = new GardeDroit(
      reflectorTest({ [CLE_META_AUCUN_DROIT]: true }),
      contexteRequeteTest(PRINCIPAL_TECHNICIEN),
    );

    expect(guard.canActivate(contexteExecutionTest())).toBe(true);
  });

  it('propage l’erreur si, malgré tout, aucun principal n’est attaché (défense en profondeur)', () => {
    const guard = new GardeDroit(reflectorTest({ [CLE_META_AUCUN_DROIT]: true }), contexteRequeteTest(null));

    expect(() => guard.canActivate(contexteExecutionTest())).toThrow(
      'Aucun principal authentifié dans le contexte de la requête courante.',
    );
  });
});
