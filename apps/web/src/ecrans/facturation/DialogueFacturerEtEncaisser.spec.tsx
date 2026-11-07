import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
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
  entree: { groupes: [{ payeur: 'client', payeurClientId: null }], motifsReport: [] },
  totalEstimeCentimes: 10944,
  destinataireNom: 'Jean Dupont',
};

const brouillon = construireDocumentBrut({
  id: 'fact-1',
  numero: null,
  statut: 'brouillon',
  statutReglement: undefined,
  soldeCentimes: undefined,
  totalTtcCentimes: 10944,
  emisLe: null,
  emisPar: null,
});
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

interface Appels {
  facturer: string[];
  emettre: string[];
  paiements: { cle: string | null; corps: Record<string, unknown> }[];
}

function simuler(options: { emissionEnEchec?: boolean } = {}): Appels {
  const appels: Appels = { facturer: [], emettre: [], paiements: [] };
  let emissionsRestantesEnEchec = options.emissionEnEchec ? 1 : 0;
  server.use(
    http.post('/api/v1/ordres-reparation/or-1/facturer', ({ request }) => {
      appels.facturer.push(request.headers.get('Idempotency-Key') ?? '');
      return HttpResponse.json(
        {
          donnees: {
            facturesCreees: [brouillon],
            ordreReparation: { id: 'or-1', statut: 'facture', lignes: [] },
          },
          avertissements: [],
        },
        { status: 201 },
      );
    }),
    http.post('/api/v1/documents-vente/fact-1/emettre', ({ request }) => {
      appels.emettre.push(request.headers.get('Idempotency-Key') ?? '');
      if (emissionsRestantesEnEchec > 0) {
        emissionsRestantesEnEchec -= 1;
        return probleme(500, 'ERREUR_INTERNE');
      }
      return HttpResponse.json({ donnees: emise, avertissements: [] });
    }),
    http.post('/api/v1/paiements', async ({ request }) => {
      appels.paiements.push({
        cle: request.headers.get('Idempotency-Key'),
        corps: (await request.json()) as Record<string, unknown>,
      });
      return HttpResponse.json(
        {
          donnees: {
            id: 'p-1',
            imputations: [{ documentId: 'fact-1', montantCentimes: 10944, nature: 'reglement' }],
          },
          avertissements: [],
        },
        { status: 201 },
      );
    }),
  );
  return appels;
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
  it('nominal : crée, émet, encaisse en espèces (arrondi 5 ct) puis propose le PDF', async () => {
    const appels = simuler();
    const utilisateur = userEvent.setup();
    rendre();

    const dialogue = await screen.findByRole('dialog', { name: 'Facturer et encaisser' });
    expect(
      within(dialogue).getByText(/À encaisser : .*109\.45 \(arrondi au 5 ct, \+0\.01\)/),
    ).toBeInTheDocument();
    await utilisateur.click(
      within(dialogue).getByRole('button', { name: /^Facturer et encaisser/ }),
    );

    expect(await screen.findByText('Facture 2026-00012 émise.')).toBeInTheDocument();
    expect(screen.getByText(/109\.45 encaissés \(Espèces\)/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Télécharger le PDF' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Envoyer par e-mail' })).toBeInTheDocument();

    expect(appels.facturer).toHaveLength(1);
    expect(appels.emettre).toHaveLength(1);
    expect(appels.paiements).toHaveLength(1);
    expect(appels.paiements[0]?.corps).toMatchObject({
      moyen: 'especes',
      montantCentimes: 10945,
      imputations: [{ documentId: 'fact-1', montantCentimes: 10944, nature: 'reglement' }],
    });
  });

  it('TWINT : montant exact au centime, aucun arrondi', async () => {
    const appels = simuler();
    const utilisateur = userEvent.setup();
    rendre();

    const dialogue = await screen.findByRole('dialog');
    await utilisateur.click(within(dialogue).getByLabelText('TWINT'));
    expect(within(dialogue).getByText(/À encaisser : .*109\.44$/)).toBeInTheDocument();
    await utilisateur.click(
      within(dialogue).getByRole('button', { name: /^Facturer et encaisser/ }),
    );

    await screen.findByText('Facture 2026-00012 émise.');
    expect(appels.paiements[0]?.corps).toMatchObject({ moyen: 'twint', montantCentimes: 10944 });
  });

  it('échec à l’émission : la facture créée est conservée, « Réessayer » ne la recrée pas et garde les clés', async () => {
    const appels = simuler({ emissionEnEchec: true });
    const utilisateur = userEvent.setup();
    rendre();

    const dialogue = await screen.findByRole('dialog');
    await utilisateur.click(
      within(dialogue).getByRole('button', { name: /^Facturer et encaisser/ }),
    );

    expect(
      await screen.findByText('La facture est créée mais pas encore émise.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/sans recréer la facture/)).toBeInTheDocument();
    expect(appels.paiements).toHaveLength(0);

    await utilisateur.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByText('Facture 2026-00012 émise.')).toBeInTheDocument();

    expect(appels.facturer).toHaveLength(1);
    expect(appels.emettre).toHaveLength(2);
    expect(appels.emettre[1]).toBe(appels.emettre[0]);
    expect(appels.paiements).toHaveLength(1);
  });

  it('« le client paiera plus tard » : facture émise, aucun paiement envoyé', async () => {
    const appels = simuler();
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
    await waitFor(() => expect(appels.emettre).toHaveLength(1));
    expect(appels.paiements).toHaveLength(0);
  });
});
