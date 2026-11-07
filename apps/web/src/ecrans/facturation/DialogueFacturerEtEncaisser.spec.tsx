import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import '@/i18n';

import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import {
  DialogueFacturerEtEncaisser,
  type DemandeFacturerEtEncaisser,
} from './DialogueFacturerEtEncaisser';
import { construireDocumentBrut } from './document.fixture';

const DEMANDE: DemandeFacturerEtEncaisser = {
  orId: 'or-1',
  totalEstimeCentimes: 10944,
  destinataireNom: 'Jean Dupont',
};

const emise = construireDocumentBrut({
  id: 'fact-1',
  numero: '2026-00012',
  soldeCentimes: 10944,
  totalTtcCentimes: 10944,
  qr: {} as never,
});

function probleme(status: number, code: string) {
  return HttpResponse.json(
    {
      type: `https://docs.dmsforall.example/erreurs/${code}`,
      title: code,
      status,
      code,
      instance: '',
    },
    { status, headers: { 'Content-Type': 'application/problem+json' } },
  );
}

interface Appel {
  cle: string | null;
  corps: Record<string, unknown>;
}

function reponseUnique(options: { paiement?: boolean; echec?: boolean; montant?: number } = {}) {
  const montant = options.montant ?? 10945;
  return HttpResponse.json(
    {
      donnees: {
        facture: emise,
        ...(options.paiement === false || options.echec
          ? {}
          : {
              paiement: {
                id: 'p-1',
                moyen: 'especes',
                montantCentimes: montant,
                imputations: [],
              },
            }),
        ordreReparation: { id: 'or-1', statut: 'facture', lignes: [] },
      },
      avertissements: options.echec
        ? [{ code: 'ENCAISSEMENT_ECHOUE', message: 'x', donnees: {} }]
        : [],
    },
    { status: 201 },
  );
}

function simuler(reponses: (() => Response)[] = [() => reponseUnique()]): {
  appels: Appel[];
  paiements: Appel[];
} {
  const appels: Appel[] = [];
  const paiements: Appel[] = [];
  let i = 0;
  server.use(
    http.post('/api/v1/ordres-reparation/or-1/facturer-et-encaisser', async ({ request }) => {
      appels.push({
        cle: request.headers.get('Idempotency-Key'),
        corps: (await request.json()) as Record<string, unknown>,
      });
      const fabrique = reponses[Math.min(i, reponses.length - 1)];
      i += 1;
      return fabrique ? fabrique() : reponseUnique();
    }),
    http.post('/api/v1/paiements', async ({ request }) => {
      paiements.push({
        cle: request.headers.get('Idempotency-Key'),
        corps: (await request.json()) as Record<string, unknown>,
      });
      return HttpResponse.json(
        { donnees: { id: 'p-2', imputations: [] }, avertissements: [] },
        { status: 201 },
      );
    }),
  );
  return { appels, paiements };
}

function rendre() {
  const onFermer = vi.fn();
  render(
    <QueryClientProvider client={creerQueryClientTest()}>
      <DialogueFacturerEtEncaisser
        demande={DEMANDE}
        onFermer={onFermer}
        onOuvrirFacture={() => {}}
      />
    </QueryClientProvider>,
  );
  return { onFermer };
}

describe('DialogueFacturerEtEncaisser', () => {
  it('nominal : un seul appel, affiche le montant espèces rendu par le serveur', async () => {
    const { appels, paiements } = simuler();
    const utilisateur = userEvent.setup();
    rendre();

    const dialogue = await screen.findByRole('dialog', { name: 'Facturer et encaisser' });
    await utilisateur.click(
      within(dialogue).getByRole('button', { name: /^Facturer et encaisser/ }),
    );

    expect(await screen.findByText('Facture 2026-00012 émise.')).toBeInTheDocument();
    expect(screen.getByText(/109\.45 encaissés \(Espèces\)/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Télécharger le PDF' })).toBeInTheDocument();
    expect(appels).toHaveLength(1);
    expect(appels[0]?.cle).toBeTruthy();
    expect(appels[0]?.corps).toEqual({ paiement: { mode: 'especes' } });
    expect(paiements).toHaveLength(0);
  });

  it('TWINT : le mode part au serveur', async () => {
    const { appels } = simuler([() => reponseUnique({ montant: 10944 })]);
    const utilisateur = userEvent.setup();
    rendre();

    const dialogue = await screen.findByRole('dialog');
    await utilisateur.click(within(dialogue).getByLabelText('TWINT'));
    await utilisateur.click(
      within(dialogue).getByRole('button', { name: /^Facturer et encaisser/ }),
    );

    await screen.findByText('Facture 2026-00012 émise.');
    expect(appels[0]?.corps).toEqual({ paiement: { mode: 'twint' } });
  });

  it('échec réseau : « Réessayer » rejoue la MÊME clé d’idempotence', async () => {
    const { appels } = simuler([() => probleme(500, 'ERREUR_INTERNE'), () => reponseUnique()]);
    const utilisateur = userEvent.setup();
    rendre();

    const dialogue = await screen.findByRole('dialog');
    await utilisateur.click(
      within(dialogue).getByRole('button', { name: /^Facturer et encaisser/ }),
    );
    expect(await screen.findByText('La facture n’a pas pu être créée.')).toBeInTheDocument();

    await utilisateur.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByText('Facture 2026-00012 émise.')).toBeInTheDocument();
    expect(appels).toHaveLength(2);
    expect(appels[1]?.cle).toBe(appels[0]?.cle);
  });

  it('ENCAISSEMENT_ECHOUE : facture émise, « Encaisser maintenant » encaisse via POST /paiements', async () => {
    const { appels, paiements } = simuler([() => reponseUnique({ echec: true })]);
    const utilisateur = userEvent.setup();
    rendre();

    const dialogue = await screen.findByRole('dialog');
    await utilisateur.click(
      within(dialogue).getByRole('button', { name: /^Facturer et encaisser/ }),
    );
    expect(await screen.findByText(/l’encaissement n’a pas abouti/)).toBeInTheDocument();

    await utilisateur.click(screen.getByRole('button', { name: 'Encaisser maintenant' }));
    expect(await screen.findByText(/109\.45 encaissés \(Espèces\)/)).toBeInTheDocument();
    expect(appels).toHaveLength(1);
    expect(paiements).toHaveLength(1);
    expect(paiements[0]?.corps).toMatchObject({ moyen: 'especes', montantCentimes: 10945 });
  });

  it('« le client paiera plus tard » : facture émise, corps sans paiement', async () => {
    const { appels, paiements } = simuler([() => reponseUnique({ paiement: false })]);
    const utilisateur = userEvent.setup();
    rendre();

    const dialogue = await screen.findByRole('dialog');
    await utilisateur.click(within(dialogue).getByLabelText('Le client paiera plus tard'));
    await utilisateur.click(
      within(dialogue).getByRole('button', { name: 'Facturer sans encaisser' }),
    );

    expect(
      await screen.findByText('Facture émise, à régler plus tard par le client.'),
    ).toBeInTheDocument();
    expect(appels[0]?.corps).toEqual({});
    expect(paiements).toHaveLength(0);
  });
});
