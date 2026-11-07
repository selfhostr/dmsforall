import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';

import '@/i18n';

import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { construireDocumentBrut } from './document.fixture';
import { EcranFicheFacture } from './EcranFicheFacture';

function rendre() {
  return render(
    <QueryClientProvider client={creerQueryClientTest()}>
      <MemoryRouter initialEntries={['/factures/devis-1']}>
        <Routes>
          <Route path="/factures/:id" element={<EcranFicheFacture />} />
          <Route path="/ordres-reparation/:orId" element={<p>Fiche OR ouverte</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function installerDevis(overrides: Parameters<typeof construireDocumentBrut>[0] = {}) {
  server.use(
    http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
    http.get('/api/v1/documents-vente/devis-1', () =>
      HttpResponse.json(
        construireDocumentBrut({
          id: 'devis-1',
          typeDocument: 'devis',
          natureFacture: null,
          numero: null,
          statut: 'brouillon',
          statutReglement: undefined,
          soldeCentimes: undefined,
          qr: null,
          emisLe: null,
          emisPar: null,
          ...overrides,
        }),
      ),
    ),
  );
}

describe('EcranFicheFacture — devis', () => {
  it('titre un devis en brouillon « Nouveau devis », jamais « Nouvelle facture »', async () => {
    installerDevis();
    rendre();

    expect(await screen.findByRole('heading', { name: 'Nouveau devis' })).toBeInTheDocument();
    expect(screen.queryByText('Nouvelle facture')).not.toBeInTheDocument();
  });

  it('propose « Télécharger le PDF » pour un devis, et affiche l’erreur DOCUMENT_PDF_INDISPONIBLE tant que l’API ne le produit pas', async () => {
    installerDevis({ numero: '2026-D-00001', statut: 'emis' });
    server.use(
      http.get('/api/v1/documents-vente/devis-1/pdf', () =>
        HttpResponse.json(
          {
            type: 'https://docs.dmsforall.example/erreurs/DOCUMENT_PDF_INDISPONIBLE',
            title: 'Document PDF pas encore disponible',
            status: 409,
            code: 'DOCUMENT_PDF_INDISPONIBLE',
            instance: '',
          },
          { status: 409, headers: { 'Content-Type': 'application/problem+json' } },
        ),
      ),
    );
    const utilisateur = userEvent.setup();
    rendre();

    await utilisateur.click(await screen.findByRole('button', { name: 'Télécharger le PDF' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Le PDF n'est pas encore prêt. Patientez quelques instants, puis réessayez.",
    );
  });

  it('un devis brouillon parle de devis : « Envoyer », jamais « facture », « bulletin » ni « émise le »', async () => {
    installerDevis();
    const utilisateur = userEvent.setup();
    rendre();

    expect(await screen.findByText('Brouillon')).toBeInTheDocument();
    expect(screen.queryByText(/émise le/)).not.toBeInTheDocument();
    expect(screen.queryByText(/envoyé le/)).not.toBeInTheDocument();

    await utilisateur.click(await screen.findByRole('button', { name: 'Envoyer le devis' }));
    const dialogue = await screen.findByRole('dialog');
    expect(within(dialogue).getByText('Envoyer le devis ?')).toBeInTheDocument();
    expect(dialogue).not.toHaveTextContent(/facture/i);
    expect(dialogue).not.toHaveTextContent(/bulletin/i);
  });

  it('un devis envoyé affiche « Envoyé » et « envoyé le », sans état de règlement ni « Facture émise »', async () => {
    installerDevis({ numero: '2026-D-00001', statut: 'emis', statutReglement: 'non_regle' });
    rendre();

    expect(await screen.findByText('Envoyé')).toBeInTheDocument();
    expect(screen.getByText('envoyé le 01.07.2026')).toBeInTheDocument();
    expect(screen.queryByText('Non réglée')).not.toBeInTheDocument();
    expect(screen.queryByText('Émise')).not.toBeInTheDocument();
    expect(screen.queryByText(/émise le/)).not.toBeInTheDocument();
    expect(
      screen.getByText('Ce devis est envoyé et ne peut plus être modifié.'),
    ).toBeInTheDocument();
  });

  it('« Accord du client » appelle POST /accepter et passe le devis à Accepté', async () => {
    installerDevis({ numero: '2026-D-00001', statut: 'emis', vehiculeId: 'veh-1' });
    let appels = 0;
    server.use(
      http.post('/api/v1/documents-vente/devis-1/accepter', () => {
        appels += 1;
        return HttpResponse.json({
          donnees: construireDocumentBrut({
            id: 'devis-1',
            typeDocument: 'devis',
            natureFacture: null,
            numero: '2026-D-00001',
            statut: 'accepte',
            vehiculeId: 'veh-1',
            qr: null,
          }),
          avertissements: [],
        });
      }),
    );
    const utilisateur = userEvent.setup();
    rendre();

    await utilisateur.click(await screen.findByRole('button', { name: 'Accord du client' }));

    expect(await screen.findByText('Accepté')).toBeInTheDocument();
    expect(appels).toBe(1);
    expect(screen.queryByRole('button', { name: 'Accord du client' })).not.toBeInTheDocument();
  });

  it('« Créer l’OR » appelle POST /creer-ordre-reparation avec une clé d’idempotence et navigue vers l’OR créé', async () => {
    installerDevis({ numero: '2026-D-00001', statut: 'accepte', vehiculeId: 'veh-1' });
    const requetes: { cle: string | null; corps: unknown }[] = [];
    server.use(
      http.post('/api/v1/documents-vente/devis-1/creer-ordre-reparation', async ({ request }) => {
        requetes.push({
          cle: request.headers.get('Idempotency-Key'),
          corps: await request.json(),
        });
        return HttpResponse.json(
          {
            donnees: {
              ordreReparation: { id: 'or-9', client: { id: 'cl-1' } },
              devisId: 'devis-1',
              devisStatut: 'accepte',
              nombreLignesReprises: 2,
            },
            avertissements: [],
          },
          { status: 201 },
        );
      }),
    );
    const utilisateur = userEvent.setup();
    rendre();

    await utilisateur.click(await screen.findByRole('button', { name: "Créer l'OR" }));
    const dialogue = await screen.findByRole('dialog', { name: "Créer l'OR à partir de ce devis" });
    await utilisateur.click(within(dialogue).getByRole('button', { name: "Créer l'OR" }));

    expect(await screen.findByText('Fiche OR ouverte')).toBeInTheDocument();
    expect(requetes).toHaveLength(1);
    expect(requetes[0]?.cle).toMatch(/^[0-9a-f-]{36}$/);
    expect(requetes[0]?.corps).toEqual({
      kilometrageEntree: null,
      uniteKilometrage: 'km',
      demandes: [],
      statutInitial: 'ouvert',
    });
  });

  it('« Créer l’OR » est absent quand le devis n’a pas de véhicule', async () => {
    installerDevis({ numero: '2026-D-00001', statut: 'accepte', vehiculeId: null });
    rendre();

    await screen.findByText('Accepté');
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: "Créer l'OR" })).not.toBeInTheDocument(),
    );
  });
});
