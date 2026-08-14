import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mocke le module entier (même patron que `PanneauResultatsRecherche.spec.tsx`) : évite tout besoin
// de `QueryClientProvider`, `useSession` ne passe jamais par le vrai `useQuery` dans ce test.
const { useSessionMock } = vi.hoisted(() => ({ useSessionMock: vi.fn() }));
vi.mock('@/hooks/useSession', () => ({ useSession: useSessionMock }));

import { useVueAgendaPreferee } from './useVueAgendaPreferee';

function sessionUtilisateur(id: string) {
  return { data: { utilisateur: { id } } } as never;
}

describe('useVueAgendaPreferee', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('retombe sur "semaine" par défaut, tant que la session n’est pas résolue', () => {
    useSessionMock.mockReturnValue({ data: undefined });
    const { result } = renderHook(() => useVueAgendaPreferee());
    expect(result.current[0]).toBe('semaine');
  });

  it('mémorise le choix PAR UTILISATEUR, retrouvé après un remontage', () => {
    useSessionMock.mockReturnValue(sessionUtilisateur('u-1'));
    const { result, unmount } = renderHook(() => useVueAgendaPreferee());

    act(() => result.current[1]('jour'));
    expect(result.current[0]).toBe('jour');
    unmount();

    const second = renderHook(() => useVueAgendaPreferee());
    expect(second.result.current[0]).toBe('jour');
  });

  it('ne mélange jamais la préférence de deux utilisateurs différents (même poste partagé)', () => {
    useSessionMock.mockReturnValue(sessionUtilisateur('u-1'));
    const premier = renderHook(() => useVueAgendaPreferee());
    act(() => premier.result.current[1]('jour'));
    premier.unmount();

    useSessionMock.mockReturnValue(sessionUtilisateur('u-2'));
    const second = renderHook(() => useVueAgendaPreferee());
    expect(second.result.current[0]).toBe('semaine');
  });
});
