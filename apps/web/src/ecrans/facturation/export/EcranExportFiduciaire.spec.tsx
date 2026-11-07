import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  ApercuExport,
  EtatMappingExport,
  ExportHistorique,
  RoleUtilisateur,
} from '@dfa/shared';

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

function apercu(surcharge: Partial<ApercuExport> = {}): ApercuExport {
  return {
    cible: 'winbiz',
    periodeDu: '2026-10-01',
    periodeAu: '2026-10-31',
    documents: {
      nbFactures: 12,
      nbAvoirs: 2,
      aExporter: 14,
      dejaExportes: 3,
      dejaExportesFactures: 2,
      dejaExportesAvoirs: 1,
    },
    encaissements: { aExporter: 9, dejaExportes: 1, imputationsAExporter: 9 },
    totaux: { htCentimes: 1000000, tvaCentimes: 81000, ttcCentimes: 1081000 },
    plageNumeros: {
      factures: { premier: 'FAC-2026-00012', dernier: 'FAC-2026-00023' },
      avoirs: { premier: 'AVO-2026-00001', dernier: 'AVO-2026-00002' },
    },
    prerequis: [],
    aQuelqueChoseAExporter: true,
    exportable: true,
    ...surcharge,
  };
}

function lot(surcharge: Partial<ExportHistorique> = {}): ExportHistorique {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    genereLe: '2026-11-02T08:30:00.000Z',
    periodeDu: '2026-10-01',
    periodeAu: '2026-10-31',
    cible: 'csv',
    granularite: 'detaille',
    statut: 'genere',
    nbEcritures: 40,
    totalDebitCentimes: 500000,
    totalCreditCentimes: 500000,
    nbFactures: 10,
    nbAvoirs: 1,
    nbEncaissements: 5,
    totalHtCentimes: 450000,
    totalTvaCentimes: 36450,
    totalTtcCentimes: 486450,
    plageNumeros: {
      factures: { premier: 'FAC-2026-00001', dernier: 'FAC-2026-00010' },
      avoirs: null,
    },
    genereParId: null,
    genereParNom: 'Marie Dupont',
    empreinteSha256: 'abc',
    nomFichier: 'export-2026-10.csv',
    fichierDisponible: true,
    ...surcharge,
  };
}

function etatMapping(surcharge: Partial<EtatMappingExport> = {}): EtatMappingExport {
  return {
    cible: 'winbiz',
    complet: false,
    nbPostesManquants: 2,
    comptes: [
      {
        usage: 'creances_clients',
        categorie: 'defaut',
        libelle: 'Créances clients',
        compte: null,
        actifDu: null,
        compteParDefaut: '1100',
        requis: true,
      },
      {
        usage: 'tva_due',
        categorie: '81',
        libelle: 'TVA due 8.1 %',
        compte: null,
        actifDu: null,
        compteParDefaut: null,
        requis: true,
      },
    ],
    codesTva: [
      {
        regimeTva: 'normal',
        tauxPourmille: 81,
        libelle: 'Normal 8.1 %',
        codeExterne: null,
        codeParDefaut: 'TN81',
        requis: true,
      },
    ],
    ...surcharge,
  };
}

function page(donnees: ExportHistorique[], curseurSuivant: string | null = null) {
  return { donnees, curseurSuivant, limite: 20 };
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
  server.use(
    http.get('/api/v1/exports-fiduciaires/apercu', () => HttpResponse.json(apercu())),
    http.get('/api/v1/exports-fiduciaires', () => HttpResponse.json(page([]))),
  );
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

    expect(await screen.findByRole('radio', { name: /WinBIZ/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Mois précédent' })).toBeChecked();
    const debut = new Date();
    const mois = new Date(debut.getFullYear(), debut.getMonth() - 1, 1);
    const fin = new Date(mois.getFullYear(), mois.getMonth() + 1, 0);
    const jj = (d: Date) =>
      `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
    expect(screen.getByText(`Du ${jj(mois)} au ${jj(fin)}.`)).toBeInTheDocument();
  });

  it('propose seulement WinBIZ et CSV, avec une phrase par format', async () => {
    connecte('comptable');
    rendre();

    expect(await screen.findByRole('radio', { name: /WinBIZ/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /CSV/ })).not.toBeChecked();
    expect(screen.getByText('CSV : lisible par Excel et toute fiduciaire.')).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /Bexio|Abacus|Banana/ })).not.toBeInTheDocument();
  });

  it('exporte au format choisi', async () => {
    connecte('comptable');
    let corps: unknown;
    server.use(
      http.post('/api/v1/exports-fiduciaires', async ({ request }) => {
        corps = await request.json();
        return HttpResponse.json(reponseExport(), { status: 201 });
      }),
    );
    const utilisateur = userEvent.setup();
    rendre();

    await utilisateur.click(await screen.findByRole('radio', { name: /CSV/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Télécharger' })).toBeEnabled());
    await lancerExport(utilisateur);

    await screen.findByText('Export terminé');
    expect(corps).toMatchObject({ cible: 'csv', granularite: 'detaille' });
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

  it('détaille les blocages d’un 409 : compte manquant, pièce citée, lien vers les comptes', async () => {
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
            detail: 'x',
            blocages: [
              {
                type: 'champ',
                id: 'compte:creances_clients:defaut',
                libelle: 'Compte manquant',
                donnees: {
                  poste: 'compte',
                  usage: 'creances_clients',
                  categorie: 'defaut',
                  references: ['FAC-2026-00012'],
                  total: 2,
                },
              },
              {
                type: 'champ',
                id: 'code_tva:normal:81',
                libelle: 'Code TVA manquant',
                donnees: {
                  poste: 'code_tva',
                  regimeTva: 'normal',
                  tauxPourmille: 81,
                  references: [],
                },
              },
            ],
          },
          { status: 409, headers: { 'Content-Type': 'application/problem+json' } },
        ),
      ),
    );
    const utilisateur = userEvent.setup();
    rendre();

    await lancerExport(utilisateur);

    expect(await screen.findByText(/Clients débiteurs/)).toBeInTheDocument();
    expect(screen.getByText(/pièces : FAC-2026-00012/)).toBeInTheDocument();
    expect(screen.getByText(/Code TVA : Normal, 8.1 %/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Régler les comptes' })).toBeInTheDocument();
  });

  it('détaille un trou de numérotation et un déséquilibre venant d’un 409', async () => {
    connecte('comptable');
    server.use(
      http.post('/api/v1/exports-fiduciaires', () =>
        HttpResponse.json(
          {
            type: 'about:blank',
            title: 't',
            status: 409,
            instance: 'req-1',
            code: 'EXPORT_TROU_NUMEROTATION',
            detail: 'x',
            blocages: [
              {
                type: 'document_vente',
                id: 'd1',
                libelle: 'FAC-2026-00013',
                donnees: { numero: 'FAC-2026-00013', typeDocument: 'facture', exercice: 2026 },
              },
              {
                type: 'document_vente',
                id: 'd2',
                libelle: 'FAC-2026-00014',
                donnees: { numero: 'FAC-2026-00014', typeDocument: 'facture', exercice: 2026 },
              },
            ],
          },
          { status: 409, headers: { 'Content-Type': 'application/problem+json' } },
        ),
      ),
    );
    const utilisateur = userEvent.setup();
    rendre();

    await lancerExport(utilisateur);

    expect(
      await screen.findByText(/numéros manquants FAC-2026-00013, FAC-2026-00014/),
    ).toBeInTheDocument();
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

describe('EcranExportFiduciaire — aperçu', () => {
  it('affiche le contenu de la période et active Télécharger quand c’est exportable', async () => {
    connecte('comptable');
    let requete: URL | undefined;
    server.use(
      http.get('/api/v1/exports-fiduciaires/apercu', ({ request }) => {
        requete = new URL(request.url);
        return HttpResponse.json(apercu());
      }),
    );
    rendre();

    expect(await screen.findByText('Factures à exporter')).toBeInTheDocument();
    expect(screen.getByText('3 documents, 1 encaissements')).toBeInTheDocument();
    expect(screen.getByText('CHF 10’000.00'.replace('’', "'"))).toBeInTheDocument();
    expect(screen.getByText('CHF 810.00')).toBeInTheDocument();
    expect(screen.getByText('CHF 10’810.00'.replace('’', "'"))).toBeInTheDocument();
    expect(screen.getByText('FAC-2026-00012 à FAC-2026-00023')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Télécharger' })).toBeEnabled();
    expect(requete?.searchParams.get('cible')).toBe('winbiz');
    expect(requete?.searchParams.get('periodeDu')).toMatch(/^\d{4}-\d{2}-01$/);
  });

  it('désactive Télécharger et explique chaque prérequis non satisfait', async () => {
    connecte('comptable');
    server.use(
      http.get('/api/v1/exports-fiduciaires/apercu', () =>
        HttpResponse.json(
          apercu({
            exportable: false,
            prerequis: [
              {
                code: 'EXPORT_MAPPING_INCOMPLET',
                comptes: [{ usage: 'produit', categorie: 'piece', references: ['FAC-2026-00015'] }],
                codesTva: [],
              },
              {
                code: 'EXPORT_TROU_NUMEROTATION',
                trous: [{ typeDocument: 'facture', exercice: 2026, numeros: ['FAC-2026-00013'] }],
              },
              {
                code: 'EXPORT_ECRITURES_DESEQUILIBREES',
                ecritures: [
                  {
                    reference: 'FAC-2026-00016',
                    totalDebitCentimes: 10000,
                    totalCreditCentimes: 9995,
                  },
                ],
              },
              {
                code: 'FONCTION_NON_DISPONIBLE',
                limites: ['Compensation sur FAC-2026-00017'],
                details: [
                  {
                    code: 'COMPENSATION_NON_SUPPORTEE',
                    donnees: { paiementId: 'p-1', documentId: 'FAC-2026-00017' },
                  },
                ],
              },
            ],
          }),
        ),
      ),
    );
    rendre();

    expect(await screen.findByText(/Produits \(Pièces\)/)).toBeInTheDocument();
    expect(screen.getByText(/numéros manquants FAC-2026-00013/)).toBeInTheDocument();
    expect(
      screen.getByText('FAC-2026-00016 : débit CHF 100.00, crédit CHF 99.95'),
    ).toBeInTheDocument();
    // `details` structurés rendus en clair (le libellé de repli `limites` n'est pas affiché).
    expect(
      screen.getByText(
        'Un encaissement par compensation ne peut pas encore être exporté. (document FAC-2026-00017)',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Compensation sur FAC-2026-00017')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Télécharger' })).toBeDisabled();
  });

  it('FONCTION_NON_DISPONIBLE : détails traduits (uuid masqué, nature, format), repli sur limites', async () => {
    connecte('comptable');
    server.use(
      http.get('/api/v1/exports-fiduciaires/apercu', () =>
        HttpResponse.json(
          apercu({
            exportable: false,
            prerequis: [
              {
                code: 'FONCTION_NON_DISPONIBLE',
                limites: ['Texte de repli français'],
                details: [
                  {
                    code: 'TAUX_MULTIPLES_NON_SUPPORTE',
                    donnees: {
                      paiementId: 'p-2',
                      documentId: '4d1c4f86-2b6a-4a7e-9b86-0f1e8d3a1a11',
                      nature: 'perte',
                    },
                  },
                  { code: 'ADAPTATEUR_NON_CABLE', donnees: { cible: 'winbiz' } },
                ],
              },
              { code: 'FONCTION_NON_DISPONIBLE', limites: ['Seul le repli existe'], details: [] },
            ],
          }),
        ),
      ),
    );
    rendre();
    expect(
      await screen.findByText(
        'Une perte sur une facture à plusieurs taux de TVA ne peut pas encore être exporté.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Le format WinBIZ n’est pas encore disponible pour l’export.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Texte de repli français')).not.toBeInTheDocument();
    expect(screen.getByText('Seul le repli existe')).toBeInTheDocument();
  });

  it('dit qu’il n’y a rien à exporter et garde le bouton désactivé', async () => {
    connecte('comptable');
    server.use(
      http.get('/api/v1/exports-fiduciaires/apercu', () =>
        HttpResponse.json(apercu({ aQuelqueChoseAExporter: false, exportable: false })),
      ),
    );
    rendre();

    expect(await screen.findByText('Rien à exporter sur cette période')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Télécharger' })).toBeDisabled();
  });

  it('propose de réessayer quand l’aperçu échoue', async () => {
    connecte('comptable');
    let appels = 0;
    server.use(
      http.get('/api/v1/exports-fiduciaires/apercu', () => {
        appels += 1;
        return appels === 1 ? HttpResponse.error() : HttpResponse.json(apercu());
      }),
    );
    const utilisateur = userEvent.setup();
    rendre();

    expect(await screen.findByText("L'aperçu n'a pas pu être calculé")).toBeInTheDocument();
    await utilisateur.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByText('Factures à exporter')).toBeInTheDocument();
  });
});

describe('EcranExportFiduciaire — comptes comptables', () => {
  it('propose les valeurs par défaut en un clic puis enregistre par PUT', async () => {
    connecte('comptable');
    let corps: unknown;
    server.use(
      http.get('/api/v1/exports-fiduciaires/mapping', () => HttpResponse.json(etatMapping())),
      http.put('/api/v1/exports-fiduciaires/mapping', async ({ request }) => {
        corps = await request.json();
        return HttpResponse.json(etatMapping({ complet: true, nbPostesManquants: 0 }));
      }),
    );
    const utilisateur = userEvent.setup();
    rendre();

    await utilisateur.click(await screen.findByRole('button', { name: 'Comptes comptables' }));
    expect(await screen.findByText(/à valider avec votre fiduciaire/)).toBeInTheDocument();
    await utilisateur.click(screen.getByRole('button', { name: 'Utiliser les valeurs proposées' }));

    expect(screen.getByLabelText('Clients débiteurs')).toHaveValue('1100');
    expect(
      screen.getByLabelText('Code TVA : Normal, 8.1 %'.replace('Code TVA : ', '')),
    ).toHaveValue('TN81');
    // Pas de proposition pour la TVA due : champ à saisir soi-même.
    expect(screen.getByLabelText(/TVA due \(8.1 %\)/)).toHaveValue('');
    await utilisateur.type(screen.getByLabelText(/TVA due \(8.1 %\)/), '2200');
    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer' }));

    await waitFor(() => expect(corps).toBeDefined());
    expect(corps).toEqual({
      cible: 'winbiz',
      comptes: [
        { usage: 'creances_clients', categorie: 'defaut', compte: '1100' },
        { usage: 'tva_due', categorie: '81', compte: '2200' },
      ],
      codesTva: [{ regimeTva: 'normal', tauxPourmille: 81, codeExterne: 'TN81' }],
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('signale un compte invalide champ par champ sans perdre la saisie', async () => {
    connecte('comptable');
    let appels = 0;
    server.use(
      http.get('/api/v1/exports-fiduciaires/mapping', () => HttpResponse.json(etatMapping())),
      http.put('/api/v1/exports-fiduciaires/mapping', () => {
        appels += 1;
        return HttpResponse.json(etatMapping());
      }),
    );
    const utilisateur = userEvent.setup();
    rendre();

    await utilisateur.click(await screen.findByRole('button', { name: 'Comptes comptables' }));
    const champ = await screen.findByLabelText('Clients débiteurs');
    await utilisateur.type(champ, '11 00 !');
    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer' }));

    expect(await screen.findByText(/Compte ou code non valable/)).toBeInTheDocument();
    expect(champ).toHaveValue('11 00 !');
    expect(appels).toBe(0);
  });

  it('ouvre les comptes depuis « Régler les comptes » de l’aperçu', async () => {
    connecte('comptable');
    server.use(
      http.get('/api/v1/exports-fiduciaires/apercu', () =>
        HttpResponse.json(
          apercu({
            exportable: false,
            prerequis: [
              {
                code: 'EXPORT_MAPPING_INCOMPLET',
                comptes: [{ usage: 'creances_clients', categorie: 'defaut', references: [] }],
                codesTva: [],
              },
            ],
          }),
        ),
      ),
      http.get('/api/v1/exports-fiduciaires/mapping', () => HttpResponse.json(etatMapping())),
    );
    const utilisateur = userEvent.setup();
    rendre();

    await utilisateur.click(await screen.findByRole('button', { name: 'Régler les comptes' }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(await screen.findByLabelText('Clients débiteurs')).toBeInTheDocument();
  });
});

describe('EcranExportFiduciaire — historique', () => {
  it('affiche un état vide quand aucun export n’a eu lieu', async () => {
    connecte('comptable');
    rendre();

    expect(await screen.findByText('Aucun export pour le moment')).toBeInTheDocument();
  });

  it('liste les lots, re-télécharge un fichier conservé et signale un lot non conservé', async () => {
    connecte('comptable');
    let idFichier: string | undefined;
    server.use(
      http.get('/api/v1/exports-fiduciaires', () =>
        HttpResponse.json(
          page([
            lot(),
            lot({
              id: '33333333-3333-4333-8333-333333333333',
              cible: 'winbiz',
              fichierDisponible: false,
              nomFichier: null,
              totalTtcCentimes: null,
              genereParNom: null,
            }),
          ]),
        ),
      ),
      http.get('/api/v1/exports-fiduciaires/:id/fichier', ({ params }) => {
        idFichier = String(params.id);
        return new HttpResponse('a;b\n', { headers: { 'Content-Type': 'text/csv' } });
      }),
    );
    const utilisateur = userEvent.setup();
    rendre();

    expect(await screen.findByText('Marie Dupont')).toBeInTheDocument();
    expect(screen.getAllByText('01.10.2026 au 31.10.2026')).toHaveLength(2);
    expect(screen.getByText('CHF 4’864.50'.replace('’', "'"))).toBeInTheDocument();
    expect(screen.getByText('Non conservé')).toBeInTheDocument();
    expect(screen.getByText('Utilisateur supprimé')).toBeInTheDocument();

    await utilisateur.click(screen.getByRole('button', { name: 'Télécharger à nouveau' }));

    await waitFor(() => expect(clicsTelechargement).toEqual(['export-2026-10.csv']));
    expect(idFichier).toBe('22222222-2222-4222-8222-222222222222');
  });

  it('charge la page suivante par curseur', async () => {
    connecte('comptable');
    const curseurs: (string | null)[] = [];
    server.use(
      http.get('/api/v1/exports-fiduciaires', ({ request }) => {
        const curseur = new URL(request.url).searchParams.get('curseur');
        curseurs.push(curseur);
        return HttpResponse.json(
          curseur
            ? page([lot({ id: '44444444-4444-4444-8444-444444444444', genereParNom: 'Paul Roy' })])
            : page([lot()], 'suite'),
        );
      }),
    );
    const utilisateur = userEvent.setup();
    rendre();

    await utilisateur.click(await screen.findByRole('button', { name: 'Charger plus' }));

    expect(await screen.findByText('Paul Roy')).toBeInTheDocument();
    expect(curseurs).toEqual([null, 'suite']);
  });

  it('propose de réessayer quand l’historique échoue', async () => {
    connecte('comptable');
    server.use(http.get('/api/v1/exports-fiduciaires', () => HttpResponse.error()));
    rendre();

    expect(await screen.findByText("L'historique n'a pas pu être chargé")).toBeInTheDocument();
  });
});
