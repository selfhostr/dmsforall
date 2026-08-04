import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { ReponseParametresAtelier } from '@dfa/shared';

import '@/i18n';
import i18n from '@/i18n';

import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { EcranParametrageAtelier } from './EcranParametrageAtelier';

// Radix Select appelle `hasPointerCapture`/`scrollIntoView` (absents de jsdom) et observe sa
// hauteur via `ResizeObserver` (également absent) — même stub que
// `ecrans/recherche/EcranRecherche.spec.tsx`.
beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

const CHEMIN = '/api/v1/parametres-atelier';

const PARAMETRES: ReponseParametresAtelier = {
  or: {
    prefixe: 'OR',
    porteeNumerotation: 'tenant',
    resetAnnuel: true,
    etatPlanifieActif: false,
    sansRdvAutorise: true,
    rdvRetroactifAuto: false,
    deuxOrMemeVehicule: 'avertir',
  },
  reception: {
    kmEntreeObligatoire: true,
    kmSortieObligatoire: false,
    signature: 'recommandee',
    plafondDefautCentimes: 30000,
  },
  travaux: {
    uniteTemps: 'heures_decimales',
    arrondiPointage: 'dixieme',
    chevauchementPointageAutorise: false,
    pointageObligatoirePourTerminer: false,
    controleQualite: 'jamais',
    dureeMaxPointageHeures: 12,
  },
  facturation: {
    multiPayeursAutorise: false,
    restitutionAvantPaiement: true,
    piecesClientAutorisees: false,
    politiqueDemontageRefuse: 'facturer',
    seuilDemontageCentimes: null,
    produitsAtelier: { mode: 'desactive', pourmille: null, plafondCentimes: null },
  },
  documents: {
    langue: 'client',
    mentionSecurite: 'obligatoire',
  },
  vehicule: {
    expertiseAlerteMois: 2,
    visibiliteHistoriqueNouveauDetenteur: 'technique',
  },
  planning: {
    noShowSeuilAlerte: 3,
    tamponPretMinutes: 0,
    rappel: { canal: 'aucun', joursAvant: 0 },
  },
  fonctionnalites: { facturation: false, stockPieces: false, depotPneus: false, prets: false },
  version: 1_700_000_000_000,
};

function connecterSession(role: (typeof SESSION_TEST)['utilisateur']['role'] = 'chef_atelier') {
  server.use(
    http.get('/api/v1/auth/moi', () =>
      HttpResponse.json({ ...SESSION_TEST, utilisateur: { ...SESSION_TEST.utilisateur, role } }),
    ),
  );
}

function rendre() {
  const queryClient = creerQueryClientTest();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <EcranParametrageAtelier />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EcranParametrageAtelier', () => {
  it('affiche un squelette pendant le chargement', async () => {
    connecterSession('chef_atelier');
    server.use(
      http.get(CHEMIN, async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return HttpResponse.json(PARAMETRES);
      }),
    );
    rendre();

    expect(screen.getByText(i18n.t('commun:chargement.enCours'))).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByLabelText(i18n.t('parametrage:atelier.or.prefixe'))).toBeInTheDocument(),
    );
  });

  it('affiche les valeurs actuelles et les domaines inertes en lecture seule (rôle habilité)', async () => {
    connecterSession('chef_atelier');
    server.use(http.get(CHEMIN, () => HttpResponse.json(PARAMETRES)));
    rendre();

    expect(await screen.findByLabelText(i18n.t('parametrage:atelier.or.prefixe'))).toHaveValue(
      'OR',
    );
    expect(screen.getByText(i18n.t('parametrage:atelier.aVenir.titre'))).toBeInTheDocument();
    expect(
      screen.getAllByText(i18n.t('parametrage:atelier.aVenir.pasEncoreDisponible')).length,
    ).toBe(4);
    expect(screen.queryByText(i18n.t('parametrage:atelier.lectureSeule'))).not.toBeInTheDocument();
  });

  it("affiche un bandeau lecture seule et n'affiche pas le bouton enregistrer pour un rôle sans droit (réceptionnaire)", async () => {
    connecterSession('receptionnaire');
    server.use(http.get(CHEMIN, () => HttpResponse.json(PARAMETRES)));
    rendre();

    expect(await screen.findByText(i18n.t('parametrage:atelier.lectureSeule'))).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: i18n.t('commun:actions.enregistrer') }),
    ).not.toBeInTheDocument();
    // Champs désactivés, pas retirés — le réceptionnaire voit toujours la configuration réelle.
    expect(screen.getByLabelText(i18n.t('parametrage:atelier.or.prefixe'))).toBeDisabled();
  });

  it('enregistre une modification et n’envoie jamais un domaine inerte au lot 1', async () => {
    connecterSession('chef_atelier');
    let corpsRecu: unknown;
    server.use(
      http.get(CHEMIN, () => HttpResponse.json(PARAMETRES)),
      http.patch(CHEMIN, async ({ request }) => {
        corpsRecu = await request.json();
        return HttpResponse.json({
          ...PARAMETRES,
          or: { ...PARAMETRES.or, prefixe: 'REP' },
          version: PARAMETRES.version + 1,
        });
      }),
    );
    rendre();

    const champPrefixe = await screen.findByLabelText(i18n.t('parametrage:atelier.or.prefixe'));
    const utilisateur = userEvent.setup();
    await utilisateur.clear(champPrefixe);
    await utilisateur.type(champPrefixe, 'REP');
    await utilisateur.click(
      screen.getByRole('button', { name: i18n.t('commun:actions.enregistrer') }),
    );

    expect(
      await screen.findByText(i18n.t('parametrage:atelier.enregistrementReussi')),
    ).toBeInTheDocument();
    expect(corpsRecu).toMatchObject({ or: { prefixe: 'REP' } });
    const corps = corpsRecu as Record<string, unknown>;
    expect(corps.facturation).toBeUndefined();
    expect(corps.planning).toBeUndefined();
  });

  it('affiche un état d’erreur actionnable sur une panne serveur', async () => {
    connecterSession('chef_atelier');
    server.use(
      http.get(CHEMIN, () =>
        HttpResponse.json(
          {
            type: 'https://docs.dmsforall.example/erreurs/ERREUR_INTERNE',
            title: 'Erreur interne',
            status: 500,
            code: 'ERREUR_INTERNE',
            instance: 'req-1',
          },
          { status: 500, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    rendre();

    expect(
      await screen.findByRole('button', { name: i18n.t('commun:actions.reessayer') }),
    ).toBeInTheDocument();
  });
});
