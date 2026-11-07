import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { ReponseTravailReporte } from '@dfa/shared';

import '@/i18n';
import i18n from '@/i18n';

import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { PanneauTravauxReportes } from './PanneauTravauxReportes';

// Radix Select (édition d'urgence) appelle `hasPointerCapture`/`scrollIntoView`, absents de
// jsdom — même stub que les autres specs du lot (ex. EcranFicheVehicule.spec.tsx).
beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

const TRAVAIL_OUVERT: ReponseTravailReporte = {
  id: 't1',
  designation: 'Plaquettes de frein avant',
  urgence: 'urgent',
  montantEstimeCentimes: 24000,
  kilometrageAlors: 85000,
  constateLe: '2026-01-15',
  securite: true,
  statut: 'ouvert',
  ordreReparationOrigineId: null,
  ligneOrOrigineId: null,
  ordreReparationRepriseId: null,
  // Jamais de motif de clôture sur un travail encore OUVERT (pas encore clos/abandonné).
  motifModification: null,
  detail: null,
};

const TRAVAIL_REPRIS: ReponseTravailReporte = {
  id: 't2',
  designation: 'Amortisseur arrière gauche',
  urgence: 'a_surveiller',
  montantEstimeCentimes: 45000,
  kilometrageAlors: 80000,
  constateLe: '2025-11-02',
  securite: false,
  statut: 'repris',
  ordreReparationOrigineId: null,
  ligneOrOrigineId: null,
  ordreReparationRepriseId: 'or-9',
  motifModification: 'Le client a accepté le devis au comptoir.',
  detail: null,
};

function installerSession(role: (typeof SESSION_TEST)['utilisateur']['role'] = 'chef_atelier') {
  server.use(
    http.get('/api/v1/auth/moi', () =>
      HttpResponse.json({ ...SESSION_TEST, utilisateur: { ...SESSION_TEST.utilisateur, role } }),
    ),
  );
}

function rendre(vehiculeId = 'v1') {
  const queryClient = creerQueryClientTest();
  return render(
    <QueryClientProvider client={queryClient}>
      <PanneauTravauxReportes vehiculeId={vehiculeId} />
    </QueryClientProvider>,
  );
}

describe('PanneauTravauxReportes', () => {
  afterEach(async () => {
    await i18n.changeLanguage('fr');
  });

  it('traduit les onglets et les actions en allemand (namespace `vehicules`, clés ajoutées par ce panneau)', async () => {
    await i18n.changeLanguage('de');
    installerSession('chef_atelier');
    server.use(
      http.get('/api/v1/vehicules/v1/travaux-reportes', () => HttpResponse.json([TRAVAIL_OUVERT])),
    );
    rendre();

    expect(await screen.findByRole('tab', { name: /Offen/ })).toBeInTheDocument();
    expect(screen.getByText('Zurückgestellte Arbeiten')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Korrigieren' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Als übernommen markieren' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Verwerfen' })).toBeInTheDocument();
  });

  it('affiche un état vide dédié quand le véhicule ne porte aucun travail reporté', async () => {
    installerSession();
    server.use(http.get('/api/v1/vehicules/v1/travaux-reportes', () => HttpResponse.json([])));
    rendre();

    expect(await screen.findByText('Aucun travail reporté pour ce véhicule.')).toBeInTheDocument();
  });

  it('affiche une erreur actionnable avec bouton réessayer en cas d’échec', async () => {
    installerSession();
    server.use(
      http.get('/api/v1/vehicules/v1/travaux-reportes', () =>
        HttpResponse.json(
          {
            type: 'https://docs.dmsforall.example/erreurs/RESSOURCE_INTROUVABLE',
            title: 'Introuvable',
            status: 404,
            code: 'RESSOURCE_INTROUVABLE',
            instance: 'req-1',
          },
          { status: 404, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    rendre();

    expect(
      await screen.findByText('Impossible de charger les travaux reportés'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
  });

  it('affiche par défaut les travaux OUVERTS avec le montant et le kilométrage de l’époque, et propose corriger/reprendre/abandonner à un rôle habilité', async () => {
    installerSession('chef_atelier');
    server.use(
      http.get('/api/v1/vehicules/v1/travaux-reportes', () =>
        HttpResponse.json([TRAVAIL_OUVERT, TRAVAIL_REPRIS]),
      ),
    );
    rendre();

    expect(await screen.findByText('Plaquettes de frein avant')).toBeInTheDocument();
    expect(screen.getByText(/240\.00/)).toBeInTheDocument();
    expect(screen.getByText(/85'000 km/)).toBeInTheDocument();
    // L'onglet « Ouverts » est actif par défaut : le travail déjà repris n'y apparaît pas.
    expect(screen.queryByText('Amortisseur arrière gauche')).not.toBeInTheDocument();

    expect(screen.getByRole('button', { name: 'Corriger' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Marquer comme repris' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abandonner' })).toBeInTheDocument();
  });

  it('ne propose AUCUNE action à un rôle sans le droit `vehicule.travail_reporte.gerer` (ex. technicien)', async () => {
    installerSession('technicien');
    server.use(
      http.get('/api/v1/vehicules/v1/travaux-reportes', () => HttpResponse.json([TRAVAIL_OUVERT])),
    );
    rendre();

    expect(await screen.findByText('Plaquettes de frein avant')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Corriger' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Marquer comme repris' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Abandonner' })).not.toBeInTheDocument();
  });

  it('bascule sur l’onglet « Tous » et affiche le statut de chaque travail', async () => {
    installerSession();
    server.use(
      http.get('/api/v1/vehicules/v1/travaux-reportes', () =>
        HttpResponse.json([TRAVAIL_OUVERT, TRAVAIL_REPRIS]),
      ),
    );
    const utilisateur = userEvent.setup();
    rendre();

    await screen.findByText('Plaquettes de frein avant');
    await utilisateur.click(screen.getByRole('tab', { name: /Tous/ }));

    expect(await screen.findByText('Amortisseur arrière gauche')).toBeInTheDocument();
    expect(screen.getByText('Plaquettes de frein avant')).toBeInTheDocument();
  });

  it('affiche `motifModification` sur un travail déjà REPRIS, jamais sur un travail OUVERT (trou n°3 comblé)', async () => {
    installerSession();
    server.use(
      http.get('/api/v1/vehicules/v1/travaux-reportes', () =>
        HttpResponse.json([TRAVAIL_OUVERT, TRAVAIL_REPRIS]),
      ),
    );
    const utilisateur = userEvent.setup();
    rendre();

    await screen.findByText('Plaquettes de frein avant');
    await utilisateur.click(screen.getByRole('tab', { name: /Tous/ }));
    await screen.findByText('Amortisseur arrière gauche');

    // Le travail REPRIS porte un motif : affiché.
    expect(screen.getByText('Le client a accepté le devis au comptoir.')).toBeInTheDocument();
    // `TRAVAIL_OUVERT.motifModification` est `null` : le libellé « Motif : » n'apparaît nulle
    // part associé à sa ligne — un seul motif au total sur la page (celui du travail REPRIS).
    expect(screen.getAllByText('Motif :')).toHaveLength(1);
  });

  it('corrige la désignation, l’urgence et le montant d’un travail reporté', async () => {
    installerSession();
    server.use(
      http.get('/api/v1/vehicules/v1/travaux-reportes', () => HttpResponse.json([TRAVAIL_OUVERT])),
    );
    const utilisateur = userEvent.setup({ pointerEventsCheck: 0 });
    rendre();

    await utilisateur.click(await screen.findByRole('button', { name: 'Corriger' }));
    const dialogue = await screen.findByRole('dialog');

    server.use(
      http.patch('/api/v1/vehicules/v1/travaux-reportes/t1', async ({ request }) => {
        const corps = (await request.json()) as Record<string, unknown>;
        expect(corps.designation).toBe('Plaquettes de frein avant et arrière');
        expect(corps.urgence).toBe('a_faire');
        expect(corps.montantEstimeCentimes).toBe(30000);
        return HttpResponse.json({
          ...TRAVAIL_OUVERT,
          designation: 'Plaquettes de frein avant et arrière',
          urgence: 'a_faire',
          montantEstimeCentimes: 30000,
        });
      }),
    );

    const champDesignation = within(dialogue).getByLabelText('Désignation');
    await utilisateur.clear(champDesignation);
    await utilisateur.type(champDesignation, 'Plaquettes de frein avant et arrière');

    await utilisateur.click(within(dialogue).getByRole('combobox', { name: 'Urgence' }));
    await utilisateur.click(await screen.findByRole('option', { name: 'À faire' }));

    const champMontant = within(dialogue).getByLabelText('Montant estimé');
    await utilisateur.clear(champMontant);
    await utilisateur.type(champMontant, '300');

    await utilisateur.click(within(dialogue).getByRole('button', { name: 'Enregistrer' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('demande une confirmation explicite puis marque un travail comme repris', async () => {
    installerSession();
    server.use(
      http.get('/api/v1/vehicules/v1/travaux-reportes', () => HttpResponse.json([TRAVAIL_OUVERT])),
    );
    let corpsRecu: unknown;
    server.use(
      http.patch('/api/v1/vehicules/v1/travaux-reportes/t1', async ({ request }) => {
        corpsRecu = await request.json();
        return HttpResponse.json({ ...TRAVAIL_OUVERT, statut: 'repris' });
      }),
    );
    const utilisateur = userEvent.setup();
    rendre();

    await utilisateur.click(await screen.findByRole('button', { name: 'Marquer comme repris' }));
    const dialogue = await screen.findByRole('dialog');
    expect(within(dialogue).getByText('Marquer ce travail comme repris ?')).toBeInTheDocument();

    await utilisateur.click(within(dialogue).getByRole('button', { name: 'Marquer comme repris' }));

    await waitFor(() => expect(corpsRecu).toEqual({ statut: 'repris' }));
  });

  it('abandonne un travail reporté après confirmation (statut `abandonne`, jamais une suppression)', async () => {
    installerSession();
    server.use(
      http.get('/api/v1/vehicules/v1/travaux-reportes', () => HttpResponse.json([TRAVAIL_OUVERT])),
    );
    let corpsRecu: unknown;
    server.use(
      http.patch('/api/v1/vehicules/v1/travaux-reportes/t1', async ({ request }) => {
        corpsRecu = await request.json();
        return HttpResponse.json({ ...TRAVAIL_OUVERT, statut: 'abandonne' });
      }),
    );
    const utilisateur = userEvent.setup();
    rendre();

    await utilisateur.click(await screen.findByRole('button', { name: 'Abandonner' }));
    const dialogue = await screen.findByRole('dialog');
    expect(within(dialogue).getByText('Abandonner ce travail reporté ?')).toBeInTheDocument();

    await utilisateur.click(within(dialogue).getByRole('button', { name: 'Abandonner' }));

    await waitFor(() => expect(corpsRecu).toEqual({ statut: 'abandonne' }));
  });

  it('envoie le motif saisi au moment d’abandonner un travail (facultatif, transmis quand renseigné)', async () => {
    installerSession();
    server.use(
      http.get('/api/v1/vehicules/v1/travaux-reportes', () => HttpResponse.json([TRAVAIL_OUVERT])),
    );
    let corpsRecu: unknown;
    server.use(
      http.patch('/api/v1/vehicules/v1/travaux-reportes/t1', async ({ request }) => {
        corpsRecu = await request.json();
        return HttpResponse.json({
          ...TRAVAIL_OUVERT,
          statut: 'abandonne',
          motifModification: 'Parti à la concurrence.',
          detail: null,
        });
      }),
    );
    const utilisateur = userEvent.setup();
    rendre();

    await utilisateur.click(await screen.findByRole('button', { name: 'Abandonner' }));
    const dialogue = await screen.findByRole('dialog');
    await utilisateur.type(
      within(dialogue).getByLabelText('Motif (facultatif)'),
      'Parti à la concurrence.',
    );
    await utilisateur.click(within(dialogue).getByRole('button', { name: 'Abandonner' }));

    await waitFor(() =>
      expect(corpsRecu).toEqual({ statut: 'abandonne', motif: 'Parti à la concurrence.' }),
    );
  });

  it('refuse un motif trop court (moins de 3 caractères) SANS envoyer la requête, dialogue laissé ouvert', async () => {
    installerSession();
    server.use(
      http.get('/api/v1/vehicules/v1/travaux-reportes', () => HttpResponse.json([TRAVAIL_OUVERT])),
    );
    let appele = false;
    server.use(
      http.patch('/api/v1/vehicules/v1/travaux-reportes/t1', () => {
        appele = true;
        return HttpResponse.json({ ...TRAVAIL_OUVERT, statut: 'abandonne' });
      }),
    );
    const utilisateur = userEvent.setup();
    rendre();

    await utilisateur.click(await screen.findByRole('button', { name: 'Abandonner' }));
    const dialogue = await screen.findByRole('dialog');
    await utilisateur.type(within(dialogue).getByLabelText('Motif (facultatif)'), 'x');
    await utilisateur.click(within(dialogue).getByRole('button', { name: 'Abandonner' }));

    expect(
      await within(dialogue).findByText(
        "Le motif doit compter au moins 3 caractères s'il est renseigné.",
      ),
    ).toBeInTheDocument();
    expect(appele).toBe(false);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('affiche une erreur actionnable si la modification échoue (ex. droit retiré entre-temps)', async () => {
    installerSession();
    server.use(
      http.get('/api/v1/vehicules/v1/travaux-reportes', () => HttpResponse.json([TRAVAIL_OUVERT])),
      http.patch('/api/v1/vehicules/v1/travaux-reportes/t1', () =>
        HttpResponse.json(
          {
            type: 'https://docs.dmsforall.example/erreurs/DROIT_INSUFFISANT',
            title: 'Droit insuffisant',
            status: 403,
            code: 'DROIT_INSUFFISANT',
            instance: 'req-1',
          },
          { status: 403, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    const utilisateur = userEvent.setup();
    rendre();

    await utilisateur.click(await screen.findByRole('button', { name: 'Marquer comme repris' }));
    const dialogue = await screen.findByRole('dialog');
    await utilisateur.click(within(dialogue).getByRole('button', { name: 'Marquer comme repris' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('« Reporter un travail » : un technicien (sans droit de gestion) note un travail, POST envoyé avec urgence par défaut', async () => {
    installerSession('technicien');
    server.use(http.get('/api/v1/vehicules/v1/travaux-reportes', () => HttpResponse.json([])));
    let corps: unknown = null;
    server.use(
      http.post('/api/v1/vehicules/v1/travaux-reportes', async ({ request }) => {
        corps = await request.json();
        return HttpResponse.json({ ...TRAVAIL_OUVERT, designation: 'Courroie' }, { status: 201 });
      }),
    );
    rendre();

    const bouton = await screen.findByRole('button', { name: 'Reporter un travail' });
    expect(screen.queryByRole('button', { name: 'Corriger' })).not.toBeInTheDocument();
    await userEvent.click(bouton);
    const dialogue = await screen.findByRole('dialog');
    await userEvent.type(within(dialogue).getByLabelText('Désignation'), 'Courroie');
    await userEvent.click(within(dialogue).getByRole('button', { name: 'Enregistrer' }));

    await waitFor(() => expect(corps).toEqual({ designation: 'Courroie', urgence: 'a_faire' }));
  });

  it('« Reporter un travail » est absent pour un rôle sans `vehicule.travail_reporte.signaler` (vendeur)', async () => {
    installerSession('vendeur');
    server.use(http.get('/api/v1/vehicules/v1/travaux-reportes', () => HttpResponse.json([])));
    rendre();

    await screen.findByText('Aucun travail reporté pour ce véhicule.');
    expect(screen.queryByRole('button', { name: 'Reporter un travail' })).not.toBeInTheDocument();
  });
});
