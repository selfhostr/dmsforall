import type { ErrorEvent, EventHint } from '@sentry/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProblemeDetail } from '@dfa/shared';

import { ErreurApi, ErreurReseau } from '@/api/erreurs';
import { definirEnvPourTests } from '@/config/env';

import { initialiserSentry, signalerErreur } from './sentry';

/**
 * Fichier séparé de sentry.spec.ts : `vi.mock('@sentry/react', …)` s'applique à tout le fichier
 * (hoisté par Vitest) et un DSN doit être configuré pour que `initialiserSentry()` charge
 * effectivement le SDK — les deux sont incompatibles avec les scénarios « pas de DSN » de
 * sentry.spec.ts, d'où l'isolation.
 */

interface ScopeSimulee {
  readonly setTag: ReturnType<typeof vi.fn>;
  readonly setContext: ReturnType<typeof vi.fn>;
}

const setTag = vi.fn();
const setContext = vi.fn();
const captureException = vi.fn(() => 'id-evenement-test');
const init = vi.fn();

vi.mock('@sentry/react', () => ({
  init,
  withScope: (callback: (scope: ScopeSimulee) => void) => callback({ setTag, setContext }),
  captureException,
}));

function probleme(status: number, code: ProblemeDetail['code'] = 'ERREUR_INTERNE'): ProblemeDetail {
  return {
    type: `https://docs.dmsforall.example/erreurs/${code}`,
    title: 'Test',
    status,
    code,
    instance: 'req-corr-42',
  };
}

beforeEach(() => {
  // `initialiserSentry()` est idempotente (promesse mise en cache) : `init` n'est donc rappelé
  // qu'une seule fois pour tout le fichier — on ne vide JAMAIS son historique, dont
  // `beforeSendConfigure()` (plus bas) a besoin à n'importe quel moment du fichier. En
  // revanche l'historique de `captureException` / `setTag` / `setContext` DOIT être vidé entre
  // chaque cas, sans quoi un test « ne capture jamais » verrait les appels laissés par le test
  // de corrélation précédent.
  setTag.mockClear();
  setContext.mockClear();
  captureException.mockClear();
  definirEnvPourTests({
    VITE_API_URL: '/api/v1',
    VITE_SENTRY_DSN: 'https://cle@sentry.exemple.ch/1',
  });
  initialiserSentry();
});

describe('signalerErreur — corrélation et filtrage du bruit', () => {
  it('attache l’identifiant de corrélation (X-Requete-Id, repris en `instance`) comme tag Sentry', async () => {
    const erreur = new ErreurApi(probleme(500));
    await signalerErreur(erreur);
    expect(setTag).toHaveBeenCalledWith('requeteId', 'req-corr-42');
    expect(setTag).toHaveBeenCalledWith('codeErreurApi', 'ERREUR_INTERNE');
    expect(captureException).toHaveBeenCalledWith(erreur);
  });

  it('ne capture jamais une ErreurApi 4xx : fonctionnement nominal, pas un incident', async () => {
    await signalerErreur(new ErreurApi(probleme(401, 'AUTH_SESSION_EXPIREE')));
    expect(captureException).not.toHaveBeenCalled();
  });

  it('ne capture jamais une ErreurReseau : très majoritairement du wifi d’atelier', async () => {
    await signalerErreur(new ErreurReseau());
    expect(captureException).not.toHaveBeenCalled();
  });
});

describe('beforeSend — filet de filtrage du bruit hors signalerErreur', () => {
  /** `beforeSend` doit rejeter le même bruit que `doitIgnorerErreur`, y compris pour les
   *  événements que les intégrations PAR DÉFAUT du SDK capturent automatiquement (erreurs
   *  globales `window.onerror`, rejets de promesse non gérés) — ces captures ne passent JAMAIS
   *  par `signalerErreur`, donc le filtrage doit aussi vivre dans `beforeSend` lui-même. */
  function beforeSendConfigure(): (evenement: ErrorEvent, indice: EventHint) => ErrorEvent | null {
    const options = init.mock.calls.at(-1)?.[0] as {
      beforeSend: (e: ErrorEvent, h: EventHint) => ErrorEvent | null;
    };
    return options.beforeSend;
  }

  it('rejette un événement dont l’exception d’origine est une ErreurReseau', () => {
    const beforeSend = beforeSendConfigure();
    const resultat = beforeSend({ type: undefined }, { originalException: new ErreurReseau() });
    expect(resultat).toBeNull();
  });

  it('rejette un événement dont l’exception d’origine est une ErreurApi 4xx', () => {
    const beforeSend = beforeSendConfigure();
    const resultat = beforeSend(
      { type: undefined },
      { originalException: new ErreurApi(probleme(404, 'RESSOURCE_INTROUVABLE')) },
    );
    expect(resultat).toBeNull();
  });

  it('laisse passer un événement dont l’exception d’origine est un vrai bug applicatif', () => {
    const beforeSend = beforeSendConfigure();
    const resultat = beforeSend({ type: undefined }, { originalException: new Error('bug réel') });
    expect(resultat).not.toBeNull();
  });
});
