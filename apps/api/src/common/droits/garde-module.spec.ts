import { describe, expect, it, vi } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ModuleApp } from '@dfa/shared';

import type { AccesBase } from '../../db';
import type { ServiceContexteRequete } from '../contexte/contexte-requete.service';
import type { PrincipalAuthentifie } from '../contexte/contexte-requete.types';
import { ErreurMetier } from '../erreurs/erreur-metier';
import { CLE_META_MODULE, ExigerModule, GardeModule } from './garde-module';

const PRINCIPAL: PrincipalAuthentifie = {
  sessionId: 's',
  tenantId: 'tid',
  utilisateurId: 'uid',
  role: 'direction',
  langue: 'fr',
};

function reflectorTest(module: ModuleApp | undefined): Reflector {
  return { getAllAndOverride: vi.fn((cle: string) => (cle === CLE_META_MODULE ? module : undefined)) } as unknown as Reflector;
}

function execution(methode: string): ExecutionContext {
  return {
    getHandler: () => (): void => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ method: methode }) }),
  } as unknown as ExecutionContext;
}

function garde(opts: { module?: ModuleApp; desactives?: ModuleApp[]; principal?: PrincipalAuthentifie | null }) {
  const principal = opts.principal === undefined ? PRINCIPAL : opts.principal;
  const requetes = vi.fn();
  const acces: AccesBase = {
    enTenant: vi.fn((_ctx, travail) =>
      travail({
        select: () => ({
          from: () => ({
            where: () => {
              requetes();
              return Promise.resolve([{ modulesDesactives: opts.desactives ?? [] }]);
            },
          }),
        }),
      } as never),
    ),
    verifierConnexion: vi.fn(),
    verifierPostureRls: vi.fn(),
  };
  const contexte = {
    actuelOuNull: () => ({ principal }),
    contexteTenant: () => ({ tenantId: 'tid', utilisateurId: 'uid', requeteId: 'r' }),
  } as unknown as ServiceContexteRequete;
  return { garde: new GardeModule(reflectorTest(opts.module), contexte, acces), requetes };
}

async function refus(promesse: Promise<boolean>): Promise<ErreurMetier> {
  try {
    await promesse;
  } catch (e) {
    return e as ErreurMetier;
  }
  throw new Error('devait lever');
}

describe('GardeModule', () => {
  it('route sans @ExigerModule : passe sans toucher la base', async () => {
    const { garde: g, requetes } = garde({ desactives: ['pneus'] });
    await expect(g.canActivate(execution('POST'))).resolves.toBe(true);
    expect(requetes).not.toHaveBeenCalled();
  });

  it('écriture sur un module désactivé : 403 MODULE_DESACTIVE', async () => {
    const { garde: g } = garde({ module: 'pneus', desactives: ['pneus'] });
    for (const methode of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const e = await refus(g.canActivate(execution(methode)));
      expect(e).toBeInstanceOf(ErreurMetier);
      expect(e.code).toBe('MODULE_DESACTIVE');
      expect(e.status).toBe(403);
    }
  });

  it('lecture sur un module désactivé : permise (historique, factures liées)', async () => {
    const { garde: g, requetes } = garde({ module: 'pneus', desactives: ['pneus'] });
    for (const methode of ['GET', 'HEAD', 'OPTIONS']) {
      await expect(g.canActivate(execution(methode))).resolves.toBe(true);
    }
    expect(requetes).not.toHaveBeenCalled();
  });

  it('écriture sur un module actif : permise', async () => {
    const { garde: g } = garde({ module: 'pneus', desactives: ['ventes'] });
    await expect(g.canActivate(execution('POST'))).resolves.toBe(true);
  });

  it('dépendance : atelier retiré bloque aussi pointage et tablettes', async () => {
    for (const module of ['pointage', 'tablettes'] as const) {
      const { garde: g } = garde({ module, desactives: ['atelier'] });
      expect((await refus(g.canActivate(execution('POST')))).code).toBe('MODULE_DESACTIVE');
    }
    const { garde: g } = garde({ module: 'planning', desactives: ['atelier'] });
    await expect(g.canActivate(execution('POST'))).resolves.toBe(true);
  });

  it('route publique (aucun principal) : passe', async () => {
    const { garde: g } = garde({ module: 'pneus', desactives: ['pneus'], principal: null });
    await expect(g.canActivate(execution('POST'))).resolves.toBe(true);
  });

  it('ExigerModule pose la métadonnée lue par la garde', () => {
    @ExigerModule('ventes')
    class Exemple {}
    expect(new Reflector().get(CLE_META_MODULE, Exemple)).toBe('ventes');
  });
});
