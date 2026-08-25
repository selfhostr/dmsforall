import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createHash } from 'node:crypto';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { ReponseDossierReprise } from '@dfa/shared';

import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { useTeleversementArchive } from './useTeleversementArchive';

function enveloppe() {
  const queryClient = creerQueryClientTest();
  return function Enveloppe({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function empreinteDe(contenu: string): string {
  return createHash('sha256').update(contenu).digest('hex');
}

function fichierDeTest(contenu: string, nom = 'archive.zip'): File {
  return new File([contenu], nom, { type: 'application/zip' });
}

function dossierEnCoursDeTest(
  partiel: Omit<Partial<ReponseDossierReprise>, 'archive'> & {
    archive?: Partial<ReponseDossierReprise['archive']>;
  } = {},
): ReponseDossierReprise {
  // Déstructuré plutôt que spread deux fois : `...partiel` en fin d'objet réinjecterait
  // `archive?: Partial<ArchiveDeposeeReprise>` PAR-DESSUS l'objet `archive` déjà complété
  // ci-dessous, avec le même défaut de typage qu'un spread de `Partial<T>` sur des valeurs par
  // défaut requises (TypeScript retient le type OPTIONNEL du dernier spread, `T | undefined`,
  // même quand la valeur réelle est absente à l'exécution). La déstructuration exclut `archive`
  // du type de `resteSansArchive` de façon PRÉCISE (`Omit`), pas seulement à l'exécution.
  const { archive: archivePartiel, ...resteSansArchive } = partiel;
  return {
    id: 'dossier-1',
    statut: 'depot_en_cours',
    archive: {
      tailleOctetsAnnoncee: archivePartiel?.tailleOctetsAnnoncee ?? 30,
      octetsRecus: archivePartiel?.octetsRecus ?? 0,
      dernierNumeroTrancheRecuContigu: archivePartiel?.dernierNumeroTrancheRecuContigu ?? null,
      empreinteSha256Annoncee:
        archivePartiel?.empreinteSha256Annoncee ?? empreinteDe('x'.repeat(30)),
      empreinteSha256Verifiee: archivePartiel?.empreinteSha256Verifiee ?? null,
      integriteValidee: archivePartiel?.integriteValidee ?? null,
    },
    analyseId: null,
    planId: null,
    importId: null,
    creeLe: '2026-08-24T08:00:00.000Z',
    modifieLe: '2026-08-24T08:00:00.000Z',
    ...resteSansArchive,
  };
}

describe('useTeleversementArchive — dépôt initial', () => {
  it('crée le dossier, envoie les tranches dans l’ordre puis finalise', async () => {
    const contenu = 'a'.repeat(50);
    const empreinte = empreinteDe(contenu);
    const numerosRecus: number[] = [];

    server.use(
      http.post('/api/v1/reprise/dossiers', async ({ request }) => {
        const corps = (await request.json()) as { empreinteSha256Annoncee: string };
        expect(corps.empreinteSha256Annoncee).toBe(empreinte);
        return HttpResponse.json({
          dossier: dossierEnCoursDeTest({
            archive: { tailleOctetsAnnoncee: 50, empreinteSha256Annoncee: empreinte },
          }),
          tailleTrancheRecommandeeOctets: 20,
        });
      }),
      http.put('/api/v1/reprise/dossiers/:id/tranches/:numero', ({ params }) => {
        const numero = Number(params.numero);
        numerosRecus.push(numero);
        return HttpResponse.json({
          numero,
          octetsRecus: Math.min((numero + 1) * 20, 50),
          toutesTranchesRecues: (numero + 1) * 20 >= 50,
        });
      }),
      http.post('/api/v1/reprise/dossiers/:id/finaliser', async ({ request }) => {
        const corps = (await request.json()) as { empreinteSha256Calculee: string };
        expect(corps.empreinteSha256Calculee).toBe(empreinte);
        return HttpResponse.json(dossierEnCoursDeTest({ statut: 'depot_receptionne' }));
      }),
    );

    const { result } = renderHook(() => useTeleversementArchive(null), { wrapper: enveloppe() });

    act(() => {
      result.current.demarrerDepot(fichierDeTest(contenu));
    });

    await waitFor(() => expect(result.current.etat.phase).toBe('termine'));
    // Trois tranches de 20 octets pour couvrir 50 octets : 0, 1, 2 — dans l'ordre, sans trou.
    expect(numerosRecus).toEqual([0, 1, 2]);
  });
});

describe('useTeleversementArchive — reprise après interruption', () => {
  it('repart au numéro de tranche contigu suivant, sans renvoyer ce qui est déjà reçu', async () => {
    const contenu = 'b'.repeat(50);
    const empreinte = empreinteDe(contenu);
    const dossier = dossierEnCoursDeTest({
      id: 'dossier-repris',
      archive: {
        tailleOctetsAnnoncee: 50,
        empreinteSha256Annoncee: empreinte,
        // Deux tranches de 20 octets déjà reçues (numéros 0 et 1) : 40 octets, la suite doit
        // reprendre au numéro 2, PAS au numéro 0.
        octetsRecus: 40,
        dernierNumeroTrancheRecuContigu: 1,
      },
    });

    const numerosRecus: number[] = [];
    let appelCreerDossier = false;

    server.use(
      http.post('/api/v1/reprise/dossiers', () => {
        appelCreerDossier = true;
        return HttpResponse.error();
      }),
      http.get('/api/v1/reprise/dossiers/:id/tranches', () => HttpResponse.json(dossier.archive)),
      http.put('/api/v1/reprise/dossiers/:id/tranches/:numero', ({ params }) => {
        const numero = Number(params.numero);
        numerosRecus.push(numero);
        return HttpResponse.json({ numero, octetsRecus: 50, toutesTranchesRecues: true });
      }),
      http.post('/api/v1/reprise/dossiers/:id/finaliser', () =>
        HttpResponse.json(dossierEnCoursDeTest({ statut: 'depot_receptionne' })),
      ),
    );

    const { result } = renderHook(
      () => useTeleversementArchive(dossier, { tailleTrancheOctetsDefaut: 20 }),
      {
        wrapper: enveloppe(),
      },
    );

    act(() => {
      result.current.demarrerDepot(fichierDeTest(contenu));
    });

    await waitFor(() => expect(result.current.etat.phase).toBe('termine'));

    // LA preuve exigée par la mission : reprend au numéro 2 (les tranches 0 et 1 étaient déjà
    // reçues), jamais renvoyées.
    expect(numerosRecus).toEqual([2]);
    expect(appelCreerDossier).toBe(false);
  });

  it('refuse un fichier de taille différente sans envoyer un seul octet', async () => {
    const dossier = dossierEnCoursDeTest({ archive: { tailleOctetsAnnoncee: 999 } });
    const gestionnairePut = vi.fn(() =>
      HttpResponse.json({ numero: 0, octetsRecus: 1, toutesTranchesRecues: false }),
    );
    server.use(http.put('/api/v1/reprise/dossiers/:id/tranches/:numero', gestionnairePut));

    const { result } = renderHook(() => useTeleversementArchive(dossier), { wrapper: enveloppe() });

    act(() => {
      result.current.demarrerDepot(fichierDeTest('contenu different'));
    });

    await waitFor(() => expect(result.current.etat.phase).toBe('erreur'));
    expect(result.current.etat.erreur).toBe('tailleInattendue');
    expect(gestionnairePut).not.toHaveBeenCalled();
  });

  it('refuse un fichier différent (empreinte différente) après vérification, sans envoyer un octet', async () => {
    const contenu = 'c'.repeat(30);
    const dossier = dossierEnCoursDeTest({
      archive: {
        tailleOctetsAnnoncee: 30,
        empreinteSha256Annoncee: empreinteDe('autre contenu de 30 caracteres'),
      },
    });
    const gestionnairePut = vi.fn(() =>
      HttpResponse.json({ numero: 0, octetsRecus: 1, toutesTranchesRecues: false }),
    );
    server.use(http.put('/api/v1/reprise/dossiers/:id/tranches/:numero', gestionnairePut));

    const { result } = renderHook(() => useTeleversementArchive(dossier), { wrapper: enveloppe() });

    act(() => {
      result.current.demarrerDepot(fichierDeTest(contenu));
    });

    await waitFor(() => expect(result.current.etat.phase).toBe('erreur'));
    expect(result.current.etat.erreur).toBe('fichierDifferent');
    expect(gestionnairePut).not.toHaveBeenCalled();
  });
});

describe('useTeleversementArchive — retry réseau', () => {
  it('réessaie une tranche après une erreur réseau transitoire, puis termine avec succès', async () => {
    let tentatives = 0;
    server.use(
      http.post('/api/v1/reprise/dossiers', () =>
        HttpResponse.json({
          dossier: dossierEnCoursDeTest({ archive: { tailleOctetsAnnoncee: 10 } }),
          tailleTrancheRecommandeeOctets: 10,
        }),
      ),
      http.put('/api/v1/reprise/dossiers/:id/tranches/:numero', () => {
        tentatives += 1;
        if (tentatives === 1) {
          return HttpResponse.error();
        }
        return HttpResponse.json({ numero: 0, octetsRecus: 10, toutesTranchesRecues: true });
      }),
      http.post('/api/v1/reprise/dossiers/:id/finaliser', () =>
        HttpResponse.json(dossierEnCoursDeTest({ statut: 'depot_receptionne' })),
      ),
    );

    const attendreFn = vi.fn(() => Promise.resolve());
    const { result } = renderHook(() => useTeleversementArchive(null, { attendreFn }), {
      wrapper: enveloppe(),
    });

    act(() => {
      result.current.demarrerDepot(fichierDeTest('0123456789'));
    });

    await waitFor(() => expect(result.current.etat.phase).toBe('termine'));
    expect(tentatives).toBe(2);
    expect(attendreFn).toHaveBeenCalled();
  });
});
