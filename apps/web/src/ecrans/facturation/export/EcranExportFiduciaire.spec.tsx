import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RoleUtilisateur } from '@dfa/shared';

import '@/i18n';

import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { renduAvecQueryClient } from '@/test/utils';

import { EcranExportFiduciaire } from './EcranExportFiduciaire';

const CONTENU_BASE64 = btoa('Journal;Date;Montant\n');

function connecte(role: RoleUtilisateur): void {
  server.use(
    http.get('/api/v1/auth/moi', () =>
      HttpResponse.json({
        ...SESSION_TEST,
        utilisateur: { ...SESSION_TEST.utilisateur, role },
      }),
    ),
  );
}

function reponseExport() {
  return {
    donnees: {
      lots: [
        {
          exportId: '11111111-1111-4111-8111-111111111111',
          cible: 'winbiz',
          nomFichier: 'winbiz-2026-10.csv',
          nbEcritures: 3,
          nbLignesCsv: 7,
          totalDebitCentimes: '123450',
          totalCreditCentimes: '123450',
          empreinteSha256: 'abc',
          contenuBase64: CONTENU_BASE64,
          avertissements: [],
        },
      ],
      documentsExportes: [
        { id: 'd1', numero: 'FAC-2026-00012', typeDocument: 'facture' },
        { id: 'd2', numero: 'FAC-2026-00014', typeDocument: 'facture' },
        { id: 'd3', numero: 'AVO-2026-00001', typeDocument: 'avoir' },
      ],
      paiementsExportes: [{ id: 'p1', moyen: 'virement' }],
      imputationsExportees: [],
    },
    avertissements: [],
  };
}

function rendre() {
  return renduAvecQueryClient(
    <MemoryRouter initialEntries={['/export-fiduciaire']}>
      <EcranExportFiduciaire />
    </MemoryRouter>,
  );
}

let clicsTelechargement: string[];

beforeEach(() => {
  clicsTelechargement = [];
  URL.createObjectURL = () => 'blob:test';
  URL.revokeObjectURL = () => undefined;
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicsTelechargement.push(this.download);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function lancerExport(utilisateur: ReturnType<typeof userEvent.setup>) {
  await utilisateur.click(await screen.findByRole('button', { name: 'Télécharger' }));
  await utilisateur.click(await screen.findByRole('button', { name: 'Exporter et télécharger' }));
}

describe('EcranExportFiduciaire', () => {
  it('propose WinBIZ et le mois précédent par défaut', async () => {
    connecte('comptable');
    rendre();

    expect(await screen.findByText('WinBIZ')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Mois précédent' })).toBeChecked();
    const debut = new Date();
    const mois = new Date(debut.getFullYear(), debut.getMonth() - 1, 1);
    const fin = new Date(mois.getFullYear(), mois.getMonth() + 1, 0);
    const jj = (d: Date) =>
      `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
    expect(screen.getByText(`Du ${jj(mois)} au ${jj(fin)}.`)).toBeInTheDocument();
  });

  it('lance l’export avec la période et une clé d’idempotence, télécharge, affiche le bilan', async () => {
    connecte('comptable');
    let corps: unknown;
    let cle: string | null = null;
    server.use(
      http.post('/api/v1/exports-fiduciaires', async ({ request }) => {
        corps = await request.json();
        cle = request.headers.get('Idempotency-Key');
        return HttpResponse.json(reponseExport(), { status: 201 });
      }),
    );
    const utilisateur = userEvent.setup();
    rendre();

    await lancerExport(utilisateur);

    expect(await screen.findByText('Export terminé')).toBeInTheDocument();
    expect(corps).toMatchObject({ cible: 'winbiz', granularite: 'detaille' });
    expect(cle).toMatch(/^[0-9a-f-]{36}$/);
    expect(clicsTelechargement).toEqual(['winbiz-2026-10.csv']);
    expect(screen.getByText('FAC-2026-00012 à FAC-2026-00014')).toBeInTheDocument();
    expect(screen.getByText('AVO-2026-00001 à AVO-2026-00001')).toBeInTheDocument();
    expect(screen.getByText('CHF 1’234.50'.replace('’', "'"))).toBeInTheDocument();
  });

  it('affiche un état vide explicite quand rien n’est à exporter', async () => {
    connecte('direction');
    server.use(
      http.post('/api/v1/exports-fiduciaires', () =>
        HttpResponse.json(
          {
            donnees: {
              lots: [],
              documentsExportes: [],
              paiementsExportes: [],
              imputationsExportees: [],
            },
            avertissements: [],
          },
          { status: 200 },
        ),
      ),
    );
    const utilisateur = userEvent.setup();
    rendre();

    await lancerExport(utilisateur);

    expect(await screen.findByText('Rien à exporter sur cette période')).toBeInTheDocument();
    expect(clicsTelechargement).toEqual([]);
  });

  it('explique un prérequis manquant plutôt qu’une erreur générique', async () => {
    connecte('comptable');
    server.use(
      http.post('/api/v1/exports-fiduciaires', () =>
        HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Mapping comptable incomplet',
            status: 409,
            instance: 'req-1',
            code: 'EXPORT_MAPPING_INCOMPLET',
            detail: 'compte 1020 manquant',
          },
          { status: 409, headers: { 'Content-Type': 'application/problem+json' } },
        ),
      ),
    );
    const utilisateur = userEvent.setup();
    rendre();

    await lancerExport(utilisateur);

    expect(
      await screen.findByText('Le plan comptable n’est pas complet'.replace('’', "'")),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Réessayer' })).not.toBeInTheDocument();
  });

  it('propose de réessayer après une panne réseau, avec la même clé d’idempotence', async () => {
    connecte('comptable');
    const cles: (string | null)[] = [];
    let appels = 0;
    server.use(
      http.post('/api/v1/exports-fiduciaires', ({ request }) => {
        cles.push(request.headers.get('Idempotency-Key'));
        appels += 1;
        if (appels === 1) return HttpResponse.error();
        return HttpResponse.json(reponseExport(), { status: 201 });
      }),
    );
    const utilisateur = userEvent.setup();
    rendre();

    await lancerExport(utilisateur);
    await utilisateur.click(await screen.findByRole('button', { name: 'Réessayer' }));

    expect(await screen.findByText('Export terminé')).toBeInTheDocument();
    expect(cles).toHaveLength(2);
    expect(cles[0]).toBe(cles[1]);
  });

  it('bloque une période personnalisée inversée', async () => {
    connecte('comptable');
    const utilisateur = userEvent.setup();
    rendre();

    await utilisateur.click(await screen.findByRole('radio', { name: 'Période personnalisée' }));
    await utilisateur.type(screen.getByLabelText('Du'), '31.10.2026');
    await utilisateur.type(screen.getByLabelText('Au'), '01.10.2026');
    await utilisateur.tab();

    expect(
      await screen.findByText('La date de début doit précéder la date de fin.'),
    ).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Télécharger' })).toBeDisabled();
  });

  it('ne montre pas le bouton à un rôle sans droit d’export', async () => {
    connecte('vendeur');
    rendre();

    await waitFor(() =>
      expect(
        screen.getByText(
          'Seuls la direction et la comptabilité peuvent exporter vers la fiduciaire.',
        ),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByRole('button', { name: 'Télécharger' })).not.toBeInTheDocument();
  });
});
